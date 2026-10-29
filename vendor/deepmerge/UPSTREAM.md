# Maintained local fork

Source: deepmerge 4.3.1, npm dist/cjs.js and index.d.ts, MIT license retained.
See https://github.com/TehShrike/deepmerge/issues/273 and
https://github.com/advisories/GHSA-gcqx-w48m-w2h4 (no patched upstream release).

The code keeps the upstream API. Changes: reject **proto**, constructor and
prototype in BOTH target/source loops before reading values, and define own data
properties instead of invoking setters on the destination.

Consumers resolve this package through the root/Electron direct dependency and
$deepmerge override. The scoped name/version explicitly identifies our fork.
npm audit does not assess vendored code: its zero result is NOT evidence that
this fork is safe. `npm run test:merge-security` exercises the attack cases,
resolution of the fork in Jest and type-checker, and merge/array/custom API
compatibility. Full application tests and builds verify the consumers.

No Jest downgrade, audit exception or suppressed advisory is used. Replace this
fork with an upstream patched release when available; rerun these tests first.

The guards prevent the reported returned-object prototype poisoning; this does
not make arbitrary JavaScript objects safe. Custom merge functions, getters,
proxies and clone:false remain caller-controlled behavior, as upstream.
