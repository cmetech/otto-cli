verdict: manual-port

# 5a0af0a — fix: detect stale worktree roadmaps in projection

## Target file(s)
- src/resources/extensions/workflow/markdown-renderer.ts
- src/resources/extensions/workflow/tests/markdown-renderer.test.ts

## Divergence
Same bug, different helper names. Upstream introduces `resolveRoadmapProjectionPath(basePath, milestoneId)` to consistently look up the projection (worktree-scoped) roadmap path, replacing two call sites that previously used either inline projection logic (in `renderRoadmapFromDb`) or the project-mirror-biased `resolveMilestoneFile` (in `detectStaleRenders`). Otto's `markdown-renderer.ts` has the same shape: line 441 (`renderRoadmapFromDb`) uses `resolveMilestoneFile` then falls back to `join(workflowRoot(basePath), ...)`, and line 764 (`detectStaleRenders`) uses `resolveMilestoneFile` — both will read the project-mirror roadmap inside a worktree instead of the worktree projection, hiding stale-projection bugs. Otto uses `workflowProjectionRoot` where upstream uses `gsdProjectionRoot` — same concept, renamed.

## Concrete edits
1. In `src/resources/extensions/workflow/markdown-renderer.ts`, add a private helper near `loadArtifactContent`:
   ```ts
   function resolveRoadmapProjectionPath(basePath: string, milestoneId: string): string {
     const projectionMilestonesDir = join(workflowProjectionRoot(basePath), "milestones");
     const milestoneDirName = resolveDir(projectionMilestonesDir, milestoneId) ?? milestoneId;
     const milestoneDir = join(projectionMilestonesDir, milestoneDirName);
     const roadmapFileName = resolveFile(milestoneDir, milestoneId, "ROADMAP") ??
       buildMilestoneFileName(milestoneId, "ROADMAP");
     return join(milestoneDir, roadmapFileName);
   }
   ```
2. In `renderRoadmapFromDb` (line ~441), replace the `resolveMilestoneFile(...) ?? join(workflowRoot(...), ...)` expression with `resolveRoadmapProjectionPath(basePath, milestoneId)`.
3. In `detectStaleRenders` (line ~764), replace `resolveMilestoneFile(basePath, milestone.id, "ROADMAP")` with `resolveRoadmapProjectionPath(basePath, milestone.id)`. The `if (roadmapPath && existsSync(roadmapPath))` guard simplifies to `if (existsSync(roadmapPath))`.
4. Remove `resolveMilestoneFile` from the imports if no other call site remains (verify via grep first).
5. Port the new test case `'repairStaleRenders reads worktree roadmap projection'` to `tests/markdown-renderer.test.ts`, substituting `.gsd/` paths with the otto equivalent: `.otto/workflow/` (or whatever path `workflowProjectionRoot` produces). The test asserts that the worktree-scoped roadmap (not the project mirror) is the one detected as stale and the one repaired.

## Verdict
Manual-port. Clear, contained bug with otto-side parity. The rename from `gsdProjectionRoot` → `workflowProjectionRoot` is the only friction; the helper function and the two call-site edits are otherwise a clean cherry-pick. Test path adjustments are mechanical. Recommend porting — stale-projection bugs in worktree mode are user-visible (incorrect roadmap state shown).
