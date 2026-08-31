import tasks = require('azure-pipelines-task-lib/task');
import { readSecretEndpointDataParameter } from '@4cloudguru/pipeline-task-ado';

/**
 * Fail-closed credential primitives shared by EVERY provider handler.
 *
 * The defect class these exist to eliminate: a provider auth handler accepts an
 * absent, empty or malformed credential input and proceeds -- degrading to the
 * agent's ambient/instance credentials, to a different auth scheme, or to a
 * silently skipped environment variable -- instead of failing closed.
 * Equivalently: a validation applied in one handler, or in ONE BRANCH of one
 * handler, is absent from its siblings.
 *
 * That asymmetry is exactly why #97 reopened: its first fix hardened
 * `mapAuthorizationScheme` and the ServicePrincipal branch of the Azure handler
 * while the Workload Identity Federation branch of the SAME FILE kept reading
 * `serviceprincipalid` through `getEndpointAuthorizationParameter(id, key, true)`
 * (optional = true, so undefined at runtime) behind a `!` assertion. An empty
 * client id then reached `EnvironmentVariableHelper.setEnvironmentVariable`,
 * which skips an empty value with a warning (environment-variables.ts:11-14), so
 * `PKR_VAR_arm_client_id` was simply never set and packer-plugin-azure fell
 * through to its MSI path -- authenticating as the agent VM's identity.
 *
 * Every handler therefore reads credential fields through the helpers below
 * rather than calling the task-lib accessors directly, so a new branch inherits
 * the guard instead of having to remember it. `scripts/auth-parity-matrix.cjs`
 * enumerates (handler x auth-branch x required-field) and fails CI on any cell
 * that reads a field without one of these.
 */

/**
 * The charset permitted in a service-connection field that becomes a
 * `PKR_VAR_*`/`AWS_*`/`GOOGLE_*` value. Packer does NOT treat `PKR_VAR_*` as
 * opaque strings: for a variable declared with a non-string type (or no explicit
 * `type`), the environment value is parsed as an HCL EXPRESSION rather than
 * taken as a literal. This allowlist admits every real identifier shape these
 * fields carry (GUIDs, OCIDs, regions, fingerprints, ARNs, UPNs, URLs) while
 * rejecting the characters an HCL expression, an INI key, or an injected log
 * line would need: whitespace, CR/LF/NUL and the rest of C0, quotes, parentheses,
 * braces, `$`, `%` and backticks.
 */
export const IDENTITY_FIELD_PATTERN = /^[A-Za-z0-9._:@\/=+-]+$/;

/** Strict per-field grammars, applied on top of IDENTITY_FIELD_PATTERN. */
export const OCID_PATTERN = /^ocid1\.[a-z0-9_]+\.[a-z0-9._-]*$/;
export const REGION_PATTERN = /^[a-z0-9-]+$/;
export const FINGERPRINT_PATTERN = /^([0-9a-fA-F]{2}:){15}[0-9a-fA-F]{2}$/;

/** AWS's own `RoleSessionName` grammar for AssumeRoleWithWebIdentity (2-64 chars). */
export const ROLE_SESSION_NAME_PATTERN = /^[\w+=,.@-]{2,64}$/;

/**
 * GCP's own per-field grammars for the values the GCP handler's Workload
 * Identity Federation branch interpolates into the audience and impersonation
 * URLs it writes to the credentials file (#339, same class as OCID_PATTERN /
 * REGION_PATTERN / FINGERPRINT_PATTERN above). Confirmed against Google's
 * current published documentation rather than guessed:
 *  - project number: Resource Manager docs describe it as a Google-assigned
 *    numeric identifier ("Project number consists of digits"); bounded to 20
 *    digits (uint64 range) since no fixed length is published.
 *  - workload identity pool/provider ID: the gcloud SDK reference for
 *    `iam workload-identity-pools providers update-oidc` states the pool ID
 *    "should be 4-32 characters, and may contain the characters [a-z0-9-]" --
 *    the pool and provider ID share the same resource-ID grammar.
 *  - service account email: `docs.cloud.google.com/iam/docs/service-accounts-create`
 *    states the account ID "must be between 6 and 30 characters, and can
 *    contain lowercase alphanumeric characters and dashes"; the project ID half
 *    of the domain additionally "must start with a letter" and "cannot end
 *    with a hyphen" per `docs.cloud.google.com/resource-manager/docs/creating-managing-projects`.
 */
export const GCP_PROJECT_NUMBER_PATTERN = /^[0-9]{1,20}$/;
export const GCP_WORKLOAD_IDENTITY_ID_PATTERN = /^[a-z0-9-]{4,32}$/;
export const GCP_SERVICE_ACCOUNT_EMAIL_PATTERN = /^[a-z0-9-]{6,30}@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;

/** Which task-lib accessor family a service-connection field lives in. */
export type EndpointSource = 'auth' | 'data' | 'auth-migrating-from-data';

function readEndpointField(serviceName: string, key: string, source: EndpointSource): string | undefined {
    // optional = true everywhere: absence is diagnosed HERE, with the field name
    // and the service connection in the message, rather than by task-lib's
    // generic LIB_EndpointAuthNotExist which names only the connection and reads
    // like an expired credential.
    return source === 'data'
        ? tasks.getEndpointDataParameter(serviceName, key, true)
        : tasks.getEndpointAuthorizationParameter(serviceName, key, true);
}

export interface RequireFieldOptions {
    /** Which accessor family the field lives in. Defaults to the auth parameters. */
    source?: EndpointSource;
    /** An additional strict grammar (OCID_PATTERN, REGION_PATTERN, ...). */
    pattern?: RegExp;
    /** Human-readable field description used in the error message. */
    description?: string;
}

/**
 * Reads a NON-SECRET identity field (client id, tenant, subscription, region,
 * account, user, fingerprint, ...) and fails closed unless it is present AND
 * well-formed. Returns the validated value, never an empty string.
 */
export function requireIdentityField(serviceName: string, key: string, options: RequireFieldOptions = {}): string {
    const value = readEndpointField(serviceName, key, options.source ?? 'auth');
    return assertIdentityValue(value, `service connection '${serviceName}' field '${key}'`, options.pattern, options.description);
}

/**
 * Validates an identity value that did not come from a service connection (a
 * task input, or a value already read elsewhere). Same contract as
 * `requireIdentityField`: present and well-formed, or throw.
 */
export function assertIdentityValue(value: string | undefined, subject: string, pattern?: RegExp, description?: string): string {
    if (!value) {
        throw new Error(`${subject} is missing or empty. Refusing to continue: an unset credential field would be silently skipped and the build would authenticate with the agent's ambient credentials instead.`);
    }
    if (!IDENTITY_FIELD_PATTERN.test(value)) {
        throw new Error(`${subject} contains characters that are not allowed in a credential field (letters, digits and . _ : @ / = + - only). Reject reason: the value is injected as an environment variable that Packer may evaluate as an HCL expression.`);
    }
    if (pattern && !pattern.test(value)) {
        throw new Error(`${subject} is not a valid ${description ?? 'value'}.`);
    }
    return value;
}

/**
 * Reads a SECRET endpoint field without letting the value reach the build log at
 * read time.
 *
 * A `data` parameter must NOT be read through `tasks.getEndpointDataParameter()`
 * (which `readEndpointField` above uses for non-secret identity fields): that
 * accessor ends with `debug(id + ' data ' + key + ' = ' + val)`, so the raw value
 * is emitted BEFORE any caller can `setSecret()` it, and `ENDPOINT_DATA_*` is not
 * in task-lib's vaulting list, so it also stays in `process.env` for the packer
 * child to inherit. `readSecretEndpointDataParameter` reads the same variable
 * directly, registers it line-wise with the masker, and deletes it
 * (@4cloudguru/pipeline-task-ado). `ENDPOINT_AUTH_*` IS vaulted and its accessor does
 * not log the value, so the auth family is read as before.
 *
 * Routing this through the shared helper rather than the OCI call site keeps the
 * two guards composed: the next data-parameter secret inherits the non-logging
 * read instead of having to remember it (#185/#195 + #199).
 */
function readSecretEndpointField(serviceName: string, key: string, source: EndpointSource): string | undefined {
    if (source === 'data') {
        return readSecretEndpointDataParameter(serviceName, key);
    }
    const fromAuth = tasks.getEndpointAuthorizationParameter(serviceName, key, true);
    if (fromAuth || source === 'auth') {
        return fromAuth;
    }
    // Connection predates the descriptor moving under the auth scheme, so the
    // value is still delivered as ENDPOINT_DATA_*. Read it through the hardened
    // path rather than failing (#185).
    return readSecretEndpointDataParameter(serviceName, key);
}

/**
 * Reads a SECRET field (client secret, password, private key, access key). Only
 * presence is checkable -- the value is opaque by definition, so no charset
 * validation is applied. Fails closed when absent.
 */
export function requireSecretField(serviceName: string, key: string, options: RequireFieldOptions = {}): string {
    const value = readSecretEndpointField(serviceName, key, options.source ?? 'auth');
    if (!value) {
        throw new Error(`service connection '${serviceName}' field '${key}' is missing or empty. Refusing to continue: an unset secret would be silently skipped and the build would authenticate with the agent's ambient credentials instead.`);
    }
    return value;
}

/**
 * Fails closed when a handler's service connection input was left unset --
 * the identical guard that was hand-copied, one throw per call site, across
 * the AWS/OCI/GCP/vSphere/Azure handlers. `providerLabel` and `inputName`
 * reproduce each handler's existing message verbatim; `context` swaps in the
 * WIF-specific wording those handlers' WIF branches used.
 */
export function requireServiceConnection(name: string | undefined, providerLabel: string, inputName: string, context = 'for this command'): string {
    if (!name) {
        throw new Error(`${/^[AEIOU]/i.test(providerLabel) ? 'An' : 'A'} ${providerLabel} service connection is required ${context}. Set ${inputName}.`);
    }
    return name;
}

/**
 * Removes environment variables that select a DIFFERENT identity than the one
 * this branch is about to inject (#187).
 *
 * Setting the right credentials is not sufficient when a competing variable
 * out-ranks them in the provider SDK's own resolution order. The AWS SDK matches
 * static env credentials STRICTLY BEFORE the web-identity token file
 * (`resolveCredentials()` in aws/session/credentials.go; identical ordering in
 * aws-sdk-go-v2's `resolveCredentialChain`), so an `AWS_ACCESS_KEY_ID` inherited
 * from a self-hosted agent, a pipeline variable, or this task's own
 * `environmentVariables` passthrough silently wins over a correctly minted
 * federated assertion. packer-plugin-azure's `UseMSI()` is the mirror image: it
 * falls back to the agent identity only while `client_secret`/`client_jwt`/
 * `client_cert_path`/`tenant_id` are ALL unset, so a stale `PKR_VAR_arm_*`
 * defeats the MSI branch just as effectively.
 *
 * Each branch therefore clears the variables of the schemes it is NOT using
 * before injecting its own.
 */
export function neutralizeEnvironmentVariables(names: readonly string[], context: string): void {
    for (const name of names) {
        if (process.env[name] === undefined) continue;
        delete process.env[name];
        tasks.warning(`Cleared the inherited environment variable '${name}' before applying ${context} credentials: it selects a different identity and would otherwise take precedence over the credentials resolved from the service connection.`);
    }
}

/**
 * Resolves a federated role session name (#197).
 *
 * For `AssumeRoleWithWebIdentity` the session name is the human-readable half of
 * CloudTrail's `userIdentity.arn`
 * (`arn:aws:sts::<acct>:assumed-role/<Role>/<SessionName>`) and the field
 * incident responders pivot on. A fixed constant -- which is what both the code
 * fallback and the `task.json` default used to be -- collapses that attribution
 * across every federated build of every pipeline in every organization using
 * this extension, and forecloses `sts:RoleSessionName` trust-policy conditions.
 *
 * An explicit input still wins, but is validated against AWS's own grammar so an
 * invalid name fails here with a clear message rather than as an opaque STS
 * rejection. Otherwise the name is derived from job context and sanitized into
 * the 2-64 character `[\w+=,.@-]` charset.
 */
export function resolveRoleSessionName(inputName: string, prefix: string): string {
    const explicit = tasks.getInput(inputName, false);
    if (explicit && explicit.trim()) {
        const value = explicit.trim();
        if (!ROLE_SESSION_NAME_PATTERN.test(value)) {
            throw new Error(`Input '${inputName}' value '${value}' is not a valid AWS role session name: 2-64 characters from [A-Za-z0-9_+=,.@-].`);
        }
        return value;
    }
    const parts = [prefix, tasks.getVariable('System.TeamProject'), tasks.getVariable('Build.BuildId')]
        .filter((p): p is string => !!p && !!p.trim());
    const derived = parts.join('-').replace(/[^\w+=,.@-]/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    // Keep the tail (the build id) when truncating: it is the part that actually
    // distinguishes one run from the next.
    const bounded = derived.length > 64 ? derived.slice(derived.length - 64).replace(/^-+/, '') : derived;
    return ROLE_SESSION_NAME_PATTERN.test(bounded) ? bounded : prefix;
}
