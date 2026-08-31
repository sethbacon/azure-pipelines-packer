import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper } from '@4cloudguru/pipeline-task-ado';
import { normalizePem } from '@4cloudguru/pipeline-task-core';
import {
    assertIdentityValue,
    GCP_PROJECT_NUMBER_PATTERN,
    GCP_SERVICE_ACCOUNT_EMAIL_PATTERN,
    GCP_WORKLOAD_IDENTITY_ID_PATTERN,
    neutralizeEnvironmentVariables,
    requireIdentityField,
    requireSecretField,
} from './credential-guards';

/**
 * Google credential sources that resolve AHEAD of, or instead of, the
 * GOOGLE_APPLICATION_CREDENTIALS file this handler writes (an inherited
 * GOOGLE_CREDENTIALS / GOOGLE_OAUTH_ACCESS_TOKEN / gcloud ADC override on a
 * self-hosted agent). Cleared on both branches so the build cannot authenticate
 * as an identity the service connection never named (#187).
 */
const GOOGLE_COMPETING_CREDENTIAL_ENV = [
    'GOOGLE_CREDENTIALS',
    'GOOGLE_OAUTH_ACCESS_TOKEN',
    'GOOGLE_GHA_CREDS_PATH',
    'CLOUDSDK_AUTH_ACCESS_TOKEN',
    'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
] as const;

/**
 * The only Google token endpoint this handler's static-key credentials file ever
 * POSTs its service-account-signed assertion to. The service connection's
 * "Audience" field lands verbatim in that file as `token_uri`, so it is
 * constrained to the exact endpoint in use rather than trusted as free text --
 * the same guard the sibling terraform extension's GCP handler applies
 * (`assertGoogleTokenUri`), which this handler was missing (#199).
 */
const ALLOWED_GOOGLE_TOKEN_URI_HOSTS = ['oauth2.googleapis.com', 'sts.googleapis.com'];

function assertGoogleTokenUri(tokenUri: string): string {
    let parsed: URL;
    try {
        parsed = new URL(tokenUri);
    } catch {
        throw new Error(`GCP service connection field 'Audience' is not a valid URL: '${tokenUri}'.`);
    }
    if (parsed.protocol !== 'https:' || !ALLOWED_GOOGLE_TOKEN_URI_HOSTS.includes(parsed.hostname.toLowerCase())) {
        throw new Error(`GCP service connection field 'Audience' must be one of https://${ALLOWED_GOOGLE_TOKEN_URI_HOSTS.join(', https://')}; got '${tokenUri}'.`);
    }
    return tokenUri;
}

/**
 * Injects GCP credentials for the packer-plugin-googlecompute builders. Both
 * service-account-key and Workload Identity Federation paths write a credentials
 * JSON file and point GOOGLE_APPLICATION_CREDENTIALS at it.
 */
export class PackerCommandHandlerGCP extends BasePackerCommandHandler {
    constructor() {
        super();
        this.providerName = "gcp";
    }

    private writeServiceAccountKey(serviceName: string): string {
        const clientEmail = requireIdentityField(serviceName, "Issuer");
        const tokenUri = assertGoogleTokenUri(requireIdentityField(serviceName, "Audience"));
        const privateKey = requireSecretField(serviceName, "PrivateKey");

        // setSecret rejects multi-line input (LIB_MultilineSecret). The UI
        // passwordbox strips newlines on paste, but a service connection created
        // via the REST API / az devops CLI can deliver a genuine multi-line PEM,
        // in which case setSecret on the raw value would throw before any
        // credential is written. Register it line-wise first (safe for both the
        // single-line-flattened and genuine multi-line shapes) so it is masked
        // either way.
        for (const line of privateKey.split('\n')) {
            const trimmed = line.trim();
            if (trimmed) tasks.setSecret(trimmed);
        }
        const normalized = normalizePem(privateKey);
        // normalizePem rewrites the key to a byte-different LF-wrapped form --
        // the form that actually lands in the on-disk (JSON-escaped) credentials
        // file -- so also register each base64 body line of that form. Mirrors
        // the OCI handler's on-disk masking (oci-packer-command-handler.ts).
        for (const line of normalized.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('-----')) {
                tasks.setSecret(trimmed);
            }
        }

        const jsonCredsString = JSON.stringify({
            type: "service_account",
            private_key: normalized,
            client_email: clientEmail,
            token_uri: tokenUri
        });

        return this.writeTrackedSecretFile('gcp-credentials', 'json', jsonCredsString);
    }

    private async writeWifCredentials(serviceConnection: string): Promise<string> {
        const tokenFilePath = await this.writeOidcTokenFile(serviceConnection, 'gcp-oidc-token');

        // Every one of these is interpolated into the audience / impersonation
        // URLs written to the credentials file, so each is charset-validated
        // rather than trusted as free text (#199). Each also now carries the
        // field-specific grammar GCP itself publishes, the same idiom the OCI
        // handler already applies via OCID_PATTERN/REGION_PATTERN/
        // FINGERPRINT_PATTERN -- generic IDENTITY_FIELD_PATTERN alone would still
        // accept a syntactically-valid-looking but structurally wrong value (#339).
        const projectNumber = assertIdentityValue(tasks.getInput("gcpProjectNumber", true), "Input 'gcpProjectNumber'", GCP_PROJECT_NUMBER_PATTERN, 'GCP project number (digits only)');
        const poolId = assertIdentityValue(tasks.getInput("gcpWorkloadIdentityPoolId", true), "Input 'gcpWorkloadIdentityPoolId'", GCP_WORKLOAD_IDENTITY_ID_PATTERN, 'workload identity pool ID (4-32 characters from [a-z0-9-])');
        const providerId = assertIdentityValue(tasks.getInput("gcpWorkloadIdentityProviderId", true), "Input 'gcpWorkloadIdentityProviderId'", GCP_WORKLOAD_IDENTITY_ID_PATTERN, 'workload identity provider ID (4-32 characters from [a-z0-9-])');
        const serviceAccountEmail = assertIdentityValue(tasks.getInput("gcpServiceAccountEmail", true), "Input 'gcpServiceAccountEmail'", GCP_SERVICE_ACCOUNT_EMAIL_PATTERN, 'GCP service account email');

        const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;
        const credentials = {
            type: "external_account",
            audience: audience,
            subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
            token_url: "https://sts.googleapis.com/v1/token",
            credential_source: { file: tokenFilePath },
            service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`
        };

        return this.writeTrackedSecretFile('gcp-wif-credentials', 'json', JSON.stringify(credentials));
    }

    public async handleProvider(command: PackerAuthorizationCommandInitializer): Promise<void> {
        const authScheme = tasks.getInput("environmentAuthSchemeGCP", false) || "ServiceConnection";
        this.validateAuthScheme(authScheme, "environmentAuthSchemeGCP");

        if (authScheme === "WorkloadIdentityFederation") {
            if (!command.serviceProviderName) {
                // Fail closed like the service-connection path rather than requesting
                // an OIDC token for an empty service connection id.
                throw new Error("A GCP service connection is required for Workload Identity Federation. Set environmentServiceNameGCP.");
            }
            const credentialsFilePath = await this.writeWifCredentials(command.serviceProviderName);
            neutralizeEnvironmentVariables(GOOGLE_COMPETING_CREDENTIAL_ENV, "GCP Workload Identity Federation");
            EnvironmentVariableHelper.setEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS", credentialsFilePath);
            return;
        }

        const serviceName = command.serviceProviderName;
        if (!serviceName) {
            throw new Error("A GCP service connection is required for this command. Set environmentServiceNameGCP.");
        }
        const keyFilePath = this.writeServiceAccountKey(serviceName);
        neutralizeEnvironmentVariables(GOOGLE_COMPETING_CREDENTIAL_ENV, "GCP service account key");
        EnvironmentVariableHelper.setEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS", keyFilePath);
        // GOOGLE_PROJECT_ID is intentionally NOT injected: packer-plugin-googlecompute
        // reads the project only from the required HCL `project_id` field, never from
        // the environment, so setting it here was dead and misleading (and on the WIF
        // path it was the project NUMBER, not the id).
    }
}
