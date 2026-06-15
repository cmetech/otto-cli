verdict: do-not-port

# 62edd1a — fix: suppress missing origin repo identity warning

## Target file(s)
- src/resources/extensions/workflow/repo-identity.ts
- src/resources/extensions/workflow/tests/project-relocation-recovery.test.ts

## Divergence
Already addressed differently — and arguably better. Upstream's `getRemoteUrl` (pre-fix) was emitting `console.warn("[GSD] repo-identity: failed to resolve remote.origin.url for ${basePath}:", error)` on every catch, including for the common local-only repo case where `git config --get remote.origin.url` exits 1. The fix adds a status-code check to distinguish "no origin configured" (suppress warning, return `""`) from genuine git failures (still warn, return `null`). Otto's `getRemoteUrl` at line 190–201 has a different signature: it returns `string` (never `null`), uses a bare `catch {}` with no logging at all, and returns `""` for any failure mode. Effectively otto already suppresses every warning that upstream's fix is trying to suppress — but otto also suppresses genuine git failures, which the upstream fix preserves.

## Concrete edits
None — though see verdict for a discretionary improvement.

## Verdict
Do-not-port (as a bug fix). The user-visible bug (noisy warnings for local-only repos) does not exist in otto. However, otto's blanket-suppress approach has the inverse drawback: legitimate git failures (PATH issues, repo corruption) are silenced. Optional follow-up worth filing separately: distinguish exit-status-1 from other errors in otto's `getRemoteUrl` to surface diagnostics for the unusual case while staying quiet for the common case. The regression test from upstream is testing for the absence of a warning that otto never emits — porting it as-is would be redundant.
