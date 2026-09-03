import tasks = require('azure-pipelines-task-lib/task');
import { EnvironmentVariableHelper } from '@4cloudguru/pipeline-task-ado';

/**
 * The `environmentVariables` passthrough policy: which operator-supplied names
 * may reach packer, which are warned about, and which fail the task outright.
 * Extracted from BasePackerCommandHandler (#113).
 *
 * This is a security surface, not plumbing. It runs in executeCommand() BEFORE
 * handleProvider(), so a name that selects an identity would otherwise land in a
 * provider SDK's credential chain ahead of the credential this task mints.
 * PassthroughEnvClassificationL0 drives it directly, table-driven over
 * REJECT/WARN/ALLOW rows.
 */

/**
 * Prefixes/names this task manages itself; a passthrough value here would
 * shadow a real credential.
 *
 * `/^ARM_/` is deliberately NOT in this list (#207). `packer-plugin-azure`'s
 * identity fields (client_id/client_secret/client_jwt/tenant_id/etc.) are
 * HCL-only, and the Azure handler injects only `PKR_VAR_arm_*` — so no
 * handler in this codebase ever sets or overwrites a bare `ARM_*` identity
 * value, and warning that this task "also manages" one was mostly
 * accurate but overstated: `ARM_METADATA_URL` IS a bare env var the plugin
 * reads directly (`setCloudEnvironment()`, verified against upstream
 * `builder/azure/common/client/config.go`), just not for credential fields
 * (#333). The Azure handler neutralizes it explicitly rather than relying
 * on this list. A bare `ARM_*` passthrough is still refused, one check
 * earlier and more strongly, by IDENTITY_SELECTING_ENV_PATTERNS below: an
 * operator setting one has mistaken this extension for the Terraform one
 * (where `ARM_*` genuinely is the provider's native convention) and their
 * credential would silently do nothing.
 */
const MANAGED_ENV_PATTERNS = [
    /^AWS_/, /^GOOGLE_/, /^PKR_VAR_oci_/, /^PKR_VAR_vsphere_/, /^PKR_VAR_arm_/, /PROXY$/i
];

/**
 * A passthrough key whose NAME looks secret-shaped, independent of whether it
 * collides with a name this task manages (#108). An arbitrary credential under
 * an unmanaged name -- DIGITALOCEAN_TOKEN, PKR_VAR_ssh_password -- gets neither
 * the throw above nor the warning below, and reaches the agent unmasked. This
 * is a heuristic, not a classification: it can both under-match (a value named
 * plainly) and over-match (a non-secret path literally named *_KEY). Over-
 * matching costs nothing but an unnecessary *** in the log; under-matching is
 * the reason `environmentVariables`' own helpMarkDown tells operators not to
 * put secrets here at all -- this is defense-in-depth on top of that guidance,
 * not a substitute for it.
 */
const SECRET_SHAPED_KEY_PATTERN = /TOKEN|SECRET|PASSWORD|KEY/i;

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
const IDENTITY_SELECTING_ENV_PATTERNS = [
    /^AWS_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|PROFILE|SHARED_CREDENTIALS_FILE|WEB_IDENTITY_TOKEN_FILE|ROLE_ARN|ROLE_SESSION_NAME)$/,
    /^GOOGLE_(APPLICATION_CREDENTIALS|CREDENTIALS|OAUTH_ACCESS_TOKEN|GHA_CREDS_PATH)$/,
    /^CLOUDSDK_AUTH_/,
    /^PKR_VAR_arm_(client_id|client_secret|client_jwt|client_cert_path|tenant_id|subscription_id|oidc_request_url|oidc_request_token|use_azure_cli_auth)$/,
    /^PKR_VAR_oci_/,
    /^PKR_VAR_vsphere_(server|user|password|insecure_connection)$/,
    /^OCI_CLI_/,
    /^ARM_/,
    // applyEnvironmentVariables() runs before any command dispatch, and every
    // dispatched command resolves its packer binary via packer.ts's
    // createToolRunner() -> tasks.which("packer", true), which searches
    // process.env.PATH at call time. A passthrough PATH therefore selects
    // WHICH packer binary this task's own tool resolution finds -- the same
    // class of identity selection as the other entries above (#339).
    /^PATH$/i,
];

/** Sets any user-provided passthrough environment variables (tracked for cleanup). */
export function applyPassthroughEnvironmentVariables(): void {
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
        if (IDENTITY_SELECTING_ENV_PATTERNS.some((p) => p.test(key))) {
            throw new Error(`'environmentVariables' sets '${key}', which selects a cloud identity. Credentials must come from a service connection: this task resolves them per provider and masks them, whereas a passthrough value is unmasked and can take precedence over the service connection's own credentials in the provider SDK's resolution order. Remove '${key}' from 'environmentVariables' and configure the service connection instead.`);
        }
        if (MANAGED_ENV_PATTERNS.some((p) => p.test(key))) {
            // Deliberately NOT promising an overwrite: the previous wording
            // ("will be overwritten by the provider handler") was true for
            // AWS_REGION but false for the variables that actually decide
            // identity, which is what made it misleading (#187). Those names
            // are now rejected above; what reaches here only configures an
            // already-chosen identity.
            tasks.warning(`'environmentVariables' sets '${key}', a name this task also manages. A provider handler may replace it during build/validate/console/custom, and it persists unmasked for commands that don't authenticate. Use 'environmentVariables' for non-secret builder settings only.`);
        }
        if (value && SECRET_SHAPED_KEY_PATTERN.test(key)) {
            tasks.setSecret(value);
        }
        EnvironmentVariableHelper.setEnvironmentVariable(key, value);
    }
}
