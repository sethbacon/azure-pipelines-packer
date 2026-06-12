import { ToolRunner } from 'azure-pipelines-task-lib/toolrunner';
import { PackerBaseCommandInitializer } from './packer-commands';

export interface IPackerToolHandler {
    createToolRunner(command?: PackerBaseCommandInitializer): ToolRunner;
}

export class PackerToolHandler implements IPackerToolHandler {
    private readonly tasks: typeof import('azure-pipelines-task-lib/task');

    constructor(tasks: typeof import('azure-pipelines-task-lib/task')) {
        this.tasks = tasks;
    }

    public createToolRunner(command?: PackerBaseCommandInitializer): ToolRunner {
        let toolPath;
        try {
            toolPath = this.tasks.which("packer", true);
        } catch {
            throw new Error(this.tasks.loc("PackerToolNotFound"));
        }

        const toolRunner: ToolRunner = this.tasks.tool(toolPath);
        if (command) {
            // The command name may be a multi-word sub-command (e.g. "plugins install");
            // line() splits on whitespace into discrete argv entries.
            toolRunner.line(command.name);
            if (command.additionalArgs) {
                toolRunner.line(command.additionalArgs);
            }
        }

        return toolRunner;
    }
}
