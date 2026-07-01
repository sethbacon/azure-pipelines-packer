import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper } from './environment-variables';
import { writeSecretFile } from './secure-temp';
import { normalizePem } from './pem-normalizer';
import path = require('path');
import os = require('os');
import { randomUUID as uuidV4 } from 'crypto';

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
        tasks.setSecret(privateKey);
        const normalized = normalizePem(privateKey);
        const keyFilePath = path.join(os.tmpdir(), `oci-keyfile-${uuidV4()}.pem`);
        writeSecretFile(keyFilePath, normalized);
        this.tempFiles.push(keyFilePath);
        return keyFilePath;
    }

    public async handleProvider(command: PackerAuthorizationCommandInitializer): Promise<void> {
        const serviceName = command.serviceProviderName;
        if (!serviceName) {
            throw new Error("An OCI service connection is required for this command. Set environmentServiceNameOCI.");
        }

        const rawPrivateKey = tasks.getEndpointDataParameter(serviceName, "privateKey", false);
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
