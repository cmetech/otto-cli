verdict: manual-port

# 0af8f0d — fix: project root artifacts into worktrees

## Target file(s)
- src/resources/extensions/workflow/worktree-state-projection.ts (exists; upstream `gsd/worktree-state-projection.ts`)
- src/resources/extensions/workflow/tests/worktree-state-projection.test.ts (exists)

## Divergence
Renamed. Otto-cli has the same module under `workflow/` with the same `ROOT_DIAGNOSTIC_FILES` constant (line 170), the same `_projectRootToWorktreeImpl` (line 190), and the same `safeCopy` / `isSamePath` plumbing. The bug — milestone artifacts are projected into a worktree but the root `PROJECT.md` / `REQUIREMENTS.md` / etc. are not, so worktree-bound auto runs can't read them — applies identically to otto.

## Concrete edits
1. In `src/resources/extensions/workflow/worktree-state-projection.ts`, just below the `ROOT_DIAGNOSTIC_FILES` constant (≈line 180), add the new `ROOT_FORWARD_PROJECTION_FILES` array verbatim from upstream:
   ```ts
   const ROOT_FORWARD_PROJECTION_FILES = [
     "DECISIONS.md", "REQUIREMENTS.md", "PROJECT.md", "KNOWLEDGE.md",
     "OVERRIDES.md", "QUEUE.md", "completed-units.json", "metrics.json", "mcp.json",
   ] as const;
   ```
2. Add the `syncRootProjectionFilesToWorktree(prGsd, wtGsd)` helper verbatim from upstream (uses `mkdirSync`, `existsSync`, `join`, `safeCopy` — all already imported in the otto file).
3. Inside `_projectRootToWorktreeImpl`, immediately after the `if (isSamePath(prGsd, wtGsd)) return;` guard, insert the call:
   ```ts
   syncRootProjectionFilesToWorktree(prGsd, wtGsd);
   ```
   Place it before the existing milestone-directory copy.
4. In `src/resources/extensions/workflow/tests/worktree-state-projection.test.ts`, port the new test `projectRootToWorktree forwards root PROJECT.md into isolated worktrees`. Expand the `node:fs` import to add `existsSync`, `readFileSync`, `writeFileSync`. Verify the helper signatures (`makeProjectRoot`, `createWorkspace`, `scopeMilestone`) used by the upstream test exist in otto's test file; if names differ, adapt.

## Verdict
Manual-port. `git am -3` will fail because of the `gsd/` → `workflow/` path rename, but the additions are self-contained and additive — no existing otto behavior changes. The fix is genuinely needed for worktree-isolated workflow runs to read project-level state.
