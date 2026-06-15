verdict: do-not-port

# eee1c61 — feat(pi): gap closure, test confidence stack, verify:pi-boundary in CI

## Target file(s)
- none

## Divergence
This is a GSD-Pi project-wide initiative: it wires a `verify:pi-boundary` script into `.github/workflows/ci.yml`, adds `docs/dev/test-confidence-stack.md`, adds `scripts/test/*` audit scripts, and restores GSD extension shims (`src/resources/extensions/gsd/shims/{tool-search,save-gate-result,workflow-mcp}.ts`). The "pi-boundary" is a contract GSD-Pi enforces between its pi-* packages and its own `gsd-*`/`src/` layer — otto-cli has the same pi-* packages but uses them differently (otto extensions, not gsd extensions), so the same boundary contract isn't meaningful. The README/LICENSE/CONTRIBUTING/VISION/ADR/PRD/docs edits and jiti workspace alias touches are GSD-Pi project metadata that does not exist in otto.

## Concrete edits
1. None.

## Verdict
Project-level CI/docs/test-tooling feature for GSD-Pi. Not a portable bug fix. otto-cli should design its own boundary-verification stance if/when desired.
