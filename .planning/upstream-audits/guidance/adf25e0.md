verdict: manual-port

# adf25e0 — fix(ci): pin dev publishes to stable engine packages on npm

## Target file(s)
- native/scripts/sync-platform-versions.cjs
- scripts/lib/version-sync.cjs
- scripts/__tests__/sync-platform-versions.test.mjs
- scripts/__tests__/version-sync.test.mjs
- scripts/verify-native-platform-packages.mjs

## Divergence
Otto has all five files. Otto's `native/scripts/sync-platform-versions.cjs` line 48 builds `@cmetech/otto-engine-${platform}` (vs upstream's `@opengsd/engine-${platform}`), and writes `rootPkg.optionalDependencies[dependencyName] = version` at line 51 — the same buggy "use stamped root version" pattern upstream is fixing. Otto's `scripts/lib/version-sync.cjs` similarly references `optionalDependencies` and uses `version` directly (lines 130, 214, 216) with no `resolveEngineOptionalDependencyVersion` helper.

The bug applies identically to otto: if a `-dev.<sha>` stamp gets written into `optionalDependencies` for `@cmetech/otto-engine-*` packages, those packages will not exist on npm at that exact dev version, and `npm install` will fail.

## Concrete edits
1. In `scripts/lib/version-sync.cjs`, add and export `resolveEngineOptionalDependencyVersion(version)` that strips a `-dev.<sha>` suffix (and only that suffix — keep `-next.N` and other prereleases as-is). Upstream logic: if version matches `/-dev\./`, return the base semver; else return version unchanged.
2. In `native/scripts/sync-platform-versions.cjs`, import the new helper, compute `optionalDependencyVersion = resolveEngineOptionalDependencyVersion(version)`, and write that value into `rootPkg.optionalDependencies[dependencyName]` instead of `version`.
3. Add the console log line `[sync-platform-versions] optionalDependencies pinned to stable engine version …` when the resolved version differs.
4. Update `scripts/verify-native-platform-packages.mjs` so the version assertion reads `pkg.optionalDependencies[name]` directly (not building `${name}@${version}` from the stamped root version). The exact otto code at line 8-14 already iterates optionalDependencies — confirm the assertion logic matches.
5. Port the test additions:
   - `version-sync.test.mjs`: add the new `resolveEngineOptionalDependencyVersion` assertions (verbatim from upstream).
   - `sync-platform-versions.test.mjs`: replace the existing strict-version assertion with the helper-based one.

## Verdict
Manual-port. The bug is real in otto (dev-publish stamps will pin engine packages to versions that don't exist on npm), and the fix structure transfers cleanly once the package name prefix is mapped (`@opengsd/engine-*` → `@cmetech/otto-engine-*`). The patch is otherwise straightforward — small helper + one call-site rewire + two test additions. This is also a publish-blocker risk worth addressing per MEMORY note about the otto release/publish flow asserting version-sync invariants.
