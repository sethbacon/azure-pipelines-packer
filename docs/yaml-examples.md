# Pipeline Tasks for Packer — YAML Examples

## Task reference

- [`PipelinePackerInstaller@1`](#pipelinepackerinstaller1) — install Packer
- [`PipelinePacker@1`](#pipelinepacker1) — run Packer commands
- [End-to-end image factory](#end-to-end-image-factory) — install → init → validate → build
- [Chaining a built image into Terraform](#chaining-a-built-image-into-terraform)

---

## PipelinePackerInstaller@1

Install a specific version of Packer on the pipeline agent and prepend it to `PATH`.

### Install the latest Packer

```yaml
- task: PipelinePackerInstaller@1
  displayName: 'Install Packer (latest)'
  inputs:
    packerVersion: 'latest'
```

### Install a pinned version

```yaml
- task: PipelinePackerInstaller@1
  displayName: 'Install Packer 1.12.0'
  inputs:
    packerVersion: '1.12.0'
```

### Download from a custom mirror

The mirror must serve files at the same path structure as `releases.hashicorp.com/packer`.

```yaml
- task: PipelinePackerInstaller@1
  inputs:
    packerVersion: '1.12.0'
    downloadSource: 'mirror'
    mirrorBaseUrl: 'https://artifacts.example.com/hashicorp/packer'
    # Optional. Empty (the default) refuses any mirror host that is, or resolves
    # to, a loopback/link-local/metadata/CGNAT/private address -- on the initial
    # URL and on every redirect hop. Set it to pin a deliberately private or
    # air-gapped mirror; '*.' matches subdomains only. See SECURITY.md.
    mirrorAllowedHosts: 'artifacts.example.com'
    requireChecksum: true
```

### Download from a private registry backend

Points at a [terraform-registry-backend](https://github.com/sethbacon/terraform-registry-backend) instance that mirrors the `packer` binary. The registry resolves `latest` and returns a pre-signed, SHA256-verified download URL.

```yaml
- task: PipelinePackerInstaller@1
  inputs:
    packerVersion: 'latest'
    downloadSource: 'registry'
    registryUrl: 'https://registry.example.com'
    registryMirrorName: 'packer'
    # Optional. Same shape as mirrorAllowedHosts, applied to the storage host the
    # registry hands the download off to (and to every redirect hop from it).
    registryAllowedHosts: '*.s3.amazonaws.com'
```

After this task, `$(packerLocation)` holds the binary path and `$(packerDownloadedFrom)` records the source (`hashicorp`, `registry:<url>`, `mirror:<url>`, or `cache`).

---

## PipelinePacker@1

### init

```yaml
- task: PipelinePacker@1
  displayName: 'packer init'
  inputs:
    command: 'init'
    templatePath: './images/ubuntu'
    upgradePlugins: true
    # Optional: avoid GitHub plugin-download rate limits
    githubToken: $(GITHUB_TOKEN)
```

Plugin verification and source selection are performed by Packer. Keep plugin versions and sources pinned in the template's `required_plugins` block, review the recorded checksums, and use `upgradePlugins` only when updating those dependencies intentionally. The task does not add a separate plugin allowlist or checksum policy.

### validate

```yaml
- task: PipelinePacker@1
  displayName: 'packer validate'
  inputs:
    command: 'validate'
    provider: 'azurerm'
    environmentServiceNameAzureRM: 'my-azure-connection'
    templatePath: './images/ubuntu'
    variableFiles: |
      ./images/ubuntu/prod.pkrvars.hcl
```

### fmt (formatting gate)

`fmt` defaults to check mode (`-check -diff`); a formatting difference fails the task.

```yaml
- task: PipelinePacker@1
  displayName: 'packer fmt check'
  inputs:
    command: 'fmt'
    templatePath: '.'
    fmtRecursive: true
```

### build — Azure

`packer-plugin-azure`'s credential fields (`client_id`/`client_secret`/`client_jwt`/`tenant_id`/`subscription_id`) are HCL-only, not environment variables. The Azure connection is exposed to the template as `PKR_VAR_arm_*` variables (`PKR_VAR_arm_client_id`, `PKR_VAR_arm_subscription_id`, and either `PKR_VAR_arm_client_jwt` for Workload Identity Federation or `PKR_VAR_arm_client_secret` for a Service Principal). Declare matching variables in your template and wire them to the `azure-arm` source. One exception: the plugin does read the bare `ARM_METADATA_URL` environment variable directly (to select the Azure cloud endpoint) -- this task neutralizes any inherited value before each build so it can't redirect where credentials are exchanged.

```yaml
- task: PipelinePacker@1
  displayName: 'Build Azure managed image'
  inputs:
    command: 'build'
    provider: 'azurerm'
    environmentServiceNameAzureRM: 'my-azure-connection'   # WIF recommended
    templatePath: './images/ubuntu'
    packerVariables: |
      image_version=$(Build.BuildNumber)
    manifestFile: './images/ubuntu/manifest.json'
```

```hcl
# images/ubuntu/variables.pkr.hcl
variable "arm_client_id" {
  type    = string
  default = ""
}

variable "arm_subscription_id" {
  type    = string
  default = ""
}

variable "arm_tenant_id" {
  type    = string
  default = ""
}

variable "arm_client_jwt" {
  type      = string
  default   = ""
  sensitive = true
}

variable "arm_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

source "azure-arm" "ubuntu" {
  client_id       = var.arm_client_id
  subscription_id = var.arm_subscription_id
  tenant_id       = var.arm_tenant_id
  client_jwt      = var.arm_client_jwt
  client_secret   = var.arm_client_secret
  # ... image/build settings
}
```

For **Managed Identity**, the task injects only `PKR_VAR_arm_subscription_id`; leave `arm_tenant_id`/`arm_client_jwt`/`arm_client_secret` unset in the template (or defaulted to `""`) so `packer-plugin-azure` falls back to the VM's managed identity automatically. ADO's MSI-scheme service connection does not expose a distinct client ID for a specific user-assigned identity, so only the VM's default identity is supported.

WIF requires a recent `packer-plugin-azure` version — older releases reject Azure DevOps-issued OIDC tokens with an "x5t header" error ([hashicorp/packer-plugin-azure#451](https://github.com/hashicorp/packer-plugin-azure/issues/451), fixed upstream).

### build — AWS (static keys)

```yaml
- task: PipelinePacker@1
  displayName: 'Build AMI'
  inputs:
    command: 'build'
    provider: 'aws'
    environmentServiceNameAWS: 'my-aws-connection'
    environmentAuthSchemeAWS: 'ServiceConnection'
    awsRegion: 'us-east-1'
    templatePath: './images/amazon-linux'
    onlyBuilds: 'amazon-ebs.al2023'
```

### build — AWS (Workload Identity Federation)

```yaml
- task: PipelinePacker@1
  inputs:
    command: 'build'
    provider: 'aws'
    environmentServiceNameAWS: 'my-aws-oidc-connection'
    environmentAuthSchemeAWS: 'WorkloadIdentityFederation'
    awsRegion: 'us-east-1'
    awsRoleArn: 'arn:aws:iam::123456789012:role/packer-builder'
    templatePath: './images/amazon-linux'
```

### build — Google Cloud

```yaml
- task: PipelinePacker@1
  inputs:
    command: 'build'
    provider: 'gcp'
    environmentServiceNameGCP: 'my-gcp-connection'
    environmentAuthSchemeGCP: 'ServiceConnection'
    templatePath: './images/gce'
```

For WIF, set `environmentAuthSchemeGCP: 'WorkloadIdentityFederation'` and supply
`gcpProjectNumber`, `gcpWorkloadIdentityPoolId`, `gcpWorkloadIdentityProviderId`,
and `gcpServiceAccountEmail`.

### build — Oracle Cloud (OCI)

The OCI connection fields are exposed to the template as `PKR_VAR_oci_*` variables. Declare matching variables in your template and wire them to the `oracle-oci` source.

```yaml
- task: PipelinePacker@1
  inputs:
    command: 'build'
    provider: 'oci'
    environmentServiceNameOCI: 'my-oci-connection'
    templatePath: './images/oci'
```

```hcl
# images/oci/variables.pkr.hcl
variable "oci_tenancy_ocid" { type = string }
variable "oci_user_ocid" { type = string }
variable "oci_region" { type = string }
variable "oci_fingerprint" { type = string }
variable "oci_key_file" { type = string }

source "oracle-oci" "instance" {
  tenancy_ocid = var.oci_tenancy_ocid
  user_ocid    = var.oci_user_ocid
  region       = var.oci_region
  fingerprint  = var.oci_fingerprint
  key_file     = var.oci_key_file
  # ...
}
```

### build — Oracle Cloud (OCI) with Workload Identity Federation

No API key is stored: the task exchanges the pipeline's OIDC token for a short-lived OCI User Principal Session Token and writes a generated OCI config file referencing it. Setup steps are in [wif-setup.md](wif-setup.md#oracle-cloud-oci).

```yaml
- task: PipelinePacker@1
  inputs:
    command: 'build'
    provider: 'oci'
    environmentServiceNameOCI: 'my-oci-connection'
    environmentAuthSchemeOCI: 'WorkloadIdentityFederation'
    ociWifTenancyOcid: 'ocid1.tenancy.oc1..aaaa...'
    ociWifRegion: 'us-ashburn-1'
    ociWifIdentityDomainUrl: 'https://idcs-0123456789abcdef0123456789abcdef.identity.oraclecloud.com'
    ociWifClientId: 'abc123def456'
    templatePath: './images/oci'
```

The template must declare `oci_access_cfg_file` and wire it to `access_cfg_file`. The task passes it with `-var`, so a missing declaration is a hard Packer error rather than a silent fall-through to the agent's ambient OCI config.

```hcl
# images/oci/variables.pkr.hcl
variable "oci_access_cfg_file" {
  type    = string
  default = ""
}

source "oracle-oci" "instance" {
  access_cfg_file = var.oci_access_cfg_file
  # tenancy_ocid / user_ocid / fingerprint / key_file are deliberately absent.
  # They must stay unset so the plugin falls through to the config file above;
  # a value in any of them is resolved first and the session token is ignored.
  # ...
}
```

One template for both schemes: give every `oci_*` variable `default = ""` and set the API-key fields from their variables. Under WIF those resolve to `""`, the plugin's raw configuration provider errors per-field, and the chain falls through to `access_cfg_file`. Do not "fix" the empty defaults — they are what makes the fall-through work.

### build — VMware vSphere

The vSphere connection is exposed as `PKR_VAR_vsphere_*` variables.

```yaml
- task: PipelinePacker@1
  inputs:
    command: 'build'
    provider: 'vsphere'
    environmentServiceNameVSphere: 'my-vcenter-connection'
    vsphereInsecureConnection: true   # self-signed vCenter cert only -- see SECURITY.md; never use in production
    templatePath: './images/vsphere'
```

```hcl
variable "vsphere_server" {
  type = string
}

variable "vsphere_user" {
  type = string
}

variable "vsphere_password" {
  type      = string
  sensitive = true
}

source "vsphere-iso" "ubuntu" {
  vcenter_server = var.vsphere_server
  username       = var.vsphere_user
  password       = var.vsphere_password
  # ...
}
```

### build — local / hypervisor builders (Docker, QEMU, etc.)

Use `provider: 'none'` for builders that need no cloud credentials. Pass any builder-specific settings via `environmentVariables`.

```yaml
- task: PipelinePacker@1
  inputs:
    command: 'build'
    provider: 'none'
    templatePath: './images/docker'
    environmentVariables: |
      DOCKER_BUILDKIT=1
```

### plugins

```yaml
- task: PipelinePacker@1
  inputs:
    command: 'plugins'
    pluginsSubCommand: 'install'
    pluginSource: 'github.com/hashicorp/azure'
    pluginVersion: '2.3.0'
```

### inspect / console / fix / hcl2_upgrade / version

```yaml
- task: PipelinePacker@1
  inputs:
    command: 'inspect'
    templatePath: './images/ubuntu'

- task: PipelinePacker@1
  inputs:
    command: 'console'
    templatePath: './images/ubuntu'
    consoleExpression: 'var.image_version'

- task: PipelinePacker@1
  inputs:
    command: 'hcl2_upgrade'
    templatePath: './legacy/template.json'
    hclOutputFile: './images/ubuntu/ubuntu.pkr.hcl'

- task: PipelinePacker@1
  inputs:
    command: 'version'
```

### custom

Escape hatch for any command or flag combination not surfaced as a dedicated input.

```yaml
- task: PipelinePacker@1
  inputs:
    command: 'custom'
    customCommand: 'fmt'
    commandOptions: '-check -recursive .'
```

---

## End-to-end image factory

```yaml
steps:
  - task: PipelinePackerInstaller@1
    displayName: 'Install Packer'
    inputs:
      packerVersion: 'latest'

  - task: PipelinePacker@1
    displayName: 'packer init'
    inputs:
      command: 'init'
      templatePath: './images/ubuntu'

  - task: PipelinePacker@1
    displayName: 'packer fmt (check)'
    inputs:
      command: 'fmt'
      templatePath: './images/ubuntu'

  - task: PipelinePacker@1
    displayName: 'packer validate'
    inputs:
      command: 'validate'
      provider: 'azurerm'
      environmentServiceNameAzureRM: 'my-azure-connection'
      templatePath: './images/ubuntu'

  - task: PipelinePacker@1
    displayName: 'packer build'
    inputs:
      command: 'build'
      provider: 'azurerm'
      environmentServiceNameAzureRM: 'my-azure-connection'
      templatePath: './images/ubuntu'
      manifestFile: './images/ubuntu/manifest.json'
```

---

## Chaining a built image into Terraform

When the `build` step has a `manifestFile`, the last build's artifact id is published as `$(artifactId)`. Pass it to a downstream Terraform task (e.g. the sibling [Pipeline Tasks for Terraform](https://github.com/sethbacon/azure-pipelines-terraform) extension):

```yaml
  - task: PipelinePacker@1
    name: imageBuild
    inputs:
      command: 'build'
      provider: 'azurerm'
      environmentServiceNameAzureRM: 'my-azure-connection'
      templatePath: './images/ubuntu'
      manifestFile: './images/ubuntu/manifest.json'

  - task: PipelineTerraformTask@5
    inputs:
      command: 'apply'
      provider: 'azurerm'
      environmentServiceNameAzureRM: 'my-azure-connection'
      commandOptions: '-var image_id=$(artifactId)'
```
