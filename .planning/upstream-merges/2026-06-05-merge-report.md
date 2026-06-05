# Upstream-merge run — 2026-06-05

End-to-end dogfood of the upstream-merge skill (third/final stage of the
upstream-port pipeline: cherry-pick → fix → merge).

## Outcome

- **Merged: 1** — PR #74 → main as `c622c39`
- **Blocked: 0**
- **Skipped: 0**

| PR | Title | Issue | mergeSha | Verdict |
|----|-------|-------|----------|---------|
| #74 | fix(upstream): port baf4028 — use the right basedir for patterns | #53 (closed, status:applied) | `c622c39` | both signals green |

## Signals

| PR | GitHub required-checks | Local full gate | Informational reds |
|----|------------------------|-----------------|--------------------|
| #74 | ✓ build, test-unit, test-packages, fast-gates | ✓ 9742/9742 pass + verify:pr clean | docker-e2e, e2e, integration-tests |

The informational reds are not in the allowlist and were red on prior PRs
too — pre-existing infra noise, not regressions from #74.

## Bugs surfaced and fixed during the dogfood

The first CI/local-gate runs hit three real problems unrelated to #74's
one-line patch. Each was fixed and folded into the same PR before the
merge gate flipped green.

1. **`scripts/compile-tests.mjs` — vendor copy missing** (`4be200e`)
   The vendor-xlsx drift-guard tests (added 2026-06-03 in 4f1da5d)
   expected `dist-test/vendor/xlsx-0.20.3.tgz`, but `test:compile` never
   copied `vendor/` into `dist-test/`. Hidden on main pushes because the
   CI workflow skips `test-unit` there; only PRs run it. Fix: one
   `copyAssets` call.
2. **`.claude/skills/upstream-merge/config.json` — conditional checks treated as required** (`3064c3f`)
   `cargo audit` and `npm audit (.)` only run on PRs touching
   `package-lock.json` or `native/Cargo.lock` (security-audit.yml).
   PRs that don't (like #74) hit `evaluate-checks` reporting "required
   check missing" as a false-positive block. Fix: split the allowlist
   into `requiredChecks` (must run + pass) and `conditionalChecks`
   (must pass IF present; absence does not block). New unit tests cover
   the split-shape semantics.
3. **`scripts/install.js` — symlinked rg in managed bin** (`e73b8bd`)
   `copyBundledTools` followed pre-existing symlinks in
   `<OTTO_HOME>/agent/bin/` (e.g. `rg → /opt/homebrew/bin/rg` on the
   maintainer's machine) and EACCES'd writing through to the
   system-owned target. Fix: `lstatSync` + `unlinkSync` the dst when
   it's a symlink before `copyFileSync`. New regression test pre-creates
   a symlinked `rg` pointing at a system path and asserts clean exit.

## Commits landed on main via the squash

The squash bundle (`c622c39`) collapses four commits:
- `8458839` — fix(coding-agent): use the right basedir for patterns (the actual #53 port)
- `4be200e` — fix(test:compile): copy vendor/ into dist-test/
- `3064c3f` — fix(upstream-merge): split required vs path-conditional CI checks
- `e73b8bd` — fix(postinstall): unlink symlinked rg/fd in managed bin before copy

## Process notes — skill dogfood observations

- **Two-signal gate held up.** Both findings #1 and #3 would have shipped
  silently without a local full-suite run. The skill's insistence on
  both CI and local-gate green is doing real work, even when it looks
  redundant.
- **Conditional-checks gap was real.** The skill would have blocked any
  PR not touching lock files; finding #2 changes the allowlist shape
  permanently. Worth backporting to the design spec.
- **Ledger API has a destructure footgun.** `recordVerdict` and
  `recordMerge` take options objects, not positional args. First call
  silently no-op'd most fields; corrected in a follow-up call. Consider
  adding `assert(typeof opts === 'object')` to fail loud.
- **Local-gate setup is heavier than a one-liner.** The current SKILL.md
  says `npm ci` in the trial-merge worktree and run the gate. In
  practice we needed `npm ci` + `npm run build:core` (workspace package
  dist outputs) before the gate would resolve `@otto/*` imports.
  Probably worth documenting in the SKILL or wrapping in a helper.

## Cleanup

- `.worktrees/upstream-merge-pr-74` — to be removed in Phase D worktree
  hygiene.
- `.worktrees/upstream-fix-lane-1` — leftover from the upstream-fix run
  that produced #74; also to be removed.
- Local branches `fix/upstream-lane-1` and
  `integration/upstream-fix-2026-06-05` are now redundant (upstream
  branches were auto-deleted on merge).
