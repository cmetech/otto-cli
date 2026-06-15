verdict: do-not-port

# 37af7ad — fix(ci): repair dist-test node_modules for coverage

## Target file(s)
- (none in otto-cli)

## Divergence
Modifies `scripts/compile-tests.mjs` (adds dist-test node_modules repair for coverage runs) and adds `scripts/__tests__/compile-tests-cache.test.mjs`. Otto-cli has `scripts/compile-tests.mjs` but its structure has diverged — the file does not contain the dist-test repair surface the upstream patch hooks into. The coverage CI path in otto-cli is also different (separate native build matrix, different artifact unpack flow).

## Concrete edits
1. Inspect `scripts/compile-tests.mjs` in otto-cli to confirm; if its layout has fundamentally diverged from gsd-pi's (likely — otto has its own native-build pipeline), do not port.
2. If a future otto-cli coverage run reports missing dist-test node_modules, reconsider this commit as a reference for the repair recipe.

## Verdict
CI plumbing tied to upstream's coverage pipeline. Otto-cli's compile-tests and coverage flow have diverged; porting in isolation would land orphan code.
