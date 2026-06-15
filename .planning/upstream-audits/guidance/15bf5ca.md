verdict: manual-port

# 15bf5ca — fix(gsd): report effective verdict after gate downgrade

## Target file(s)
- src/resources/extensions/workflow/commands-verdict.ts (exists; matches upstream pre-fix)
- src/resources/extensions/workflow/tests/commands-verdict.test.ts (exists)

## Divergence
Renamed. Otto's `commands-verdict.ts` matches upstream pre-fix exactly: line 217 reads `const prevVerdict = current.verdict ?? "unknown";`, line 219 emits `Milestone ... verdict: ${prevVerdict} -> ${parsed.verdict}`, and line 223 branches on `parsed.verdict === "needs-remediation"`. Same bug applies: when a downstream gate downgrades the verdict (e.g. browser UAT failed), the notify still reports the requested verdict, not the effective one.

## Concrete edits
1. In `src/resources/extensions/workflow/commands-verdict.ts`:
   - Just after `extractSection` (≈line 97-99 area), insert `extractEffectiveVerdict(resultDetails, fallback)` verbatim from upstream (depends on `isValidMilestoneVerdict` — verify it's already imported in otto's file; if not, import it from the same module as upstream).
   - At line 217-219 area, replace the unconditional notify with the upstream `effectiveVerdict !== parsed.verdict ? warning : success` branch. The warning string format: `"Milestone ${milestoneId} verdict requested: ${parsed.verdict}, effective: ${effectiveVerdict} (${existingValidation.source})"`. The success path keeps the existing `-> ${effectiveVerdict}` form.
   - Replace `parsed.verdict === "needs-remediation"` on line 223 with `effectiveVerdict === "needs-remediation"`.
2. In `src/resources/extensions/workflow/tests/commands-verdict.test.ts`:
   - Extend `writeValidation` to accept an optional `verificationClasses` parameter and inject a `## Verification Class Compliance` section when present.
   - Add the new test `handleVerdict reports downgraded effective verdict after validation gates`. Uses helpers `seedMilestone`, `seedSlice`, `openTestDb`, `_getAdapter`, `cleanup`, `invalidateStateCache`, `makeMockCtx` — verify each already exists in otto's test file (they should, as otto inherits this test structure).

## Verdict
Manual-port. `git am -3` will fail only due to the `gsd/` → `workflow/` rename and possibly small adjacent diffs. The fix is small, additive, and the surrounding code matches upstream 1:1.
