import * as assert from 'assert';
import tasks = require('azure-pipelines-task-lib/task');
import { PackerCommandHandlerNone } from '../src/none-packer-command-handler';

/**
 * The class test for provider-contributed `-var` arguments.
 *
 * WHY `-var` AND NOT `PKR_VAR_`. The three channels Packer accepts input on are
 * not equivalent, and only one fails closed. Verified against packer 1.14.1 and
 * upstream hcl2template/types.variables.go's collectInputVariableValues():
 *
 *   PKR_VAR_<name>  a variable the template does not declare is SILENTLY
 *                   skipped -- "let's skip it !", continue. Exit 0.
 *   -var-file=      at most a DiagWarning, and only when WarnOnUndeclaredVar
 *                   is set; otherwise continue. Exit 0.
 *   -var name=      hcl.DiagError, "Undefined -var variable". Exit 1.
 *
 * Reproduce in one line each:
 *
 *   packer validate -var undeclared=1 <template>     # exit 1, "not found in known variables"
 *   PKR_VAR_undeclared=1 packer validate <template>  # exit 0, "The configuration is valid."
 *
 * That asymmetry is what lets a credential which can ONLY reach Packer through
 * an HCL field (OCI WIF's synthetic config file, delivered as `access_cfg_file`
 * because packer-plugin-oracle reads no OCI_CLI_* variable) fail loudly on a
 * template that forgot the declaration, instead of silently falling through to
 * whatever ambient OCI config the agent happens to have.
 *
 * WHAT THIS SUITE PINS. Go's flag package stops parsing at the first non-flag
 * argument, so a `-var` emitted after the template path is read as a positional
 * argument and silently ignored -- the same fail-open shape, one layer down.
 * Every command that authenticates must therefore emit provider `-var` entries
 * BEFORE the template path (or, for `custom`, before commandOptions, which is
 * where an operator's own template path arrives).
 *
 * Mutation-provable: deleting an applyProviderVarArgs() call, or moving
 * tool.arg(getTemplatePath()) back above handleProvider(), reddens exactly the
 * rows below and nothing else in the suite.
 */
describe('provider-contributed -var args precede the template path', function () {
    const originalGetInput = tasks.getInput;
    const originalGetBoolInput = tasks.getBoolInput;
    const originalGetVariable = tasks.getVariable;
    const originalWhich = tasks.which;

    /** Captures every token a command appends, in order, without spawning packer. */
    function captureArgv(handler: any): string[] {
        const argv: string[] = [];
        const fakeTool = {
            arg: (a: string) => { argv.push(a); return fakeTool; },
            line: (l: string) => { argv.push(l); return fakeTool; },
            argIf: () => fakeTool,
            // The command never actually runs: returning 0 lets each public
            // method complete so the FULL argv it would have passed is captured.
            execAsync: async () => 0,
        };
        handler.packerToolHandler = { createToolRunner: () => fakeTool };
        return argv;
    }

    beforeEach(() => {
        (tasks as any).getInput = (name: string) => {
            if (name === 'templatePath') return 'template.pkr.hcl';
            if (name === 'customCommand') return 'inspect';
            return undefined;
        };
        (tasks as any).getBoolInput = () => false;
        (tasks as any).getVariable = (name: string) =>
            name === 'Agent.TempDirectory' ? undefined : undefined;
        (tasks as any).which = () => 'packer';
    });

    afterEach(() => {
        (tasks as any).getInput = originalGetInput;
        (tasks as any).getBoolInput = originalGetBoolInput;
        (tasks as any).getVariable = originalGetVariable;
        (tasks as any).which = originalWhich;
    });

    const VAR_ENTRY = 'oci_access_cfg_file=/tmp/oci-wif-config-test';

    // `custom` is listed separately below: it has no template-path argument, so
    // its ordering invariant is stated against commandOptions instead.
    const TEMPLATE_COMMANDS = ['validate', 'build', 'console'] as const;

    for (const commandName of TEMPLATE_COMMANDS) {
        it(`${commandName}: emits -var before the template path`, async () => {
            const handler: any = new PackerCommandHandlerNone();
            const argv = captureArgv(handler);
            // Stand in for a provider that contributes a -var during handleProvider().
            handler.handleProvider = async () => {
                handler.providerVarArgs = [VAR_ENTRY];
            };

            await handler[commandName]();

            const varFlagIndex = argv.indexOf('-var');
            const valueIndex = argv.indexOf(VAR_ENTRY);
            const templateIndex = argv.indexOf('template.pkr.hcl');

            assert.notStrictEqual(varFlagIndex, -1, `${commandName} did not emit the -var flag at all`);
            assert.strictEqual(
                valueIndex,
                varFlagIndex + 1,
                `${commandName}: the -var value must immediately follow the -var flag`,
            );
            assert.notStrictEqual(templateIndex, -1, `${commandName} did not emit a template path`);
            assert.ok(
                varFlagIndex < templateIndex,
                `${commandName}: -var must precede the template path (Go's flag parser stops at the ` +
                `first non-flag argument, so a -var after it is silently ignored). argv: ${JSON.stringify(argv)}`,
            );
        });
    }

    it('custom: emits -var before commandOptions, which is where a template path would arrive', async () => {
        (tasks as any).getInput = (name: string) => {
            if (name === 'customCommand') return 'inspect';
            if (name === 'commandOptions') return 'operator-template.pkr.hcl';
            if (name === 'templatePath') return 'template.pkr.hcl';
            return undefined;
        };

        const handler: any = new PackerCommandHandlerNone();
        const argv = captureArgv(handler);
        handler.handleProvider = async () => {
            handler.providerVarArgs = [VAR_ENTRY];
        };

        await handler.custom();

        const varFlagIndex = argv.indexOf('-var');
        const optionsIndex = argv.indexOf('operator-template.pkr.hcl');

        assert.notStrictEqual(varFlagIndex, -1, 'custom did not emit the -var flag at all');
        assert.notStrictEqual(optionsIndex, -1, 'custom did not emit commandOptions');
        assert.ok(
            varFlagIndex < optionsIndex,
            `custom: -var must precede commandOptions. argv: ${JSON.stringify(argv)}`,
        );
    });

    it('emits nothing extra for a provider that contributes no -var entries', async () => {
        const handler: any = new PackerCommandHandlerNone();
        const argv = captureArgv(handler);
        handler.handleProvider = async () => { /* the five existing providers contribute none */ };

        await handler.validate();

        assert.strictEqual(
            argv.indexOf('-var'),
            -1,
            'a handler contributing no provider vars must not change argv at all',
        );
        assert.strictEqual(
            argv[argv.length - 1],
            'template.pkr.hcl',
            'the template path must remain the final argument for every existing provider',
        );
    });
});
