# Editor dependency security

Use Node.js 22 for the npm workspace. The 2026-10-29 refresh removed cpx and
its legacy watcher/glob tree, refreshed compatible transitive dependencies,
and upgraded Zod, copy-webpack-plugin, webpack-dev-server and React Refresh.
Build copying uses Node fs.cpSync instead of shell glob expansion.

Validation: clean npm ci, production build, clipboard compatibility tests,
editor regression tests and loopback webpack-dev-server startup.

Run `npm audit --audit-level=moderate` for the complete web workspace and
`npm audit --omit=dev` for runtime dependencies. CI rejects moderate or higher.
The initial result was 58 findings, including 4 critical; the updated lockfile
reports 8 low findings, all propagated from deepmerge in Jest/type-check tooling,
and zero runtime findings. See https://github.com/advisories/GHSA-gcqx-w48m-w2h4.
Do not apply the suggested Jest 25 downgrade or an untested deepmerge override.

The nested Electron packaging project has its own manifest and is outside the
web workspace audit. These results do not certify the desktop distribution.
No node_modules, test runner or dev server are deployed with the static editor.
