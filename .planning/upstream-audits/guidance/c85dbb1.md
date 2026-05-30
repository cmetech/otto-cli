verdict: manual-port

# c85dbb1 — fix(coding-agent): reconcile pinned git update refs

## Target file(s)
packages/pi-coding-agent/src/core/package-manager.ts

## Divergence
Significantly diverged. The upstream update-check flow that this fix touches does not exist in otto-cli:
- Hunk 1 rewrites a `npmCandidates`/`gitCandidates` split inside a `for (const entry of sources)` loop — otto-cli's package-manager.ts has no such candidate-split machinery.
- Hunks 2/3 modify `ensureGitRef` and `getLocalGitUpdateTarget` and switch `rev-parse ref` / `reset --hard ref` to `ref^{commit}` — neither `ensureGitRef` nor `getLocalGitUpdateTarget` exists in otto-cli. otto-cli's git update path is `updateGit(...)` and clone uses `git checkout source.ref` (line ~1235), a different design.
Cannot cherry-pick; none of the three pre-images match.

## Concrete edits
Manual reimplementation against otto-cli's `updateGit`/update flow:
1. Ensure pinned git refs are still reconciled when the configured ref changes (don't skip git sources just because they are pinned; only skip pinned npm versions).
2. When a `source.ref` is set, fetch that ref and reset the clone to it.
3. Use `<ref>^{commit}` (not bare `<ref>`) for `git rev-parse` and `git reset --hard` so annotated tags/refs dereference to a commit.
Locate otto-cli's actual rev-parse/reset/checkout calls (around line 1234+) and apply the `^{commit}` peeling + pinned-git-reconcile semantics there.

## Verdict
manual-port — real correctness fix (pinned git refs not reconciled; tag-ref reset can fail), but the surrounding machinery is structurally different. Port the intent, not the diff; verify carefully against otto-cli's update path.
