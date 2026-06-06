# Supervised swarm batch — handoff

**Created:** 2026-06-05, end of a long session that landed a stack of
swarm-autonomy fixes (#78, #80, #81, #82) and refreshed the gsd-pi
cherry-pick backlog (287 new issues). The next session picks up here to
run a 10-issue supervised dogfood that exercises the new code paths.

## TL;DR for the next session

Run `/upstream-swarm` against exactly these 10 issues:

- **Auto-tier (6):** #90, #91, #93, #95, #99, #106
- **Human-tier (4):** #285, #326, #343, #345

Use `--max-wave-size 1` to force sequential fix lanes (one per wave). The
prWindow / refute / merge stages still pipeline freely.

## Why we stopped to hand off

The previous session was already context-heavy. A 10-issue swarm run is
expected to take ~3–5 hours wall-clock with many subagent dispatches and
state transitions. Doing it in a fresh context is cheaper, more reliable,
and easier to debug.

## Repo state at handoff

- `main` is at `14cf496` — `audit(upstream): gsd-pi scan 2026-06-05 (287 issues filed)`
- Working tree clean except untracked `.planning/upstream-swarms/` and
  `.planning/upstream-audits/2026-06-05-gsd-pi-{manifest,slice-*}.json`
  (intermediate artifacts; safe to ignore).
- `origin/main == main` — clean for the preflight guard.

## What was just landed (the autonomy stack)

These all merged today; the next session should **trust** these and not
re-implement them inline:

| PR | Commit | What it gives you |
|---|---|---|
| #78 | `786f837` | `baseline-gate.mjs` symlinks repo-root `node_modules`; `run-gates.mjs` runs `verify:pr` before `npm test` (FULL_STEPS); `wave-plan.mjs` accepts the select-issues `{autoTier,humanTier,needsTriage}` shape |
| #80 | `5c304e8` | NEW `preflight-clean-main.mjs` (run first, exits 2 on ahead-of-origin); `worktree-setup.mjs` defaults base to `origin/main` + `git fetch origin` first |
| #81 | `29dbc97` | `refute-panel.buildInputBundle` auto-resolves `upstreamRoot` from the issue's `upstream:<key>` label via `.planning/upstream-sync-config.json` (no more silent empty `git show`); `swarm-ledger`: `quarantined` and `pending-human-review` allow `→ selected` (re-attempt without ledger surgery) |
| #82 | `b2eb1c6` | NEW `poll-pr-checks.mjs` — non-blocking one-shot CI snapshot; SKILL.md `poll-ci` action rewrites to use it. **Never use `gh pr checks --watch`** — it serializes the swarm to one PR |

## The 10 issues for this batch

All filed via `audit(upstream): gsd-pi scan 2026-06-05 (287 issues filed)`,
so all carry `upstream:gsd-pi`, `status:triaged`, and their respective
severity + conflict-risk labels. Each has a guidance file at
`.planning/upstream-audits/guidance/<sha7>.md`.

### Auto-tier — first 6 by issue number (lowest = oldest)

| # | sha | guidance |
|---|---|---|
| 90 | `9171fc3` | `.planning/upstream-audits/guidance/9171fc3.md` |
| 91 | `9a20e26` | `.planning/upstream-audits/guidance/9a20e26.md` |
| 93 | `8aaf7fa` | `.planning/upstream-audits/guidance/8aaf7fa.md` |
| 95 | `83f54b1` | `.planning/upstream-audits/guidance/83f54b1.md` |
| 99 | `2c830cd` | `.planning/upstream-audits/guidance/2c830cd.md` |
| 106 | `c5057c9` | `.planning/upstream-audits/guidance/c5057c9.md` |

### Human-tier — all 4 currently filed

| # | severity | sha | guidance |
|---|---|---|---|
| 285 | feature | `90652ad` | `.planning/upstream-audits/guidance/90652ad.md` |
| 326 | feature | `941b208` | `.planning/upstream-audits/guidance/941b208.md` |
| 343 | critical-stability | `58227e0` | `.planning/upstream-audits/guidance/58227e0.md` |
| 345 | critical-stability | `fc39cdc` | `.planning/upstream-audits/guidance/fc39cdc.md` |

Auto-tier issues go through the full pipeline → auto-merge. Human-tier
issues stop at `pending-human-review` after the fix subagent opens the PR
(no CI poll, no local gate, no refute panel, no merge — per skill spec).

### needsTriage (will be skipped with a comment)

#47, #52 — leftover from the first batch; targetFiles empty. The swarm
should comment "skipped, needs triage" and label `status:needs-human` on
each, without burning a fix lane.

## What this batch exercises (the goal)

Six code paths that have NEVER been live-exercised:

1. **Multi-wave scheduling** — `--max-wave-size 1` forces 1 issue per
   wave for 6 auto-tier issues. The scheduler's fix-lane / prWindow /
   refute-concurrency back-pressure should actually engage.
2. **Real CI poll loop with `poll-pr-checks.mjs`** — non-blocking. The
   orchestrator paces with `ScheduleWakeup ~270s` between checks.
   Multiple PRs in `awaiting-ci` concurrently.
3. **gsd-pi upstream-root auto-resolution** — every issue has
   `upstream:gsd-pi`; the refute panel's `buildInputBundle` must
   correctly resolve `../gsd-pi` (the smoke test in #81 proved this
   works, but no PR has actually been refuted yet under this path).
4. **Human-tier severity routing** — 4 issues with `severity:feature`
   or `severity:critical-stability`. The fix subagent opens the PR,
   the swarm transitions to `pending-human-review`, and STOPS without
   merging.
5. **needsTriage skip + comment** — #47, #52 must get the comment and
   the `status:needs-human` label without a fix lane being dispatched.
6. **Retry path** — if any auto-tier issue hits a real-or-transient CI
   red, `classifyFailure` → `recordRetry` → `retrying → fixing` must
   round-trip correctly. (May not naturally fire; that's OK.)

## Step-by-step plan for the next session

### Phase A (preflight)

```sh
DATE=$(date +%F); DIR=.planning/upstream-swarms

# 1. NEW: clean-main preflight (from PR #80). On exit 2, STOP.
node .claude/skills/upstream-swarm/scripts/preflight-clean-main.mjs

# 2. Baseline gate (now correctly provisions node_modules per #78)
node .claude/skills/upstream-swarm/scripts/baseline-gate.mjs \
  --workdir .worktrees/upstream-swarm-baseline \
  --log $DIR/$DATE-supervised-baseline-gate.log
```

### Phase A (selection — restricted to the 10)

There is no `--issues` flag on `upstream-swarm`. The clean approach is
to call `select-issues.mjs` and then **manually filter** the JSON down
to exactly the 10 issue numbers before passing to `wave-plan.mjs` /
`initSwarmLedger`:

```sh
node .claude/skills/upstream-swarm/scripts/select-issues.mjs \
  --label type:cherry-pick-candidate \
  --out $DIR/$DATE-supervised-full-selected.json

# Then filter:
node -e '
const fs = require("fs");
const KEEP = new Set([90, 91, 93, 95, 99, 106, 285, 326, 343, 345]);
const SKIP_TRIAGE = [47, 52]; // already known; will be commented separately
const data = JSON.parse(fs.readFileSync(".planning/upstream-swarms/" + process.env.DATE + "-supervised-full-selected.json", "utf-8"));
const filter = (arr) => arr.filter((x) => KEEP.has(x.number));
const out = {
  autoTier: filter(data.autoTier),
  humanTier: filter(data.humanTier),
  needsTriage: [], // handle 47/52 separately
};
fs.writeFileSync(".planning/upstream-swarms/" + process.env.DATE + "-supervised-selected.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({autoTier: out.autoTier.length, humanTier: out.humanTier.length}));
' # expects DATE=2026-06-06 (or whatever today is)
```

Then wave-plan and ledger init as usual:

```sh
node .claude/skills/upstream-swarm/scripts/wave-plan.mjs \
  $DIR/$DATE-supervised-selected.json --max-wave-size 1 \
  --out $DIR/$DATE-supervised-waves.json

node -e "import('./.claude/skills/upstream-swarm/scripts/swarm-ledger.mjs').then(m => {
  const fs = require('fs');
  const sel = JSON.parse(fs.readFileSync('$DIR/$DATE-supervised-selected.json', 'utf-8'));
  const all = [...sel.autoTier, ...sel.humanTier];
  m.initSwarmLedger('$DIR/$DATE-supervised-run-state.json', {
    date: '$DATE', filter: 'supervised-10-issue', issues: all
  });
})"
```

### Handling #47, #52 (needsTriage) up-front

Before entering Phase B, comment + label:

```sh
for N in 47 52; do
  gh issue comment $N --repo cmetech/otto-cli --body \
    "Skipped by /upstream-swarm 2026-06-XX supervised batch — targetFiles empty. Needs human triage to fill guidance before re-entry."
  gh issue edit $N --repo cmetech/otto-cli \
    --add-label status:needs-human \
    --remove-label status:triaged
done
```

### Phase B (the actual loop)

This is where the orchestrator runs the scheduler tick → action →
record loop. Key tooling reminders:

- **`poll-ci` action:** call `node .claude/skills/upstream-swarm/scripts/poll-pr-checks.mjs <N>`.
  Pace via `ScheduleWakeup ~270s` when nothing but `awaiting-ci` is
  outstanding. NEVER `gh pr checks --watch`.
- **`run-refute` action:** call `buildInputBundle` with NO custom
  `gitRunner`; the upstream root auto-resolves from labels via #81.
  For the workflow, **inline the bundle into the script body** —
  passing it via `args` does not deserialize cleanly (lesson from
  this session).
- **`start-fix` for human-tier:** the fix subagent opens the PR, then
  the swarm transitions directly `fix-ok → pending-human-review`
  (skip awaiting-ci entirely). Label the issue / PR with
  `status:awaits-review`. Do NOT poll CI or run the refute panel.
- **`start-fix` for auto-tier:** same fix-subagent prompt template
  as PR #77's session (read the issue + guidance, write regression
  test, apply fix, run regression/build/targeted gates, commit, push,
  open PR). The branch name must be
  `fix/upstream-issue-<N>-<sha7>`; the PR title must close the issue.
- **Worktree branch base:** the fix subagent must `git worktree add -b
  fix/upstream-issue-<N>-<sha7> <path> origin/main` (NOT local main).
  PR #80's worktree-setup default handles this when the orchestrator
  calls the script; if the orchestrator inlines its own prompt, it
  must specify `origin/main` explicitly. **Do not repeat the PR #77
  contamination mistake.**

### Phase C (report + cleanup)

```sh
node .claude/skills/upstream-swarm/scripts/write-report.mjs \
  $DIR/$DATE-supervised-run-state.json $DIR/$DATE-supervised-swarm-report.md

# Worktree hygiene — remove every .worktrees/upstream-fix-issue-*
# and .worktrees/upstream-merge-pr-* on terminal state.
```

## Known traps from this session

1. **Workflow `args` doesn't deserialize objects.** When dispatching
   the 4-lens refute panel via Workflow, inline the bundle into the
   script body (`const BUNDLE = {...}`), don't pass it via `args`.
   This burnt two retries before we figured it out.
2. **`gh pr checks --watch` blocks the whole orchestrator.** Use
   `poll-pr-checks.mjs` and `ScheduleWakeup` to pace.
3. **Direct push to `main` requires per-action authorization** under
   the auto-mode classifier even with explicit user approval. For the
   audit commit at the end (`audit(upstream): ...`), the operator may
   need to push manually via `!git push origin main`.
4. **`triage`, `e2e`, `docker-e2e`, `integration-tests`,
   `windows-portability` are NOT in the required-checks allowlist.**
   They're known pre-existing flakes on `main` (see commit `c622c39`
   for the baseline). The `evaluate-checks.mjs` correctly buckets
   them as `informationalReds` — don't treat them as blockers.
5. **For `.claude/`-only diffs (the harness PRs), heavy CI jobs get
   path-filter SKIPPED** but `poll-pr-checks` correctly treats
   `bucket: "skipping"` as OK. Won't bite this batch (no harness
   changes expected) but worth knowing.

## How to confirm the dogfood succeeded

After the run:

1. `gh issue list --repo cmetech/otto-cli --label upstream:gsd-pi --label status:applied` should show ≥ 5–6 of the auto-tier issues (assuming most actually applied — some may legitimately be `unresolved` if their guidance was off).
2. PRs #285, #326, #343, #345 should be open with `status:awaits-review` and a refute-skipped note.
3. #47 and #52 should be labeled `status:needs-human` with the skip comment.
4. The swarm report (`$DIR/$DATE-supervised-swarm-report.md`) should
   show `state: merged` for the auto-tier ones, `state:
   pending-human-review` for the four human-tier ones.
5. Spot-check that the refute panel ran with non-empty `upstreamShow`
   for at least one merged auto-tier issue — confirms the gsd-pi
   resolution path actually flowed.

## Pointers

- This handoff: `.planning/upstream-swarms/2026-06-05-supervised-batch-handoff.md`
- Most recent dogfood post-mortem: search this session's transcript for
  PR #77's refute v1 → rebase → refute v2.
- Skill docs: `.claude/skills/upstream-swarm/SKILL.md` (now includes the
  preflight step + non-blocking poll-ci action).
- Memory:
  - `[[project_upstream_swarm_skill]]`
  - `[[project_upstream_merge_skill]]`
  - `[[project_upstream_fix_skill]]`
  - `[[project_upstream_cherry_pick_enriched]]`
  - `[[project_upstream_swarm_otto_port]]`
