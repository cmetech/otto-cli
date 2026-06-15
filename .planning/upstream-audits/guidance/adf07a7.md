verdict: do-not-port

# adf07a7 — fix(gsd): preserve crash exit cleanup semantics

## Target file(s)
- src/resources/extensions/workflow/bootstrap/register-extension.ts

## Divergence
Otto's `register-extension.ts` is ALREADY in the post-patch state. The upstream patch removes the `exitViaCleanupPath` helper (which tried `process.kill(process.pid, "SIGTERM")` then fell back to `process.exit`) and replaces the two call sites in `_gsdEpipeGuard` and `_gsdRejectionGuard` with plain `process.exit(1)`. Otto's file at line 72 and line 82 already calls `process.exit(1)` directly and has no `exitViaCleanupPath` function defined. Otto never had the buggy SIGTERM-based cleanup path.

## Concrete edits
None.

## Verdict
Do-not-port. Otto's register-extension is already where upstream is trying to get to. Verify by grepping `exitViaCleanupPath` in otto (returns no hits) — the patch would no-op or fail to apply.
