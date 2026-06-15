verdict: manual-port

# 77e8cee — fix(bug-2): Unhandled-phase warnings pause instead of retrying fresh state

## Target file(s)
- src/resources/extensions/workflow/auto/phases.ts

## Divergence
Otto's `auto/phases.ts` already imports and uses `deps.invalidateAllCaches()` extensively (lines 836, 937, 1131, 1295, 1479, 1636, 1644, 1647), and the file mirrors upstream `auto/phases.ts`. We did not grep `isUnhandledPhaseWarning` in otto's copy, so the upstream-only one-retry-on-stale-phase-warning helper is absent. The bug — `runDispatch` receives a stop-warning of `Unhandled phase "..."` based on a *cached* state snapshot, then pauses without ever re-deriving state — applies to otto identically because otto's dispatch resolution goes through the same `deps.resolveDispatch(...)` interface.

## Concrete edits
1. In `src/resources/extensions/workflow/auto/phases.ts`, add `import type { DispatchAction } from "../auto-dispatch.js";` near the other type imports.
2. Add the `isUnhandledPhaseWarning(dispatchResult: DispatchAction)` helper above `runDispatch` (verbatim from upstream).
3. In `runDispatch`, change `const dispatchResult = await deps.resolveDispatch({...});` to `let dispatchResult = await deps.resolveDispatch({...});`.
4. Immediately after that call, if `isUnhandledPhaseWarning(dispatchResult)`: `deps.invalidateAllCaches()`, `const freshState = await deps.deriveState(s.canonicalProjectRoot)`, compute fresh `mid`/`midTitle`, debug-log a `dispatch-unhandled-phase-retry` phase, and re-call `deps.resolveDispatch` with the fresh state.
5. Sanity-check: otto's `DispatchAction.action === "stop"` variants include `level`, `matchedRule`, and `reason` fields. If otto's type names diverge, adapt the type guard predicate accordingly.

## Verdict
manual-port — the dispatch loop and dependency injection in otto match upstream closely. Patch is ~28 lines of code in a single file. Small adapter risk around `DispatchAction` type guard; otherwise straightforward.
