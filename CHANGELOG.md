# Changelog

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
