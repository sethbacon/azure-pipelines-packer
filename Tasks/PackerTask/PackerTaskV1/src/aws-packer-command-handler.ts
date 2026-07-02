import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper } from './environment-variables';

/**
 * Injects AWS credentials for the packer-plugin-amazon builders. Static
 * credentials set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY; Workload Identity
 * Federation writes an OIDC token file and sets the AWS SDK web-identity vars.
 */
export class PackerCommandHandlerAWS extends BasePackerCommandHandler {
    constructor() {
        super();
        this.providerName = "aws";
    }

    public async handleProvider(command: PackerAuthorizationCommandInitializer): Promise<void> {
        const authScheme = tasks.getInput("environmentAuthSchemeAWS", false) || "ServiceConnection";
        this.validateAuthScheme(authScheme, "environmentAuthSchemeAWS");

        if (authScheme === "WorkloadIdentityFederation") {
            await this.handleProviderWIF(command);
            return;
        }

        const serviceName = command.serviceProviderName;
        if (!serviceName) {
            throw new Error("An AWS service connection is required for this command. Set environmentServiceNameAWS.");
        }

        const accessKeyId = tasks.getEndpointAuthorizationParameter(serviceName, "username", false);
        const secretAccessKey = tasks.getEndpointAuthorizationParameter(serviceName, "password", false);
        if (!accessKeyId || !secretAccessKey) {
            // Fail closed rather than injecting an empty credential: the AWS SDK
            // treats a missing AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY as "not set"
            // and silently falls back to instance-profile/ambient credentials,
            // authenticating as an unintended (possibly more-privileged) identity.
            throw new Error(`AWS static credentials are incomplete for service connection '${serviceName}'. Both an access key ID and a secret access key are required.`);
        }
        tasks.setSecret(secretAccessKey);

        EnvironmentVariableHelper.setEnvironmentVariable("AWS_ACCESS_KEY_ID", accessKeyId);
        EnvironmentVariableHelper.setEnvironmentVariable("AWS_SECRET_ACCESS_KEY", secretAccessKey, true);

        // Region: prefer the explicit task input, fall back to the service connection.
        const region = tasks.getInput("awsRegion", false)
            || tasks.getEndpointAuthorizationParameter(serviceName, "region", false)
            || '';
        if (region) {
            EnvironmentVariableHelper.setEnvironmentVariable("AWS_REGION", region);
        }
    }

    private async handleProviderWIF(command: PackerAuthorizationCommandInitializer): Promise<void> {
        if (!command.serviceProviderName) {
            // Fail closed like the static path: an empty service connection would
            // otherwise POST to the ADO OIDC endpoint with an empty id and surface
            // a cryptic downstream error instead of a clear misconfiguration.
            throw new Error("An AWS service connection is required for Workload Identity Federation. Set environmentServiceNameAWS.");
        }
        const tokenFilePath = await this.writeOidcTokenFile(command.serviceProviderName, 'aws-oidc-token');

        EnvironmentVariableHelper.setEnvironmentVariable("AWS_ROLE_ARN", tasks.getInput("awsRoleArn", true)!);
        EnvironmentVariableHelper.setEnvironmentVariable("AWS_WEB_IDENTITY_TOKEN_FILE", tokenFilePath);
        EnvironmentVariableHelper.setEnvironmentVariable("AWS_REGION", tasks.getInput("awsRegion", true)!);
        EnvironmentVariableHelper.setEnvironmentVariable("AWS_ROLE_SESSION_NAME", tasks.getInput("awsSessionName", false) || "AzureDevOps-Packer");
    }
}
