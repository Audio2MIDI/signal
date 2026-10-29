# Editor and Electron dependency security

Use Node.js 22.12+ (22.x). Production and user profiles are not touched by these checks.

## Web editor

The first refresh removed cpx and upgraded Zod/webpack tooling. The remaining
8 low findings came from deepmerge 4.3.1 in Jest and the type checker. Upstream
has no patched release for GHSA-gcqx-w48m-w2h4. Rather than downgrade Jest or
suppress the advisory, the root and Electron manifests override deepmerge with
our private, MIT-licensed local fork in vendor/deepmerge.

The fork rejects **proto**, constructor and prototype before reading values
in both merge loops and defines destination data properties explicitly.
See vendor/deepmerge/UPSTREAM.md for provenance, scope and replacement criteria.
`npm run test:merge-security` checks attack cases, consumers' actual module
resolution, and merge API compatibility. The scoped fork is outside the public
npm advisory database: audit=0 does NOT independently certify vendored code.
Do not remove these tests or count an audit exception as a fix.

## Electron

The separate electron lockfile initially reported 41 findings (2 critical).
Electron 31 is replaced with 45.1, Forge 7.4 with 8.0, and compatible transitive
patches are refreshed. Electron's supported-release policy is documented at
https://www.electronjs.org/docs/latest/tutorial/electron-timelines.
The local deepmerge fork also covers Rollup's node resolver.

Electron 45 compatibility fixes: soundfont discovery joins the known directory
instead of removed Dirent.path; packaged startup loads the emitted index.html;
desktop webpack uses relative asset paths, while web retains /editor/ paths.
Main/preload compilation now runs tsc --noEmit before Rollup.

The smoke harness blocks HTTP/S requests and uses temporary userData/sessionData/logs directories before
loading main code. It verifies the actual renderer, preload bridge and soundfont
IPC against synthetic files. It forces packaged mode to avoid a dev server.
On Linux CI only, the test launcher uses SwiftShader software rendering and
disables Chromium sandboxing under Xvfb; the test window disables background
throttling so renderer inspection can run without a desktop session. This
does not alter application runtime configuration. Profiles are left under the
OS temp directory for diagnostics and contain no real user information.

Checks:

```sh
npm ci
npm run test:merge-security
npm audit --audit-level=low
npm run lint
npm run build
npm test -- -- --runInBand
npm ci --prefix electron
npm audit --prefix electron --audit-level=low
npm run build --prefix electron
npm run build:electron
npm run test:smoke --prefix electron
```

Also audit/install the separate generate-appx-manifest and generate-ico projects.
Their lockfiles were already clean. The final npm results are zero for all four
trees, including --omit=dev for web and Electron. Audit results are dated evidence,
not a guarantee about future advisories, Chromium internals or the local fork.

Local testing covers macOS arm64 and an unsigned package build. Windows AppX,
Mac App Store, signed/notarized installers, browser login and real MIDI file
open/save flows are not certified by this change. Re-test those before releasing
a desktop distribution. Nothing is published, signed, deployed or auto-updated.
