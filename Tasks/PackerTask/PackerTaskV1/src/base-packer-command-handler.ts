import { PackerToolHandler, IPackerToolHandler } from './packer';
import { ToolRunner, IExecOptions } from 'azure-pipelines-task-lib/toolrunner';
import { PackerBaseCommandInitializer, PackerAuthorizationCommandInitializer } from './packer-commands';
import { getSecureVarFileArgs, SecureFileLoader } from './secure-file-loader';
import { EnvironmentVariableHelper } from './environment-variables';
import { writeSecretFile } from './secure-temp';
import { generateIdToken } from './id-token-generator';
import tasks = require('azure-pipelines-task-lib/task');
import path = require('path');
import fs = require('fs');
import os = require('os');
import { randomUUID as uuidV4 } from 'crypto';

export abstract class BasePackerCommandHandler {
    providerName: string;
    packerToolHandler: IPackerToolHandler;
    protected tempFiles: string[];
    private secureFileId: string | null = null;

    /** Injects provider credentials as environment variables for commands that build/evaluate. */
    abstract handleProvider(command: PackerAuthorizationCommandInitializer): Promise<void>;

    constructor() {
        this.providerName = "";
        this.packerToolHandler = new PackerToolHandler(tasks);
        this.tempFiles = [];
    }

    // --- Shared helpers ---

    protected getWorkingDirectory(): string {
        return tasks.getInput("workingDirectory") || '';
    }

    /** The trailing template path/dir argument. Defaults to the current directory. */
    protected getTemplatePath(): string {
        return tasks.getInput("templatePath") || '.';
    }

    /**
     * True when `resolvedPath` is workingDirectory itself or a descendant of it,
     * with symlinks resolved on both sides. A purely lexical check (path.resolve +
     * startsWith) is blind to an in-tree symlink (e.g. one left by a checkout or a
     * prior build step) whose lexical path stays under base but which points
     * outside — so a manifest read / fix-output write could escape the working
     * directory. Because a write target may not exist yet, the deepest EXISTING
     * ancestor is realpath'd and the not-yet-existent tail (which cannot itself be
     * a symlink) is re-appended.
     */
    protected isWithinWorkingDirectory(resolvedPath: string, workingDirectory: string): boolean {
        const base = this.realpathOfExistingPrefix(path.resolve(workingDirectory || '.'));
        const target = this.realpathOfExistingPrefix(path.resolve(resolvedPath));
        return target === base || target.startsWith(base + path.sep);
    }

    /** realpath the deepest existing ancestor of `p`, re-appending any non-existent tail. */
    private realpathOfExistingPrefix(p: string): string {
        let existing = p;
        const tail: string[] = [];
        while (!fs.existsSync(existing)) {
            const parent = path.dirname(existing);
            if (parent === existing) return p; // hit the root with no existing ancestor
            tail.unshift(path.basename(existing));
            existing = parent;
        }
        return tail.length ? path.join(fs.realpathSync(existing), ...tail) : fs.realpathSync(existing);
    }

    /**
     * Reads a boolean input, returning `defaultValue` when the input is unset.
     * Use this for inputs that default to `true`; `tasks.getBoolInput(name, false)`
     * always defaults to `false` and is fine for false-defaulting inputs.
     * Intentionally duplicated as a free function in the PackerInstaller task
     * (packer-installer.ts): the two tasks are bundled separately and share no
     * module, mirroring the annotated http-client.ts duplication.
     */
    protected getBoolInputWithDefault(name: string, defaultValue: boolean): boolean {
        const value = tasks.getInput(name, false);
        if (value === undefined || value === '') return defaultValue;
        return value === 'true';
    }

    /** Auth schemes shared by the AWS and GCP handlers (both support static-credential and WIF service connections). */
    protected static readonly VALID_AUTH_SCHEMES = ["ServiceConnection", "WorkloadIdentityFederation"] as const;

    protected validateAuthScheme(scheme: string, inputName: string): void {
        if (!(BasePackerCommandHandler.VALID_AUTH_SCHEMES as readonly string[]).includes(scheme)) {
            throw new Error(`Unrecognized authorization scheme '${scheme}' for input '${inputName}'. Valid values: ${BasePackerCommandHandler.VALID_AUTH_SCHEMES.join(", ")}`);
        }
    }

    /** Maps a provider id (this.providerName) to its input-name suffix (environmentServiceName<Suffix>). */
    private static readonly PROVIDER_SUFFIX: Record<string, string> = {
        azurerm: "AzureRM",
        aws: "AWS",
        gcp: "GCP",
        oci: "OCI",
        vsphere: "VSphere",
    };

    protected getProviderSuffix(): string {
        // Derive from the instance's own providerName (set in each subclass
        // constructor) rather than re-reading the global 'provider' input — the
        // handler already knows which provider it is, and this keeps a single
        // provider→class mapping in parent-handler.ts.
        return BasePackerCommandHandler.PROVIDER_SUFFIX[this.providerName] ?? ""; // none
    }

    protected getServiceName(): string {
        const suffix = this.getProviderSuffix();
        return suffix ? `environmentServiceName${suffix}` : '';
    }

    protected createAuthCommand(commandName: string): PackerAuthorizationCommandInitializer {
        const serviceName = this.getServiceName();
        const serviceConnection = serviceName ? (tasks.getInput(serviceName, false) || '') : '';
        return new PackerAuthorizationCommandInitializer(
            commandName,
            this.getWorkingDirectory(),
            serviceConnection
        );
    }

    protected createBaseCommand(commandName: string): PackerBaseCommandInitializer {
        return new PackerBaseCommandInitializer(
            commandName,
            this.getWorkingDirectory()
        );
    }

    /**
     * Prefixes/names this task manages itself; a passthrough value here would
     * shadow a real credential.
     *
     * `/^ARM_/` is deliberately NOT in this list (#207). `packer-plugin-azure`
     * does not read `ARM_*` environment variables at all — its auth fields are
     * HCL-only, and the Azure handler injects only `PKR_VAR_arm_*` — so no
     * handler in this codebase ever sets or overwrites a bare `ARM_*`, and
     * warning that this task "also manages" it was simply false. It was a
     * carry-over from the sibling Terraform extension, where `ARM_*` genuinely
     * is the provider's native convention. A bare `ARM_*` is still refused, one
     * check earlier and more strongly, by IDENTITY_SELECTING_ENV_PATTERNS below:
     * an operator setting one has mistaken this extension for the Terraform one
     * and their credential would silently do nothing.
     */
    private static readonly MANAGED_ENV_PATTERNS = [
        /^AWS_/, /^GOOGLE_/, /^PKR_VAR_oci_/, /^PKR_VAR_vsphere_/, /^PKR_VAR_arm_/, /PROXY$/i
    ];

    /**
     * The subset of managed names that SELECT AN IDENTITY rather than merely
     * configure one. These are rejected outright instead of warned about (#187).
     *
     * A warning was never sufficient here: `applyEnvironmentVariables()` runs in
     * `executeCommand()` BEFORE `handleProvider()`, and while a provider handler
     * does overwrite the variables it sets, it historically never cleared the
     * ones belonging to a DIFFERENT auth scheme. A passthrough
     * `AWS_ACCESS_KEY_ID` therefore survived into the AWS SDK's credential chain,
     * which matches static env credentials strictly before the web-identity token
     * file -- silently defeating Workload Identity Federation on the path
     * operators are told is the safer one. The handlers now neutralize competing
     * variables too (credential-guards.ts), but a value that names an identity has
     * no legitimate reason to arrive through a builder-settings passthrough at all,
     * so it fails the task instead.
     */
    private static readonly IDENTITY_SELECTING_ENV_PATTERNS = [
        /^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|PROFILE|SHARED_CREDENTIALS_FILE|WEB_IDENTITY_TOKEN_FILE|ROLE_ARN|ROLE_SESSION_NAME)$/,
        /^GOOGLE_(APPLICATION_CREDENTIALS|CREDENTIALS|OAUTH_ACCESS_TOKEN|GHA_CREDS_PATH)$/,
        /^CLOUDSDK_AUTH_/,
        /^PKR_VAR_arm_(client_id|client_secret|client_jwt|client_cert_path|tenant_id|subscription_id)$/,
        /^PKR_VAR_oci_/,
        /^PKR_VAR_vsphere_(server|user|password|insecure_connection)$/,
        /^OCI_CLI_/,
        /^ARM_/,
    ];

    /** Sets any user-provided passthrough environment variables (tracked for cleanup). */
    protected applyEnvironmentVariables(): void {
        const env = tasks.getInput("environmentVariables", false);
        if (!env) return;
        for (const line of env.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const idx = trimmed.indexOf('=');
            if (idx <= 0) {
                tasks.warning(`Ignoring malformed environment variable line (expected key=value): ${trimmed}`);
                continue;
            }
            const key = trimmed.substring(0, idx).trim();
            const value = trimmed.substring(idx + 1).trim();
            if (BasePackerCommandHandler.IDENTITY_SELECTING_ENV_PATTERNS.some((p) => p.test(key))) {
                throw new Error(`'environmentVariables' sets '${key}', which selects a cloud identity. Credentials must come from a service connection: this task resolves them per provider and masks them, whereas a passthrough value is unmasked and can take precedence over the service connection's own credentials in the provider SDK's resolution order. Remove '${key}' from 'environmentVariables' and configure the service connection instead.`);
            }
            if (BasePackerCommandHandler.MANAGED_ENV_PATTERNS.some((p) => p.test(key))) {
                // Deliberately NOT promising an overwrite: the previous wording
                // ("will be overwritten by the provider handler") was true for
                // AWS_REGION but false for the variables that actually decide
                // identity, which is what made it misleading (#187). Those names
                // are now rejected above; what reaches here only configures an
                // already-chosen identity.
                tasks.warning(`'environmentVariables' sets '${key}', a name this task also manages. A provider handler may replace it during build/validate/console/custom, and it persists unmasked for commands that don't authenticate. Use 'environmentVariables' for non-secret builder settings only.`);
            }
            EnvironmentVariableHelper.setEnvironmentVariable(key, value);
        }
    }

    /** Adds `-var-file=` tokens (secure file + variableFiles) and `-var key=value` tokens. */
    protected async applyVarArgs(tool: ToolRunner): Promise<void> {
        const secure = await getSecureVarFileArgs();
        if (secure) {
            this.secureFileId = secure.secureFileId;
            tool.arg(secure.varFileArg);
        }

        const variableFiles = tasks.getInput("variableFiles", false);
        if (variableFiles) {
            for (const line of variableFiles.split('\n')) {
                const trimmed = line.trim();
                if (trimmed) tool.arg(`-var-file=${trimmed}`);
            }
        }

        const packerVariables = tasks.getInput("packerVariables", false);
        if (packerVariables) {
            for (const line of packerVariables.split('\n')) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    tool.arg('-var');
                    tool.arg(trimmed);
                }
            }
        }
    }

    protected applyCommandOptions(tool: ToolRunner): void {
        const commandOptions = tasks.getInput("commandOptions");
        if (commandOptions) tool.line(commandOptions);
    }

    /**
     * Runs `tool` while buffering its stdout, and RETURNS the exit code instead of
     * rejecting on it.
     *
     * `ignoreReturnCode` is forced here rather than left to callers (#203):
     * task-lib's ToolRunner rejects the promise on any non-zero exit unless it is
     * set, which would throw away the very stdout this method exists to capture.
     * `packer fix` prints the fixed template and then exits non-zero merely
     * because its own default post-fix `-validate` check still fails -- a common,
     * non-catastrophic outcome, since fix does not resolve every deprecation. The
     * equivalent raw CLI usage (`packer fix template.json > fixed.json`) keeps the
     * output regardless of exit status, and fixOutputFile exists to replace that
     * workflow. Callers get the code and remain responsible for failing the task.
     */
    protected async execWithStdoutCapture(tool: ToolRunner, options: IExecOptions): Promise<{ code: number; stdout: string }> {
        let stdout = '';
        tool.on('stdout', (data: string | Buffer) => {
            stdout += data.toString();
        });
        const code = await tool.execAsync(<IExecOptions>{ ...options, ignoreReturnCode: true });
        return { code, stdout };
    }

    /**
     * Writes `content` to a uniquely-named 0600 temp file (`<prefix>-<uuid>.<ext>`),
     * tracks it for cleanup, and returns the path. Centralizes the temp-secret
     * convention shared by the AWS/GCP/OCI handlers.
     */
    protected writeTrackedSecretFile(prefix: string, ext: string, content: string): string {
        // Prefer Agent.TempDirectory (purged between jobs) over the shared OS
        // tmpdir so an abnormal termination (SIGKILL, hard crash) that skips the
        // finally-block/signal-handler cleanup still gets an agent-provided
        // backstop for these long-lived credential files (#104). Falls back to
        // os.tmpdir() for headless/mock runs (and any run where the variable is
        // unset), which is every existing test -- no behavior change there.
        const baseDir = tasks.getVariable('Agent.TempDirectory') || os.tmpdir();
        const filePath = path.join(baseDir, `${prefix}-${uuidV4()}.${ext}`);
        writeSecretFile(filePath, content);
        this.tempFiles.push(filePath);
        return filePath;
    }

    /**
     * Requests an ADO OIDC token for `serviceConnection`, masks it, and writes it
     * to a tracked `.jwt` temp file (the shared AWS/GCP Workload Identity Federation
     * idiom). Returns the token file path.
     */
    protected async writeOidcTokenFile(serviceConnection: string, prefix: string): Promise<string> {
        const oidcToken = await generateIdToken(serviceConnection);
        tasks.setSecret(oidcToken);
        return this.writeTrackedSecretFile(prefix, 'jwt', oidcToken);
    }

    public cleanupTempFiles(): void {
        for (const filePath of this.tempFiles) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    tasks.debug(`Cleaned up temp file: ${filePath}`);
                }
            } catch (err) {
                // A leftover credential temp file (OIDC token / GCP or OCI key) is
                // a real exposure on a self-hosted agent -- surface it above debug (#104).
                tasks.warning(`Failed to clean up temp file ${filePath}: ${err}`);
            }
        }
        this.tempFiles = [];

        if (this.secureFileId) {
            try {
                new SecureFileLoader().deleteSecureFile(this.secureFileId);
            } catch (err) {
                tasks.warning(`Failed to clean up secure file: ${err}`);
            }
            this.secureFileId = null;
        }
    }

    // --- Dispatch ---

    public async executeCommand(command: string): Promise<number> {
        this.applyEnvironmentVariables();

        // A Map, not an object literal: `command` is a task input, and an object
        // literal keyed by it resolves `constructor` to Object -- truthy, callable,
        // and therefore straight past the not-found guard below.
        const commands = new Map<string, () => Promise<number>>([
            ['init', () => this.init()],
            ['validate', () => this.validate()],
            ['build', () => this.build()],
            ['fmt', () => this.fmt()],
            ['inspect', () => this.inspect()],
            ['console', () => this.console()],
            ['fix', () => this.fix()],
            ['hcl2_upgrade', () => this.hcl2Upgrade()],
            ['plugins', () => this.plugins()],
            ['version', () => this.version()],
            ['custom', () => this.custom()],
        ]);
        const fn = commands.get(command);
        if (!fn) {
            throw new Error(`Invalid command: ${command}. Valid: ${[...commands.keys()].join(', ')}`);
        }
        return fn();
    }

    // --- Command implementations ---

    public async init(): Promise<number> {
        const command = this.createBaseCommand("init");
        const tool = this.packerToolHandler.createToolRunner(command);

        if (tasks.getBoolInput("upgradePlugins", false)) {
            tool.arg('-upgrade');
        }

        const githubToken = tasks.getInput("githubToken", false);
        if (githubToken) {
            // Avoids GitHub API rate limits during plugin download.
            EnvironmentVariableHelper.setEnvironmentVariable("PACKER_GITHUB_API_TOKEN", githubToken, true);
        }

        this.applyCommandOptions(tool);
        tool.arg(this.getTemplatePath());

        return tool.execAsync(<IExecOptions>{ cwd: command.workingDirectory });
    }

    public async validate(): Promise<number> {
        const command = this.createAuthCommand("validate");
        const tool = this.packerToolHandler.createToolRunner(command);

        if (tasks.getBoolInput("syntaxOnly", false)) {
            tool.arg('-syntax-only');
        }
        await this.applyVarArgs(tool);
        this.applyCommandOptions(tool);
        tool.arg(this.getTemplatePath());

        await this.handleProvider(command);

        return tool.execAsync(<IExecOptions>{ cwd: command.workingDirectory });
    }

    public async build(): Promise<number> {
        const command = this.createAuthCommand("build");
        const tool = this.packerToolHandler.createToolRunner(command);

        const only = tasks.getInput("onlyBuilds", false);
        if (only) tool.arg(`-only=${only}`);

        const except = tasks.getInput("exceptBuilds", false);
        if (except) tool.arg(`-except=${except}`);

        const parallelBuilds = tasks.getInput("parallelBuilds", false);
        if (parallelBuilds) {
            const n = parseInt(parallelBuilds, 10);
            if (isNaN(n) || n < 1) {
                throw new Error(`Invalid parallelBuilds value '${parallelBuilds}': must be a positive integer`);
            }
            tool.arg(`-parallel-builds=${n}`);
        }

        const onError = tasks.getInput("onError", false);
        if (onError && onError !== 'default') {
            tool.arg(`-on-error=${onError}`);
        }

        if (tasks.getBoolInput("force", false)) {
            tool.arg('-force');
        }

        if (tasks.getBoolInput("disableColor", false)) {
            tool.arg('-color=false');
        }

        await this.applyVarArgs(tool);
        this.applyCommandOptions(tool);
        tool.arg(this.getTemplatePath());

        await this.handleProvider(command);

        // #202: the manifest post-processor writes artifact_id entries as each
        // builder finishes, so a multi-builder template that fails on ONE builder
        // still leaves a manifest on disk naming the artifacts the others already
        // created. With the default ignoreReturnCode:false the await below would
        // reject and setBuildOutputs() would never run, hiding exactly the ids a
        // cleanup/deregistration step needs to remove those orphans. Capture the
        // code, publish the outputs, and only then fail.
        const code = await tool.execAsync(<IExecOptions>{ cwd: command.workingDirectory, ignoreReturnCode: true });
        this.setBuildOutputs();
        if (code !== 0) {
            throw new Error(`packer build failed with exit code ${code}.`);
        }
        return code;
    }

    public async fmt(): Promise<number> {
        const command = this.createBaseCommand("fmt");
        const tool = this.packerToolHandler.createToolRunner(command);

        // Defaults to check mode: a formatting diff fails the task.
        if (this.getBoolInputWithDefault("fmtCheck", true)) {
            tool.arg('-check');
            tool.arg('-diff');
        }
        if (tasks.getBoolInput("fmtWrite", false)) {
            tool.arg('-write=true');
        }
        if (tasks.getBoolInput("fmtRecursive", false)) {
            tool.arg('-recursive');
        }
        this.applyCommandOptions(tool);
        tool.arg(this.getTemplatePath());

        return tool.execAsync(<IExecOptions>{ cwd: command.workingDirectory });
    }

    public async inspect(): Promise<number> {
        const command = this.createBaseCommand("inspect");
        const tool = this.packerToolHandler.createToolRunner(command);

        this.applyCommandOptions(tool);
        tool.arg(this.getTemplatePath());

        return tool.execAsync(<IExecOptions>{ cwd: command.workingDirectory });
    }

    public async console(): Promise<number> {
        const command = this.createAuthCommand("console");
        const tool = this.packerToolHandler.createToolRunner(command);

        this.applyCommandOptions(tool);
        tool.arg(this.getTemplatePath());

        await this.handleProvider(command);

        // Non-interactive: feed the expression on stdin so the console evaluates and exits.
        const expression = tasks.getInput("consoleExpression", false) || '';
        return tool.execAsync(<IExecOptions>{
            cwd: command.workingDirectory,
            input: Buffer.from(expression ? `${expression}\n` : '')
        });
    }

    public async fix(): Promise<number> {
        const command = this.createBaseCommand("fix");
        const tool = this.packerToolHandler.createToolRunner(command);

        if (!this.getBoolInputWithDefault("fixValidate", true)) {
            tool.arg('-validate=false');
        }
        this.applyCommandOptions(tool);
        tool.arg(this.getTemplatePath());

        const outputFile = tasks.getInput("fixOutputFile", false);
        if (outputFile) {
            const resolved = path.resolve(command.workingDirectory, outputFile);
            if (!this.isWithinWorkingDirectory(resolved, command.workingDirectory)) {
                throw new Error(`fixOutputFile '${outputFile}' resolves outside the working directory (${resolved}). Use a path within workingDirectory.`);
            }
            // execWithStdoutCapture forces ignoreReturnCode, so a non-zero exit
            // resolves here with the fixed template still buffered (#203) instead
            // of rejecting and discarding it.
            const result = await this.execWithStdoutCapture(tool, { cwd: command.workingDirectory });
            // Re-validate immediately before writing (TOCTOU guard, #110): packer
            // fix's run is an arbitrarily long window during which a symlink could
            // be planted at `resolved`, which the lexical write below cannot
            // itself detect.
            if (!this.isWithinWorkingDirectory(resolved, command.workingDirectory)) {
                throw new Error(`fixOutputFile '${outputFile}' resolves outside the working directory (${resolved}) after packer fix ran. Refusing to write.`);
            }
            if (result.stdout) {
                tasks.writeFile(resolved, result.stdout);
                const safeFixFilePath = this.sanitizeOutputVariableValue(resolved);
                if (safeFixFilePath) {
                    tasks.setVariable('fixFilePath', safeFixFilePath, false, true);
                } else {
                    tasks.warning(`fixFilePath '${resolved}' failed output-variable validation (length/printable-ASCII); skipping fixFilePath output variable.`);
                }
            }
            // The write happens first so the fixed template survives; the task
            // still fails on a non-zero code, exactly as it did before #203.
            if (result.code !== 0) {
                throw new Error(`packer fix failed with exit code ${result.code}.`);
            }
            return result.code;
        }

        return tool.execAsync(<IExecOptions>{ cwd: command.workingDirectory });
    }

    public async hcl2Upgrade(): Promise<number> {
        const command = this.createBaseCommand("hcl2_upgrade");
        const tool = this.packerToolHandler.createToolRunner(command);

        const outputFile = tasks.getInput("hclOutputFile", false);
        if (outputFile) {
            // Same containment guard as fixOutputFile/manifestFile (#100): packer
            // resolves a relative -output-file against its cwd (workingDirectory),
            // so validate before handing it through; the CLI arg itself stays
            // relative (packer does the actual resolution against the same cwd).
            const resolved = path.resolve(command.workingDirectory, outputFile);
            if (!this.isWithinWorkingDirectory(resolved, command.workingDirectory)) {
                throw new Error(`hclOutputFile '${outputFile}' resolves outside the working directory (${resolved}). Use a path within workingDirectory.`);
            }
            tool.arg(`-output-file=${outputFile}`);
        }
        if (tasks.getBoolInput("withAnnotations", false)) tool.arg('-with-annotations');

        this.applyCommandOptions(tool);
        tool.arg(this.getTemplatePath());

        return tool.execAsync(<IExecOptions>{ cwd: command.workingDirectory });
    }

    public async plugins(): Promise<number> {
        const subCommand = tasks.getInput("pluginsSubCommand", true)!;
        const command = this.createBaseCommand(`plugins ${subCommand}`);
        const tool = this.packerToolHandler.createToolRunner(command);

        if (subCommand === 'install' || subCommand === 'remove') {
            const source = tasks.getInput("pluginSource", true)!;
            tool.arg(source);
            const version = tasks.getInput("pluginVersion", false);
            if (version) tool.arg(version);
        }

        this.applyCommandOptions(tool);

        if (subCommand === 'required') {
            tool.arg(this.getTemplatePath());
        }

        return tool.execAsync(<IExecOptions>{ cwd: command.workingDirectory });
    }

    public async version(): Promise<number> {
        const command = this.createBaseCommand("version");
        const tool = this.packerToolHandler.createToolRunner(command);
        return tool.execAsync(<IExecOptions>{ cwd: command.workingDirectory });
    }

    public async custom(): Promise<number> {
        const customCommand = tasks.getInput("customCommand", true)!;
        const command = this.createAuthCommand(customCommand);
        const tool = this.packerToolHandler.createToolRunner(command);

        await this.applyVarArgs(tool);
        this.applyCommandOptions(tool);

        await this.handleProvider(command);

        return tool.execAsync(<IExecOptions>{ cwd: command.workingDirectory });
    }

    // --- Build output parsing ---

    /**
     * If a `manifestFile` input is set, reads the Packer `manifest` post-processor
     * output and exposes the last build's artifact id and the manifest path as
     * pipeline output variables. No-op when the manifest is absent or unparseable.
     */
    /** Upper bound on a template-controlled value before it becomes a pipeline output variable. */
    private static readonly OUTPUT_VAR_MAX_LENGTH = 1024;

    /**
     * Upper bound on the manifest file itself before it is read into memory and
     * JSON.parse'd (#101). The manifest post-processor's output is
     * build-template-controlled: a template that appends unbounded post-processor
     * entries (or simply points manifestFile at a large artifact) would otherwise
     * be buffered whole and parsed. A real manifest is a few KB per build.
     */
    private static readonly MANIFEST_MAX_BYTES = 5 * 1024 * 1024;

    /**
     * Caps length and requires printable-ASCII content before a template- or
     * build-influenced value becomes a pipeline output variable. The manifest
     * JSON (artifactId in particular) is written by the Packer manifest
     * post-processor -- i.e. build-template-controlled, possibly from a less
     * trusted repo than the pipeline definition -- and later steps commonly
     * macro-expand $(artifactId) into a script, so embedded newlines/NUL/
     * control bytes are command/argument injection, not just log noise (#101).
     * Returns null (caller should skip the variable) when validation fails.
     */
    private sanitizeOutputVariableValue(value: string): string | null {
        if (!value || value.length > BasePackerCommandHandler.OUTPUT_VAR_MAX_LENGTH) return null;
        return /^[\x20-\x7E]+$/.test(value) ? value : null;
    }

    private setBuildOutputs(): void {
        const manifestFile = tasks.getInput("manifestFile", false);
        if (!manifestFile) return;

        const resolved = path.resolve(this.getWorkingDirectory(), manifestFile);
        if (!this.isWithinWorkingDirectory(resolved, this.getWorkingDirectory())) {
            tasks.warning(`manifestFile '${manifestFile}' resolves outside the working directory (${resolved}); skipping build output variables.`);
            return;
        }
        if (!fs.existsSync(resolved)) {
            // Explicitly configured by the user -- a missing manifest usually means
            // the template's manifest post-processor block is missing/misconfigured,
            // which should be diagnosable from this step's own log, not debug-only (#106).
            tasks.warning(`Manifest file not found at ${resolved}; skipping build output variables.`);
            return;
        }
        try {
            const size = fs.statSync(resolved).size;
            if (size > BasePackerCommandHandler.MANIFEST_MAX_BYTES) {
                tasks.warning(`Manifest file ${resolved} is ${size} bytes, above the ${BasePackerCommandHandler.MANIFEST_MAX_BYTES}-byte cap; skipping build output variables.`);
                return;
            }
            const manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'));
            const safeManifestPath = this.sanitizeOutputVariableValue(resolved);
            if (safeManifestPath) {
                tasks.setVariable('manifestFilePath', safeManifestPath, false, true);
            } else {
                tasks.warning(`manifestFilePath '${resolved}' failed output-variable validation (length/printable-ASCII); skipping manifestFilePath output variable.`);
            }

            const builds = manifest.builds;
            if (Array.isArray(builds) && builds.length > 0) {
                const last = builds[builds.length - 1];
                const artifactId = last?.artifact_id;
                if (typeof artifactId === 'string' || typeof artifactId === 'number') {
                    const safeArtifactId = this.sanitizeOutputVariableValue(String(artifactId));
                    if (safeArtifactId) {
                        tasks.setVariable('artifactId', safeArtifactId, false, true);
                        tasks.debug(`Set artifactId output variable: ${safeArtifactId}`);
                    } else {
                        tasks.warning(`Manifest artifact_id failed output-variable validation (length/printable-ASCII); skipping artifactId output variable.`);
                    }
                } else if (artifactId !== undefined) {
                    tasks.debug(`Manifest artifact_id is not a string or number (${typeof artifactId}); skipping artifactId output variable.`);
                }
            }
        } catch (err) {
            // Explicitly configured by the user -- a parse failure means the
            // manifest post-processor produced corrupt/unexpected JSON, which
            // should be diagnosable from this step's own log, not debug-only (#106).
            tasks.warning(`Could not parse Packer manifest for build outputs: ${err}`);
        }
    }
}
