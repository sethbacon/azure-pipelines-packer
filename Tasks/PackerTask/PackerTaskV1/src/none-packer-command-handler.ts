import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';

/**
 * Handler for local and hypervisor builders (Docker, QEMU, VirtualBox, VMware,
 * Hyper-V, Vagrant) that need no cloud service-connection credentials. Any
 * builder-specific settings are passed through the task's environmentVariables
 * input, which the base handler applies before dispatch.
 */
export class PackerCommandHandlerNone extends BasePackerCommandHandler {
    constructor() {
        super();
        this.providerName = "none";
    }

    public async handleProvider(_command: PackerAuthorizationCommandInitializer): Promise<void> {
        // No cloud credentials required.
    }
}
