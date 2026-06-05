# Upstream-port pipeline → otto-cli (pi-dev) — porting context

**Status:** Context capture. Not a spec, not a plan. Written so a future
session can pick up the conversation cold and build the actual SPEC.md /
PLAN.md from here.

**Authored:** 2026-06-05, during a `/upstream-swarm --dry-run` session
that surfaced three harness bugs (now fixed in `e7ec10c`) and turned
into a feasibility discussion for porting the whole pipeline to otto.

---

## What "the pipeline" is today

Three composable Claude Code skills, layered:

1. `upstream-cherry-pick` — audits the two upstream forks
   (`../pi` = pi-dev, `../gsd-pi`), classifies each commit by
   applicability + severity, scores conflict risk, files GitHub issues
   labeled `type:cherry-pick-candidate` + `severity:*` + `status:triaged`,
   writes a triage report. Pure discovery; safe to run in background.
2. `upstream-fix` — implementer companion. Takes a triaged issue (or
   group of them), opens a file-disjoint git worktree per lane, runs a
   fix subagent under four confidence gates (regression-test, build,
   targeted suite, full suite + independent reviewer subagent),
   integrates accepted fixes into one PR per issue, closes the issue
   on merge.
3. `upstream-merge` — confirm + squash-merge upstream-fix PRs. Gates on
   the GitHub required-checks allowlist AND a local trial-merge full
   suite. Two-signal gate. Default human-gated; `--auto` for unattended.

And the autonomous orchestrator above all three:

4. `upstream-swarm` — selects ALL triaged candidates, partitions into
   auto-tier (`severity:nice-to-have-fix`) and human-tier
   (`severity:feature` | `severity:critical-stability`), plans
   file-disjoint waves capped at 3, runs a scheduler loop that dispatches
   fix lanes, polls CI, runs local gates, dispatches a 4-lens refute
   panel per finding, and merges on two-signal-green + refute-approve.
   Human-tier issues stop at PR-open with `status:awaits-review`. Hard
   caps: 3 fix lanes / 10 open PRs / 5 refute panels / 3 wave-size /
   1 retry per issue / abort streak of 5.

### Why these are coupled to Claude Code today

- **`Agent` tool** spawns the fix subagent, the reviewer subagent, and
  each of the 4 refute-lens subagents. Structured output is enforced via
  schema arg.
- **`Workflow` tool** runs the scheduler-style fan-out (parallel lenses,
  pipeline stages).
- **Slash-command UX** (`/upstream-swarm`, `--dry-run`, `--resume`) and
  system-reminder injection are Claude Code primitives.
- **`AskUserQuestion`** handles the human-tier review gate (default
  mode of `upstream-merge`).

Everything else (selection, wave-plan, ledger, scheduler, classifier,
report writer, gh/git shell-outs) is plain Node ESM with `node --test`
unit tests. Roughly two-thirds of the LOC is platform-agnostic.

---

## Why port to otto / pi-dev

- **Non-interactive runs.** Claude Code skills need a Claude Code session.
  otto-cli runs headless (cron, CI, scheduled cloud agents) — natural fit
  for "run the swarm overnight against latest upstream."
- **Reuse otto's persistence.** Coworker memory / vault / scratchpad /
  artifacts already give us session forking and durable run dirs; we
  wouldn't reinvent the swarm ledger.
- **Reach.** Any project running otto (not just cmetech/otto-cli) could
  install `pi-upstream-swarm` as a package and audit/port from its own
  upstreams.

Tradeoff: lose Claude Code's first-class skill/system-reminder UX and
re-validate every gate on the new host.

---

## pi-subagents primitive review (2026-06-05)

Source: https://pi.dev/packages/pi-subagents

**Verdict: every primitive the pipeline needs already exists.**

| Pipeline need | Today (Claude Code) | pi-subagents equivalent |
|---|---|---|
| 1 fix lane per issue | `Agent({prompt, schema})` | `{ agent, task, outputSchema }` |
| 4 refute lenses concurrent | `parallel(LENS.map(...))` | `{ tasks: [...], concurrency: 4 }` (max 8) |
| File-disjoint worktree per lane | `git worktree add` + manual `node_modules` symlink (see `e7ec10c`) | `worktree: true` — auto symlinks `node_modules`, per-agent diff stats, auto-cleanup |
| Dynamic fanout from wave-plan | hand-rolled JS over array | `expand` over array items, `maxItems` bound |
| Schema-validated verdicts | `Workflow` schema arg | JSON Schema via `outputSchema`; prose-only fails |
| Sequential fix→CI→gate→refute→merge | `pipeline()` | `chain` primitive |
| Per-call model | model override on `Agent` | per-call `model:` + `fallbackModels:` array |
| Tool scoping for child | inherited | explicit `tools:` allowlist + `mcp:` entries via `pi-mcp-adapter` |
| Persist run state for resume | swarm ledger JSON | run directory (status/events/output) + `context: "fork"` |
| Slash command UX | `/upstream-swarm` | `/run`, `/chain`, `/parallel` are first-class |

### What gets *cleaner* on pi-subagents

- The `provisionDeps` hack I just committed in `baseline-gate.mjs`
  becomes unnecessary — pi-subagents' `worktree: true` already symlinks
  `node_modules`. Likely deletable.
- The `Workflow` script's `pipeline()` and `parallel()` become
  `.chain.json` files. Declarative, diff-friendly, fork-resumable.
- `outputSchema` validation moves from JS into the agent definition —
  one fewer place for the schema to drift.

### Watch-outs

1. **Nested delegation.** The swarm controller spawns a fix subagent
   which spawns its own reviewer subagent. pi-subagents requires
   `subagent` to be in the child's resolved `tools:` to permit nesting.
   Safety boundary, not a blocker — plumb it through the fix-lane
   agent config.
2. **Concurrency cap.** pi-subagents max is 8. Hardest pipeline cap is
   5 (refute panels). Fits.
3. **Slash-command parity.** pi-subagents has slash commands but the
   `/upstream-swarm --dry-run --resume` flag matrix needs to be
   re-implemented as command args — not free.
4. **System-reminder injection.** Claude Code's loop drops periodic
   reminders (e.g. "task tools haven't been used"). otto/pi-dev doesn't
   have a direct equivalent. Probably fine — the pipeline doesn't depend
   on reminders for correctness, only ergonomics.

---

## Proposed package boundary

One otto package, three layers:

```
packages/pi-upstream-swarm/
├── package.json                    # @otto/pi-upstream-swarm
├── agents/                         # pi-subagents agent definitions (YAML/JSON)
│   ├── fix-lane.yaml               #   subagent: implements 1 issue in a worktree
│   ├── reviewer.yaml               #   subagent: independent review of committed fix
│   ├── refute-correctness.yaml     #   refute lens 1
│   ├── refute-security.yaml        #   refute lens 2
│   ├── refute-repro.yaml           #   refute lens 3
│   └── refute-style.yaml           #   refute lens 4
├── chains/                         # pi-subagents .chain.json orchestration
│   ├── swarm.chain.json            #   top: select → waves → expand(fan-out) → merge
│   ├── fix-then-verify.chain.json  #   per-issue: fix → CI poll → local gate → refute → merge
│   └── refute-panel.chain.json     #   per-finding: 4 lenses in parallel + tally
├── scripts/                        # pure-Node lift-and-shift from current skills
│   ├── select-issues.mjs           #   ← .claude/skills/upstream-swarm/scripts/ (unchanged)
│   ├── wave-plan.mjs               #   ← (unchanged after `extractWaveCandidates` fix in e7ec10c)
│   ├── swarm-ledger.mjs            #   ← may collapse into pi-subagents' run dir
│   ├── scheduler.mjs               #   ← may collapse into chain expand+concurrency
│   ├── transient-classifier.mjs    #   ← unchanged
│   ├── write-report.mjs            #   ← unchanged
│   ├── baseline-gate.mjs           #   ← simplified: drop provisionDeps (worktree handles it)
│   ├── run-gates.mjs               #   ← unchanged (run-gates is host-agnostic)
│   ├── gh-ops.mjs                  #   NEW: extracted shell-outs to gh (issues, PRs, labels)
│   └── git-ops.mjs                 #   NEW: extracted shell-outs to git (worktree, cherry-pick, merge)
├── commands/                       # otto slash-command surface
│   ├── upstream-swarm.ts           #   maps `/upstream-swarm [--dry-run|--resume]` → chain invocation
│   ├── upstream-fix.ts             #   maps `/upstream-fix <issue#>` → single-issue chain
│   └── upstream-merge.ts           #   maps `/upstream-merge <pr#>` → merge step only
└── tests/                          # node --test, ported as-is
    ├── select-issues.test.mjs
    ├── wave-plan.test.mjs
    ├── ...
    └── integration/                # end-to-end with mocked gh+git+subagents
        ├── happy-path.test.mjs
        └── refute-blocks.test.mjs
```

### What lifts unchanged

These are pure Node, already have unit tests, port byte-for-byte:

- `select-issues.mjs`
- `wave-plan.mjs` (post-`extractWaveCandidates`)
- `transient-classifier.mjs`
- `write-report.mjs`
- `run-gates.mjs` (post-`FULL_STEPS` reorder)
- All unit tests (`__tests__/*.test.mjs`)

### What gets rewritten as pi-subagents agents

The four subagent prompts currently inlined in the skill:

- Fix lane prompt (SKILL.md lines 117-160) → `agents/fix-lane.yaml` with
  `tools: read, edit, bash, grep` + `worktree: true` + `outputSchema:
  FIX_RESULT_SCHEMA`.
- Reviewer prompt (SKILL.md lines 175-195) → `agents/reviewer.yaml`,
  read-only tools, `outputSchema: REVIEW_VERDICT_SCHEMA`.
- 4 refute lenses → 4 agent YAMLs, each with a `lens` system-prompt
  fragment + the same `VERDICT_SCHEMA`.

### What collapses into pi-subagents primitives

- `scheduler.mjs` next-action queue → `expand` + `concurrency` in
  `swarm.chain.json`. The hand-rolled file-disjoint partitioning stays
  in `wave-plan.mjs`; pi-subagents just consumes the wave array.
- `swarm-ledger.mjs` durable run state → pi-subagents' run directory
  (status/events/output). Resume becomes `pi-run --resume <runId>`.
- `pipeline()` and `parallel()` JS from the Workflow script → `chain`
  and `tasks:` blocks in JSON.

### What's NEW

- `gh-ops.mjs` and `git-ops.mjs` — today these are inline shell-outs
  scattered across scripts and the SKILL.md prose. For a packaged
  artifact they need extraction into a stable module so tests can mock
  them and so multiple chain steps can call them without duplication.
- otto slash-command bindings (`commands/*.ts`) — argv parsing,
  flag-matrix, help text. The current Claude Code skill spec doc IS the
  arg parser; otto needs real code.

---

## Open questions for the future spec

1. **Cherry-pick stage scope.** Does `pi-upstream-swarm` include the
   audit/triage skill, or is that a separate `pi-upstream-audit` package?
   Audit has different cadence (occasional, idempotent, safe) vs swarm
   (rare, high-stakes, gated). Probably split: audit can run on a
   schedule; swarm is operator-triggered.
2. **Cross-repo isolation.** The current skills assume the cwd is the
   target repo (cmetech/otto-cli). For `pi-upstream-swarm` to be useful
   to other projects, it needs config for: upstream remote names, label
   conventions, severity taxonomy, required-checks allowlist. Where does
   that config live — `.pi/upstream-swarm.yaml`? Per-repo?
3. **Reviewer model selection.** Today the reviewer subagent is whatever
   model the parent session is running. On otto, do we pin to a strong
   model (Opus) for the reviewer + a cheap model (Haiku) for refute? Per
   the table above, pi-subagents supports per-call `model`.
4. **Ledger compatibility.** If pi-subagents' run dir replaces
   `swarm-ledger.mjs`, the `--resume` semantics need to map cleanly.
   Specifically: refute panel mid-tally, fix lane mid-commit, CI poll
   waiting. The current ledger has explicit states for all of these.
5. **Two-signal merge gate.** Today, the local trial-merge full suite is
   run as a separate Bash step driven by the swarm controller. On otto,
   should this be a chain step (so it's resumable), or stay imperative?
6. **Refute tally policy.** Currently 2-of-4 lenses must refute to block.
   Is this a chain-level expression, or do we keep a tiny `tally-refute.mjs`
   that the chain calls?
7. **otto version compatibility.** What otto-cli version introduces
   `pi-subagents` and is it stable enough to depend on for a high-stakes
   workflow that lands on main?

---

## Pointers to artifacts you'll want

- **Current skill code:** `.claude/skills/upstream-swarm/`,
  `.claude/skills/upstream-fix/`, `.claude/skills/upstream-merge/`,
  `.claude/skills/upstream-cherry-pick/`.
- **Current design spec:** `docs/superpowers/specs/2026-06-05-upstream-swarm-design.md`
- **Current implementation plan:** `docs/superpowers/plans/2026-06-05-upstream-swarm.md`
- **Runbook:** `docs/UPSTREAM-PIPELINE.md` (added 2026-06-05 via PR #76)
- **Harness fixes from this session:** commit `e7ec10c` — the
  `baseline-gate.mjs` symlink hack + `FULL_STEPS` reorder + `wave-plan.mjs`
  shape adapter. Useful as a precedent for what edge cases broke under
  the current host; some will reappear, some won't.
- **pi-subagents docs:** https://pi.dev/packages/pi-subagents
- **Memory pointers:**
  - `[[project_upstream_swarm_skill]]` — origin of the current skill
  - `[[project_upstream_merge_skill]]` — merge stage
  - `[[project_upstream_fix_skill]]` — fix stage
  - `[[project_upstream_cherry_pick_enriched]]` — discovery stage

---

## When you pick this up

Suggested flow:

1. Re-read this file + the pi-subagents docs.
2. Decide on the open questions above (especially #1, #2, #3 — they
   shape the package boundary).
3. Run `/gsd-spec-phase` on "port upstream-port pipeline to otto-cli as
   pi-upstream-swarm" to clarify scope and produce a SPEC.md.
4. Then `/gsd-plan-phase` to produce a PLAN.md.
5. Build behind a feature flag in otto-cli — keep the Claude Code skills
   as the canonical path until the otto port has passed a full live
   swarm on a non-trivial backlog.
