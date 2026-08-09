import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper } from './environment-variables';
import {
    assertIdentityValue,
    neutralizeEnvironmentVariables,
    requireIdentityField,
    requireSecretField,
    resolveRoleSessionName,
} from './credential-guards';

/**
 * Environment variables the AWS SDK's default credential chain matches BEFORE
 * the web-identity token file (`resolveCredentials()` in
 * aws/session/credentials.go; same ordering in aws-sdk-go-v2's
 * `resolveCredentialChain`). Any of these left set by a self-hosted agent, a
 * pipeline variable, or this task's own `environmentVariables` passthrough wins
 * outright over a freshly minted federated assertion, so the WIF branch clears
 * them before injecting (#187).
 */
const AWS_STATIC_CREDENTIAL_ENV = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_PROFILE',
    'AWS_SHARED_CREDENTIALS_FILE',
] as const;

/** The mirror set: web-identity/role selectors the static-key branch must clear. */
const AWS_FEDERATED_CREDENTIAL_ENV = [
    'AWS_WEB_IDENTITY_TOKEN_FILE',
    'AWS_ROLE_ARN',
    'AWS_SESSION_TOKEN',
    'AWS_PROFILE',
    'AWS_SHARED_CREDENTIALS_FILE',
] as const;

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

        // Fail closed rather than injecting an empty credential: the AWS SDK
        // treats a missing AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY as "not set"
        // and silently falls back to instance-profile/ambient credentials,
        // authenticating as an unintended (possibly more-privileged) identity.
        const accessKeyId = requireIdentityField(serviceName, "username");
        const secretAccessKey = requireSecretField(serviceName, "password");
        tasks.setSecret(secretAccessKey);

        neutralizeEnvironmentVariables(AWS_FEDERATED_CREDENTIAL_ENV, "AWS static");
        EnvironmentVariableHelper.setEnvironmentVariable("AWS_ACCESS_KEY_ID", accessKeyId);
        EnvironmentVariableHelper.setEnvironmentVariable("AWS_SECRET_ACCESS_KEY", secretAccessKey, true);

        // Region: prefer the explicit task input, fall back to the service
        // connection. BOTH are legitimately optional -- `awsRegion` is
        // required=false/defaultValue="" in task.json and the endpoint's own
        // `region` descriptor is isRequired:false, because a template that sets
        // `region` in its amazon-ebs source needs neither. The service-connection
        // read therefore passes optional=true; with optional=false (which is what
        // this used to do) task-lib THROWS on an absent optional field, so the
        // `|| ''` tail was unreachable and an entirely valid configuration aborted
        // inside the credential path with a generic LIB_EndpointAuthNotExist that
        // reads like a broken credential (#194).
        const region = tasks.getInput("awsRegion", false)
            || tasks.getEndpointAuthorizationParameter(serviceName, "region", true)
            || '';
        if (region) {
            EnvironmentVariableHelper.setEnvironmentVariable(
                "AWS_REGION",
                assertIdentityValue(region, `AWS region for service connection '${serviceName}'`));
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

        // Clear the static keys FIRST: the SDK matches them before the
        // web-identity token file, so leaving an inherited pair in place would
        // silently discard the assertion just written above (#187).
        neutralizeEnvironmentVariables(AWS_STATIC_CREDENTIAL_ENV, "AWS Workload Identity Federation");

        EnvironmentVariableHelper.setEnvironmentVariable("AWS_ROLE_ARN", assertIdentityValue(tasks.getInput("awsRoleArn", true), "Input 'awsRoleArn'"));
        EnvironmentVariableHelper.setEnvironmentVariable("AWS_WEB_IDENTITY_TOKEN_FILE", tokenFilePath);
        EnvironmentVariableHelper.setEnvironmentVariable("AWS_REGION", assertIdentityValue(tasks.getInput("awsRegion", true), "Input 'awsRegion'"));
        EnvironmentVariableHelper.setEnvironmentVariable("AWS_ROLE_SESSION_NAME", resolveRoleSessionName("awsSessionName", "ado-packer"));
    }
}
