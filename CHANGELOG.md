# Changelog

## [1.4.0](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.3.7...v1.4.0) (2026-08-31)


### Features

* **ci:** adopt the shared Dependabot CI-health check ([#378](https://github.com/sethbacon/azure-pipelines-packer/issues/378)) ([8dd7d1d](https://github.com/sethbacon/azure-pipelines-packer/commit/8dd7d1d0877ae2c9995a42ccd38f7d9260d00add))


### Bug Fixes

* **security:** adopt readSecretEndpointDataParameter from pipeline-task-ado ([#381](https://github.com/sethbacon/azure-pipelines-packer/issues/381)) ([ef8af33](https://github.com/sethbacon/azure-pipelines-packer/commit/ef8af338722b358be0ed60a907047d4cf508813f))
* **security:** annotate stale TFX_PAT doc reference, verify marketplace environment protection ([#340](https://github.com/sethbacon/azure-pipelines-packer/issues/340) findings 0+1) ([#373](https://github.com/sethbacon/azure-pipelines-packer/issues/373)) ([3699da6](https://github.com/sethbacon/azure-pipelines-packer/commit/3699da6fc8911e382bd42a9f60e7bfdac8c5e29f))
* **security:** dedupe the service-connection guard, wire Azure through command.serviceProviderName ([#370](https://github.com/sethbacon/azure-pipelines-packer/issues/370)) ([a1cada8](https://github.com/sethbacon/azure-pipelines-packer/commit/a1cada83282d3c9858d15cdbe32d5607804fef57))
* **security:** delete dead proxy-config.ts, add minimumAgentVersion to both tasks ([#337](https://github.com/sethbacon/azure-pipelines-packer/issues/337), [#344](https://github.com/sethbacon/azure-pipelines-packer/issues/344)) ([#383](https://github.com/sethbacon/azure-pipelines-packer/issues/383)) ([0f59104](https://github.com/sethbacon/azure-pipelines-packer/commit/0f591048080f3e9fa2727e537ed877418fa78dbe))
* **security:** delete endpoint-data-secret.ts, import from @4cloudguru/pipeline-task-ado ([#380](https://github.com/sethbacon/azure-pipelines-packer/issues/380)) ([#382](https://github.com/sethbacon/azure-pipelines-packer/issues/382)) ([04530cc](https://github.com/sethbacon/azure-pipelines-packer/commit/04530cc71348b7acc44b3b5ec56cbf167d5ba6e9))
* **security:** document SIGKILL residual risk, add a credential-cleanup-on-failure test ([#336](https://github.com/sethbacon/azure-pipelines-packer/issues/336) findings 3+4) ([#369](https://github.com/sethbacon/azure-pipelines-packer/issues/369)) ([b85f297](https://github.com/sethbacon/azure-pipelines-packer/commit/b85f297f476c7d844e0e6a1136a0682ae50ed85b))
* **security:** don't trust a cache-hit's sidecar hash as an adversarial control, and stop calling it one ([#360](https://github.com/sethbacon/azure-pipelines-packer/issues/360)) ([1cb378b](https://github.com/sethbacon/azure-pipelines-packer/commit/1cb378b188131da0f070c8052f1e846e186e7407))
* **security:** fail closed when a cache re-verification source withholds the checksum ([#334](https://github.com/sethbacon/azure-pipelines-packer/issues/334)) ([#366](https://github.com/sethbacon/azure-pipelines-packer/issues/366)) ([2736c5f](https://github.com/sethbacon/azure-pipelines-packer/commit/2736c5f90912c22f70a2f07f392836b0d216a386))
* **security:** mask secret-shaped environmentVariables passthrough, document the proxy TLS residual ([#361](https://github.com/sethbacon/azure-pipelines-packer/issues/361)) ([223e55a](https://github.com/sethbacon/azure-pipelines-packer/commit/223e55a98b02f6ed936a874aa68e69737a31c1ff))
* **security:** route the HashiCorp binary download through the redirect-safe egress-authorized client ([#334](https://github.com/sethbacon/azure-pipelines-packer/issues/334)) ([#367](https://github.com/sethbacon/azure-pipelines-packer/issues/367)) ([9d4ee88](https://github.com/sethbacon/azure-pipelines-packer/commit/9d4ee8870d3d255d85d68371f879a6a698d08a1a))
* **security:** scrub credential temp files before unlinking them ([#336](https://github.com/sethbacon/azure-pipelines-packer/issues/336)) ([#365](https://github.com/sethbacon/azure-pipelines-packer/issues/365)) ([bf05a24](https://github.com/sethbacon/azure-pipelines-packer/commit/bf05a24a9bc47e7e334e26858e71614ae035e22b))
* **security:** type-validate checkpoint/registry JSON fields, register termination listeners before any throw ([#342](https://github.com/sethbacon/azure-pipelines-packer/issues/342) error-handling roundup) ([#372](https://github.com/sethbacon/azure-pipelines-packer/issues/372)) ([470a25f](https://github.com/sethbacon/azure-pipelines-packer/commit/470a25fd4683e48bad52c2021ea1a4eaec754745))
* **security:** validate pluginsSubCommand/onError against their pickLists, add hcl2_upgrade TOCTOU re-check, apply GCP field grammars, block PATH passthrough ([#371](https://github.com/sethbacon/azure-pipelines-packer/issues/371)) ([a1c3a81](https://github.com/sethbacon/azure-pipelines-packer/commit/a1c3a813bab2f8349681f56f9f662f7f7a0aafdd))


### Documentation

* fill four documentation gaps found in the docs domain roundup ([#343](https://github.com/sethbacon/azure-pipelines-packer/issues/343)) ([#374](https://github.com/sethbacon/azure-pipelines-packer/issues/374)) ([5d6f0fa](https://github.com/sethbacon/azure-pipelines-packer/commit/5d6f0fa455165afdeeb99e5cc602e7a989071458))
* **security:** document that plugin installation trust is delegated to Packer itself ([#362](https://github.com/sethbacon/azure-pipelines-packer/issues/362)) ([e358329](https://github.com/sethbacon/azure-pipelines-packer/commit/e35832955655e60a0057232a20c1de3233a9f24e))
* **security:** surface the registry trust model at design time ([#334](https://github.com/sethbacon/azure-pipelines-packer/issues/334)) ([#368](https://github.com/sethbacon/azure-pipelines-packer/issues/368)) ([c2dd203](https://github.com/sethbacon/azure-pipelines-packer/commit/c2dd20327e81a0d4ba762d75deeca2d57d9404e6))


### Security

* block egress in sbom-and-sign and publish-marketplace ([#335](https://github.com/sethbacon/azure-pipelines-packer/issues/335)) ([#384](https://github.com/sethbacon/azure-pipelines-packer/issues/384)) ([234fc5f](https://github.com/sethbacon/azure-pipelines-packer/commit/234fc5ff2c33f1045231bb5598375119e2cf0e7f))

## [1.3.7](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.3.6...v1.3.7) (2026-08-28)


### Bug Fixes

* **gates:** bound the proxy-parity walk by ROOT, not by the script's own location ([#359](https://github.com/sethbacon/azure-pipelines-packer/issues/359)) ([221d894](https://github.com/sethbacon/azure-pipelines-packer/commit/221d894c9d64cb9f61abd26b42e154181deddcf5))
* symlink-aware path containment for PackerTaskV1's variableFiles ([#357](https://github.com/sethbacon/azure-pipelines-packer/issues/357)) ([422472b](https://github.com/sethbacon/azure-pipelines-packer/commit/422472bc4df8395699f3c4a58f739a52783c0ae7))

## [1.3.6](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.3.5...v1.3.6) (2026-08-27)


### Bug Fixes

* **ci:** retire the operator-declared egress exemption and fix two scanner blind spots ([#348](https://github.com/sethbacon/azure-pipelines-packer/issues/348)) ([86adcd8](https://github.com/sethbacon/azure-pipelines-packer/commit/86adcd86a0add08a0b1564cea0def76a42d42b3f))
* **ci:** tell a broken OSV scanner from a clean one ([#352](https://github.com/sethbacon/azure-pipelines-packer/issues/352)) ([6cd1e35](https://github.com/sethbacon/azure-pipelines-packer/commit/6cd1e355dc301e0de78682f520b3af06fa1455ad))
* **security:** add an npm audit gate for the root build/publish toolchain ([#335](https://github.com/sethbacon/azure-pipelines-packer/issues/335)) ([#354](https://github.com/sethbacon/azure-pipelines-packer/issues/354)) ([a815bbb](https://github.com/sethbacon/azure-pipelines-packer/commit/a815bbb5247755f7ecf883090315d735e56f06bc))
* **security:** deliver the OCI private key as a vaulted auth parameter ([#350](https://github.com/sethbacon/azure-pipelines-packer/issues/350)) ([4ceaab8](https://github.com/sethbacon/azure-pipelines-packer/commit/4ceaab85f8556a373873110cdfd23ae77bba60e9))
* **security:** disclose that the registry trust anchor is checksum-only ([#1024](https://github.com/sethbacon/azure-pipelines-packer/issues/1024)) ([#353](https://github.com/sethbacon/azure-pipelines-packer/issues/353)) ([1995906](https://github.com/sethbacon/azure-pipelines-packer/commit/1995906fee336cea361a3ff1a72676cac083eae4))
* **security:** egress-authorize registryUrl's own host ([#347](https://github.com/sethbacon/azure-pipelines-packer/issues/347)) ([e4dba72](https://github.com/sethbacon/azure-pipelines-packer/commit/e4dba72e0b537dcf20201d73f5f5b518f7444b7a))
* **security:** honor fail-closed switches regardless of value capitalization ([#345](https://github.com/sethbacon/azure-pipelines-packer/issues/345)) ([71d3099](https://github.com/sethbacon/azure-pipelines-packer/commit/71d3099cb15a76a06073b1c1a09b1e48573b6613))
* **security:** neutralize ARM_METADATA_URL and pin OCI access_cfg_file ([#333](https://github.com/sethbacon/azure-pipelines-packer/issues/333)) ([#356](https://github.com/sethbacon/azure-pipelines-packer/issues/356)) ([6c1eaa3](https://github.com/sethbacon/azure-pipelines-packer/commit/6c1eaa3e306c8edfb86c6de6c9be470f1c665e74))
* **security:** neutralize the Azure identity-selector gaps packer-plugin-azure honors ([#332](https://github.com/sethbacon/azure-pipelines-packer/issues/332)) ([#355](https://github.com/sethbacon/azure-pipelines-packer/issues/355)) ([1302f43](https://github.com/sethbacon/azure-pipelines-packer/commit/1302f43976d7b7bbd4b94ea1dc1fee62d2771227))
* **security:** register the OCI private key for the exact-match scrub, not just the masker ([#349](https://github.com/sethbacon/azure-pipelines-packer/issues/349)) ([af4a37b](https://github.com/sethbacon/azure-pipelines-packer/commit/af4a37be4a0c3134c395e92f75d46d7bf0552fcf))

## [1.3.5](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.3.4...v1.3.5) (2026-08-25)


### Bug Fixes

* **ci:** record zizmor findings as well as blocking on them ([#323](https://github.com/sethbacon/azure-pipelines-packer/issues/323)) ([ed1110b](https://github.com/sethbacon/azure-pipelines-packer/commit/ed1110bb6716b227ae91f800c7cdeec8ebe389a1))
* **ci:** resolve a delegated sink's origin before attributing it to a package ([#325](https://github.com/sethbacon/azure-pipelines-packer/issues/325)) ([1e9dd45](https://github.com/sethbacon/azure-pipelines-packer/commit/1e9dd458384508e342f25462f16daf4881be2d43))

## [1.3.4](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.3.3...v1.3.4) (2026-08-24)


### Bug Fixes

* **gates:** adopt the cross-file resolution the sibling gate already has ([#320](https://github.com/sethbacon/azure-pipelines-packer/issues/320)) ([58513d9](https://github.com/sethbacon/azure-pipelines-packer/commit/58513d92fc2897cd1abd185cf30712ec740d9841)), closes [#317](https://github.com/sethbacon/azure-pipelines-packer/issues/317)
* **gates:** report how many source files were read, not just what was found ([#315](https://github.com/sethbacon/azure-pipelines-packer/issues/315)) ([bb070d6](https://github.com/sethbacon/azure-pipelines-packer/commit/bb070d655b13b8df85d270b1d48414321167c42b))


### Documentation

* mark the federated-credential subject as this repo's, not a template ([#313](https://github.com/sethbacon/azure-pipelines-packer/issues/313)) ([c5dd7b2](https://github.com/sethbacon/azure-pipelines-packer/commit/c5dd7b2a2507d6f1bf81c9be967a4666fd1baf70))

## [1.3.3](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.3.2...v1.3.3) (2026-08-24)


### Bug Fixes

* **ci:** stop gating the required CodeQL check on repository visibility ([#311](https://github.com/sethbacon/azure-pipelines-packer/issues/311)) ([6a0e5cb](https://github.com/sethbacon/azure-pipelines-packer/commit/6a0e5cb0232820e7a684aa080cb9865f7d14119e))


### Refactor

* extract remaining [#46](https://github.com/sethbacon/azure-pipelines-packer/issues/46) shared modules to published packages ([#310](https://github.com/sethbacon/azure-pipelines-packer/issues/310)) ([e646dd2](https://github.com/sethbacon/azure-pipelines-packer/commit/e646dd21ddddaece55eeded4b0b48f8310679197))

## [1.3.2](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.3.1...v1.3.2) (2026-08-23)


### ⚠ BREAKING CHANGES

* ` spelling

### chore

* direct the next release to 1.3.2 ([#288](https://github.com/sethbacon/azure-pipelines-packer/issues/288)) ([1d672d5](https://github.com/sethbacon/azure-pipelines-packer/commit/1d672d5cfce3a3f8706e4df5faf24365af177f0a))


### ci

* count breaking-change declarations across the commits being squashed ([#282](https://github.com/sethbacon/azure-pipelines-packer/issues/282)) ([4fee12a](https://github.com/sethbacon/azure-pipelines-packer/commit/4fee12a70334b523e5574c1539f11233f15fd557))


### Features

* **ci:** compose the .vsix from an allowlist that refuses what it does not recognise ([#295](https://github.com/sethbacon/azure-pipelines-packer/issues/295)) ([b348fb8](https://github.com/sethbacon/azure-pipelines-packer/commit/b348fb89b7917fc991b30071386896d3677265e0))
* **ci:** one documented-claims gate, with each section conditional on its inputs ([#305](https://github.com/sethbacon/azure-pipelines-packer/issues/305)) ([bc3df4b](https://github.com/sethbacon/azure-pipelines-packer/commit/bc3df4b716a31f0d2442ae5fac17c060841bed90))
* **ci:** one version gate for all three extensions, with the checks each was missing ([#296](https://github.com/sethbacon/azure-pipelines-packer/issues/296)) ([753f355](https://github.com/sethbacon/azure-pipelines-packer/commit/753f3557af76964709ed59d80c5513eee922d3e9))
* **ci:** take the shared workflow-security definition, and scan the whole repository ([#302](https://github.com/sethbacon/azure-pipelines-packer/issues/302)) ([13bbfc8](https://github.com/sethbacon/azure-pipelines-packer/commit/13bbfc8051634c020543f73284f6a9b7d5d46c4a))


### Bug Fixes

* check-minor-bumps.js now catches production dependency changes ([#307](https://github.com/sethbacon/azure-pipelines-packer/issues/307)) ([291ae96](https://github.com/sethbacon/azure-pipelines-packer/commit/291ae96e8f4333fb41be6949538e9039b295122e))
* **ci:** refuse to run signature-replay when Dependabot edited the workflow ([#275](https://github.com/sethbacon/azure-pipelines-packer/issues/275)) ([f1a4eab](https://github.com/sethbacon/azure-pipelines-packer/commit/f1a4eab451d5750da6df1f887f0cd11abaed4c6d))
* **ci:** reject a provenance marker declared twice, and correct one that was ([#301](https://github.com/sethbacon/azure-pipelines-packer/issues/301)) ([2cae81b](https://github.com/sethbacon/azure-pipelines-packer/commit/2cae81b701f828e5bdd0332adfd6f7a109548983))
* **ci:** see the discard-without-a-record class this gate could not report ([#293](https://github.com/sethbacon/azure-pipelines-packer/issues/293)) ([7a14772](https://github.com/sethbacon/azure-pipelines-packer/commit/7a147727a9d091329cbdf203fc7fb5e27949549d))
* **ci:** stop a self-test filename counting as an unguarded publish ([#291](https://github.com/sethbacon/azure-pipelines-packer/issues/291)) ([c5a9033](https://github.com/sethbacon/azure-pipelines-packer/commit/c5a9033d0c98c96eec0dab4e621a258ae227db88))
* **ci:** take the gate copies azure-pipelines-terraform and release-docs agree on ([#292](https://github.com/sethbacon/azure-pipelines-packer/issues/292)) ([5867ea4](https://github.com/sethbacon/azure-pipelines-packer/commit/5867ea4e4fd497a32e02c7cb59c5e87e07d2526c))
* **release:** a slow validation is not a failed publish ([#277](https://github.com/sethbacon/azure-pipelines-packer/issues/277)) ([89e865b](https://github.com/sethbacon/azure-pipelines-packer/commit/89e865b0b3837d44ad82f9a882a3fdbcf26dffe2))


### Dependencies

* move PackerInstaller to pipeline-task-ado 0.4.1 with core 0.6.0 ([#278](https://github.com/sethbacon/azure-pipelines-packer/issues/278)) ([5b35145](https://github.com/sethbacon/azure-pipelines-packer/commit/5b35145aed30a6eb508d6f142587ebe1018423c3)), closes [#273](https://github.com/sethbacon/azure-pipelines-packer/issues/273)


### Documentation

* **security:** record the shared-workflow trust relationship, and fix what it invalidated ([#287](https://github.com/sethbacon/azure-pipelines-packer/issues/287)) ([3ee1d58](https://github.com/sethbacon/azure-pipelines-packer/commit/3ee1d5863a7408592bf91c0892968065df22d4a5))


### Refactor

* **ci:** make the publish script one file again, not three headers ([#298](https://github.com/sethbacon/azure-pipelines-packer/issues/298)) ([7f4b339](https://github.com/sethbacon/azure-pipelines-packer/commit/7f4b339cc4af7e72bd34688771cb5af7ba006a52))
* **ci:** share the shared-module gate's logic, keep its lists local ([#297](https://github.com/sethbacon/azure-pipelines-packer/issues/297)) ([93668a2](https://github.com/sethbacon/azure-pipelines-packer/commit/93668a20ec60cce6db3ba1abbd3a33c7a4b0a1a4))
* **ci:** take release-docs' task-dirs, the one every other gate sits on ([#294](https://github.com/sethbacon/azure-pipelines-packer/issues/294)) ([6699f0d](https://github.com/sethbacon/azure-pipelines-packer/commit/6699f0d53cb8ffc3aa05221b4596c3d5c15cf24a))

## [1.3.1](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.3.0...v1.3.1) (2026-08-16)


### Bug Fixes

* pin pipeline-task-ado 0.3.0 and gate the transitive core version ([#267](https://github.com/sethbacon/azure-pipelines-packer/issues/267)) ([7187d6f](https://github.com/sethbacon/azure-pipelines-packer/commit/7187d6f92a3195f3061d0deedc5612b24afbe0d8))


### Refactor

* consume the ADO HTTP client from pipeline-task-ado ([#265](https://github.com/sethbacon/azure-pipelines-packer/issues/265)) ([a7bb409](https://github.com/sethbacon/azure-pipelines-packer/commit/a7bb409387122e3779638287a034423735050f9e))

## [1.3.0](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.2.10...v1.3.0) (2026-08-14)


### Features

* **ci:** replace the SUITE_READ_TOKEN PAT with a GitHub App ([#243](https://github.com/sethbacon/azure-pipelines-packer/issues/243)) ([2d85f66](https://github.com/sethbacon/azure-pipelines-packer/commit/2d85f6651253d23e97602e613eabf6af7eee8a8f))
* **installer:** consume the shared egress module from pipeline-task-core ([#239](https://github.com/sethbacon/azure-pipelines-packer/issues/239)) ([deb344f](https://github.com/sethbacon/azure-pipelines-packer/commit/deb344fb2255dfb3b9e1546848473a4a882e6538))
* **installer:** consume the shared URL-safety modules from pipeline-task-core ([#242](https://github.com/sethbacon/azure-pipelines-packer/issues/242)) ([a683554](https://github.com/sethbacon/azure-pipelines-packer/commit/a6835545585cc458189a384bed1b2ca5a50f647b))
* **installer:** consume the shared verification modules from pipeline-task-core ([#246](https://github.com/sethbacon/azure-pipelines-packer/issues/246)) ([1db713e](https://github.com/sethbacon/azure-pipelines-packer/commit/1db713ef5db5a4fa64087b8f7cd5eedc1f88b8a3))
* **installer:** consume verifyDetached from pipeline-task-core/gpg ([#247](https://github.com/sethbacon/azure-pipelines-packer/issues/247)) ([b331f62](https://github.com/sethbacon/azure-pipelines-packer/commit/b331f6252e16cf58c37c3b32e4aa4575693e33cb))


### Bug Fixes

* **ci:** follow the suite-ui repo move in the replay checkout ([#240](https://github.com/sethbacon/azure-pipelines-packer/issues/240)) ([ec58101](https://github.com/sethbacon/azure-pipelines-packer/commit/ec5810125ebc4d68de309956fa7c8262817d9971))
* **ci:** spend the replay credential on the one private checkout only ([#244](https://github.com/sethbacon/azure-pipelines-packer/issues/244)) ([56ee107](https://github.com/sethbacon/azure-pipelines-packer/commit/56ee1075c946ff478c20d608093e946fc89cf2c8))


### Dependencies

* bump pipeline-task-core to ^0.5.0 ([#252](https://github.com/sethbacon/azure-pipelines-packer/issues/252)) ([157a0a8](https://github.com/sethbacon/azure-pipelines-packer/commit/157a0a8b6b53e096162cd453bff8eea88f673d4b))


### Refactor

* consume resolveProxy from pipeline-task-core, closing a masking gap ([#250](https://github.com/sethbacon/azure-pipelines-packer/issues/250)) ([d512061](https://github.com/sethbacon/azure-pipelines-packer/commit/d512061a4567e94e6cc50797082e46b9872b73a1))
* **installer:** consume the shared HTTP client from pipeline-task-core ([#248](https://github.com/sethbacon/azure-pipelines-packer/issues/248)) ([b59a9e4](https://github.com/sethbacon/azure-pipelines-packer/commit/b59a9e41994c4d5c7043d0e5360a75f2a641723e))

## [1.2.10](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.2.9...v1.2.10) (2026-08-10)


### Security

* **packer:** declare githubToken a password so it is not stored in cleartext ([#235](https://github.com/sethbacon/azure-pipelines-packer/issues/235)) ([c1f88b6](https://github.com/sethbacon/azure-pipelines-packer/commit/c1f88b6144c1f17ef16d756c7af9c0ea3a9cf662))
* **packer:** dispatch commands through a Map, not a prototype-reachable literal ([#238](https://github.com/sethbacon/azure-pipelines-packer/issues/238)) ([368004e](https://github.com/sethbacon/azure-pipelines-packer/commit/368004ed33f71de80bd93eada4313334704a70d3))
* **packer:** retry the installer's binary download, safely ([#237](https://github.com/sethbacon/azure-pipelines-packer/issues/237)) ([f383a55](https://github.com/sethbacon/azure-pipelines-packer/commit/f383a55748813a6b2219147f719c9d436a44f372))

## [1.2.9](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.2.8...v1.2.9) (2026-08-09)


### Bug Fixes

* publish outputs before failing, and cap the manifest read ([#232](https://github.com/sethbacon/azure-pipelines-packer/issues/232)) ([e432a2c](https://github.com/sethbacon/azure-pipelines-packer/commit/e432a2c5c1a92385107fa0df9a40ea2ec24d8662)), closes [#101](https://github.com/sethbacon/azure-pipelines-packer/issues/101) [#202](https://github.com/sethbacon/azure-pipelines-packer/issues/202) [#203](https://github.com/sethbacon/azure-pipelines-packer/issues/203) [#110](https://github.com/sethbacon/azure-pipelines-packer/issues/110)
* route OIDC through the agent proxy, and make the docs match the code ([#231](https://github.com/sethbacon/azure-pipelines-packer/issues/231)) ([9a14573](https://github.com/sethbacon/azure-pipelines-packer/commit/9a14573199a1c077b6a94d4bed795b3678b6e65c)), closes [#196](https://github.com/sethbacon/azure-pipelines-packer/issues/196) [#190](https://github.com/sethbacon/azure-pipelines-packer/issues/190) [#205](https://github.com/sethbacon/azure-pipelines-packer/issues/205) [#206](https://github.com/sethbacon/azure-pipelines-packer/issues/206) [#207](https://github.com/sethbacon/azure-pipelines-packer/issues/207)


### Security

* authorize egress by resolved address, on every hop ([#226](https://github.com/sethbacon/azure-pipelines-packer/issues/226)) ([605e085](https://github.com/sethbacon/azure-pipelines-packer/commit/605e085f6e16e5a83059f55cd711e82021d82a46)), closes [#161](https://github.com/sethbacon/azure-pipelines-packer/issues/161) [#188](https://github.com/sethbacon/azure-pipelines-packer/issues/188) [#191](https://github.com/sethbacon/azure-pipelines-packer/issues/191) [#200](https://github.com/sethbacon/azure-pipelines-packer/issues/200) [#201](https://github.com/sethbacon/azure-pipelines-packer/issues/201)
* bound wildcard host pins to exactly one label ([#229](https://github.com/sethbacon/azure-pipelines-packer/issues/229)) ([55d2602](https://github.com/sethbacon/azure-pipelines-packer/commit/55d2602aa91e293101a139f2ed205f3d96fa5c33))
* discard unverified artifacts and re-verify the cache ([#233](https://github.com/sethbacon/azure-pipelines-packer/issues/233)) ([8fbff85](https://github.com/sethbacon/azure-pipelines-packer/commit/8fbff85e6abb7ff8117b317dec759f38922c0a40)), closes [#65](https://github.com/sethbacon/azure-pipelines-packer/issues/65) [#136](https://github.com/sethbacon/azure-pipelines-packer/issues/136) [#204](https://github.com/sethbacon/azure-pipelines-packer/issues/204) [#198](https://github.com/sethbacon/azure-pipelines-packer/issues/198) [#78](https://github.com/sethbacon/azure-pipelines-packer/issues/78)
* fail closed on absent or malformed provider credentials ([#228](https://github.com/sethbacon/azure-pipelines-packer/issues/228)) ([8690a77](https://github.com/sethbacon/azure-pipelines-packer/commit/8690a777462512b69fe41ba1de65a8093d1d05a1)), closes [#97](https://github.com/sethbacon/azure-pipelines-packer/issues/97) [#187](https://github.com/sethbacon/azure-pipelines-packer/issues/187) [#199](https://github.com/sethbacon/azure-pipelines-packer/issues/199) [#194](https://github.com/sethbacon/azure-pipelines-packer/issues/194) [#44](https://github.com/sethbacon/azure-pipelines-packer/issues/44) [#197](https://github.com/sethbacon/azure-pipelines-packer/issues/197)
* register credentials with setSecret before they can be logged ([#225](https://github.com/sethbacon/azure-pipelines-packer/issues/225)) ([18d2f48](https://github.com/sethbacon/azure-pipelines-packer/commit/18d2f484729a2ecaeb646507e738b0946e27ed83)), closes [#185](https://github.com/sethbacon/azure-pipelines-packer/issues/185) [#195](https://github.com/sethbacon/azure-pipelines-packer/issues/195) [#186](https://github.com/sethbacon/azure-pipelines-packer/issues/186) [#193](https://github.com/sethbacon/azure-pipelines-packer/issues/193) [#66](https://github.com/sethbacon/azure-pipelines-packer/issues/66)

## [1.2.8](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.2.7...v1.2.8) (2026-08-09)


### Bug Fixes

* patch transitive js-yaml 3.x to 3.15.1 in both task lockfiles ([#224](https://github.com/sethbacon/azure-pipelines-packer/issues/224)) ([e9d158f](https://github.com/sethbacon/azure-pipelines-packer/commit/e9d158f970c446f6f7795852d2b157202f629e3a))
* raise js-yaml to 4.3.1 in both task lockfiles ([#222](https://github.com/sethbacon/azure-pipelines-packer/issues/222)) ([6015701](https://github.com/sethbacon/azure-pipelines-packer/commit/60157010f563c962b19b4961f2017d84a261e5b7))

## [1.2.7](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.2.6...v1.2.7) (2026-08-06)


### Bug Fixes

* remediate brace-expansion HIGH and suppress unfixable uuid OSV residual ([#183](https://github.com/sethbacon/azure-pipelines-packer/issues/183)) ([68365cd](https://github.com/sethbacon/azure-pipelines-packer/commit/68365cdc07354442e3a34b0260a78d18ef93d58a))

## [1.2.6](https://github.com/sethbacon/azure-pipelines-packer/compare/v1.2.5...v1.2.6) (2026-07-25)


### Bug Fixes

* **installer:** block SSRF through mirror downloads ([#176](https://github.com/sethbacon/azure-pipelines-packer/issues/176)) ([a5b9d4b](https://github.com/sethbacon/azure-pipelines-packer/commit/a5b9d4b2b845071629eab564c249ba80346596af))
* remediate production dependency vulnerabilities ([#173](https://github.com/sethbacon/azure-pipelines-packer/issues/173)) ([89faff8](https://github.com/sethbacon/azure-pipelines-packer/commit/89faff8522e25d054e1ff9fb46e1219d33e95248))
* remediate remaining dependency alerts ([#178](https://github.com/sethbacon/azure-pipelines-packer/issues/178)) ([2f7f50a](https://github.com/sethbacon/azure-pipelines-packer/commit/2f7f50a7635b76093ab350b6a1331f0f93870567))

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
