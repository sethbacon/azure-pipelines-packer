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
        // @credential-exempt: local/hypervisor builders (Docker, QEMU, VirtualBox,
        // VMware, Hyper-V, Vagrant) authenticate to nothing. There is no service
        // connection, no credential field and no environment variable for this
        // handler to require or to neutralize, so it has no cell in the
        // (handler x branch x field) matrix to guard. Verified by inspection:
        // this method's body is empty and the class adds no other member.
    }
}
