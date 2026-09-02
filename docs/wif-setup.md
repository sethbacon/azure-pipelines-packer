# Workload Identity Federation Setup

This guide covers the one-time cloud-side configuration needed to use Workload Identity Federation (WIF/OIDC) instead of long-lived static credentials with the **Pipeline Tasks for Packer** extension. WIF is supported for `azurerm`, `aws`, `gcp`, and `oci`. vSphere authenticates with a service-connection username/password and does not support WIF in this extension.

WIF eliminates storing a cloud secret in Azure DevOps. Instead, the pipeline requests a short-lived OIDC token from Azure DevOps (`generateIdToken()`, from `@4cloudguru/pipeline-task-ado`), and the target cloud exchanges that token for temporary credentials via its own federation mechanism.

## Security note: the token has ADO's default audience

Every WIF provider (`azurerm`/`aws`/`gcp`/`oci`) reuses the same OIDC token requester, which asks Azure DevOps for a token using only the service-connection ID — it does **not** set a custom `audience`/`aud` parameter, so the minted JWT carries ADO's default audience (`api://AzureADTokenV2`) regardless of which cloud consumes it.

This means **the federation configuration on the cloud side is the actual security boundary**, not the token's audience. For every provider below, you must pin the trust condition to the exact **issuer** (`https://vstoken.dev.azure.com/<your-org-id>`), the exact **audience** (`api://AzureADTokenV2`), and the exact **subject** (`sub`, which encodes the specific service connection) — a loosely-scoped trust policy lets *any* service connection in your ADO organization impersonate the role/identity, not just the one you intend.

## Azure (`azurerm`)

Azure Resource Manager service connections with **Workload Identity Federation** authentication are created and federated entirely through the Azure DevOps UI — when you create the service connection and pick "Workload Identity federation (automatic)", ADO creates the Entra app registration's federated credential for you, scoped to that specific service connection.

1. Create an **Azure Resource Manager** service connection in your ADO project (**Project Settings → Service connections → New**), selecting **Workload Identity federation (automatic)**.
2. Assign the app registration's service principal the **minimum RBAC role** your Packer template needs at the narrowest scope that works — e.g. `Virtual Machine Contributor` on a single resource group for building a managed image, not `Contributor` on the subscription.
3. Reference `environmentServiceNameAzureRM` in the task with this service connection.

**Packer-specific wiring:** unlike the Terraform extension's `azurerm` provider, `packer-plugin-azure` does not read `ARM_*` environment variables — the task injects `PKR_VAR_arm_client_id`, `PKR_VAR_arm_subscription_id`, `PKR_VAR_arm_tenant_id`, and `PKR_VAR_arm_client_jwt` as Packer variables, and **your template must declare and wire them** (see [`docs/yaml-examples.md`](yaml-examples.md#build--azure) for a worked `azure-arm` source block). Use a recent `packer-plugin-azure` version — older releases reject ADO-issued OIDC tokens with an "x5t header" error ([hashicorp/packer-plugin-azure#451](https://github.com/hashicorp/packer-plugin-azure/issues/451), fixed upstream).

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

### Role session name — per-run by default, and pinning it in the trust policy

`AWS_ROLE_SESSION_NAME` is the human-readable half of CloudTrail's `userIdentity.arn` (`arn:aws:sts::<acct>:assumed-role/<Role>/<SessionName>`), so it is the field an incident responder pivots on to find which pipeline and which run created a resource.

Leave the optional `awsSessionName` input **blank** (the default) and the task derives a distinct name per run:

```txt
ado-packer-<System.TeamProject>-<Build.BuildId>
```

sanitized to AWS's `[A-Za-z0-9_+=,.@-]` charset and truncated to 64 characters from the right, so the build id — the part that distinguishes one run from the next — always survives.

> **Behaviour change.** Earlier versions used the fixed constant `AzureDevOps-Packer` for every federated build of every pipeline in every organization. **If your IAM trust policy pins `sts:RoleSessionName` to that constant, assume-role will now be denied.** Either drop the condition, widen it to a prefix, or set `awsSessionName` explicitly to the old value (see below).

To keep a `sts:RoleSessionName` condition while still getting per-run attribution, match on the prefix rather than the whole name:

```json
"Condition": {
  "StringEquals": {
    "vstoken.dev.azure.com/<ORG_ID>:aud": "api://AzureADTokenV2",
    "vstoken.dev.azure.com/<ORG_ID>:sub": "sc://<ORG_NAME>/<PROJECT_NAME>/<SERVICE_CONNECTION_NAME>"
  },
  "StringLike": {
    "sts:RoleSessionName": "ado-packer-MyProject-*"
  }
}
```

Setting `awsSessionName` explicitly still wins, and the value is validated against AWS's own grammar (2–64 characters from `[A-Za-z0-9_+=,.@-]`) so an invalid name fails in the task with a clear message rather than as an opaque STS rejection. Pinning it to a constant restores the old, un-attributable behaviour — prefer the prefix condition above.

You cannot set `AWS_ROLE_SESSION_NAME` through the task's `environmentVariables` input: that input rejects any name that selects or forges an identity (see below).

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

## Oracle Cloud (`oci`)

OCI federation is a **two-hop** flow, unlike the other three providers. The task requests the ADO OIDC token, then exchanges it at your Identity Domain for a short-lived **User Principal Session Token (UPST)**, and hands Packer a generated OCI config file that references it. No API key is stored in Azure DevOps.

### 1. Create a confidential application

Identity & Security → Domains → *your domain* → Applications → **Add application** → **Confidential Application**. Name it something like `azure-devops-packer-token-exchange` and activate it.

Grant it **no app roles**: it is not the identity the build ends up running as, it only identifies which trust configuration a token-exchange request may use. Note its **Client ID** — that is `ociWifClientId`. The task sends `client_id` and never a client secret.

### 2. Create a service user and group

Create a service user (e.g. `svc-azdo-packer`) and add it to a group such as `PackerBuilders`. The UPST is issued for this user, so this is the identity your policies apply to.

### 3. Create an Identity Propagation Trust — the security boundary

This is the part that actually decides who may exchange a token. Register the ADO issuer against your confidential application:

- `issuer`: `https://vstoken.dev.azure.com/<your-org-id>`
- `oauthClients`: `["<client-id from step 1>"]`
- `clientClaimName` / `clientClaimValues`: `aud` / the audience your organization's tokens carry
- `impersonationServiceUsers`: the service user from step 2

**Scope the `sub` claim to the exact service connection.** As the security note at the top of this guide explains, the token carries ADO's default audience regardless of which cloud consumes it, so the trust configuration is the real boundary. A trust that accepts any `sub` lets *any* service connection in your organization exchange a token through it.

### 4. Grant an IAM policy

`Allow group PackerBuilders to manage instance-family in compartment my-packer-compartment` — narrow the verbs and compartment to what your template actually builds.

### 5. Wire the pipeline

```yaml
- task: PackerTask@1
  inputs:
    command: 'build'
    provider: 'oci'
    environmentServiceNameOCI: 'my-oci-connection'
    environmentAuthSchemeOCI: 'WorkloadIdentityFederation'
    ociWifTenancyOcid: 'ocid1.tenancy.oc1..aaaa...'
    ociWifRegion: 'us-ashburn-1'
    ociWifIdentityDomainUrl: 'https://idcs-0123456789abcdef0123456789abcdef.identity.oraclecloud.com'
    ociWifClientId: '<client-id from step 1>'
    templatePath: 'image.pkr.hcl'
```

The identity domain host must be a real Oracle identity-domain host: an `idcs-` prefix followed by 32 hex characters, under one of the four Oracle realms. A look-alike host is refused **before** the OIDC token is transmitted.

### The template contract — required

Unlike AWS and GCP, whose SDKs read well-known environment variables natively, `packer-plugin-oracle` reads **no** `OCI_CLI_*` variable. Its only override for the config file is the HCL `access_cfg_file` field, so **your template must declare the variable and wire it**:

```hcl
variable "oci_access_cfg_file" {
  type    = string
  default = ""
}

source "oracle-oci" "example" {
  access_cfg_file = var.oci_access_cfg_file
  # Do NOT set tenancy_ocid / user_ocid / fingerprint / key_file on the WIF path.
  # They must stay empty so the plugin falls through to the config file above --
  # a value in any of them is answered first and the session token is never used.
  availability_domain = "..."
  # ...
}
```

The task passes the path with `-var`, not as an environment variable, and that is deliberate: Packer **silently ignores** a `PKR_VAR_` for a variable the template never declared, so a missing declaration would leave the build authenticating with whatever ambient OCI config the agent happens to have. Passed as `-var`, the same mistake is a hard error before any builder runs:

```
A "oci_access_cfg_file" variable was passed in the command line but was not
found in known variables.
```

One case this does **not** catch: a template that declares the variable but never wires it to `access_cfg_file`. Packer accepts that, and the build then falls back to the plugin's own default config lookup.

### What the task writes

Three files, all mode 0600 under the agent temp directory, all scrubbed and deleted when the command finishes: the ephemeral private key, the UPST, and the config file naming both. The key pair is generated per run and never leaves the agent except as a public key in the exchange request.

## Long-running builds and WIF token lifetime

The ADO OIDC ID token is **short-lived — minutes, not hours**. Azure DevOps chooses the exact lifetime and has shortened it before, so this extension does not encode a figure and neither does this guide; treat it as "expires during a long build" rather than as a number you can plan against.

What this repo *can* state, because it is a property of the code rather than of ADO's issuing policy: **the token is fetched exactly once, at the start of the command, and is never refetched or refreshed for the life of the build.** `generateIdToken()` (`@4cloudguru/pipeline-task-ado`) has no expiry handling and no refresh path — it acquires the token, retries only transport failures, and returns. The token is then injected statically (as `PKR_VAR_arm_client_jwt` for Azure, or written to the file `AWS_WEB_IDENTITY_TOKEN_FILE` / the GCP `external_account` credential source points at). It is a client assertion, exchanged once by the cloud SDK for an access token or role session; that exchanged credential has its own, longer lifetime, and it is not refreshed from the ADO token either.

OCI is the one provider where the task performs that exchange itself rather than handing the assertion to the cloud SDK: the ADO token is traded for a **User Principal Session Token** before Packer starts, and it is the UPST — not the ADO token — that is written to disk and named by the generated config file. That shortens the exposure of the federated assertion, but it does not change the shape of this limitation. The UPST is minted once, has its own bounded lifetime, and this task never refreshes it.

A Packer build that runs longer than the exchanged credential's lifetime will start failing cloud API calls partway through. For Azure specifically, `packer-plugin-azure`'s calls to Entra will start returning **`AADSTS700024: Client assertion is not within its valid time range`** — this is a well-known failure mode for Azure DevOps-issued OIDC tokens on long-running operations (see Microsoft's WIF troubleshooting guidance for `AADSTS700024`). AWS, GCP and OCI builds can fail similarly once the assumed role session, Workload Identity Pool token or UPST expires.

If your Packer templates build large or slow images (long provisioner scripts, big base images, multi-hour builds):

- **Azure**: prefer a **Managed Identity**-backed service connection (`ManagedServiceIdentity` authorization scheme) for long builds — MSI credentials are refreshed by the Azure SDK for the life of the process, unlike a one-shot WIF assertion. If MSI is not available in your environment, a Service Principal with a client secret is the other long-build-safe fallback (the task will emit a warning recommending WIF, which you can accept for this specific case).
- **AWS**: the assumed role's session duration is controlled by the IAM role's **Maximum session duration** setting (up to 12 hours) rather than anything this task configures — set it as high as your role's policy allows for long-running builds.
- **GCP**: the exchanged access token from `external_account` credentials is refreshed automatically by Google's client libraries as long as the underlying ADO OIDC token used to establish it is still valid — but since the ADO token is one-shot and non-refreshable here, the build is bounded by that token's lifetime plus the derived session length, exactly as above.
- **OCI**: the build is bounded by the UPST's lifetime, which Oracle sets and this task does not configure. There is no equivalent of AWS's role session-duration dial to turn up. If a build reliably outlives it, use the **API key** scheme (`environmentAuthSchemeOCI: ServiceConnection`) for that pipeline instead — an API key does not expire, which is the whole tradeoff being made, and it is the reason this task keeps both schemes rather than replacing one with the other.

There is currently no code path in this task that refetches the ADO OIDC token mid-build; the safest choice for long Azure builds today is Managed Identity or Service Principal rather than WIF.

## Prefer WIF over static keys

For all four providers, prefer WIF over the static-credential alternative (AWS access keys, GCP service-account JSON keys, Azure Service Principal secrets, OCI API keys):

- No long-lived secret is stored in Azure DevOps.
- Tokens are short-lived: the ADO OIDC token expires in minutes, the exchanged cloud credential within the hour — see [Long-running builds and WIF token lifetime](#long-running-builds-and-wif-token-lifetime) for what that means for a slow build.
- The trust condition above (issuer + audience + subject) can be scoped to a single service connection, unlike a static key/secret which grants access for as long as it exists and however widely it is shared.

The Azure Service Principal (client secret) and AWS static-key paths remain supported for compatibility, but the task emits a warning recommending WIF when a Service Principal secret is used.

## Behaviour changes that can break an existing pipeline

Three recent hardening changes fail a build that previously ran. Each is listed with what to do about it.

### A passthrough `environmentVariables` entry that names an identity now fails the task

`environmentVariables` is applied *before* the provider handler runs, so a passthrough `AWS_ACCESS_KEY_ID` (or `GOOGLE_APPLICATION_CREDENTIALS`, `AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_ROLE_SESSION_NAME`, `PKR_VAR_arm_client_secret`, `PKR_VAR_oci_*`, `PKR_VAR_vsphere_*`, `CLOUDSDK_AUTH_*`, `OCI_CLI_*`, …) used to survive into the provider SDK's credential chain and win against the service connection — silently defeating WIF on the path operators are told is the safer one. It **used to warn**; it now **fails**.

Move the credential to a service connection. `environmentVariables` is for non-secret builder settings.

Names that only *configure* an already-chosen identity (`AWS_REGION`, a non-selector `PKR_VAR_arm_*`, a `*PROXY` setting) still warn rather than fail.

`ARM_*` is also refused. That is not because this task manages it — `packer-plugin-azure` never reads `ARM_*` at all, and no handler here sets one — but because setting it means you have this extension confused with the sibling Terraform extension, and your credential would otherwise sit there doing nothing.

### The AWS role session name is derived per run

See [Role session name](#role-session-name--per-run-by-default-and-pinning-it-in-the-trust-policy) above. Affects any IAM trust policy pinning `sts:RoleSessionName`.

### Outbound calls now honour the agent's proxy configuration

The ADO OIDC token request previously used Node's global `fetch` with no dispatcher, which ignores `HTTP_PROXY`/`HTTPS_PROXY` and the agent's own proxy settings — so on a self-hosted agent whose only egress is a forward proxy, **every** WIF path failed at token acquisition. It now routes through `Agent.ProxyUrl`/`Agent.ProxyUsername`/`Agent.ProxyPassword` exactly as the installer task already did, while keeping the https-only assertion and the no-redirect policy on the token exchange. Nothing to configure; if you worked around this by switching a connection back to static keys, you can switch it back to WIF.
