import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper } from './environment-variables';

/**
 * Injects vCenter credentials for the packer-plugin-vsphere (vsphere-iso /
 * vsphere-clone) builders using the PKR_VAR_* convention. Templates declare
 * `variable "vsphere_server" / "vsphere_user" / "vsphere_password"` blocks and
 * wire them to the builder's vcenter_server / username / password fields.
 */
export class PackerCommandHandlerVSphere extends BasePackerCommandHandler {
    constructor() {
        super();
        this.providerName = "vsphere";
    }

    private static readonly HOST_PATTERN = /^[A-Za-z0-9.-]+(:[0-9]+)?$/;

    public async handleProvider(command: PackerAuthorizationCommandInitializer): Promise<void> {
        const serviceName = command.serviceProviderName;
        if (!serviceName) {
            throw new Error("A vSphere service connection is required for this command. Set environmentServiceNameVSphere.");
        }

        // The vsphere builder's vcenter_server expects a bare hostname[:port]. A
        // lexical scheme-strip left userinfo and any path/query segment intact
        // (e.g. 'https://user:secret@vcenter.example.com/sdk' -> a credential
        // riding into this unmasked PKR_VAR_*), so parse properly and take only
        // url.host, then validate its charset like the OCI fields (#110).
        const endpointUrl = tasks.getEndpointUrl(serviceName, false) || '';
        let server: string;
        try {
            const withScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(endpointUrl) ? endpointUrl : `https://${endpointUrl}`;
            server = new URL(withScheme).host;
        } catch {
            throw new Error(`vSphere service connection '${serviceName}' has an invalid server URL: '${endpointUrl}'.`);
        }
        if (!PackerCommandHandlerVSphere.HOST_PATTERN.test(server)) {
            throw new Error(`vSphere service connection '${serviceName}' server '${server}' contains characters outside the allowed hostname[:port] charset.`);
        }
        const username = tasks.getEndpointAuthorizationParameter(serviceName, "username", false) || '';
        const password = tasks.getEndpointAuthorizationParameter(serviceName, "password", false) || '';
        if (!password) {
            // Fail closed like AWS/GCP/OCI: an empty password would otherwise be
            // silently skipped by the env helper (warning only), leaving the build
            // to attempt vCenter auth with no credential instead of failing clearly.
            throw new Error(`vSphere password not found in service connection '${serviceName}'. Ensure the service connection includes a password.`);
        }
        tasks.setSecret(password);

        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_vsphere_server", server);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_vsphere_user", username);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_vsphere_password", password, true);

        if (tasks.getBoolInput("vsphereInsecureConnection", false)) {
            tasks.warning("Disabling vCenter TLS verification exposes the vSphere credentials to man-in-the-middle interception; use only on trusted networks with self-signed certificates, never in production.");
            EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_vsphere_insecure_connection", "true");
        }
    }
}
