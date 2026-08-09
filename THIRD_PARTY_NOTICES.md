# Third-Party Notices

This project incorporates the following third-party open-source software as
runtime dependencies bundled into the packaged `.vsix` (see
`scripts/copy-build.js`, which copies each task's pruned production
`node_modules` into the release build).

---

## openpgp (OpenPGP.js)

**Repository:** https://github.com/openpgpjs/openpgpjs
**Used by:** `Tasks/PackerInstaller/PackerInstallerV1` (GPG signature verification of HashiCorp release checksums)
**License:** GNU Lesser General Public License v3.0 or later (LGPL-3.0+)

OpenPGP.js is used unmodified as a library dependency (no source changes). The
full LGPL-3.0 license text is available at
https://www.gnu.org/licenses/lgpl-3.0.txt and is also included verbatim in
`node_modules/openpgp/LICENSE` in the packaged extension. Per the LGPL, you
may obtain, inspect, and relink against a modified version of this library;
its corresponding source is published at the repository above.

---

## azure-pipelines-task-lib, azure-pipelines-tool-lib, azure-pipelines-tasks-securefiles-common

**Repository:** https://github.com/microsoft/azure-pipelines-task-lib
**Used by:** both tasks (`azure-pipelines-task-lib`), `PackerInstallerV1` (`azure-pipelines-tool-lib`), `PackerTaskV1` (`azure-pipelines-tasks-securefiles-common`)
**License:** MIT

```txt
The MIT License (MIT)

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## undici

**Repository:** https://github.com/nodejs/undici
**Used by:** `Tasks/PackerInstaller/PackerInstallerV1` (proxy-aware HTTP client), `Tasks/PackerTask/PackerTaskV1` (proxy-aware OIDC token request, `src/proxy-config.ts`)
**License:** MIT

```txt
MIT License

Copyright (c) Matteo Collina and Undici contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Architecture influences (no code copied)

This extension's task/handler architecture was modelled on its sibling
`azure-pipelines-terraform` extension (same publisher, same author), which in
turn credits the following projects for architectural patterns it studied.
Neither pattern applies to this Packer extension directly — it has no plan
tab, build attachment, or webpack-bundled extension UI — but they are
recorded here for provenance since the base handler dispatch architecture
(`ParentCommandHandler` → provider handler → command implementations)
originated from that lineage:

- [jason-johnson/azure-pipelines-tasks-terraform](https://github.com/jason-johnson/azure-pipelines-tasks-terraform) (MIT) — service-connection auth handler dispatch pattern.
- [JaydenMaalouf/azure-pipelines-terraform-output](https://github.com/JaydenMaalouf/azure-pipelines-terraform-output) (MIT) — not applicable to this extension (referenced a webpack/tab-UI pattern this repository does not use).
