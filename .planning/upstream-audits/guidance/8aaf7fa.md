verdict: cherry-pick

# 8aaf7fa — fix(gsd): sync marker after state recovery

## Target file(s)
- src/resources/extensions/workflow/repo-identity.ts
- src/resources/extensions/workflow/tests/project-relocation-recovery.test.ts

## Divergence
Direct follow-up to 83f54b1 (same files). Otto has both at the renamed `workflow/` path. The fix is a 1-line addition in `repo-identity.ts` plus a 35-line test extension that ensures the identity marker is re-synced after state recovery. Marker constants may need otto-vs-gsd renaming, same as 83f54b1.

## Concrete edits
1. Apply the 1-line addition to `src/resources/extensions/workflow/repo-identity.ts` (likely a marker-write call after recovery).
2. Append the new test cases to `src/resources/extensions/workflow/tests/project-relocation-recovery.test.ts`, renaming `gsd` references to otto where appropriate.
3. Must land AFTER 83f54b1 (the file precondition this patch builds on).
4. Run `pnpm test project-relocation-recovery` to confirm.

## Verdict
Small follow-up fix on top of 83f54b1; cherry-pick in sequence.
