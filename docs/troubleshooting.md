# Pipeline Tasks for Packer — Troubleshooting

## "Packer was not found on the agent"

The command task could not locate the `packer` binary on the `PATH`.

- Add a **Pipeline Packer tool installer** task before the command task, or
- Ensure a pre-installed Packer is on the agent's `PATH`.

The installer prepends the binary directory to `PATH` for subsequent tasks in the same job.

## Installer fails with "Only HTTPS URLs are allowed"

`registryUrl` and `mirrorBaseUrl` must use `https://`. Plain HTTP is rejected before any network access.

## Installer fails with a SHA256 verification error

The downloaded archive's hash did not match the published `SHA256SUMS`. This is a hard failure (possible corruption or tampering). Re-run; if it persists, verify the mirror/registry is serving the correct files for the requested version and platform.

## Installer: GPG signature unavailable

For `hashicorp` and `mirror` sources the installer verifies the `SHA256SUMS.sig` against HashiCorp's release key. If the `.sig` is missing and `requireGpgSignature` is `true` (the default), the task fails. Set `requireGpgSignature: false` only for mirrors that do not serve `.sig` files — you then rely on SHA256 alone.

## `latest` resolves to an unexpected version

- For `hashicorp`/`mirror`, `latest` is resolved via the HashiCorp checkpoint API. If it is unreachable the installer falls back to a pinned version and logs a warning — pin an explicit `packerVersion` for reproducible builds.
- For `registry`, `latest` is whatever the registry's `packer` mirror reports as latest.

## Build fails with cloud authentication errors

Confirm the **provider** input matches the service connection you supplied and that the connection has the required permissions:

| Provider  | Env injected | Common cause of failure |
| --------- | ------------ | ----------------------- |
| `azurerm` | `ARM_*` | Service connection scheme/permissions; for WIF, the federated credential subject must match the pipeline |
| `aws`     | `AWS_*` | Wrong region, missing role trust policy (WIF), or expired keys |
| `gcp`     | `GOOGLE_APPLICATION_CREDENTIALS` | Service account lacks Compute permissions; WIF pool/provider IDs incorrect |
| `oci`     | `PKR_VAR_oci_*` | Template does not declare/use the `oci_*` variables (see below) |
| `vsphere` | `PKR_VAR_vsphere_*` | Template does not declare/use the `vsphere_*` variables, or TLS verification fails |

## OCI / vSphere: credentials seem to be ignored

The OCI and vSphere handlers expose the connection as **Packer variables** (`PKR_VAR_oci_*`, `PKR_VAR_vsphere_*`), not as plugin-native environment variables. Your template must declare matching `variable` blocks and wire them to the builder `source`. See the [YAML examples](yaml-examples.md#build--oracle-cloud-oci) for the exact variable names and a sample source block.

## Azure Workload Identity Federation token issues

WIF token generation requires the pipeline to allow OAuth token access and the service connection to be configured for federation. The Azure handler injects `ARM_CLIENT_ID`, `ARM_USE_OIDC`, and `ARM_OIDC_TOKEN`. If `packer-plugin-azure` reports an authentication error, verify the federated credential on the app registration trusts your pipeline's subject, and that the plugin version supports OIDC.

## `artifactId` output variable is empty

`artifactId` is only set when `manifestFile` points at the output of a [`manifest` post-processor](https://developer.hashicorp.com/packer/docs/post-processors/manifest) in your template. Add the post-processor and set `manifestFile` to its `output` path.

## `fmt` fails the build

`fmt` defaults to check mode (`-check -diff`). A non-zero exit means files are not canonically formatted — run `packer fmt` locally, or set `fmtWrite: true` to reformat in place (and `fmtCheck: false` if you do not want the check to gate).

## Plugin download is rate-limited

`packer init` downloads plugins from GitHub, which is rate-limited for anonymous requests. Set the `githubToken` input on the `init` command to a token (use a pipeline secret variable); it is passed as `PACKER_GITHUB_API_TOKEN`.

## Behind a proxy

The installer honours the agent's proxy configuration (`tasks.getHttpProxyConfiguration()`). Ensure the agent's proxy is configured so it can reach `releases.hashicorp.com`, `checkpoint-api.hashicorp.com`, and your registry/mirror.
