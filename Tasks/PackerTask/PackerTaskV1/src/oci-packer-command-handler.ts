import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper } from './environment-variables';
import { writeSecretFile } from './secure-temp';
import { normalizePem } from './pem-normalizer';
import path = require('path');
import os = require('os');
import { randomUUID as uuidV4 } from 'crypto';

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

        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_tenancy_ocid", tasks.getEndpointDataParameter(serviceName, "tenancy", false) || '');
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_user_ocid", tasks.getEndpointDataParameter(serviceName, "user", false) || '');
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_region", tasks.getEndpointDataParameter(serviceName, "region", false) || '');
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_fingerprint", tasks.getEndpointDataParameter(serviceName, "fingerprint", false) || '');
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_oci_key_file", keyFilePath);
    }
}
