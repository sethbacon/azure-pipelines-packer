import { BasePackerCommandHandler } from './base-packer-command-handler';
import { PackerCommandHandlerAzureRM } from './azure-packer-command-handler';
import { PackerCommandHandlerAWS } from './aws-packer-command-handler';
import { PackerCommandHandlerGCP } from './gcp-packer-command-handler';
import { PackerCommandHandlerOCI } from './oci-packer-command-handler';
import { PackerCommandHandlerVSphere } from './vsphere-packer-command-handler';
import { PackerCommandHandlerNone } from './none-packer-command-handler';
import { EnvironmentVariableHelper } from './environment-variables';

export interface IParentCommandHandler {
    execute(providerName: string, command: string): Promise<number>;
    emergencyCleanup(): void;
}

export class ParentCommandHandler implements IParentCommandHandler {
    private activeHandler: BasePackerCommandHandler | null = null;

    public async execute(providerName: string, command: string): Promise<number> {
        const handler = this.createHandler(providerName);
        this.activeHandler = handler;
        try {
            return await handler.executeCommand(command);
        } finally {
            handler.cleanupTempFiles();
            EnvironmentVariableHelper.clearTrackedVariables();
            this.activeHandler = null;
        }
    }

    public emergencyCleanup(): void {
        if (this.activeHandler) {
            this.activeHandler.cleanupTempFiles();
            EnvironmentVariableHelper.clearTrackedVariables();
        }
    }

    private createHandler(name: string): BasePackerCommandHandler {
        switch (name) {
            case "azurerm": return new PackerCommandHandlerAzureRM();
            case "aws": return new PackerCommandHandlerAWS();
            case "gcp": return new PackerCommandHandlerGCP();
            case "oci": return new PackerCommandHandlerOCI();
            case "vsphere": return new PackerCommandHandlerVSphere();
            case "none":
            case "": return new PackerCommandHandlerNone();
            default: throw new Error(`Unknown provider type: ${name}`);
        }
    }
}
