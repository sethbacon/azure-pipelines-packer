import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper } from './environment-variables';
import { generateIdToken } from './id-token-generator';

/**
 * Injects Azure credentials for the packer-plugin-azure builders via ARM_* env
 * vars, matching the authorization scheme of the Azure Resource Manager service
 * connection: Workload Identity Federation (OIDC), Managed Identity, or Service
 * Principal.
 */
export class PackerCommandHandlerAzureRM extends BasePackerCommandHandler {
    constructor() {
        super();
        this.providerName = "azurerm";
    }

    public async handleProvider(_command: PackerAuthorizationCommandInitializer): Promise<void> {
        const serviceConnectionID = tasks.getInput("environmentServiceNameAzureRM", true)!;
        const authorizationScheme = this.mapAuthorizationScheme(
            tasks.getEndpointAuthorizationScheme(serviceConnectionID, true)!
        );

        tasks.debug("Setting up Azure provider for authorization scheme: " + authorizationScheme + ".");

        let subscriptionId = tasks.getInput("environmentAzureRmOverrideSubscriptionID", false);
        if (!subscriptionId) {
            subscriptionId = tasks.getEndpointDataParameter(serviceConnectionID, "subscriptionid", true);
        }
        if (subscriptionId) {
            EnvironmentVariableHelper.setEnvironmentVariable("ARM_SUBSCRIPTION_ID", subscriptionId);
        }

        EnvironmentVariableHelper.setEnvironmentVariable(
            "ARM_TENANT_ID",
            tasks.getEndpointAuthorizationParameter(serviceConnectionID, "tenantid", false) ?? ''
        );

        switch (authorizationScheme) {
            case AuthorizationScheme.ManagedServiceIdentity:
                EnvironmentVariableHelper.setEnvironmentVariable("ARM_USE_MSI", "true");
                break;

            case AuthorizationScheme.WorkloadIdentityFederation: {
                const servicePrincipalId = tasks.getEndpointAuthorizationParameter(serviceConnectionID, "serviceprincipalid", true)!;
                const oidcToken = await generateIdToken(serviceConnectionID);
                tasks.setSecret(oidcToken);

                EnvironmentVariableHelper.setEnvironmentVariable("ARM_CLIENT_ID", servicePrincipalId);
                EnvironmentVariableHelper.setEnvironmentVariable("ARM_USE_OIDC", "true");
                EnvironmentVariableHelper.setEnvironmentVariable("ARM_OIDC_TOKEN", oidcToken, true);
                break;
            }

            case AuthorizationScheme.ServicePrincipal: {
                tasks.warning("Client secret authentication is less secure than Workload Identity Federation. Prefer a WIF-configured service connection where possible.");
                const servicePrincipalId = tasks.getEndpointAuthorizationParameter(serviceConnectionID, "serviceprincipalid", true)!;
                const servicePrincipalKey = tasks.getEndpointAuthorizationParameter(serviceConnectionID, "serviceprincipalkey", true)!;
                if (servicePrincipalKey) { tasks.setSecret(servicePrincipalKey); }
                EnvironmentVariableHelper.setEnvironmentVariable("ARM_CLIENT_ID", servicePrincipalId);
                EnvironmentVariableHelper.setEnvironmentVariable("ARM_CLIENT_SECRET", servicePrincipalKey, true);
                break;
            }
        }

        tasks.debug("Finished setting up Azure provider for authorization scheme: " + authorizationScheme + ".");
    }

    private mapAuthorizationScheme(authorizationScheme: string): AuthorizationScheme {
        if (authorizationScheme === undefined) {
            tasks.warning("The authorization scheme could not be found for your Service Connection, using Workload Identity Federation by default.");
            return AuthorizationScheme.WorkloadIdentityFederation;
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
