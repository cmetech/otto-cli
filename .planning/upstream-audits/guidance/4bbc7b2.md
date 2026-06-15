verdict: manual-port

# 4bbc7b2 — fix: external worktree state routing and tool argument normalization

## Target file(s)
- packages/pi-ai/src/utils/normalize-tool-arguments.ts (NEW)
- packages/pi-ai/src/utils/tests/normalize-tool-arguments.test.ts (NEW)
- packages/pi-ai/src/utils/validation.ts
- src/resources/extensions/workflow/repo-identity.ts
- src/resources/extensions/workflow/worktree-root.ts
- src/resources/extensions/workflow/worktree-manager.ts
- src/resources/extensions/workflow/paths.ts
- src/resources/extensions/workflow/workflow-projections.ts
- src/resources/extensions/workflow/prompts/gate-evaluate.md
- src/resources/extensions/workflow/tests/repo-identity-external-worktree.test.ts (NEW)
- src/resources/extensions/workflow/tests/worktree-manager.test.ts
- scripts/copy-resources.cjs

## Divergence
Two largely independent fixes bundled in one commit. (a) The pi-ai normalize-tool-arguments piece is a clean clip-and-paste — `packages/pi-ai/src/utils/validation.ts` exists at the same path in otto-cli and currently has no re-export wiring for normalize-tool-arguments (otto's validation.ts is leaner than upstream's). (b) The worktree/external-state piece touches files that exist under otto's `src/resources/extensions/workflow/` (rebranded from upstream `gsd/`). Otto already has parallel `repo-identity.ts`, `worktree-root.ts`, `worktree-manager.ts`, `paths.ts`, plus a `workflow-projections.ts` analogue — but the rebrand from `.gsd/` to `.otto/workflow/` plus the rename of `gsd-home.ts` to (likely) `otto-home.ts` / `paths.ts` means the symbol names referenced by the patch (`isGsdWorktreePath`, `resolveExternalStateProjectGsdFromWorktreePath`, `resolveExternalStateProjectIdentityFromWorktreePath`) need to be reimplemented against otto's path conventions, not pasted verbatim. The `gate-evaluate.md` prompt and `copy-resources.cjs` script have direct parallels.

## Concrete edits
1. Port `packages/pi-ai/src/utils/normalize-tool-arguments.ts` and its test file as-is from upstream (zero divergence in pi-ai utils layout).
2. In `packages/pi-ai/src/utils/validation.ts`, wire `normalizeToolArguments` into the AJV validation path exactly as upstream does (call before validation; the +2 line delta).
3. In `src/resources/extensions/workflow/worktree-root.ts`, add otto-flavored helpers `isOttoWorktreePath`, `resolveExternalStateProjectOttoFromWorktreePath`, `resolveExternalStateProjectIdentityFromWorktreePath` — replicate the upstream logic but match against the `.otto/workflow/projects/<hash>/worktrees/<MID>/` layout otto already uses (confirmed in `paths.ts` regex).
4. In `src/resources/extensions/workflow/repo-identity.ts`, mirror the two upstream guards in `resolveExternalPathWithRecovery` and `ensureGsdSymlinkCore` (rename to `ensureOttoWorkflowSymlinkCore` if otto uses that name) — route external-state worktrees to the parent project store and skip the `.otto-id` marker write inside them. Skip the `writeRepoMeta` refresh when running under an external-state worktree.
5. Port the worktree-manager orphan-`.git`-folder recovery: when a stale worktree directory has only an orphan `.git/` (no `gitdir:` file), `rmSync` it before attempting `git worktree add`.
6. Update `prompts/gate-evaluate.md` with the new instructions block (apply diff verbatim — prompts are text-only).
7. Apply `scripts/copy-resources.cjs` glob-pattern adjustments verbatim — that script exists in otto with very similar shape.
8. Port the two new tests (`repo-identity-external-worktree.test.ts` and the `worktree-manager.test.ts` delta) to otto's `src/resources/extensions/workflow/tests/`, renaming any `gsdHome()`/`.gsd` references.
9. Skip the upstream-only `tests/live/` additions — otto has no parallel live-credentials harness here.

## Verdict
Manual-port. The pi-ai half is essentially a cherry-pick; the workflow-extension half requires symbol rename and path-layout rewiring but the underlying bugs (split-brain identity for external-state worktrees, orphan-`.git` recovery, AJV-rejecting un-normalized tool args) all apply directly to otto. Recommend porting as two separate commits/PRs: pi-ai utility first (low risk, drops in clean), then workflow-extension worktree routing (needs careful symbol mapping plus the new test).
