verdict: do-not-port

# cbb3b69 — fix(bug-1): Linux x64 native addon is unavailable after npm install

## Target file(s)
- native/scripts/sync-platform-versions.cjs (already has equivalent behavior)
- package.json (already pins engine optional deps to package version)
- .github/workflows/npm-publish.yml

## Divergence
Upstream pinned root `optionalDependencies` for the per-platform engine packages to the exact package version (instead of a `>=` range) and made the sync script write them on every run. Otto-cli already does both: `native/scripts/sync-platform-versions.cjs` lines 47–53 build `dependencyName = '@cmetech/otto-engine-${platform}'` and assign it on the root pkg, and `package.json` already lists `@cmetech/otto-engine-*: "1.3.2"` (exact, matching root version) under `optionalDependencies`. The `npm-publish.yml` flag removal (`--any-version`) is gsd-pi-specific — otto's workflow doesn't pass that flag.

## Concrete edits
1. None — the fix is already in place under otto's naming (`@cmetech/otto-engine-*` instead of `@opengsd/engine-*`).

## Verdict
Skip — already ported in spirit. The bug class (range-pinned optional engine deps falling back to stale platform binaries) was solved in otto-cli during initial brand fork. If a future regression appears, re-audit `sync-platform-versions.cjs` and `package.json`, but right now there is no work to do.
