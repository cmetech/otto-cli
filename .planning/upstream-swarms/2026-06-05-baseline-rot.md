# Baseline-rot report — 2026-06-05 (dry-run)

**Verdict:** `pass: false` from `baseline-gate.mjs` against `origin/main @ be2fe71`.
**Skill action:** STOP. No PRs opened (dry-run already implies that). No selection or wave-planning performed.

## Diagnosis

The failure is **not** repo rot on `origin/main`. It is a harness gap in the
baseline-gate flow:

- `.claude/skills/upstream-swarm/scripts/baseline-gate.mjs` creates a fresh
  detached worktree via `git worktree add --detach <workdir> origin/main`.
- It then immediately runs `run-gates.mjs full` (= `npm test` → `npm run verify:pr`)
  in that worktree.
- The fresh worktree has **no `node_modules/`**, so the first step
  (`test:compile` → `scripts/compile-tests.mjs`) blows up trying to
  `require('esbuild')`.

Evidence:

- `ls .worktrees/upstream-swarm-baseline/node_modules` → `No such file or directory`.
- `ls node_modules/esbuild` (repo root) → present.
- Fail-tail (full log: `.planning/upstream-swarms/2026-06-05-baseline-gate.log`):
  ```
  Error: Cannot find module '/.../.worktrees/upstream-swarm-baseline/node_modules/esbuild'
      at scripts/compile-tests.mjs:26:17
  ```

The companion `upstream-fix/scripts/worktree-setup.mjs` doesn't install deps
either, so this same gap exists in lane worktrees — but lane work is gated by
`upstream-fix`'s own setup, which presumably handles this (or also has the bug
and we just haven't tripped it because of how `npm` resolves up the tree under
some commands but not others).

## Options

1. **Patch baseline-gate.mjs** to run `npm ci --prefer-offline --no-audit` (or
   `npm install --no-save`) in the worktree after creation, before running
   the gate. Right fix; ~5 LoC.
2. **Symlink** `node_modules/` from repo root into the worktree as a
   pre-step. Faster than `npm ci` but fragile (binary deps with native
   builds may not be portable across paths even though paths are sibling).
3. Run with `--skip-baseline-gate` (RARE, explicit opt-out per the skill).
   Acceptable only if the operator separately verifies main locally.

## Recommendation

Option 1. The dry-run can't validate Phase A end-to-end until the gate runs
the same way every real swarm run will. Until then, every swarm invocation —
dry or live — will hit the same baseline-red and abort.

## Resume

Per skill spec, "Resuming requires the baseline rot to be addressed." Once
the harness is patched, re-run `/upstream-swarm --dry-run` to confirm
baseline green, then proceed with selection + wave planning.
