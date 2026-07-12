# Changelog

## [1.2.5](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.2.4...v1.2.5) (2026-07-12)


### Bug Fixes

* cheap offline re-verification of the tool cache on a cache hit ([#148](https://github.com/sethbacon/azure-pipelines-packer/issues/148)) ([f32a1ae](https://github.com/sethbacon/azure-pipelines-packer/commit/f32a1aed164c63dc04eed962526ca24cd090069f)), closes [#136](https://github.com/sethbacon/azure-pipelines-packer/issues/136)
* validate registryUrl as a well-formed https:// URL before use ([#145](https://github.com/sethbacon/azure-pipelines-packer/issues/145)) ([29921ec](https://github.com/sethbacon/azure-pipelines-packer/commit/29921ec9d6030b2070e9a17783fc3955ef8ca7cb)), closes [#139](https://github.com/sethbacon/azure-pipelines-packer/issues/139)
* verify all signatures in a detached GPG .sig file, not just signatures[0] ([#146](https://github.com/sethbacon/azure-pipelines-packer/issues/146)) ([39e7cd7](https://github.com/sethbacon/azure-pipelines-packer/commit/39e7cd7f93ad5ae3e2d557d941442a6eae27e6eb)), closes [#137](https://github.com/sethbacon/azure-pipelines-packer/issues/137)


### Documentation

* correct stale PLANNED status and Node target claim in initiative-1 doc ([#134](https://github.com/sethbacon/azure-pipelines-packer/issues/134)) ([1ebc0b1](https://github.com/sethbacon/azure-pipelines-packer/commit/1ebc0b135aeab8bb160cc761e6d9af6b81633ab4))

## [1.2.4](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.2.3...v1.2.4) (2026-07-04)


### Documentation

* fix invalid HCL samples, correct security-toggle inventory, rewrite THIRD_PARTY_NOTICES, document WIF token lifetime ([#120](https://github.com/sethbacon/azure-pipelines-packer/issues/120)) ([8177514](https://github.com/sethbacon/azure-pipelines-packer/commit/8177514cac48f82f745d59e90f1844714ac70553))
* mark http-client.ts IN-SYNC now that terraform has the backport ([#122](https://github.com/sethbacon/azure-pipelines-packer/issues/122)) ([1681128](https://github.com/sethbacon/azure-pipelines-packer/commit/16811282c3de282eb318cc13038fe77cf12a8069))
* surface the Entra token argv-exposure residual risk in SECURITY.md ([#121](https://github.com/sethbacon/azure-pipelines-packer/issues/121)) ([710d9aa](https://github.com/sethbacon/azure-pipelines-packer/commit/710d9aa67b032d7747c085809124e34f9927ca60))


### Security

* fail-closed Azure auth, path traversal guards, and OIDC hardening for PackerTaskV1 ([#117](https://github.com/sethbacon/azure-pipelines-packer/issues/117)) ([d3d4e4e](https://github.com/sethbacon/azure-pipelines-packer/commit/d3d4e4eca5efa9b611833a898f6b7332e7aff047))
* harden release pipeline against supply-chain and tag-mismatch risks ([#119](https://github.com/sethbacon/azure-pipelines-packer/issues/119)) ([767c6ba](https://github.com/sethbacon/azure-pipelines-packer/commit/767c6ba90dc7f3c78f5a37e9b425d3a5eafeefc4))
* installer supply-chain hardening (P0 token leak + fail-open fixes) ([#115](https://github.com/sethbacon/azure-pipelines-packer/issues/115)) ([e06dda4](https://github.com/sethbacon/azure-pipelines-packer/commit/e06dda48d0453949369c29099eb10970f6ea380e))

## [1.2.3](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.2.2...v1.2.3) (2026-07-02)


### Security

* harden command-task credential handling and containment ([#83](https://github.com/sethbacon/azure-pipelines-packer/issues/83)) ([838c9ad](https://github.com/sethbacon/azure-pipelines-packer/commit/838c9ad5e3668ce38921548f768fbcc069a90267))
* harden installer download integrity and error handling ([#81](https://github.com/sethbacon/azure-pipelines-packer/issues/81)) ([f42c3c9](https://github.com/sethbacon/azure-pipelines-packer/commit/f42c3c9221ba77668da730d1561ba8e540a75558))

## [1.2.2](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.2.1...v1.2.2) (2026-07-01)


### Documentation

* fix TFX_PAT drift, add WIF setup guide, document security toggles ([#63](https://github.com/sethbacon/azure-pipelines-packer/issues/63)) ([4d94f26](https://github.com/sethbacon/azure-pipelines-packer/commit/4d94f2649c397ef377147177bf72d74a3fb7d1b1))


### Refactor

* bound installer HTTP requests with a wall-clock timeout ([#60](https://github.com/sethbacon/azure-pipelines-packer/issues/60)) ([c746e33](https://github.com/sethbacon/azure-pipelines-packer/commit/c746e33e899d09f4fb3e297cd5b5eaf274dc7f70))


### Security

* add task.json restrictions and settableVariables allowlists ([#61](https://github.com/sethbacon/azure-pipelines-packer/issues/61)) ([10c07ac](https://github.com/sethbacon/azure-pipelines-packer/commit/10c07acb6e7b0aec5aa9a6296d6cee0b5d4d5ccc))
* fail-closed registry/mirror checksum + HTTPS enforcement ([#56](https://github.com/sethbacon/azure-pipelines-packer/issues/56)) ([3a71acc](https://github.com/sethbacon/azure-pipelines-packer/commit/3a71accc68bca42efb0b179175b9c5a3a31569b6))
* harden handler-level credential and cleanup edge cases ([#59](https://github.com/sethbacon/azure-pipelines-packer/issues/59)) ([ce9e777](https://github.com/sethbacon/azure-pipelines-packer/commit/ce9e7771f4ff316cf987821628e1ade7c6b8c8f2))
* hardening omnibus + pin actionlint installer ([#64](https://github.com/sethbacon/azure-pipelines-packer/issues/64)) ([3cdc7f0](https://github.com/sethbacon/azure-pipelines-packer/commit/3cdc7f0d150c569e46cd1384d7bb085990619b5c))

## [1.2.1](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.2.0...v1.2.1) (2026-06-22)


### Security

* pin tfx-cli to 0.23.2, replace glob-exec in root ([#35](https://github.com/sethbacon/azure-pipelines-packer/issues/35)) ([2db495d](https://github.com/sethbacon/azure-pipelines-packer/commit/2db495dc6b04525f16874870e8696310a6a90c5d))

## [1.2.0](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.1.2...v1.2.0) (2026-06-22)


### Features

* require Node 24 agent runtime, pin types ([#33](https://github.com/sethbacon/azure-pipelines-packer/issues/33)) ([7357720](https://github.com/sethbacon/azure-pipelines-packer/commit/73577208b78c367cb8fad03542f30bb8d4aab481))

## [1.1.2](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.1.1...v1.1.2) (2026-06-22)


### Security

* release installer mock CodeQL fix ([#30](https://github.com/sethbacon/azure-pipelines-packer/issues/30)) ([#31](https://github.com/sethbacon/azure-pipelines-packer/issues/31)) ([55127f3](https://github.com/sethbacon/azure-pipelines-packer/commit/55127f3e662bc26ec7afcea0ee70a6f1fba079a5))

## [1.1.1](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.1.0...v1.1.1) (2026-06-12)


### Bug Fixes

* vSphere service connection URL fails marketplace validation ([#19](https://github.com/sethbacon/azure-pipelines-packer/issues/19)) ([d414708](https://github.com/sethbacon/azure-pipelines-packer/commit/d414708c60d15b91d79efcee42878a00b366a38c))

## [1.1.0](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.0.0...v1.1.0) (2026-06-12)


### Features

* initial Pipeline Tasks for Packer extension ([623894f](https://github.com/sethbacon/azure-pipelines-packer/commit/623894f217d544f6b5380a73cea2b97edd6120b6))


### Bug Fixes

* restore green build after dependabot major bumps ([#16](https://github.com/sethbacon/azure-pipelines-packer/issues/16)) ([5773bb6](https://github.com/sethbacon/azure-pipelines-packer/commit/5773bb650adf439b5eef15e184b69bdea5002552))

## Changelog

All notable changes to this project are documented here. This project follows
[Conventional Commits](https://www.conventionalcommits.org/) and releases are
managed by [release-please](https://github.com/googleapis/release-please).
