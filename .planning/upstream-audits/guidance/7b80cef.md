verdict: do-not-port

# 7b80cef — fix: drop noisy codeql path hardening

## Target file(s)
- packages/pi-tui/test/markdown.test.ts (only otto-applicable part)
- src/web/bridge-service.ts (does not exist in otto)

## Divergence
The bulk of the diff (90+ lines) lives in `src/web/bridge-service.ts`, but otto has no `src/web/` directory and no web bridge service — that subsystem is upstream-only. The only otto-relevant file is `packages/pi-tui/test/markdown.test.ts`, where the patch is a 1-line cosmetic noise reduction reverting prior codeql hardening. Without the bridge-service context the markdown nit is not worth a cherry-pick alone.

## Concrete edits
1. None — skip.

## Verdict
Primary target (`src/web/bridge-service.ts`) does not exist in otto, and the residual 1-line markdown test cleanup is too small to justify a port. Skip.
