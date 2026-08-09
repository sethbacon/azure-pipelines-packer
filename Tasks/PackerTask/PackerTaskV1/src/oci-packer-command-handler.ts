import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper } from './environment-variables';
import { normalizePem } from './pem-normalizer';
import { maskSecretLines } from './endpoint-data-secret';
import {
    FINGERPRINT_PATTERN,
    neutralizeEnvironmentVariables,
    OCID_PATTERN,
    REGION_PATTERN,
    requireIdentityField,
    requireSecretField,
} from './credential-guards';

/**
 * OCI SDK configuration the packer-plugin-oracle builder honours ahead of, or
 * instead of, the PKR_VAR_oci_* values this handler injects. Cleared so an
 * inherited config file or profile on a self-hosted agent cannot redirect the
 * build to a different tenancy/user (#187).
 */
const OCI_COMPETING_CREDENTIAL_ENV = [
    'OCI_CLI_CONFIG_FILE',
    'OCI_CLI_PROFILE',
    'OCI_CLI_AUTH',
    'OCI_CLI_TENANCY',
    'OCI_CLI_USER',
    'OCI_CLI_FINGERPRINT',
    'OCI_CLI_KEY_FILE',
    'OCI_CLI_REGION',
] as const;

/**
 * Injects OCI credentials for the packer-plugin-oracle (oracle-oci) builder
 * using the PKR_VAR_* convention: the API-key fields from the OCI service
 * connection are exposed as Packer variables, and the private key is written to
 * a restrictive temp file referenced by PKR_VAR_oci_key_file. Templates declare
 * matching `variable "oci_*"` blocks and wire them to the builder source.
 */
export class PackerCommandHandlerOCI extends BasePackerCommandHandler {
    constructor() {
        super();
        this.providerName = "oci";
    }

    private writeKeyFile(privateKey: string): string {
        // Mask the raw value LINE-WISE first. setSecret rejects multi-line input
        // (LIB_MultilineSecret): the UI passwordbox strips newlines on paste, but
        // a service connection created via the REST API / az devops CLI can
        // deliver a genuine multi-line PEM, in which case setSecret on the raw
        // value throws before any credential is written AND leaves the raw form
        // unregistered. No boundary-line filtering here: the flattened
        // single-line form is itself one "line" that starts with "-----BEGIN".
        // Mirrors gcp-packer-command-handler.ts and the terraform extension's
        // getPrivateKeyFilePath().
        maskSecretLines(privateKey);
        const normalized = normalizePem(privateKey);
        // setSecret masks exact substrings within a single log line. normalizePem
        // rewrites the key to a byte-different LF-wrapped form — the form actually
        // written to disk and referenced by PKR_VAR_oci_key_file — so also register
        // each base64 body line of that on-disk form. setSecret rejects multi-line
        // input, hence per line rather than the whole PEM.
        for (const line of normalized.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('-----')) {
                tasks.setSecret(trimmed);
            }
        }
        return this.writeTrackedSecretFile('oci-keyfile', 'pem', normalized);
    }

    public async handleProvider(command: PackerAuthorizationCommandInitializer): Promise<void> {
        const serviceName = command.serviceProviderName;
        if (!serviceName) {
            throw new Error("An OCI service connection is required for this command. Set environmentServiceNameOCI.");
        }

        // Fails closed on an absent/empty key (#199), and reads it through
        // readSecretEndpointDataParameter rather than tasks.getEndpointDataParameter
        // (#185/#195): the latter debug-logs the value it returns, so the raw API key
        // would be in the build log before the first setSecret below, and leaves
        // ENDPOINT_DATA_* in process.env for the packer child to inherit. Both guards
        // now compose inside requireSecretField(source: 'data') -- see
        // credential-guards.ts readSecretEndpointField and endpoint-data-secret.ts.
        const rawPrivateKey = requireSecretField(serviceName, "privateKey", { source: 'data' });
        const keyFilePath = this.writeKeyFile(rawPrivateKey);

        // The strict per-field grammars this handler pioneered now live in the
        // shared credential-guards module, so the Azure/AWS/vSphere/GCP handlers
        // apply the same "reject missing/newline-bearing/malformed before it
        // reaches an injected environment variable" contract (#199).
        const tenancyOcid = requireIdentityField(serviceName, "tenancy", { source: 'data', pattern: OCID_PATTERN, description: 'OCID' });
        const userOcid = requireIdentityField(serviceName, "user", { source: 'data', pattern: OCID_PATTERN, description: 'OCID' });
        const region = requireIdentityField(serviceName, "region", { source: 'data', pattern: REGION_PATTERN, description: 'region identifier' });
        const fingerprint = requireIdentityField(serviceName, "fingerprint", { source: 'data', pattern: FINGERPRINT_PATTERN, description: 'key fingerprint' });

        neutralizeEnvironmentVariables(OCI_COMPETING_CREDENTIAL_ENV, "OCI API key");
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_tenancy_ocid", tenancyOcid);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_user_ocid", userOcid);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_region", region);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_fingerprint", fingerprint);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_key_file", keyFilePath);
    }
}
