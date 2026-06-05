# Upstream-Port Pipeline — Operational Runbook

How to keep OTTO in sync with its upstream forks (`pi-dev`, `gsd-pi`)
without doing the work manually. This document is the operational
companion to [`UPSTREAM-SYNC.md`](./UPSTREAM-SYNC.md) (which captures the
fork baseline + divergence ledger).

> Want the why? See `docs/superpowers/specs/2026-06-05-upstream-swarm-design.md`.
> Want the build details? See `docs/superpowers/plans/2026-06-05-upstream-swarm.md`.
> Want each stage in depth? Each skill's `SKILL.md` is its own reference.

---

## The four stages

```
┌─────────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ upstream-cherry-pick│→ │ upstream-fix     │→ │ upstream-merge   │  │ upstream-swarm   │
│ (discovery)         │  │ (implementation) │  │ (merge gate)     │  │ (orchestrator)   │
└─────────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘
        │                        │                       │                     │
        │ files GitHub issues    │ opens reviewable      │ squash-merges       │ runs all 3
        │ tagged                 │ PR(s) gated on        │ behind two-signal   │ stages
        │ status:triaged         │ regression+build+     │ + (under --auto)    │ autonomously
        │                        │ targeted+full+        │ refute panel gate   │ for whole
        │                        │ reviewer subagent     │                     │ status:triaged
        │                                                                      │ backlog
        ▼                        ▼                       ▼                     ▼
   audit report             integration PR        squash on main          rollup report
```

Each stage is a separately invocable skill. The fourth (`upstream-swarm`)
is just an orchestrator that wires the other three together for the
hands-off path.

---

## Stage 1 — Discovery (`upstream-cherry-pick`)

**Purpose:** scan upstreams for fixes/features worth porting; file
enriched GitHub issues so the rest of the pipeline has something to
work with.

**Preconditions:**

- Local checkouts of upstream forks at `../pi` and `../gsd-pi`
  (siblings of `otto-cli/`).
- `gh auth status` clean.
- Latest `main`.

**Trigger:**

| What you want | What to type |
|---|---|
| Audit pi-dev for new candidates | `/upstream-cherry-pick pi-dev` |
| Audit gsd-pi | `/upstream-cherry-pick gsd-pi` |
| Both, in background | `/upstream-cherry-pick` (defaults to both, safe in background) |

**Output:**

- Filed issues with labels: `type:cherry-pick-candidate`, `upstream:pi-dev` (or `:gsd-pi`), `severity:<tier>`, `conflict-risk:<tier>`, `status:triaged`
- Guidance docs at `.planning/upstream-audits/guidance/<sha>.md`
- Triage report at `.planning/upstream-audits/<date>-audit-report.md`

**Safe to background:** yes. Produces durable artifacts; no live merges.

---

## Stage 2 — Implementation (`upstream-fix`)

**Purpose:** take filed issues and produce reviewable PRs that pass four
confidence gates (regression test → build → targeted suite → full suite +
independent reviewer subagent).

**Preconditions:** stage 1 has filed at least one `status:triaged` issue.

**Trigger:**

| What you want | What to type |
|---|---|
| Bundled mode — N issues into ONE integration PR (human-driven, default) | `/upstream-fix --severity critical-stability` |
| Single-issue mode — one issue, one PR (used by swarm) | `/upstream-fix --single-issue 53` |
| Specific issues | `/upstream-fix --issues 53,67,89` |
| Everything triaged | `/upstream-fix --all` |
| Dry-run plan only | `/upstream-fix --severity nice-to-have-fix --dry-run` |

**Output:**

- Per-run ledger: `.planning/upstream-fixes/<date>-run-state.json`
- Worktrees: `.worktrees/upstream-fix-lane-<N>/` (cleaned up on PR open)
- Integration PR(s) titled either `feat(upstream): port <subject>...` (bundled) or `fix(upstream): <subject> (closes #N)` (single-issue)
- Reviewer-subagent reasons recorded in the ledger

**Safe to background:** medium. Spawns parallel subagents (cap 3). PR opens are visible to the team. Confirm scope before backgrounding a large batch.

---

## Stage 3 — Merge gate (`upstream-merge`)

**Purpose:** confirm a PR is mergeable by two independent signals (GitHub
required-checks allowlist + a local trial-merge full-suite run) and squash
it to `main`. The third signal under `--auto` is the refute panel.

**Preconditions:** at least one open upstream-fix PR against `main`.

**Trigger:**

| What you want | What to type |
|---|---|
| Merge PRs on current branch (human-gated) | `/upstream-merge` |
| Merge specific PRs | `/upstream-merge 64,70` |
| Filter by head-ref glob | `/upstream-merge --filter "integration/upstream-fix-*"` |
| Dry-run (confirm only, don't merge) | `/upstream-merge --dry-run` |
| Auto (skip human gate, REQUIRE refute panel) | `/upstream-merge --auto` (used by swarm; humans normally don't pass `--auto`) |

**Required-checks allowlist** (in `.claude/skills/upstream-merge/config.json`):

- Required (always run): `build`, `test-unit`, `test-packages`, `fast-gates`
- Conditional (run only on lock-file PRs): `cargo audit`, `npm audit (.)`
- `skipping` bucket counts as pass (workflow path filters)
- Informational reds (not in allowlist): `triage`, `docker-e2e`, `e2e`, `integration-tests`, `windows-portability`, `test-coverage`

**Output:**

- Per-run ledger: `.planning/upstream-merges/<date>-run-state.json`
- Trial-merge worktrees at `.worktrees/upstream-merge-pr-<N>/` (kept on gate failure for inspection)
- Final report: `.planning/upstream-merges/<date>-merge-report.md`
- Closed issues (via the PR's `closes #N` link) + `status:applied` label

**Safe to background:** no. The two-signal gate runs a full local `npm test` per PR (~15–20 min). Don't background unattended unless under `--auto`.

---

## Stage 4 — Autonomous orchestrator (`upstream-swarm`)

**Purpose:** run stages 2+3 across the whole `status:triaged` backlog
without a human in the loop for routine `severity:nice-to-have-fix` work.
Higher-severity issues open PRs and stop at `status:awaits-review`.

**Preconditions:**

- Stage 1 has filed issues you want to process.
- Local `main` is at `origin/main` (pre-flight baseline gate runs against `origin/main`).
- `gh auth status` clean.
- At least ~2GB free disk for parallel worktrees.

**Trigger:**

| What you want | What to type |
|---|---|
| Process everything triaged | `/upstream-swarm` |
| Plan only (no PRs opened) | `/upstream-swarm --dry-run` |
| Smaller wave size | `/upstream-swarm --max-wave-size 1` |
| Tighter open-PR cap | `/upstream-swarm --pr-window 5` |
| Custom filter | `/upstream-swarm --filter "label:upstream:pi-dev severity:nice-to-have-fix"` |
| Resume interrupted run | `/upstream-swarm --resume` |

**Output:**

- Pre-flight log: `.planning/upstream-swarms/<date>-baseline-gate.log`
- Run-state ledger: `.planning/upstream-swarms/<date>-run-state.json`
- Final rollup: `.planning/upstream-swarms/<date>-swarm-report.md`
- Multiple closed issues + merged PRs on `main`

**Hard caps** (configurable down, never up via CLI):

| Cap | Default | Why |
|---|---|---|
| `fix-concurrency` | 3 | matches upstream-fix's lane cap |
| `pr-window` | 10 | CI runner queue saturation guard |
| `refute-concurrency` | 5 | 4 lens subagents × 5 PRs = 20-agent ceiling |
| `max-wave-size` | 3 | per-wave file-disjoint partition |

**Failure policy:** `retry-then-quarantine`. Transient failures (CI flake,
rebase conflict from main moving, baseline drift, infra signature) get
exactly one retry. Persistent failures get `status:needs-human` and the
swarm continues with the rest.

**Safe to background:** yes, but use `--dry-run` once first on a new
backlog to sanity-check wave planning + selection.

---

## Recommended first-time workflows

### 1. Initial sync after a long gap

```bash
# 1. Discover
/upstream-cherry-pick                      # files issues for both upstreams

# 2. Review the triage report
$EDITOR .planning/upstream-audits/$(date +%F)-audit-report.md

# 3. Pick a critical-stability fix and port it manually first
/upstream-fix --single-issue <N>
/upstream-merge <PR>                       # human-gated, no --auto

# 4. Once you trust the loop, unleash the swarm on the long tail
/upstream-swarm --dry-run                  # sanity-check wave plan
/upstream-swarm                            # run for real
```

### 2. Periodic incremental sync (steady state)

```bash
/upstream-cherry-pick                      # background-safe
# … wait for issues to file …
/upstream-swarm                            # processes whatever's triaged
```

### 3. One urgent backport

```bash
/upstream-fix --single-issue <N>           # one issue → one PR
/upstream-merge <PR>                       # human gate; review the diff
```

---

## Recovery + troubleshooting

### `upstream-swarm` aborted mid-run

```bash
$EDITOR .planning/upstream-swarms/$(date +%F)-swarm-report.md  # see what stopped
/upstream-swarm --resume                                       # continues from ledger
```

The ledger tracks per-issue state durably; resume reads it and only
dispatches work for non-terminal issues.

### A PR's refute panel blocked auto-merge

You'll see a `🤖 Refute panel blocked auto-merge` comment on the PR plus a
`status:needs-human` label. Inspect the verdict table in the comment, fix
the underlying issue (usually scope-discipline finding an unrelated edit),
push to the PR branch, and either re-merge manually or let `--resume`
pick it up.

### Baseline gate red — swarm refuses to start

```bash
cat .planning/upstream-swarms/$(date +%F)-baseline-gate.log    # what's broken on main
```

Fix `main` (typically a baseline-rot test or a missing build step), push
the fix, then re-run the swarm. Do NOT use `--skip-baseline-gate` to dodge
this — it's there because we've been bitten three times by exactly this.

### Worktree leftover after a failed run

```bash
git worktree list
git worktree remove .worktrees/<leftover>
git worktree prune
```

Worktrees are intentionally preserved on gate failures for inspection.
The skill's terminal-state cleanup only fires on success paths.

---

## Cross-references

- [`UPSTREAM-SYNC.md`](./UPSTREAM-SYNC.md) — fork baseline, divergence ledger, manual patch log
- `.claude/skills/upstream-cherry-pick/SKILL.md` — stage 1 internals
- `.claude/skills/upstream-fix/SKILL.md` — stage 2 internals
- `.claude/skills/upstream-merge/SKILL.md` — stage 3 internals
- `.claude/skills/upstream-swarm/SKILL.md` — stage 4 internals
- `docs/superpowers/specs/2026-06-05-upstream-swarm-design.md` — design rationale
- `docs/superpowers/plans/2026-06-05-upstream-swarm.md` — TDD implementation plan
- `.planning/upstream-merges/2026-06-05-merge-report.md` — the dogfood run that motivated the swarm

## Dogfood lessons (so far)

From the 2026-06-05 end-to-end dogfood that landed PR #74:

1. **Baseline rot is the most common failure mode.** Three separate baseline-test bugs surfaced during a single dogfood (vendor copy, conditional-checks allowlist, postinstall symlink). The pre-flight baseline gate in `upstream-swarm` exists specifically to catch this *before* opening 60 PRs.
2. **Path-conditional checks mislead naive allowlists.** The skill's required-checks allowlist now distinguishes always-required vs conditional, and treats `skipping` as pass. PRs that only touch docs/skills correctly pass without running heavy build/test jobs.
3. **Local-gate setup is heavier than `npm ci`.** A clean worktree needs `npm ci` + `npm run build:core` before `npm test` will resolve workspace `@otto/*` imports. Wrapped into the swarm but worth knowing when debugging gate failures manually.
