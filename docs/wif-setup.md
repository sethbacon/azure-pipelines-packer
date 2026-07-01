# Workload Identity Federation Setup

This guide covers the one-time cloud-side configuration needed to use Workload Identity Federation (WIF/OIDC) instead of long-lived static credentials with the **Pipeline Tasks for Packer** extension. WIF is supported for `azurerm`, `aws`, and `gcp`. OCI and vSphere authenticate with a service-connection API key / username-password and do not support WIF in this extension.

WIF eliminates storing a cloud secret in Azure DevOps. Instead, the pipeline requests a short-lived OIDC token from Azure DevOps (`id-token-generator.ts`), and the target cloud exchanges that token for temporary credentials via its own federation mechanism.

## Security note: the token has ADO's default audience

Every WIF provider (`azurerm`/`aws`/`gcp`) reuses the same OIDC token requester, which asks Azure DevOps for a token using only the service-connection ID — it does **not** set a custom `audience`/`aud` parameter, so the minted JWT carries ADO's default audience (`api://AzureADTokenV2`) regardless of which cloud consumes it.

This means **the federation configuration on the cloud side is the actual security boundary**, not the token's audience. For every provider below, you must pin the trust condition to the exact **issuer** (`https://vstoken.dev.azure.com/<your-org-id>`), the exact **audience** (`api://AzureADTokenV2`), and the exact **subject** (`sub`, which encodes the specific service connection) — a loosely-scoped trust policy lets *any* service connection in your ADO organization impersonate the role/identity, not just the one you intend.

## Azure (`azurerm`)

Azure Resource Manager service connections with **Workload Identity Federation** authentication are created and federated entirely through the Azure DevOps UI — when you create the service connection and pick "Workload Identity federation (automatic)", ADO creates the Entra app registration's federated credential for you, scoped to that specific service connection.

1. Create an **Azure Resource Manager** service connection in your ADO project (**Project Settings → Service connections → New**), selecting **Workload Identity federation (automatic)**.
2. Assign the app registration's service principal the **minimum RBAC role** your Packer template needs at the narrowest scope that works — e.g. `Virtual Machine Contributor` on a single resource group for building a managed image, not `Contributor` on the subscription.
3. Reference `environmentServiceNameAzureRM` in the task with this service connection.

**Packer-specific wiring:** unlike the Terraform extension's `azurerm` provider, `packer-plugin-azure` does not read `ARM_*` environment variables — the task injects `PKR_VAR_arm_client_id`, `PKR_VAR_arm_tenant_id`, and `PKR_VAR_arm_client_jwt` as Packer variables, and **your template must declare and wire them** (see [`docs/yaml-examples.md`](yaml-examples.md#build--azure) for a worked `azure-arm` source block). Use a recent `packer-plugin-azure` version — older releases reject ADO-issued OIDC tokens with an "x5t header" error ([hashicorp/packer-plugin-azure#451](https://github.com/hashicorp/packer-plugin-azure/issues/451), fixed upstream).

## AWS (`aws`)

1. Create an IAM OIDC identity provider (**IAM → Identity providers → Add provider**) with:
   - **Provider URL:** `https://vstoken.dev.azure.com/<your-azure-devops-organization-id>` (the org GUID, not the name)
   - **Audience:** `api://AzureADTokenV2`
2. Create an IAM role with **Web identity** as the trusted entity, selecting the provider above, and attach the **minimum policies** your Packer builder needs (e.g. scoped EC2/AMI permissions, not `AdministratorAccess`).
3. **Restrict the trust policy** to your specific service connection:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/vstoken.dev.azure.com/<ORG_ID>" },
       "Action": "sts:AssumeRoleWithWebIdentity",
       "Condition": {
         "StringEquals": {
           "vstoken.dev.azure.com/<ORG_ID>:aud": "api://AzureADTokenV2",
           "vstoken.dev.azure.com/<ORG_ID>:sub": "sc://<ORG_NAME>/<PROJECT_NAME>/<SERVICE_CONNECTION_NAME>"
         }
       }
     }]
   }
   ```

4. Configure the task:

   ```yaml
   - task: PipelinePacker@1
     inputs:
       command: 'build'
       provider: 'aws'
       environmentAuthSchemeAWS: 'WorkloadIdentityFederation'
       environmentServiceNameAWS: 'my-aws-service-connection'
       awsRoleArn: 'arn:aws:iam::123456789012:role/PackerBuildRole'
       awsRegion: 'us-east-1'
   ```

The task sets `AWS_ROLE_ARN`, `AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_REGION`, and `AWS_ROLE_SESSION_NAME` — read natively by `packer-plugin-amazon`'s AWS SDK, no template wiring required.

## GCP (`gcp`)

1. Enable the required APIs: `iam.googleapis.com`, `iamcredentials.googleapis.com`, `sts.googleapis.com`.
2. Create a Workload Identity Pool and an OIDC provider inside it:

   ```bash
   gcloud iam workload-identity-pools create "azure-devops-pool" --project="<PROJECT_ID>" --location="global"
   gcloud iam workload-identity-pools providers create-oidc "azure-devops-provider" \
       --project="<PROJECT_ID>" --location="global" --workload-identity-pool="azure-devops-pool" \
       --issuer-uri="https://vstoken.dev.azure.com/<ORG_ID>" \
       --allowed-audiences="api://AzureADTokenV2" \
       --attribute-mapping="google.subject=assertion.sub,attribute.service_connection=assertion.sub" \
       --attribute-condition="attribute.service_connection == 'sc://<ORG_NAME>/<PROJECT_NAME>/<SERVICE_CONNECTION_NAME>'"
   ```

3. Create (or reuse) a service account with the **minimum IAM roles** your builder needs (e.g. `roles/compute.instanceAdmin.v1` for a GCE image build, not `roles/editor`), and grant the pool permission to impersonate it:

   ```bash
   gcloud iam service-accounts add-iam-policy-binding "packer-builder@<PROJECT_ID>.iam.gserviceaccount.com" \
       --project="<PROJECT_ID>" --role="roles/iam.workloadIdentityUser" \
       --member="principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/azure-devops-pool/attribute.service_connection/sc://<ORG_NAME>/<PROJECT_NAME>/<SERVICE_CONNECTION_NAME>"
   ```

4. Configure the task:

   ```yaml
   - task: PipelinePacker@1
     inputs:
       command: 'build'
       provider: 'gcp'
       environmentAuthSchemeGCP: 'WorkloadIdentityFederation'
       environmentServiceNameGCP: 'my-gcp-service-connection'
       gcpProjectNumber: '123456789012'
       gcpWorkloadIdentityPoolId: 'azure-devops-pool'
       gcpWorkloadIdentityProviderId: 'azure-devops-provider'
       gcpServiceAccountEmail: 'packer-builder@my-project.iam.gserviceaccount.com'
   ```

The task writes an `external_account` credentials JSON file pointing at the ADO OIDC token and sets `GOOGLE_APPLICATION_CREDENTIALS` — read natively by `packer-plugin-googlecompute`, no template wiring required.

## Prefer WIF over static keys

For all three providers, prefer WIF over the static-credential alternative (AWS access keys, GCP service-account JSON keys, Azure Service Principal secrets):

- No long-lived secret is stored in Azure DevOps.
- Tokens are short-lived (typically ~5 minutes for the ADO OIDC token, up to 1 hour for the exchanged cloud credential).
- The trust condition above (issuer + audience + subject) can be scoped to a single service connection, unlike a static key/secret which grants access for as long as it exists and however widely it is shared.

The Azure Service Principal (client secret) and AWS static-key paths remain supported for compatibility, but the task emits a warning recommending WIF when a Service Principal secret is used.
