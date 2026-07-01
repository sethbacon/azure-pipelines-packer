import tasks = require('azure-pipelines-task-lib/task');
import { PackerAuthorizationCommandInitializer } from './packer-commands';
import { BasePackerCommandHandler } from './base-packer-command-handler';
import { EnvironmentVariableHelper } from './environment-variables';
import { generateIdToken } from './id-token-generator';
import { writeSecretFile } from './secure-temp';
import path = require('path');
import os = require('os');
import { randomUUID as uuidV4 } from 'crypto';

/**
 * Injects GCP credentials for the packer-plugin-googlecompute builders. Both
 * service-account-key and Workload Identity Federation paths write a credentials
 * JSON file and point GOOGLE_APPLICATION_CREDENTIALS at it.
 */
export class PackerCommandHandlerGCP extends BasePackerCommandHandler {
    constructor() {
        super();
        this.providerName = "gcp";
    }

    private writeServiceAccountKey(serviceName: string): string {
        const clientEmail = tasks.getEndpointAuthorizationParameter(serviceName, "Issuer", false);
        const tokenUri = tasks.getEndpointAuthorizationParameter(serviceName, "Audience", false);
        const privateKey = tasks.getEndpointAuthorizationParameter(serviceName, "PrivateKey", false);

        if (!clientEmail || !tokenUri || !privateKey) {
            const missing = ([!clientEmail && "Issuer", !tokenUri && "Audience", !privateKey && "PrivateKey"] as (string | false)[])
                .filter(Boolean).join(", ");
            throw new Error(`GCP service connection is missing required fields: ${missing}`);
        }
        tasks.setSecret(privateKey);

        const jsonCredsString = JSON.stringify({
            type: "service_account",
            private_key: privateKey,
            client_email: clientEmail,
            token_uri: tokenUri
        });

        const keyFilePath = path.join(os.tmpdir(), `gcp-credentials-${uuidV4()}.json`);
        writeSecretFile(keyFilePath, jsonCredsString);
        this.tempFiles.push(keyFilePath);
        return keyFilePath;
    }

    private async writeWifCredentials(serviceConnection: string): Promise<string> {
        const oidcToken = await generateIdToken(serviceConnection);
        tasks.setSecret(oidcToken);

        const tokenFilePath = path.join(os.tmpdir(), `gcp-oidc-token-${uuidV4()}.jwt`);
        writeSecretFile(tokenFilePath, oidcToken);
        this.tempFiles.push(tokenFilePath);

        const projectNumber = tasks.getInput("gcpProjectNumber", true)!;
        const poolId = tasks.getInput("gcpWorkloadIdentityPoolId", true)!;
        const providerId = tasks.getInput("gcpWorkloadIdentityProviderId", true)!;
        const serviceAccountEmail = tasks.getInput("gcpServiceAccountEmail", true)!;

        const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;
        const credentials = {
            type: "external_account",
            audience: audience,
            subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
            token_url: "https://sts.googleapis.com/v1/token",
            credential_source: { file: tokenFilePath },
            service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`
        };

        const credentialsFilePath = path.join(os.tmpdir(), `gcp-wif-credentials-${uuidV4()}.json`);
        writeSecretFile(credentialsFilePath, JSON.stringify(credentials));
        this.tempFiles.push(credentialsFilePath);
        return credentialsFilePath;
    }

    public async handleProvider(command: PackerAuthorizationCommandInitializer): Promise<void> {
        const authScheme = tasks.getInput("environmentAuthSchemeGCP", false) || "ServiceConnection";
        this.validateAuthScheme(authScheme, "environmentAuthSchemeGCP");

        if (authScheme === "WorkloadIdentityFederation") {
            const credentialsFilePath = await this.writeWifCredentials(command.serviceProviderName);
            EnvironmentVariableHelper.setEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS", credentialsFilePath);
            EnvironmentVariableHelper.setEnvironmentVariable("GOOGLE_PROJECT_ID", tasks.getInput("gcpProjectNumber", true)!);
            return;
        }

        const serviceName = command.serviceProviderName;
        if (!serviceName) {
            throw new Error("A GCP service connection is required for this command. Set environmentServiceNameGCP.");
        }
        const keyFilePath = this.writeServiceAccountKey(serviceName);
        EnvironmentVariableHelper.setEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS", keyFilePath);

        const project = tasks.getEndpointDataParameter(serviceName, "project", false);
        if (project) {
            EnvironmentVariableHelper.setEnvironmentVariable("GOOGLE_PROJECT_ID", project);
        }
    }
}
