# Pipeline Tasks for Packer — Troubleshooting

## "Packer was not found on the agent"

The command task could not locate the `packer` binary on the `PATH`.

- Add a **Pipeline Packer tool installer** task before the command task, or
- Ensure a pre-installed Packer is on the agent's `PATH`.

The installer prepends the binary directory to `PATH` for subsequent tasks in the same job.

## Installer fails with "Only HTTPS URLs are allowed"

`registryUrl` and `mirrorBaseUrl` must use `https://`. Plain HTTP is rejected before any network access.

## Installer fails with "... host ... is private or link-local and was rejected"

The installer refuses to download the Packer binary from a host that is — or resolves to — a loopback, link-local/metadata (`169.254.0.0/16`), carrier-grade-NAT (`100.64.0.0/10`), or RFC1918/ULA private address. The check runs on the initial download URL and again on every redirect hop, so a public-looking mirror that redirects (or resolves) to an internal address is refused too.

If the host really is your private or air-gapped mirror, name it explicitly:

- `mirrorAllowedHosts` for `downloadSource: mirror`
- `registryAllowedHosts` for `downloadSource: registry`

Both accept a comma- or newline-separated list; a `*.` prefix matches subdomains only. Naming a host disables the baseline private-address refusal **for that host** and pins every hop to the list. See SECURITY.md → "Security-relevant toggles".

A companion message, "... host ... is not in mirrorAllowedHosts (...)", means an allowlist *is* configured and the download (or a redirect from it) landed on a host outside it — add that host, or investigate why the mirror is redirecting off-list.

## Installer fails with a SHA256 verification error

The downloaded archive's hash did not match the published `SHA256SUMS`. This is a hard failure (possible corruption or tampering). Re-run; if it persists, verify the mirror/registry is serving the correct files for the requested version and platform.

## Installer: GPG signature unavailable

For `hashicorp` and `mirror` sources the installer verifies the `SHA256SUMS.sig` against HashiCorp's release key. If the `.sig` is missing and `requireGpgSignature` is `true` (the default), the task fails. The same applies when a mirror publishes no `SHA256SUMS` at all: that file is what the `.sig` signs, so there is nothing left to verify and the task fails rather than installing with the toggle enabled but inert. Set `requireGpgSignature: false` only for mirrors that do not serve `.sig` files — you then rely on SHA256 alone.

A download whose checksum or signature fails verification is **deleted** rather than left in the agent's temp directory, so a rejected (possibly tampered) archive never lingers on a persistent self-hosted agent.

## `latest` resolves to an unexpected version

- For `hashicorp`/`mirror`, `latest` is resolved via the HashiCorp checkpoint API. If it is unreachable the installer **fails the task** — it does not fall back to a pinned version (#78). Someone who asked for `latest` often did so precisely for security currency, so a selective outage of the version endpoint must not silently hand them a since-superseded release. Pin an explicit `packerVersion` for reproducible builds, and to be unaffected by a checkpoint outage at all.
- `latest` carries no rollback protection on any source: nothing compares the resolved version against anything previously installed, so a checkpoint or registry pointer that moves *backwards* resolves to that older version. On `hashicorp`/`mirror` the artifact is still GPG-verified against the embedded HashiCorp key, so the residual is a genuine, signed, **older** release rather than a forged one; the `registry` source has no signature chain, only a checksum from the same host. Pinning `packerVersion` is the supported mitigation.
- For `registry`, `latest` is whatever the registry's `packer` mirror reports as latest.

## Build fails with cloud authentication errors

Confirm the **provider** input matches the service connection you supplied and that the connection has the required permissions:

| Provider  | Env injected | Common cause of failure |
| --------- | ------------ | ----------------------- |
| `azurerm` | `PKR_VAR_arm_*` | Template does not declare/wire the `arm_*` variables (see below); for WIF, the federated credential subject must match the pipeline |
| `aws`     | `AWS_*` | Wrong region, missing role trust policy (WIF), or expired keys |
| `gcp`     | `GOOGLE_APPLICATION_CREDENTIALS` | Service account lacks Compute permissions; WIF pool/provider IDs incorrect |
| `oci`     | `PKR_VAR_oci_*` | Template does not declare/use the `oci_*` variables (see below) |
| `vsphere` | `PKR_VAR_vsphere_*` | Template does not declare/use the `vsphere_*` variables, or TLS verification fails |

## Azure / OCI / vSphere: credentials seem to be ignored

`packer-plugin-azure`, `packer-plugin-oracle`, and `packer-plugin-vsphere` do not read plugin-native environment variables for credentials — all three handlers expose the connection as **Packer variables** (`PKR_VAR_arm_*`, `PKR_VAR_oci_*`, `PKR_VAR_vsphere_*`) instead. Your template must declare matching `variable` blocks and wire them to the builder `source`. See the [YAML examples](yaml-examples.md#build--azure) for the exact variable names and a sample source block for each provider.

## Azure Workload Identity Federation token issues

WIF token generation requires the pipeline to allow OAuth token access and the service connection to be configured for federation. The Azure handler injects `PKR_VAR_arm_client_id`, `PKR_VAR_arm_tenant_id`, and `PKR_VAR_arm_client_jwt` — your template's `azure-arm` source block must reference `var.arm_client_jwt` as `client_jwt` (see [YAML examples](yaml-examples.md#build--azure)). If `packer-plugin-azure` reports an authentication error: verify the federated credential on the app registration trusts your pipeline's subject; verify the template actually references the injected variables (a template written for the Terraform extension's `ARM_*` env-var convention will NOT pick up Azure credentials here); and use a plugin version that includes the fix for [hashicorp/packer-plugin-azure#451](https://github.com/hashicorp/packer-plugin-azure/issues/451) (older versions reject Azure DevOps-issued OIDC tokens with an "x5t header" error). See [docs/wif-setup.md](wif-setup.md) for least-privilege federated-credential setup across all three WIF-capable providers (Azure/AWS/GCP).

## Build fails partway through with `AADSTS700024` or another mid-build auth error

The ADO OIDC token used for Workload Identity Federation is fetched once at the start of the command and is valid for only ~10 minutes; the cloud access token/session exchanged from it is typically valid for ~1 hour, and neither is refreshed during the build. A Packer build that runs longer than that will fail with an authentication error partway through — for Azure specifically, `AADSTS700024: Client assertion is not within its valid time range`. This is not a misconfiguration: it is a lifetime limitation of the one-shot WIF token exchange. For long-running builds, switch to a Managed Identity-backed connection (Azure), increase your IAM role's maximum session duration (AWS), or use the API-key scheme (OCI); see [Long-running builds and WIF token lifetime](wif-setup.md#long-running-builds-and-wif-token-lifetime) for details on all four providers.

## `artifactId` output variable is empty

`artifactId` is only set when `manifestFile` points at the output of a [`manifest` post-processor](https://developer.hashicorp.com/packer/docs/post-processors/manifest) in your template. Add the post-processor and set `manifestFile` to its `output` path.

## `fmt` fails the build

`fmt` defaults to check mode (`-check -diff`). A non-zero exit means files are not canonically formatted — run `packer fmt` locally, or set `fmtWrite: true` to reformat in place (and `fmtCheck: false` if you do not want the check to gate).

## Plugin download is rate-limited

`packer init` downloads plugins from GitHub, which is rate-limited for anonymous requests. Set the `githubToken` input on the `init` command to a token (use a pipeline secret variable); it is passed as `PACKER_GITHUB_API_TOKEN`.

Packer itself verifies plugin checksums and signatures during `init` and the `plugins` commands. The task delegates plugin trust and source selection to Packer; it does not add a separate plugin allowlist or checksum policy. Pin plugin versions and required sources in the template's `required_plugins` block, and review its checksums before enabling `upgradePlugins` in a pipeline.

## Behind a proxy

The installer honours the agent's proxy configuration (`tasks.getHttpProxyConfiguration()`). Ensure the agent's proxy is configured so it can reach `releases.hashicorp.com`, `checkpoint-api.hashicorp.com`, and your registry/mirror.
