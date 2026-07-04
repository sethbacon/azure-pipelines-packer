import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper } from './environment-variables';
import { generateIdToken } from './id-token-generator';

/**
 * Injects Azure credentials for the packer-plugin-azure builders as
 * PKR_VAR_arm_* Packer variables, matching the authorization scheme of the
 * Azure Resource Manager service connection: Workload Identity Federation
 * (OIDC), Managed Identity, or Service Principal.
 *
 * packer-plugin-azure does NOT read ARM_* environment variables (unlike the
 * Terraform azurerm provider this handler was originally modeled on) — its
 * auth fields (client_id/client_secret/client_jwt/tenant_id/subscription_id/
 * use_azure_cli_auth) are HCL-only. Credentials are therefore injected as
 * Packer variables, following the same PKR_VAR_* convention already used for
 * OCI and vSphere: the template must declare matching `variable` blocks and
 * wire them into the `azure-arm` source block. See docs/yaml-examples.md for
 * a worked example.
 */
export class PackerCommandHandlerAzureRM extends BasePackerCommandHandler {
    constructor() {
        super();
        this.providerName = "azurerm";
    }

    public async handleProvider(_command: PackerAuthorizationCommandInitializer): Promise<void> {
        const serviceConnectionID = tasks.getInput("environmentServiceNameAzureRM", true)!;
        const authorizationScheme = this.mapAuthorizationScheme(
            tasks.getEndpointAuthorizationScheme(serviceConnectionID, true),
            serviceConnectionID
        );

        tasks.debug("Setting up Azure provider for authorization scheme: " + authorizationScheme + ".");

        let subscriptionId = tasks.getInput("environmentAzureRmOverrideSubscriptionID", false);
        if (!subscriptionId) {
            subscriptionId = tasks.getEndpointDataParameter(serviceConnectionID, "subscriptionid", true);
        }
        if (subscriptionId) {
            EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_arm_subscription_id", subscriptionId);
        }

        switch (authorizationScheme) {
            case AuthorizationScheme.ManagedServiceIdentity:
                // packer-plugin-azure falls back to Managed Identity only when
                // client_secret, client_jwt, client_cert_path, tenant_id, and the
                // OIDC request fields are ALL unset (its UseMSI() check) — so
                // tenant_id must NOT be injected on this path. subscription_id
                // (above) may still be set alongside MSI. ADO's MSI-scheme service
                // connection does not expose a distinct client-id for a specific
                // user-assigned identity, so only the VM's default (system-assigned,
                // or its sole user-assigned) identity is supported by this task.
                break;

            case AuthorizationScheme.WorkloadIdentityFederation: {
                const servicePrincipalId = tasks.getEndpointAuthorizationParameter(serviceConnectionID, "serviceprincipalid", true)!;
                const tenantId = tasks.getEndpointAuthorizationParameter(serviceConnectionID, "tenantid", false);
                const oidcToken = await generateIdToken(serviceConnectionID);
                tasks.setSecret(oidcToken);

                EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_arm_client_id", servicePrincipalId);
                if (tenantId) {
                    EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_arm_tenant_id", tenantId);
                }
                EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_arm_client_jwt", oidcToken, true);
                break;
            }

            case AuthorizationScheme.ServicePrincipal: {
                tasks.warning("Client secret authentication is less secure than Workload Identity Federation. Prefer a WIF-configured service connection where possible.");
                const servicePrincipalId = tasks.getEndpointAuthorizationParameter(serviceConnectionID, "serviceprincipalid", true);
                const servicePrincipalKey = tasks.getEndpointAuthorizationParameter(serviceConnectionID, "serviceprincipalkey", true);
                if (!servicePrincipalId || !servicePrincipalKey) {
                    // Fail closed like AWS/GCP/vSphere/OCI: a missing client id or
                    // secret would otherwise be silently skipped by the env helper
                    // (warning only), leaving packer-plugin-azure to fall back to the
                    // agent VM's ambient managed identity (its MSI path) and
                    // authenticate as an unintended, possibly more-privileged identity.
                    throw new Error(`Azure service principal credentials are incomplete for service connection '${serviceConnectionID}'. Both a service principal id and key are required.`);
                }
                tasks.setSecret(servicePrincipalKey);
                const tenantId = tasks.getEndpointAuthorizationParameter(serviceConnectionID, "tenantid", false);
                EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_arm_client_id", servicePrincipalId);
                if (tenantId) {
                    EnvironmentVariableHelper.setEnvironmentVariable("PKR_VAR_arm_tenant_id", tenantId);
                }
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
