import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper, generateIdToken } from '@4cloudguru/pipeline-task-ado';
import {
    assertIdentityValue,
    neutralizeEnvironmentVariables,
    requireIdentityField,
    requireSecretField,
    requireServiceConnection,
} from './credential-guards';

/**
 * The `PKR_VAR_arm_*` variables that make packer-plugin-azure choose a
 * particular credential. Each auth branch below clears the ones belonging to the
 * schemes it is NOT using, so an inherited or passthrough value cannot decide
 * the build's identity (#187). `UseMSI()` in particular only holds while
 * client_secret / client_jwt / client_cert_path / tenant_id are ALL unset.
 */
const ARM_IDENTITY_SELECTORS = {
    secret: 'PKR_VAR_arm_client_secret',
    jwt: 'PKR_VAR_arm_client_jwt',
    certPath: 'PKR_VAR_arm_client_cert_path',
    tenant: 'PKR_VAR_arm_tenant_id',
    clientId: 'PKR_VAR_arm_client_id',
    oidcRequestUrl: 'PKR_VAR_arm_oidc_request_url',
    oidcRequestToken: 'PKR_VAR_arm_oidc_request_token',
    cliAuth: 'PKR_VAR_arm_use_azure_cli_auth',
} as const;

/**
 * Cleared unconditionally before any auth branch runs (#332): none of the
 * three branches below ever sets oidc_request_url/oidc_request_token (this
 * handler only mints a one-shot client_jwt, never packer-plugin-azure's OIDC-
 * refresh mode) or use_azure_cli_auth, so an inherited value re-enables a whole
 * auth path this task never intended -- unlike client_id, which each of the
 * WIF/ServicePrincipal branches re-establishes right after this clear.
 */
const ARM_WHOLESALE_CLEAR = [
    ARM_IDENTITY_SELECTORS.clientId,
    ARM_IDENTITY_SELECTORS.oidcRequestUrl,
    ARM_IDENTITY_SELECTORS.oidcRequestToken,
    ARM_IDENTITY_SELECTORS.cliAuth,
] as const;

/**
 * `ARM_METADATA_URL` is a BARE environment variable, not a `PKR_VAR_arm_*`
 * one: packer-plugin-azure's `setCloudEnvironment()` reads it straight via
 * `os.Getenv`, bypassing the HCL-variable injection this handler otherwise
 * relies on entirely (verified against `builder/azure/common/client/config.go`
 * upstream; #333). It selects which Azure cloud's Resource Manager/Entra
 * endpoints the plugin resolves via `environments.FromEndpoint` -- i.e. where
 * the client_secret/client_jwt this task just minted gets POSTed during the
 * OAuth exchange. None of the three branches below ever sets it, so an
 * inherited value silently redirects that exchange to an attacker-chosen host
 * regardless of auth scheme.
 */
const ARM_METADATA_URL_ENV = 'ARM_METADATA_URL';

/**
 * Injects Azure credentials for the packer-plugin-azure builders as
 * PKR_VAR_arm_* Packer variables, matching the authorization scheme of the
 * Azure Resource Manager service connection: Workload Identity Federation
 * (OIDC), Managed Identity, or Service Principal.
 *
 * packer-plugin-azure's identity fields (client_id/client_secret/client_jwt/
 * tenant_id/subscription_id/use_azure_cli_auth) are HCL-only, unlike the
 * Terraform azurerm provider this handler was originally modeled on -- so
 * credentials are injected as Packer variables, following the same PKR_VAR_*
 * convention already used for OCI and vSphere: the template must declare
 * matching `variable` blocks and wire them into the `azure-arm` source block.
 * See docs/yaml-examples.md for a worked example. One field is the exception:
 * `ARM_METADATA_URL` (see below) is read as a bare environment variable, not
 * HCL -- it selects the cloud endpoint, not a credential.
 */
export class PackerCommandHandlerAzureRM extends BasePackerCommandHandler {
    constructor() {
        super();
        this.providerName = "azurerm";
    }

    public async handleProvider(command: PackerAuthorizationCommandInitializer): Promise<void> {
        const serviceConnectionID = requireServiceConnection(command.serviceProviderName, 'Azure', 'environmentServiceNameAzureRM');
        const authorizationScheme = this.mapAuthorizationScheme(
            tasks.getEndpointAuthorizationScheme(serviceConnectionID, true),
            serviceConnectionID
        );

        tasks.debug("Setting up Azure provider for authorization scheme: " + authorizationScheme + ".");

        // The subscription is genuinely optional (the template may pin it in the
        // azure-arm source block), but when it IS supplied it becomes
        // PKR_VAR_arm_subscription_id, so it is charset-validated like every other
        // injected identity field (#199).
        let subscriptionId = tasks.getInput("environmentAzureRmOverrideSubscriptionID", false);
        if (!subscriptionId) {
            subscriptionId = tasks.getEndpointDataParameter(serviceConnectionID, "subscriptionid", true);
        }
        if (subscriptionId) {
            subscriptionId = assertIdentityValue(subscriptionId, `Azure subscription id for service connection '${serviceConnectionID}'`);
            EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_arm_subscription_id", subscriptionId);
        } else {
            // No subscription resolved from the input or the connection: an
            // inherited PKR_VAR_arm_subscription_id would otherwise silently point
            // the build at a subscription this service connection never named (#187).
            neutralizeEnvironmentVariables(['PKR_VAR_arm_subscription_id'], "Azure");
        }

        neutralizeEnvironmentVariables([...ARM_WHOLESALE_CLEAR, ARM_METADATA_URL_ENV], "Azure");

        switch (authorizationScheme) {
            case AuthorizationScheme.ManagedServiceIdentity:
                // packer-plugin-azure falls back to Managed Identity only when
                // client_secret, client_jwt, client_cert_path, tenant_id, and the
                // OIDC request fields are ALL unset (its UseMSI() check) — so
                // tenant_id must NOT be injected on this path, and any value
                // inherited from the agent or supplied through this task's
                // `environmentVariables` passthrough has to be cleared or it
                // silently disables the MSI fallback this branch depends on (#187).
                // subscription_id (above) may still be set alongside MSI. ADO's
                // MSI-scheme service connection does not expose a distinct client-id
                // for a specific user-assigned identity, so only the VM's default
                // (system-assigned, or its sole user-assigned) identity is supported.
                //
                // @credential-exempt: ManagedServiceIdentity deliberately injects NO
                // credential fields — the agent VM's own identity IS the intended
                // principal for this scheme, and ADO's MSI connection carries no
                // client id to require.
                neutralizeEnvironmentVariables(
                    [ARM_IDENTITY_SELECTORS.secret, ARM_IDENTITY_SELECTORS.jwt, ARM_IDENTITY_SELECTORS.certPath, ARM_IDENTITY_SELECTORS.tenant],
                    "Azure Managed Identity");
                break;

            case AuthorizationScheme.WorkloadIdentityFederation: {
                // #97 (reopened 2026-08-06): this branch previously read
                // serviceprincipalid with optional=true behind a `!`, so an empty
                // client id produced no PKR_VAR_arm_client_id at all (the env helper
                // skips empty values with a warning) and packer-plugin-azure fell
                // through to the agent VM's managed identity. It now fails closed and
                // is charset-validated, exactly like the ServicePrincipal branch below.
                const servicePrincipalId = requireIdentityField(serviceConnectionID, "serviceprincipalid");
                const tenantId = requireIdentityField(serviceConnectionID, "tenantid");
                // Before minting: a federated assertion is a live bearer credential
                // the moment it exists, so it must not be requested for a run that
                // is about to be rejected (#1029's ordering invariant). This also
                // keeps the inspect probe strictly pre-injection, which is what
                // stops it echoing our own credential into the log.
                await this.assertTemplateDeclaresVariable('arm_client_jwt', 'federated OIDC assertion');
                const oidcToken = await generateIdToken(serviceConnectionID);
                tasks.setSecret(oidcToken);

                neutralizeEnvironmentVariables(
                    [ARM_IDENTITY_SELECTORS.secret, ARM_IDENTITY_SELECTORS.certPath],
                    "Azure Workload Identity Federation");
                EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_arm_client_id", servicePrincipalId);
                EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_arm_tenant_id", tenantId);
                EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_arm_client_jwt", oidcToken, true);
                break;
            }

            case AuthorizationScheme.ServicePrincipal: {
                tasks.warning("Client secret authentication is less secure than Workload Identity Federation. Prefer a WIF-configured service connection where possible.");
                // Fail closed like AWS/GCP/vSphere/OCI: a missing client id or
                // secret would otherwise be silently skipped by the env helper
                // (warning only), leaving packer-plugin-azure to fall back to the
                // agent VM's ambient managed identity (its MSI path) and
                // authenticate as an unintended, possibly more-privileged identity.
                const servicePrincipalId = requireIdentityField(serviceConnectionID, "serviceprincipalid");
                // Same fail-open as the WIF branch above, same silently-droppable
                // channel: a dropped client_secret leaves UseMSI() true. Checked
                // before the secret is read, so the probe runs pre-injection.
                await this.assertTemplateDeclaresVariable('arm_client_secret', 'service principal client secret');
                const servicePrincipalKey = requireSecretField(serviceConnectionID, "serviceprincipalkey");
                tasks.setSecret(servicePrincipalKey);
                const tenantId = requireIdentityField(serviceConnectionID, "tenantid");

                neutralizeEnvironmentVariables(
                    [ARM_IDENTITY_SELECTORS.jwt, ARM_IDENTITY_SELECTORS.certPath],
                    "Azure service principal");
                EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_arm_client_id", servicePrincipalId);
                EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_arm_tenant_id", tenantId);
                EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_arm_client_secret", servicePrincipalKey, true);
                break;
            }
        }

        tasks.debug("Finished setting up Azure provider for authorization scheme: " + authorizationScheme + ".");
    }

    private mapAuthorizationScheme(authorizationScheme: string | undefined, serviceConnectionID: string): AuthorizationScheme {
        if (!authorizationScheme) {
            // Fail closed like AWS/GCP/vSphere/OCI: a service connection with no
            // authorization scheme must not silently default to Workload Identity
            // Federation. Combined with packer-plugin-azure's MSI fallback, a silent
            // default could authenticate as the agent VM's ambient managed identity
            // instead of the intended service connection.
            throw new Error(`Service connection '${serviceConnectionID}' has no authorization scheme. Expected one of: WorkloadIdentityFederation, ManagedServiceIdentity, ServicePrincipal.`);
        }
        const scheme = authorizationScheme.toLowerCase();
        if (scheme === AuthorizationScheme.ServicePrincipal) return AuthorizationScheme.ServicePrincipal;
        if (scheme === AuthorizationScheme.ManagedServiceIdentity) return AuthorizationScheme.ManagedServiceIdentity;
        if (scheme === AuthorizationScheme.WorkloadIdentityFederation) return AuthorizationScheme.WorkloadIdentityFederation;
        throw new Error(`Unrecognized authorization scheme '${authorizationScheme}'. Supported schemes: WorkloadIdentityFederation, ManagedServiceIdentity, ServicePrincipal.`);
    }
}

enum AuthorizationScheme {
    ServicePrincipal = "serviceprincipal",
    ManagedServiceIdentity = "managedserviceidentity",
    WorkloadIdentityFederation = "workloadidentityfederation"
}
