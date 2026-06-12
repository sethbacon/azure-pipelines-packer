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

    public async handleProvider(command: PackerAuthorizationCommandInitializer): Promise<void> {
        const serviceName = command.serviceProviderName;
        if (!serviceName) {
            throw new Error("A vSphere service connection is required for this command. Set environmentServiceNameVSphere.");
        }

        // The vsphere builder's vcenter_server expects a bare hostname, but the
        // service connection URL field may carry a scheme and trailing slash.
        const server = (tasks.getEndpointUrl(serviceName, false) || '')
            .replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '')
            .replace(/\/+$/, '');
        const username = tasks.getEndpointAuthorizationParameter(serviceName, "username", false) || '';
        const password = tasks.getEndpointAuthorizationParameter(serviceName, "password", false) || '';
        if (password) { tasks.setSecret(password); }

        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_vsphere_server", server);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_vsphere_user", username);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_vsphere_password", password, true);

        if (tasks.getBoolInput("vsphereInsecureConnection", false)) {
            EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_vsphere_insecure_connection", "true");
        }
    }
}
