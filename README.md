# Pipeline Tasks for Packer

An Azure DevOps extension that installs [HashiCorp Packer](https://www.packer.io/) and runs Packer commands against every cloud Packer officially supports (Azure, AWS, GCP, OCI, vSphere) plus local/hypervisor builders.

This extension is modelled on, and a sibling of, [azure-pipelines-terraform](https://github.com/sethbacon/azure-pipelines-terraform). It shares that project's architecture: a flexible tool installer (HashiCorp / private registry / custom mirror) and a command task with per-provider authentication handlers.

> **Trademark.** "Packer" is a trademark of HashiCorp. This is an independent, community-built extension. The name "Pipeline Tasks for Packer" describes the extension's function (nominative fair use) and does not imply official HashiCorp affiliation.

## Tasks

| Task | ID | Purpose |
| --- | --- | --- |
| `PipelinePackerInstaller@1` | Pipeline Packer tool installer | Install Packer from HashiCorp releases, a private registry, or a custom mirror |
| `PipelinePacker@1` | Pipeline Packer | Run any Packer command with cloud service-connection auth |

## Repository layout

```txt
azure-pipelines-packer/
├── Tasks/
│   ├── PackerInstaller/
│   │   └── PackerInstallerV1/      # Installer task
│   └── PackerTask/
│       └── PackerTaskV1/           # Command task
├── configs/                        # Extension manifest publisher overrides
├── docs/                           # Initiative plans and guides
├── scripts/                        # Build + version-check helpers
└── .github/workflows/              # CI
```

## Development

```bash
# Installer task
cd Tasks/PackerInstaller/PackerInstallerV1
npm install --include=dev
npm test

# Command task
cd Tasks/PackerTask/PackerTaskV1
npm install --include=dev
npm test

# Full build + package (.vsix) from repo root
npm install --include=dev
npm run build:release
npm run package:dev
```

## Documentation

- [YAML examples](docs/yaml-examples.md) — installer + every command/provider, end-to-end pipelines
- [Workload Identity Federation setup](docs/wif-setup.md) — Azure/AWS/GCP, least-privilege trust policies
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md) — dev workflow, testing, release process
- [Security policy](SECURITY.md)
- [Initiative 1 plan](docs/initiatives/initiative-1-packer-extension.md)

## Service connections

Azure builds use the built-in **Azure Resource Manager** service connection. AWS, GCP, OCI, and vSphere builds use service-connection types defined by this extension (`Pipeline AWS for Packer`, `Pipeline GCP for Packer`, `Pipeline OCI for Packer`, `Pipeline vSphere for Packer`). The extension is fully standalone and does not depend on the Terraform extension.

## License

See [LICENSE](LICENSE). This project retains the original Microsoft copyright notice from the upstream azure-pipelines-terraform fork lineage; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
