# Pipeline Tasks for Packer

Install [HashiCorp Packer](https://www.packer.io/) and run Packer commands to build machine images in your Azure Pipelines build and release pipelines.

## Tasks

### Pipeline Packer tool installer

Finds in cache or downloads a specific version of Packer and prepends it to the `PATH`. Download from:

- **HashiCorp official releases** (`releases.hashicorp.com`) — GPG-verified
- **Private registry** — a `terraform-registry-backend` instance serving a `packer` binary mirror
- **Custom mirror URL** — any HTTPS server mirroring the HashiCorp releases directory structure

### Pipeline Packer

Runs any Packer CLI command — `init`, `validate`, `build`, `fmt`, `inspect`, `console`, `fix`, `hcl2_upgrade`, `plugins`, `version`, and a `custom` escape hatch — with first-class service-connection authentication for every cloud Packer officially supports:

| Provider | Authentication |
| --- | --- |
| `azurerm` | Azure Resource Manager service connection (Workload Identity Federation / Managed Identity / Service Principal) |
| `aws` | AWS service connection (static keys or Workload Identity Federation) |
| `gcp` | GCP service connection (service account key or Workload Identity Federation) |
| `oci` | OCI service connection (API key, or Workload Identity Federation via OIDC-to-UPST) |
| `vsphere` | vSphere/vCenter service connection (username + password) |
| `none` | No cloud credentials — for Docker, QEMU, VirtualBox, VMware, Hyper-V, and Vagrant builders |

## Example

```yaml
steps:
  - task: PipelinePackerInstaller@1
    inputs:
      packerVersion: latest

  - task: PipelinePacker@1
    displayName: Build Azure image
    inputs:
      command: build
      provider: azurerm
      environmentServiceNameAzureRM: my-azure-connection
      templatePath: ./images/ubuntu
```

See the [GitHub repository](https://github.com/sethbacon/azure-pipelines-packer) for full documentation.

## Trademarks

"Packer" is a trademark of HashiCorp. This extension is an independent, community-built extension and is not affiliated with, endorsed by, or sponsored by HashiCorp. Amazon Web Services, Google Cloud, Oracle Cloud Infrastructure, and VMware vSphere are trademarks of their respective owners; this project is not affiliated with, endorsed by, or sponsored by any of them. Product names are used under nominative fair use solely to describe compatibility.
