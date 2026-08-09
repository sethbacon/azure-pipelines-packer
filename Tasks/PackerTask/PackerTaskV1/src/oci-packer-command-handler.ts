import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper } from './environment-variables';
import { normalizePem } from './pem-normalizer';
import { maskSecretLines, readSecretEndpointDataParameter } from './endpoint-data-secret';

const OCID_PATTERN = /^ocid1\.[a-z0-9_]+\.[a-z0-9._-]*$/;
const REGION_PATTERN = /^[a-z0-9-]+$/;
const FINGERPRINT_PATTERN = /^([0-9a-fA-F]{2}:){15}[0-9a-fA-F]{2}$/;

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

    /** Rejects missing/newline-bearing/malformed service-connection fields before they reach a PKR_VAR_* environment variable. */
    private requireField(serviceName: string, dataKey: string, pattern: RegExp, description: string): string {
        const value = tasks.getEndpointDataParameter(serviceName, dataKey, false) || '';
        if (!pattern.test(value)) {
            throw new Error(`OCI service connection '${serviceName}' field '${dataKey}' is missing or not a valid ${description}.`);
        }
        return value;
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

        // NOT tasks.getEndpointDataParameter(): that helper debug-logs the value it
        // returns, so the raw API key would already be in the build log before the
        // first setSecret below. readSecretEndpointDataParameter reads the same
        // ENDPOINT_DATA_* variable directly, masks it line-wise, and deletes it so
        // the packer child process does not inherit it (see endpoint-data-secret.ts).
        const rawPrivateKey = readSecretEndpointDataParameter(serviceName, "privateKey");
        if (!rawPrivateKey) {
            throw new Error("OCI private key not found in service connection. Ensure the 'privateKey' field is configured.");
        }
        const keyFilePath = this.writeKeyFile(rawPrivateKey);

        const tenancyOcid = this.requireField(serviceName, "tenancy", OCID_PATTERN, "OCID");
        const userOcid = this.requireField(serviceName, "user", OCID_PATTERN, "OCID");
        const region = this.requireField(serviceName, "region", REGION_PATTERN, "region identifier");
        const fingerprint = this.requireField(serviceName, "fingerprint", FINGERPRINT_PATTERN, "key fingerprint");

        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_tenancy_ocid", tenancyOcid);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_user_ocid", userOcid);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_region", region);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_fingerprint", fingerprint);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_key_file", keyFilePath);
    }
}
