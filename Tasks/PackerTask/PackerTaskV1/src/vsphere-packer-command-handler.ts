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

        const server = tasks.getEndpointUrl(serviceName, false) || '';
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
