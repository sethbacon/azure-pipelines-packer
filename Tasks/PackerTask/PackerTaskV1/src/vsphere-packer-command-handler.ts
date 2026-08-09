import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper } from './environment-variables';
import { assertIdentityValue, neutralizeEnvironmentVariables, requireSecretField } from './credential-guards';

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
        // optional=false already throws (LIB_EndpointNotExist) for an unset OR
        // empty URL, so the `|| ''` tail this used to carry was unreachable dead
        // code that only made the fallback look real (#194). The `!` documents
        // that runtime guarantee, matching the password read below.
        const endpointUrl = tasks.getEndpointUrl(serviceName, false)!;
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
        // `username` reached PKR_VAR_vsphere_user unvalidated while the adjacent
        // `server` was parsed and charset-checked -- the same one-field-guarded,
        // sibling-unguarded asymmetry as #97, and the reason #199 was filed.
        // Presence is already enforced by optional=false (username is
        // isRequired:true in the endpoint definition), so this adds the value
        // check the sibling field always had.
        const username = assertIdentityValue(
            tasks.getEndpointAuthorizationParameter(serviceName, "username", false),
            `vSphere service connection '${serviceName}' field 'username'`);
        // getEndpointAuthorizationParameter(..., false) already throws (LIB_EndpointAuthNotExist)
        // for an unset OR empty value -- it can never return falsy here, so the manual
        // "empty password" fail-closed check this used to duplicate was unreachable dead code
        // (confirmed against AWS/GCP's identical optional=false calls, neither of which has an
        // equivalent extra check). requireSecretField keeps the same fail-closed contract
        // while routing the read through the shared guard the whole matrix is checked against.
        const password = requireSecretField(serviceName, "password");
        tasks.setSecret(password);

        const insecure = tasks.getBoolInput("vsphereInsecureConnection", false);
        if (!insecure) {
            // An inherited or passed-through PKR_VAR_vsphere_insecure_connection=true
            // would disable vCenter TLS verification for a build whose operator
            // never asked for it, exposing the password set below to on-path
            // interception (#44/#187). The toggle is off, so the variable must be off.
            neutralizeEnvironmentVariables(['PKR_VAR_vsphere_insecure_connection'], "vSphere");
        }
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_vsphere_server", server);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_vsphere_user", username);
        EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_vsphere_password", password, true);

        if (insecure) {
            tasks.warning("Disabling vCenter TLS verification exposes the vSphere credentials to man-in-the-middle interception; use only on trusted networks with self-signed certificates, never in production.");
            EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_vsphere_insecure_connection", "true");
        }
    }
}
