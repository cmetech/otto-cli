# Design: `upstream-fix` skill

**Status:** Approved (design), pending implementation plan
**Date:** 2026-05-30
**Author:** Corey Ellis + Claude
**Companion to:** `upstream-cherry-pick` (see `2026-05-29-upstream-cherry-pick-skill-design.md`)

## 1. Purpose

`upstream-cherry-pick` *files* implementation-ready GitHub issues for upstream
commits worth porting into otto-cli. `upstream-fix` is the other half: it
*implements* those fixes. It selects filed issues by grouping (severity, type,
label, explicit numbers, or all), implements each fix on an isolated git
worktree using parallel subagents, gates every fix on four mandatory confidence
checks, integrates the accepted fixes into one reviewable PR, updates/closes the
issues, and writes a report.

This is the highest-stakes skill in the set: it is the one that actually changes
otto-cli source. Reliability, conflict avoidance, confidence gating, and
context-budget discipline are the design's primary concerns.

### Non-goals

- It does not file issues (that is `upstream-cherry-pick`).
- It does not port `type:do-not-port` issues (excluded by default).
- It does not force-push, push to main directly, skip hooks, or commit secrets.

## 2. Locked decisions (from design discussion)

| Decision | Choice |
| --- | --- |
| Integration model | File-disjoint lanes → one integration branch → single PR to main |
| Confidence gates (ALL mandatory) | Regression test · Build green · Targeted+full suite · Reviewer subagent |
| Max parallel lanes in flight | 3 |
| `type:do-not-port` | Excluded by default |
| Low-confidence fix | Do NOT touch code; comment on issue; report `unresolved` |

## 3. Orchestration model (who does what)

A hard constraint shapes the architecture: **a `.mjs` script cannot spawn Claude
subagents** — only the agent running `SKILL.md` can (via the Agent tool). So
responsibilities split into two layers:

- **Deterministic `.mjs` helper scripts** (pure Node, unit-testable, no LLM):
  issue selection, lane planning, worktree setup/merge, gate execution,
  issue/label updates, run-state ledger I/O, report generation.
- **Agent-driven orchestration (`SKILL.md`)**: dispatch one fix subagent per
  lane (≤3 in flight), dispatch reviewer subagents, make accept/reject
  decisions, drive the integration sequence.

This mirrors `upstream-cherry-pick`'s anatomy (`.mjs` scripts + co-located
`__tests__/` + a `SKILL.md` with trigger phrases) but differs in one essential
way: here the **core work is agentic**, not scriptable. The scripts are the
deterministic plumbing around an agentic core.

## 4. Selection & lane planning (deterministic, up front)

### 4.1 `select-issues.mjs`

Queries `gh issue list --repo cmetech/otto-cli` by filter and emits a compact
JSON array (written to disk; only counts + path printed to stdout).

Supported groupings (CLI flags):

- `--all`
- `--severity critical-stability|critical-security|feature|nice-to-have-fix`
- `--type cherry-pick-candidate|port-required`
- `--label <label>`
- `--issues 62,63,71`
- `--upstream pi-dev|gsd-pi`

Default exclusions: `type:do-not-port`, and any issue already `status:applied`
or closed. Each emitted record:

```json
{ "number": 63, "severity": "critical-stability", "type": "port-required",
  "sha": "ce0e801", "guidancePath": ".planning/upstream-audits/guidance/ce0e801.md",
  "targetFiles": ["packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts"] }
```

`targetFiles` is parsed from the issue's guidance file (the "Target file(s)"
section). When guidance lists "no equivalent exists" or is absent, the issue is
flagged `needs-triage` and excluded from automatic lanes (reported, not fixed).

### 4.2 `plan-lanes.mjs`

Builds a `file → issues` map from `targetFiles`, then runs union-find to produce
**connected components**. Two issues share a component iff they share a target
file (directly or transitively). Each component is one **lane**.

- **Across lanes:** file-disjoint by construction → safe to run in parallel,
  merges back with zero textual conflicts.
- **Within a lane:** issues are ordered (critical severity first) and run
  **sequentially** on the same evolving worktree, so there is never an
  intra-lane conflict either.

Output `lanes.json`:

```json
{ "lanes": [
  { "id": 1, "issues": [7-char-ordered], "files": ["..."] },
  ...
] }
```

This is the conflict-avoidance core: conflicts are avoided *structurally* rather
than resolved after the fact.

## 5. The fix subagent (one per lane)

Each lane is handled by a single fix subagent that owns a worktree off `main`
(`.worktrees/upstream-fix-lane-<n>`, under the gitignored `.worktrees/`). For
**each issue in its lane, in order**, the subagent runs this protocol:

1. **Re-confirm the fix in code (confidence gate 0).** Read the issue body + its
   guidance file, then *independently verify against the actual otto-cli source*
   that the proposed port is correct and will fix the described problem. otto-cli
   is not a 1:1 mirror of upstream (renamed/restructured packages), so the
   guidance is a strong pointer, not ground truth. **If confidence is not full:
   do NOT modify code.** Record `unresolved` + a concrete reason, post a comment
   on the issue explaining the concern, and move to the next issue.
2. **Reproduce-then-fix (regression test gate).** Write a `node:test`
   (`*.test.ts`, co-located with source, per repo standard) that *fails* against
   current behavior, confirm it fails, apply the fix, confirm it now *passes*.
   For changes where a runtime regression test is genuinely impossible (e.g.
   pure packaging/metadata), the subagent records the justification; such issues
   require explicit reviewer approval to proceed (see §6).
3. **Build gate.** `npm run build` succeeds.
4. **Targeted suite gate.** Affected package tests pass: `npm test -w @otto/<pkg>`.
5. **Commit.** One granular Conventional Commit per issue:
   `fix(<scope>): <summary> (closes #N)`. Continue to the next issue in the lane.

The subagent returns a **thin** result per issue and nothing else:

```
#63 resolved ce0e801sha "added rpc-mode backpressure retry + regression test"
#71 unresolved none "otto-cli already handles this via X; upstream change N/A"
```

No diffs, file contents, or logs are returned to the controller.

## 6. Review, integration, final gate (sequential, after lanes finish)

- **Reviewer gate.** For each *resolved* issue, the controller dispatches an
  **independent reviewer subagent** that reads the committed diff + the issue +
  upstream intent and returns `approve|reject <reason>`. A reject flips the issue
  to `unresolved`; its commit is excluded from integration. This catches the
  "passes tests but wrong/incomplete fix" failure mode.
- **Integration.** `worktree-merge.mjs` merges each accepted lane branch into a
  fresh `integration/upstream-fix-<date>` branch. Disjoint lanes merge clean.
  **Post-hoc overlap safety net:** before merging, compare each subagent's
  *actual* touched files against its declared `targetFiles`; if a subagent
  strayed into another lane's files, that lane is merged last and re-verified —
  on any conflict, its issues are marked `unresolved` rather than force-resolved.
- **Final full suite.** `npm test` (+ `npm run verify:pr`) on the integration
  branch. If red, integration is held and the failure is reported; **nothing
  reaches main**.
- **PR.** One PR from the integration branch to main, carrying all per-issue
  commits, body summarizing resolved/unresolved counts and linking issues.

## 7. Issue lifecycle & report

### 7.1 Lifecycle (`issue-update.mjs`)

- On lane claim: add `status:in-progress`.
- On success (merged + reviewer-approved + final suite green): add
  `status:applied`, **close the issue** with a comment linking the commit/PR.
- On failure/low-confidence: leave open, keep `status:triaged`, add a comment
  stating the blocker.

### 7.2 Report (`write-report.mjs`)

Reads the run-state ledger (on disk) and writes
`.planning/upstream-fixes/YYYY-MM-DD-fix-report.md`:

- Per issue: resolved/unresolved, commit sha, which gates passed, reviewer
  verdict, and **for every unresolved issue, the explicit reason**.
- Roll-up: N resolved / M unresolved / lanes / PR link / final-suite status.

## 8. Context budget & long-run durability

The controller must run for hours over 50–100 issues without its context filling
up. The governing principle: **the controller's context grows with the number of
lanes, not the content of issues — and progress lives on disk, not in the
transcript.**

1. **Durable run-state ledger is the source of truth.**
   `.planning/upstream-fixes/<date>-run-state.json` records every issue's lane,
   status, commit sha, gate results, and reviewer verdict. The controller never
   holds issue bodies, guidance, or diffs in context — only compact ledger
   fields. Because progress is on disk, **auto-compaction or a session restart is
   safe**: `--resume` reconstructs state from the ledger. The run is effectively
   *stateless in the controller's context*.

2. **Tight scheduler loop; never enumerate all issues.** `scheduler.mjs --next`
   reads `lanes.json` + the ledger and returns **only the next ≤3 runnable
   lanes** as compact descriptors. The controller dispatches them, folds results
   via `record-result.mjs` (one-line ack), then calls `--next` again. Per
   iteration the controller adds only a handful of short lines — **O(1)
   regardless of total issue count.**

3. **Everything heavy reads/writes files; scripts return summaries, not blobs.**
   - `select-issues.mjs` / `plan-lanes.mjs` write JSON to disk, print counts +
     path only.
   - Fix and reviewer subagents read guidance/source/diffs **in their own
     disposable context** and return thin one-liners; their context is discarded
     on completion.
   - `run-gates.mjs` writes full build/test logs to a file and returns only
     `{ pass, failTail≤30 lines }`, so a red `npm test` never dumps thousands of
     lines into the controller.
   - `write-report.mjs` assembles the report from the on-disk ledger itself.

4. **Subagent prompts are assembled from compact ledger fields** (issue number,
   guidance *path*, target files, worktree name) — never inlined content.

**Budget estimate (100 issues / ~40 lanes):** ~40 dispatch iterations + ~100
reviewer dispatches, each contributing a few thin lines → low thousands of tokens
of durable controller transcript across the entire run, before compaction
engages. Auto-compaction is a backstop, not a dependency.

**Caveat (documented protocol):** if a specific failure must be inspected
mid-run, that read lands in the controller's context — so the rule is "inspect
via a subagent, or read the on-disk log file with a bounded line range," never
`cat` a full log or diff into the controller.

## 9. Triggering

- **Natural language:** `SKILL.md` `description` carries trigger phrases —
  e.g. "implement the critical upstream fixes", "port the cherry-pick
  candidates", "fix the filed upstream issues".
- **Slash command:** a thin `.claude/commands/upstream-fix.md` invokes the skill
  so `/upstream-fix <filter>` works literally (e.g. `/upstream-fix --severity
  critical-stability`).

## 10. Robustness features

- `--dry-run`: run selection + lane planning, print the plan (lanes, issue
  counts, parallelism), do no work.
- `--resume`: idempotent re-run; skips issues already `status:applied`, continues
  from the ledger. Safe after interruption/compaction.
- **Worktree hygiene:** on success, remove the lane worktree; on failure,
  preserve it for inspection and note its path in the report.
- **Issue cap with confirmation:** runs above a configurable cap (default 25)
  require explicit confirmation, so a stray `--all` doesn't launch 100 lanes
  unattended.
- **Safety invariants:** never force-push, never commit to main directly (always
  via integration branch + PR), never `--no-verify`, never stage `.env`/secrets.

## 11. Script inventory

Deterministic `.mjs` helpers (each with co-located `__tests__/`):

| Script | Purpose |
| --- | --- |
| `select-issues.mjs` | Query gh by filter → compact issue list JSON |
| `plan-lanes.mjs` | Union-find on target files → `lanes.json` |
| `scheduler.mjs` | `--next`: return next ≤3 runnable lanes from ledger |
| `worktree-setup.mjs` | Create lane worktree off main |
| `worktree-merge.mjs` | Merge accepted lane → integration branch; overlap check |
| `run-gates.mjs` | Build + targeted/full tests; return `{pass, failTail}` |
| `record-result.mjs` | Fold a subagent result into the run-state ledger |
| `issue-update.mjs` | Labels, comments, close via gh |
| `write-report.mjs` | Ledger → markdown fix report |
| `ledger.mjs` | Run-state ledger read/write primitives (shared) |

Agent-driven (in `SKILL.md`, not scripted): lane subagent dispatch, reviewer
subagent dispatch, accept/reject decisions, integration sequencing.

## 12. Standards alignment (otto-cli)

- **Commits:** Conventional Commits; branches `<type>/<desc>`.
- **Tests:** Node built-in `node:test`, `*.test.ts` co-located, `beforeEach`/
  `afterEach` cleanup (no inline try/finally), no source-grep tests.
- **Build:** `npm run build` after any runtime change.
- **Verify gates:** `npm run verify:fast` (1–3 min) per worktree where useful;
  `npm test` / `npm run verify:pr` on the integration branch before the PR.
- **Skill scripts:** ESM `.mjs`, co-located `__tests__/` with DI-friendly
  exports (matching `upstream-cherry-pick` convention).

## 13. End-to-end validation (acceptance)

Before declaring the skill done, run it against **one critical issue** (a
`severity:critical-stability` candidate such as `#63` / `ce0e801`) end to end and
confirm: lane planned → worktree created → regression test written (fails→passes)
→ build green → targeted+full suite green → reviewer approved → merged to
integration → PR opened → issue closed with `status:applied` → report written →
worktree cleaned up → controller context stayed flat.
