import { PackerToolHandler, IPackerToolHandler } from './packer';
import { ToolRunner, IExecOptions } from 'azure-pipelines-task-lib/toolrunner';
import { PackerBaseCommandInitializer, PackerAuthorizationCommandInitializer } from './packer-commands';
import { getSecureVarFileArgs, SecureFileLoader } from './secure-file-loader';
import { EnvironmentVariableHelper } from './environment-variables';
import tasks = require('azure-pipelines-task-lib/task');
import path = require('path');
import fs = require('fs');

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

    /** True when `resolvedPath` is workingDirectory itself or a descendant of it. */
    protected isWithinWorkingDirectory(resolvedPath: string, workingDirectory: string): boolean {
        const base = path.resolve(workingDirectory || '.');
        const target = path.resolve(resolvedPath);
        return target === base || target.startsWith(base + path.sep);
    }

    /**
     * Reads a boolean input, returning `defaultValue` when the input is unset.
     * Use this for inputs that default to `true`; `tasks.getBoolInput(name, false)`
     * always defaults to `false` and is fine for false-defaulting inputs.
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

    protected getProviderSuffix(): string {
        const provider = tasks.getInput("provider") || "none";
        switch (provider) {
            case "azurerm": return "AzureRM";
            case "aws": return "AWS";
            case "gcp": return "GCP";
            case "oci": return "OCI";
            case "vsphere": return "VSphere";
            default: return ""; // none
        }
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

    /** Prefixes/names this task manages itself; a passthrough value here would shadow a real credential. */
    private static readonly MANAGED_ENV_PATTERNS = [
        /^AWS_/, /^ARM_/, /^GOOGLE_/, /^PKR_VAR_oci_/, /^PKR_VAR_vsphere_/, /^PKR_VAR_arm_/, /PROXY$/i
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
            if (BasePackerCommandHandler.MANAGED_ENV_PATTERNS.some((p) => p.test(key))) {
                tasks.warning(`'environmentVariables' sets '${key}', which this task also manages for cloud credentials. This value will be overwritten by the provider handler for build/validate/console/custom, or persist unmasked for commands that don't authenticate. Use 'environmentVariables' for non-secret builder settings only.`);
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

    protected async execWithStdoutCapture(tool: ToolRunner, options: IExecOptions): Promise<{ code: number; stdout: string }> {
        let stdout = '';
        tool.on('stdout', (data: string | Buffer) => {
            stdout += data.toString();
        });
        const code = await tool.execAsync(options);
        return { code, stdout };
    }

    public cleanupTempFiles(): void {
        for (const filePath of this.tempFiles) {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    tasks.debug(`Cleaned up temp file: ${filePath}`);
                }
            } catch (err) {
                tasks.debug(`Failed to clean up temp file ${filePath}: ${err}`);
            }
        }
        this.tempFiles = [];

        if (this.secureFileId) {
            try {
                new SecureFileLoader().deleteSecureFile(this.secureFileId);
            } catch (err) {
                tasks.debug(`Failed to clean up secure file: ${err}`);
            }
            this.secureFileId = null;
        }
    }

    // --- Dispatch ---

    public async executeCommand(command: string): Promise<number> {
        this.applyEnvironmentVariables();

        const commands: Record<string, () => Promise<number>> = {
            init: () => this.init(),
            validate: () => this.validate(),
            build: () => this.build(),
            fmt: () => this.fmt(),
            inspect: () => this.inspect(),
            console: () => this.console(),
            fix: () => this.fix(),
            hcl2_upgrade: () => this.hcl2Upgrade(),
            plugins: () => this.plugins(),
            version: () => this.version(),
            custom: () => this.custom(),
        };
        const fn = commands[command];
        if (!fn) {
            throw new Error(`Invalid command: ${command}. Valid: ${Object.keys(commands).join(', ')}`);
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

        const code = await tool.execAsync(<IExecOptions>{ cwd: command.workingDirectory });
        this.setBuildOutputs();
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
            const result = await this.execWithStdoutCapture(tool, { cwd: command.workingDirectory });
            tasks.writeFile(resolved, result.stdout);
            tasks.setVariable('fixFilePath', resolved, false, true);
            return result.code;
        }

        return tool.execAsync(<IExecOptions>{ cwd: command.workingDirectory });
    }

    public async hcl2Upgrade(): Promise<number> {
        const command = this.createBaseCommand("hcl2_upgrade");
        const tool = this.packerToolHandler.createToolRunner(command);

        const outputFile = tasks.getInput("hclOutputFile", false);
        if (outputFile) tool.arg(`-output-file=${outputFile}`);
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
    private setBuildOutputs(): void {
        const manifestFile = tasks.getInput("manifestFile", false);
        if (!manifestFile) return;

        const resolved = path.resolve(this.getWorkingDirectory(), manifestFile);
        if (!this.isWithinWorkingDirectory(resolved, this.getWorkingDirectory())) {
            tasks.warning(`manifestFile '${manifestFile}' resolves outside the working directory (${resolved}); skipping build output variables.`);
            return;
        }
        if (!fs.existsSync(resolved)) {
            tasks.debug(`Manifest file not found at ${resolved}; skipping build output variables.`);
            return;
        }
        try {
            const manifest = JSON.parse(fs.readFileSync(resolved, 'utf8'));
            tasks.setVariable('manifestFilePath', resolved, false, true);

            const builds = manifest.builds;
            if (Array.isArray(builds) && builds.length > 0) {
                const last = builds[builds.length - 1];
                const artifactId = last?.artifact_id;
                if (typeof artifactId === 'string' || typeof artifactId === 'number') {
                    tasks.setVariable('artifactId', String(artifactId), false, true);
                    tasks.debug(`Set artifactId output variable: ${artifactId}`);
                } else if (artifactId !== undefined) {
                    tasks.debug(`Manifest artifact_id is not a string or number (${typeof artifactId}); skipping artifactId output variable.`);
                }
            }
        } catch (err) {
            tasks.debug(`Could not parse Packer manifest for build outputs: ${err}`);
        }
    }
}
