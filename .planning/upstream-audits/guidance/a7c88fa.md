verdict: do-not-port

# a7c88fa — fix(test): unblock coverage-report package test failures

## Target file(s)
- packages/mcp-server/src/readers/graph.test.ts
- packages/pi-ai/src/utils/tests/agent-shim.test.ts (does not exist in otto)
- packages/pi-ai/src/utils/tests/mcp-tool-name.test.ts (does not exist)
- packages/pi-ai/src/utils/tests/tool-search-shim.test.ts (does not exist)
- packages/pi-ai/vitest.config.ts (does not exist)
- scripts/run-package-tests.cjs

## Divergence
Two distinct problems addressed upstream:

1. `graph.test.ts` isolation: otto has `packages/mcp-server/src/readers/graph.test.ts` and could benefit from the `_resetReaderCaches()` + project-local `.gsd/graphs/` setup. However the patch references `from './paths.js'` exporting `_resetReaderCaches` — otto's `packages/mcp-server/src/readers/paths.ts` may or may not expose that symbol. Marginal value alone.

2. Vitest → node:test conversion for `agent-shim.test.ts`, `mcp-tool-name.test.ts`, `tool-search-shim.test.ts`: otto has NONE of these files. Otto's `packages/pi-ai/src/utils/` has `repair-tool-json.ts`, `validation.ts`, `event-stream.ts`, etc., but no shim tests. The corresponding `run-package-tests.cjs` simplification (drop the vitest branch for `@gsd/pi-ai`) does not apply because otto's `run-package-tests.cjs` already does not special-case pi-ai for vitest.

## Concrete edits
None — neither change has a meaningful otto target.

## Verdict
Do-not-port. The shim-test conversion has no target files in otto, and the `graph.test.ts` isolation hunk on its own is too marginal to port standalone without confirming the cache-reset hook exists. Re-evaluate if otto later adopts a coverage-report-style runner that exposes the same tmpdir-inside-workspace failure mode.
