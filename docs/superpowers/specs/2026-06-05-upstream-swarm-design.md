# Upstream-Swarm Skill — Design

**Date:** 2026-06-05
**Status:** Approved (brainstorming gate)
**Companions:** `.claude/skills/upstream-cherry-pick`, `.claude/skills/upstream-fix`, `.claude/skills/upstream-merge`

## Goal

Make the upstream-port pipeline (cherry-pick → fix → merge) run autonomously
across dozens of issues without a human in the loop for routine fixes. The
swarm processes everything labelled `status:triaged`, opens one PR per issue,
gates each PR on CI signals + a multi-lens refute panel, and auto-merges the
low-severity tier while routing higher-severity work to a human review queue.

The motivating numbers: 61 open `upstream:pi-dev` cherry-pick candidates today,
all `conflict-risk:none`; expected ongoing inflow from pi-dev and gsd-pi as
upstreams evolve. Manual one-by-one processing does not scale.

## Non-goals

- **Discovering new upstream commits.** `upstream-cherry-pick` already does
  this. The swarm consumes triaged issues; it doesn't fetch upstreams.
- **Continuous daemon operation.** The swarm is on-demand one-shot; cron
  wiring can come later via `/schedule` if useful.
- **Cross-issue refactoring.** Each PR is a clean port of one upstream commit.
  No bundling, no opportunistic cleanups, no "while we're in here" work.
- **Replacing the existing batch human-driven flow.** `upstream-fix` retains
  its bundled-integration-PR mode for human-driven runs; the swarm uses a
  new `--single-issue` mode.

## Decisions locked from brainstorming

| # | Decision | Rationale |
|---|---|---|
| 1 | **1 issue → 1 PR cardinality** | Per-issue audit trail in GitHub, parallel CI, clean revert granularity. |
| 2 | **Tiered auto-merge by severity** | `severity:nice-to-have-fix` auto-merges; `severity:feature` and `severity:critical-stability` are routed to a human review queue. Matches blast-radius to oversight. |
| 3 | **Multi-lens refute panel** | 4 independent specialist subagents (upstream-alignment, scope-discipline, test-quality, blast-radius); 0 refutes + ≥2 approves required to pass; fail-safe on abstain-all. |
| 4 | **Retry-then-quarantine** | One auto-retry on transient failures (CI flake, rebase conflict, baseline drift); persistent failures get `status:needs-human` + comment. |
| 5 | **On-demand one-shot trigger** | `/upstream-swarm [filter]` processes whatever's triaged and exits. No daemon. |
| 6 | **New skill (composition)** | `upstream-swarm` orchestrates by invoking `upstream-fix --single-issue` and `upstream-merge --auto`. Refute panel lives inside `upstream-merge` as Phase B.5. |

## Architecture & topology

```
                 /upstream-swarm [filter]
                          │
                          ▼
              ┌──────────────────────┐
              │  upstream-swarm      │  thin orchestrator
              │  (new skill)         │  zero fix/merge logic
              └──────────────────────┘
                  │           │
       ┌──────────┘           └──────────┐
       │ for each issue                   │ for each PR
       ▼                                  ▼
┌─────────────────────┐         ┌──────────────────────┐
│ upstream-fix        │         │ upstream-merge       │
│ --single-issue N    │         │ --auto --refute      │
│ (existing + flag)   │         │ (existing + Phase B.5)│
└─────────────────────┘         └──────────────────────┘
                                          │
                                          ▼
                                ┌────────────────────┐
                                │ refute panel       │
                                │ 4 specialist       │
                                │ subagents          │
                                └────────────────────┘
```

**Skill responsibilities:**

- **`upstream-swarm`** — selection, file-disjoint wave planning, per-issue
  dispatch, severity routing, retry-quarantine state machine, aggregated
  ledger, pre-flight baseline gate. Zero fix or merge logic.
- **`upstream-fix`** — existing gates and reviewer subagent. Gains
  `--single-issue <N>` flag that runs Phases A-D on exactly one issue and
  produces exactly one PR titled `fix(upstream): <subject> (closes #N)`.
- **`upstream-merge`** — existing two-signal gate. Gains Phase B.5 refute
  panel; `--auto` becomes "skip human gate, require refute-panel pass".

## Per-issue lifecycle (state machine)

States are durable in `.planning/upstream-swarms/<date>-run-state.json`.
The swarm resumes from where it stopped with `--resume`.

```
                  selected
                     │
                     ▼
             ┌─── planning ───┐
             │                │
             ▼                ▼
        fixing           skipped (file-conflict → next wave)
             │
       ┌─────┼─────┐
       ▼     ▼     ▼
   fix-failed  fix-ok
       │         │
       ▼         ▼
   retrying  awaiting-ci
       │         │
       ▼         ▼
   fix-failed  ci-green / ci-red
                  │
                  ▼
              local-gate
                  │
                  ▼
              refute-panel
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
   refuted   approved    needs-human (sev:feature/critical-stability)
       │          │          │
       ▼          ▼          ▼
  quarantined  merged    pending-human-review
```

**Terminal states:**

| State | Action | Logged |
|---|---|---|
| `merged` | Auto-merged; #N closed via "closes #N"; `status:applied` label | mergeSha, PR url |
| `pending-human-review` | PR opened + all gates green, severity tier requires human; `status:awaits-review` label + ping comment | PR url, refute verdicts |
| `quarantined` | Persistent failure post-retry; `status:needs-human` label + comment with failing-gate tail | failure stage, log path, retry count |
| `skipped` | File-conflict, deferred | conflict-files, deferring-wave |
| `refuted` | Refute panel blocked; `status:needs-human` + comments from refuting lenses | refute verdicts per lens |

**Retry semantics** — exactly one auto-retry, only for transients:

- **Retriable:** CI flake (test-unit red but rerun green), rebase conflict
  from main moving since wave started, baseline-rot detection (run-gates fails
  with same error main shows), gate-log-indicates-infra (network, runner OOM).
- **Not retriable:** fix-reviewer rejection, refute-panel refute, regression
  test won't reproduce, real test failures.
- **Mechanism:** re-dispatch `upstream-fix --single-issue` with a fresh
  worktree and a fresh subagent. Reuses the same GitHub issue number. Hard
  cap of 1 retry per issue per swarm run.

## Wave planning

Greedy file-disjoint partitioning:

1. Pull `targetFiles` for each issue from its guidance doc
   (`.planning/upstream-audits/guidance/<sha>.md`).
2. Wave N = greedy-largest file-disjoint subset of remaining issues, capped
   at `--max-wave-size` (default 3).
3. Issues whose `targetFiles` conflict with an in-flight wave are deferred
   to the next wave (state `skipped` → `selected`).

This is intentionally simpler than optimal bin-packing. The `conflict-risk:none`
label already filters most overlap; the wave planner just guards within-batch
collisions.

## Refute panel

Lives inside `upstream-merge` as **Phase B.5**, after the local gate passes
and before merge.

### The four lenses

Each lens is an independent subagent invocation with `agentType: "general-purpose"`,
schema-forced output, no shared context across lenses.

| Lens | Question | Blocks when |
|---|---|---|
| **upstream-alignment** | Does the PR diff semantically match the upstream commit (`<sha>`)? | Mechanism diverges materially and no rationale is in the issue body. |
| **scope-discipline** | Are touched files a subset of (upstream commit files ∪ new test files)? | Files outside the allowed set are touched without justification. |
| **test-quality** | Does the regression test actually pin the upstream failure mode? | Test is a smoke check that would pass either way. |
| **blast-radius** | Are changes proportionate to `severity:` and `conflict-risk:` labels? | A `nice-to-have-fix` introduces refactor, dependencies, or cross-package edits. |

### Input bundle (shared across lenses)

- PR number, headSha, title, body
- PR diff (full, via `gh pr diff <n>`)
- Upstream commit sha + `git show <sha>` output
- Issue body (subject, target files, divergence, applicability)
- Severity + conflict-risk labels

### Output schema per lens

```json
{
  "verdict": "approve" | "refute" | "abstain",
  "confidence": 0.0-1.0,
  "reason": "<= 200 chars, cite specific lines/files",
  "blocking": boolean
}
```

### Voting rule

- Count non-abstain verdicts.
- Panel approves iff ≥2 non-abstain verdicts are `approve` AND 0 are `refute`.
- 1 refute → panel REFUTES; the refuting lens posts a comment on the PR.
- All-abstain or panel error → fail-safe REFUTE (never auto-merge without
  forming a verdict).

### What gets posted to GitHub

On refute: ONE consolidated PR comment with the verdict table and the run
id. On approve: silent success; merge commit body gains a one-line trailer
`Refute-panel: 3 approve, 1 abstain`.

### Cost budget

4 subagents × ~3K tokens of context per PR = ~12K tokens/PR. For 61 PRs,
~730K tokens. Refute fires ONLY after both signals are green, so refute
tokens are never spent on PRs that would fail CI.

## Concurrency & throttling

| Stage | Default cap | Why | Enforced in |
|---|---|---|---|
| Fix lanes | 3 in flight | Each lane: subagent + worktree + `npm run build:core` + full-suite (~15-20 min, ~500MB disk). 3 ≈ 1.5GB peak disk, ~3 CPU lanes. | `upstream-swarm` scheduler |
| Open PRs awaiting CI | 10 | Each PR ~12 min CI runner time. 10 parallel ≈ 2h cumulative runner time, parallel wall-clock. Protects against GH Actions queue saturation. | `upstream-swarm` scheduler |
| Refute panel | 5 PRs in panel | Each PR fires 4 lens subagents = 20 agents. Workflow tool's `min(16, cores-2)` auto-throttles. | `upstream-merge` Phase B.5 |

### Pipelined, not barrier-waved

```
Wave 1 ──fix──→ PR ──CI─→ refute ──merge────────────────
                    ↓
Wave 2  ── fix ──→ PR ──CI─→ refute ──merge────────────
                                ↓
Wave 3  ────── fix ──→ PR ──CI─→ refute ──merge ───────
```

While Wave 1's CI runs, Wave 2's fixes start. Practical wall-clock for 61
issues with defaults: **3-5 hours total**.

### Backpressure rules

Before starting each new fix lane, the scheduler checks:

1. Fix-lane cap reached? → wait for any fix to finish.
2. Open-PR cap reached? → wait for any PR to merge or quarantine.
3. Refute-panel cap reached? → green PRs queue (rare).

### Pre-flight baseline gate

Before Wave 1, the swarm runs the local full gate against `origin/main`
once. If it fails, the swarm aborts before opening any PRs. Output:
`.planning/upstream-swarms/<date>-baseline-gate.log`; failure tail logged
to the run-state ledger. Catches baseline rot proactively (the failure
mode we hit three times during the 2026-06-05 dogfood).

### CLI flags

- `--fix-concurrency N` (default 3)
- `--pr-window N` (default 10)
- `--refute-concurrency N` (default 5)
- `--max-wave-size N` (default 3)
- `--dry-run` — plan-and-print only
- `--skip-baseline-gate` — explicit opt-out (rare)
- `--resume` — idempotent re-run from ledger
- `--filter <expr>` — override default `status:triaged AND type:cherry-pick-candidate`

## Failure handling & retry policy

The swarm distinguishes three failure categories and routes each to a
distinct disposition.

### Category 1: Transient (auto-retry once)

Detected by post-failure inspection of gate logs:

| Signature | Detection |
|---|---|
| CI flake (test-unit red, rerun green) | Re-fetch `gh pr checks` after 5 min; if green, treat first run as flake. |
| Rebase conflict from main moving | `git merge --no-ff origin/<head>` exits with conflict markers AND `origin/main` SHA changed since wave start. |
| Baseline rot | `run-gates full` failure tail matches the same failure on a fresh worktree at `origin/main`. |
| Infra fail | Failure tail matches `EACCES`, `ENOSPC`, `ETIMEDOUT`, `Killed`, `OOMKilled`, `network error`. |

Mechanism: re-dispatch `upstream-fix --single-issue N` with fresh worktree
and fresh subagent. Retry counter bumped in ledger. Hard cap: 1 retry.

### Category 2: Real failure (quarantine)

| Signature | Disposition |
|---|---|
| Fix-stage reviewer subagent rejects | `status:needs-human` + comment with reviewer reason |
| Regression test won't reproduce upstream bug | Same as above |
| Refute panel refutes | `status:needs-human` + refute panel's PR comment (already posted) |
| Real test failure in local-gate | `status:needs-human` + comment with failing test names + log tail |
| CI persistent red after retry | `status:needs-human` + comment with CI check names + run-id |

Quarantined issues stay OPEN on GitHub (PR may still be open or may be
closed depending on subcase). The swarm continues processing other issues.

### Category 3: Swarm-level abort

The whole swarm halts and reports if:

- Pre-flight baseline gate fails.
- More than `--abort-threshold` (default 5) consecutive issues quarantine
  with the same root cause (suggests systemic problem, not per-issue).
- A skill invocation throws an uncaught exception (vs. a clean failure
  verdict) — implies a bug in the skill itself.

Abort writes a final report and exits non-zero. Resuming requires `--resume`
plus the human addressing the abort cause.

## Ledger & artifacts

### `.planning/upstream-swarms/<date>-run-state.json`

The canonical durable state. Schema (subset):

```json
{
  "version": 1,
  "date": "2026-06-05",
  "filter": "status:triaged AND type:cherry-pick-candidate",
  "startedAt": "2026-06-05T14:30:00Z",
  "baselineGate": { "pass": true, "logPath": "..." },
  "waves": [
    { "n": 1, "issues": [53, 67, 89], "startedAt": "...", "completedAt": "..." }
  ],
  "issues": {
    "53": {
      "wave": 1,
      "sev": "nice-to-have-fix",
      "risk": "none",
      "targetFiles": ["packages/..."],
      "upstreamSha": "baf4028",
      "state": "merged",
      "retryCount": 0,
      "prNumber": 74,
      "prUrl": "...",
      "checks": { "pass": true, "informationalReds": [...] },
      "localGate": { "pass": true },
      "refute": {
        "verdicts": [
          { "lens": "upstream-alignment", "verdict": "approve", "reason": "..." }
        ],
        "panelVerdict": "approve"
      },
      "mergeSha": "c622c39",
      "reason": null
    }
  }
}
```

### `.planning/upstream-swarms/<date>-swarm-report.md`

Final rollup, modeled on `2026-06-05-merge-report.md`:

- Outcome counts (merged / pending-human / quarantined / refuted / skipped)
- Per-issue table with state, PR url, mergeSha, refute verdict summary
- Wall-clock breakdown per stage (fix, CI, refute, merge)
- Retry log (which issues retried, why, outcome)
- Surfaced baseline issues (if pre-flight or mid-run rot detected)

### Per-stage ledger pointers

The swarm ledger points at per-stage ledgers — `upstream-fix`'s ledger for
each `--single-issue` run, `upstream-merge`'s ledger per PR. Compactness:
the swarm's own state file stays under ~50KB even for 61 issues.

## Test-driven development plan

Following the existing `upstream-merge` skill's pattern (21 unit tests for
~5 scripts), TDD coverage by component:

### `upstream-swarm/scripts/select-issues.mjs` (new)

Reuses `upstream-fix/scripts/select-issues.mjs` query logic but adds
severity-tier routing.

- `selectIssues` returns `{ autoTier, humanTier }` partitioned by severity
- Empty result handled
- Filter expression respected
- gh CLI runner injectable for tests

### `upstream-swarm/scripts/wave-plan.mjs` (new)

Greedy file-disjoint partitioning.

- Single wave when all issues are file-disjoint
- Multi-wave when overlap exists
- Respects `--max-wave-size` cap
- Stable ordering (issue number tiebreak) for deterministic resume
- Empty input returns empty plan

### `upstream-swarm/scripts/swarm-ledger.mjs` (new)

Mirrors `upstream-merge/scripts/merge-ledger.mjs` API shape.

- `initSwarmLedger` seeds wave + issue records
- `recordWaveStart` / `recordWaveComplete`
- `recordIssueTransition(state, payload)` enforces state machine validity
- `recordRetry` increments counter and stores retry-reason
- Throws on unknown issue / invalid state transition
- File written atomically

### `upstream-swarm/scripts/scheduler.mjs` (new)

The pipelined backpressure loop.

- Respects all three concurrency caps
- Yields next-fix-lane when one slot opens
- Yields next-merge-candidate when refute slot opens
- Pure function on (ledger, caps) → next actions
- Handles cap=0 edge case (no progress, returns empty)

### `upstream-swarm/scripts/baseline-gate.mjs` (new)

Pre-flight gate against `origin/main`.

- Creates fresh worktree
- Runs `run-gates.mjs full`
- Returns `{ pass, failTail, logPath }`
- Cleans up worktree on success; preserves on failure

### `upstream-swarm/scripts/transient-classifier.mjs` (new)

Categorizes a failure as transient / real / swarm-abort.

- Recognizes CI-flake signature (red→green on rerun)
- Recognizes baseline-rot signature (same failure on main)
- Recognizes infra signatures (EACCES, ENOSPC, OOM, network)
- Returns `{ category: 'transient'|'real'|'abort', reason }`
- Test cases for each signature (table-driven)

### `upstream-merge/scripts/refute-panel.mjs` (new)

The 4-lens panel.

- `lensInputs` assembles the shared input bundle deterministically
- `tallyVerdicts` applies the voting rule (table-driven test:
  3 approve+1 abstain → approve; 2 approve+1 refute+1 abstain → refute;
  all-abstain → refute; etc.)
- `formatRefuteComment` produces the consolidated PR comment markdown
- `runPanel` orchestrates 4 parallel subagent calls (mockable runner)

### `upstream-merge/scripts/merge-pr.mjs` (existing, extend)

`evaluate-checks` keeps its single responsibility (CI allowlist verdict).
The composition of CI + local + refute happens in `merge-pr.mjs` / SKILL.md
orchestration. Add tests:

- `--auto` + refute approved → `merge-pr` proceeds to squash-merge.
- `--auto` + refute refuted → `merge-pr` returns `{ merged: false, blockedBy: "refute" }` and does NOT call `gh pr merge`.
- `--auto` flag without refute panel result → fail-safe (does not merge).

### `upstream-fix/scripts/scheduler.mjs` (existing, extend)

- Add `--single-issue` mode: select-issues returns exactly one issue;
  wave plan is trivial; integration step opens 1 PR titled `fix(upstream):
  <subject> (closes #N)`.
- Add test for single-issue mode end-to-end (mocked gates).

### Integration tests (`upstream-swarm/scripts/__tests__/integration/`)

- **Happy path** (3 issues, all green): mock fix runner returns success,
  mock CI poller returns green, mock refute returns approve → all 3 merged.
- **One refute** (3 issues, 1 refuted): one PR's refute returns refute →
  that issue quarantines, other 2 merge.
- **One retry-success** (3 issues, 1 CI-flake): mock CI returns
  red-then-green on rerun → retried issue merges.
- **One retry-fail** (3 issues, 1 persistent red): retry produces same
  failure → quarantined.
- **Baseline rot abort**: pre-flight returns red → swarm aborts before
  opening PRs.
- **Severity routing**: 2 nice-to-have + 1 critical-stability → critical
  PR ends in `pending-human-review`, nice-to-have ones merge.
- **Resume from ledger**: stop mid-run, resume → completes only un-finalized
  issues, idempotent on already-merged ones.

Total target: ~30 unit tests + 7 integration tests across `upstream-swarm`
and the new `upstream-merge` refute scripts. Existing `upstream-fix`
single-issue mode adds ~3 more.

## Compatibility with otto-cli / pi-dev runtime

The user raised whether these skills/scripts can also run inside otto-cli
itself (built on pi-dev) so that pi-dev subagents can drive the same
pipeline. Two constraints determine compatibility:

1. **Skill format.** SKILL.md + scripts is Claude Code's skill format.
   pi-dev runs the same skill format via its `superpowers` registry. The
   `upstream-cherry-pick`, `upstream-fix`, and `upstream-merge` skills
   already work in both environments today; `upstream-swarm` inherits
   that property by following the same SKILL.md + `.mjs` scripts shape.
2. **Tool surface.** All scripts use `gh`, `git`, `node`, `npm` via
   `execFileSync` / `spawnSync`. No Claude Code-specific tools in script
   bodies. Subagent dispatch (refute panel) uses the standard agent
   primitive available in both Claude Code and pi-dev workflows.

The one design choice that affects portability is **avoiding the `Workflow`
tool inside any script the swarm calls.** `Workflow` is Claude-Code-only.
The swarm uses `Workflow` ONLY in its top-level SKILL.md orchestration —
the scripts themselves are pure Node modules. Inside otto-cli, the swarm's
orchestration can be implemented with pi-dev's equivalent fan-out primitive
without touching the scripts.

Net: yes, the swarm + supporting scripts are portable; the SKILL.md may
need a pi-dev variant for the orchestration shell, but the heavy logic
(scheduler, ledger, wave planner, refute panel, transient classifier)
lives in vanilla Node modules that run identically in both runtimes.

## Open questions for implementation phase

- **Refute model selection.** Each lens should use Sonnet to keep cost
  bounded; final spec leaves model choice to the writing-plans phase.
- **PR title convention.** `fix(upstream): <subject> (closes #N)` for
  nice-to-have-fix. Should `feature` ports use `feat(upstream):` instead?
  Defer to writing-plans.
- **Ledger schema versioning.** Set `version: 1`; migration policy when
  schema evolves is out of scope for v1.

## File layout

```
.claude/skills/upstream-swarm/
├── SKILL.md
├── README.md
├── config.json                    # severity-tier rules, default caps
└── scripts/
    ├── select-issues.mjs          # extends upstream-fix's selector
    ├── wave-plan.mjs              # file-disjoint partitioner
    ├── swarm-ledger.mjs           # state-machine ledger
    ├── scheduler.mjs              # pipelined backpressure loop
    ├── baseline-gate.mjs          # pre-flight gate
    ├── transient-classifier.mjs   # failure categorization
    ├── write-report.mjs           # final rollup
    └── __tests__/
        ├── *.test.mjs             # ~30 unit tests
        └── integration/
            └── *.test.mjs         # 7 integration tests

.claude/skills/upstream-merge/scripts/
└── refute-panel.mjs               # NEW: 4-lens panel
.claude/skills/upstream-merge/scripts/__tests__/
└── refute-panel.test.mjs          # NEW: voting rule + format

.claude/skills/upstream-fix/scripts/
└── scheduler.mjs                  # EXTENDED: --single-issue mode
```

## References

- `2026-06-05-merge-report.md` — dogfood report that surfaced the gaps this
  spec addresses
- `.claude/skills/upstream-fix/SKILL.md` — Phase A-D fix loop
- `.claude/skills/upstream-merge/SKILL.md` — current two-signal gate
- `.claude/skills/upstream-cherry-pick/SKILL.md` — triage stage; upstream
  of this skill
