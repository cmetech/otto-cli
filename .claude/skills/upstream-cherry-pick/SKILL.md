---
name: upstream-cherry-pick
description: >
  Audit OTTO's two upstream forks (pi-dev at ../pi, gsd-pi at ../gsd-pi)
  for fixes and features worth porting. Classifies each commit by
  applicability and severity, scores conflict risk against
  docs/UPSTREAM-SYNC.md, files GitHub issues for actionable candidates,
  and writes a triage report. Use when checking what's new upstream,
  building the cherry-pick backlog, or before a release. Safe to run in
  background mode — produces durable artifacts (issues + report file).
---

# Upstream Cherry-Pick Audit

## When to use

- "What's new upstream in pi-dev?"
- "Have we missed any gsd-pi fixes since the last sync?"
- "Build me a backlog of cherry-pick candidates."
- Before a release, to verify there's no untracked critical fix in upstream.

Safe to run as a background subagent — produces durable artifacts (gh issues + report file). No interactive prompts after `--init`.

## Quickest path — the orchestrator

For a normal scan, run the bundled orchestrator instead of hand-driving each
step. It executes the entire deterministic pipeline below in one process:

```sh
# Preview without filing (recommended first run)
node .claude/skills/upstream-cherry-pick/scripts/run-audit.mjs <upstream> --dry-run

# Real run — files issues, advances state, commits
node .claude/skills/upstream-cherry-pick/scripts/run-audit.mjs <upstream>
```

Run it from the repo root. Omit `<upstream>` to scan every upstream in config.
Flags: `--dry-run`, `--no-issue-context`, `--refresh-cache`, `--from <commit>`,
`--no-commit`, `--guidance-dir <dir>`, `--no-diff`. The orchestrator handles the
per-commit loop, dedup, dry-run report labeling, state advance, and the closing
commit; the agent supplies the judgment-call prose described under "Judgment
calls" below — most importantly, the **otto-cli implementation guidance**.

The step-by-step process below documents what the orchestrator does internally
(and is the fallback if you need to drive a single commit by hand).

## Implementation-grade issues: the otto-cli analysis (REQUIRED for real filing)

> **otto-cli is NOT a 1:1 mirror of its upstream.** Packages were renamed and
> restructured (`packages/ai` → `packages/pi-ai`, `packages/coding-agent` →
> `packages/pi-coding-agent`, `packages/tui` → `packages/pi-tui`, plus
> `pi-agent-core`, `rpc-client`, `daemon`, `mcp-server`, `contracts`, `native`).
> The upstream "Files touched" list is a **starting pointer, not a target map**.

A filed issue must be **implementation-ready**: when the implementation phase
picks it up, the analysis is already done, so the job is *confirm and apply*, not
*start from scratch*. That means every filed candidate carries an **otto-cli
implementation guidance** section answering:

1. **Target file(s)** — the actual otto-cli path(s) the change maps to (after the
   rename/restructure), or "no equivalent exists" if the code path is absent.
2. **Divergence** — has otto-cli's version of this code already diverged from
   upstream? Will a clean cherry-pick apply, or is a manual port required?
3. **Concrete edits** — the specific change(s) to make, precise enough to apply
   with confidence.
4. **Verdict** — one of three values, plus any caveats:
   - `cherry-pick` — paths align, applies clean.
   - `manual-port` — diverged / renamed / restructured; needs a hand port.
   - `do-not-port` — superseded or reverted upstream; should NOT be applied.

### The machine-readable `verdict:` line (REQUIRED)

The verdict is not just prose — it drives the issue's `type:*` label. Each
guidance file's **first line** must be a literal, machine-readable verdict:

```
verdict: cherry-pick      # or: manual-port  |  do-not-port
```

`run-audit.mjs` parses this line (`verdict:\s*(cherry-pick|manual-port|do-not-port)`,
backticks optional) and the parsed value is **authoritative** over the
deterministic, risk-based label: `cherry-pick` → `type:cherry-pick-candidate`,
`manual-port` → `type:port-required`, `do-not-port` → `type:do-not-port`. Only
when the line is absent does the script fall back to risk-based labeling
(HIGH → `type:port-required`, else `type:cherry-pick-candidate`). This is why a
commit can be labeled correctly as `type:do-not-port` even though the
deterministic classifier would have called it a cherry-pick candidate — write
the `verdict:` line and the analysis wins. Restate the verdict in a human
heading below if you like; only the first-line form is parsed.

### Two-stage workflow for a real (issue-filing) run

The deterministic scripts cannot perform this analysis — it is genuine per-commit
code reading against the otto-cli tree. So a real run is two stages:

1. **Scan + author guidance.** Run `--dry-run` to get the candidate list. For each
   candidate sha, read the upstream diff (`git -C ../pi show <sha>`), locate the
   otto-cli equivalent, and write the guidance as markdown to
   `.planning/upstream-audits/guidance/<sha7>.md`. Parallelize across subagents
   for large batches. The four guidance points above are the required structure.

2. **File.** Run the orchestrator *without* `--dry-run`. It reads
   `guidance/<sha7>.md` for each candidate, embeds it plus the upstream diff into
   the issue body, and files. Any candidate **missing** a guidance file is filed
   with an explicit "⚠️ Not yet analyzed" banner and `Analyzed | no` in its
   classification table, and the orchestrator prints a count of un-analyzed
   issues at the end. Treat a non-zero un-analyzed count as a gap to fill, not a
   normal outcome.

`--no-diff` suppresses diff embedding (smaller bodies); `--guidance-dir` points
at an alternate guidance directory.

### Context budget: finishing a batch in one context window

A large batch (dozens of candidates) will blow the controller's context if it
authors guidance inline, because every upstream diff and every otto-cli source
read accumulates in the transcript forever. The deterministic scripts are cheap;
the guidance loop is what burns context. Run a batch like this:

1. **Get the candidate list cheaply.** Run
   `run-audit.mjs <upstream> --manifest` and capture its stdout — a compact JSON
   array (`sha`, `severity`, `conflictRisk`, `hasGuidance`, `subject`), a few KB.
   Do NOT read the full human audit report to harvest shas; the manifest exists
   precisely so the controller never pays for the 15-KB report. Filter to
   `hasGuidance: false` — those are the shas still needing analysis.

2. **Delegate all guidance authoring to subagents with a thin return contract.**
   Split the un-analyzed shas into slices and dispatch one subagent per slice
   (`Agent` tool, parallel). Each subagent reads the upstream diffs
   (`git -C <path> show <sha>`) and the otto-cli source *in its own context*,
   writes `.planning/upstream-audits/guidance/<sha7>.md` (first line
   `verdict: …`), and **returns only one line per sha** to the controller:
   `<sha7> <verdict> <target-file-or-"none">`. The controller never sees a diff
   or a source file — only the one-liners. This is the single biggest lever.

3. **Never echo diffs or rendered issue bodies into the conversation.** The
   orchestrator reads and caps diffs (400 lines) itself and embeds them in issue
   bodies; the controller has no reason to `cat` a diff, a guidance file, or a
   filed issue body back into the transcript. Prefer line-ranged reads / `grep`
   over whole-file reads when you must look at something.

4. **File.** Once the manifest shows `hasGuidance: true` across the slice, run
   the orchestrator without `--dry-run`/`--manifest` to file. Re-running
   `--manifest` after authoring is a cheap way to confirm coverage before filing.

## Process

For each invocation, follow these steps in order. Each step invokes a specific script under `.claude/skills/upstream-cherry-pick/scripts/`.

1. **Preflight** — `scripts/preflight.mjs`. If it exits non-zero, print the diagnostics and stop. Do not attempt remediation autonomously beyond the auto-fix actions the script handles internally (label creation, directory creation, state file init).

2. **Parse config + ledger**:
   - `scripts/parse-config.mjs` → in-memory config (compiled regexes)
   - `scripts/parse-ledger.mjs` → `{ heavyFiles, heavyPackages, degraded }` from `docs/UPSTREAM-SYNC.md`

3. **For each upstream in `config.upstreams`** (or only the one specified via CLI arg):

   a. **Read state**: `scripts/state-read.mjs <upstream>` → `{ lastAnalyzedCommit, lastAnalyzedAt, lastReportPath }`. If empty, prompt the user (or read defaults from config) for the starting commit/tag.

   b. **Harvest commits**: `scripts/harvest-commits.mjs <path> <branch> <lastAnalyzedCommit>` → array of commit records.

   c. **For each commit (newest-first)**:

      i. **Classify applicability**: `scripts/classify-applicability.mjs` with config.applicability.notApplicable rules. If NOT_APPLICABLE → append to report's "Not applicable" appendix; skip remaining steps.

      ii. **Classify first-pass severity**: `scripts/classify-severity.mjs` with config.classifier rubric. If SKIP → append to report's skipped appendix; skip remaining steps.

      iii. **Fetch PR/issue context** (per §8.2 fetch policy): for each `#NNN` reference in commit.refs, `scripts/fetch-pr-context.mjs <upstream.ghRepo> <refNum>`. Honor `--no-issue-context` flag to skip this step (results in less-informed classification + bare body in filed issues).

      iv. **Apply context upgrades**: `scripts/apply-context-upgrades.mjs` with first-pass severity + fetched contexts. May upgrade or downgrade (e.g., closed `not-planned` → SKIP).

      v. **Score conflict risk**: `scripts/score-conflict-risk.mjs` with commit.touchedFiles + commit.locByFile + ledger.

      vi. **Build issue payload**: `scripts/build-issue-payload.mjs` with all the above + ccUser from config + the agent-authored `implementationGuidance` (from `guidance/<sha7>.md`) and the upstream `diff`. See "Implementation-grade issues" above — guidance is what makes the issue actionable.

      vii. **Dedup check**: `scripts/dedup-check.mjs <targetRepo> <shaShort>`. If existing issue found, record as "already filed as #N (state=<OPEN|CLOSED>)" in the report; skip step viii.

      viii. **File the issue**: `scripts/file-issue.mjs <targetRepo>` (with `--dry-run` flag, skip this step but still record what would have been filed).

4. **Write report**: `scripts/write-report.mjs <outputDir>` with the accumulated run data → `.planning/upstream-audits/YYYY-MM-DD-<upstream>-audit.md`.

5. **Update state**: `scripts/state-write.mjs <upstream>` with `lastAnalyzedCommit = HEAD of upstream`, `lastAnalyzedAt = now`, `lastReportPath = <report-path>`.

6. **Commit**: stage the state file + report; commit with message `"audit(upstream): <name> scan YYYY-MM-DD (<N> issues filed)"`.

## Judgment calls (NOT scripted — agent decides)

These are the only places the LLM contributes prose. Everything else is deterministic script output.

- **otto-cli implementation guidance (the important one)**: for every candidate that will be filed, perform the per-commit analysis described under "Implementation-grade issues" and write it to `.planning/upstream-audits/guidance/<sha7>.md`. This is what turns an issue from a triage pointer into something the implementation phase can confirm-and-apply. The four required points: target file(s), divergence, concrete edits, and a machine-readable `verdict:` first line (`cherry-pick` | `manual-port` | `do-not-port`) — see "The machine-readable `verdict:` line" above; it drives the issue's `type:*` label. Filing without guidance produces a "⚠️ Not yet analyzed" issue — acceptable only as a deliberate triage-only pass.

- **PR review-thread summarization**: when `fetch-pr-context.mjs` returns a PR with reviews/comments, build-issue-payload.mjs renders a generic "Review highlights" section using only flat label/state info. The agent (controller) may enrich this by reading the fetched JSON and writing a 3-5 line excerpt of the most informative review threads into the issue body BEFORE invoking `scripts/file-issue.mjs`. This is optional — in fully scripted mode (e.g., a scheduled CI run), the payload uses the raw flat info.

- **UNCLASSIFIED commits' "manual triage" notes**: the report lists each unclassified commit. Optionally, the agent may add a one-line note per commit (e.g., "this looks feature-adjacent but in a touched area — may be worth manual review"). Without these notes, the report just lists subjects.

- **Edge case decisions**: cache corruption, unexpected gh errors, partial context fetches. The agent decides whether to abort, retry, or proceed with reduced signal — using the principles documented in §14 of the design spec.

## Outputs

- **GitHub issues** filed on `cmetech/otto-cli` (or whatever `config.targetRepo` is) — one per non-SKIP, APPLICABLE commit, with full labels, embedded otto-cli implementation guidance + upstream diff, and `[sha=<7>]` dedup trailer.
- **Guidance files** at `.planning/upstream-audits/guidance/<sha7>.md` — the agent-authored per-commit otto-cli analysis embedded into each issue.
- **Report file** at `.planning/upstream-audits/YYYY-MM-DD-<upstream>-audit.md`.
- **State file update** at `.planning/upstream-sync-state.json` — advances `lastAnalyzedCommit`.
- **Commit** on the current branch including the report + state file.

## Flags

- `--init` — scaffold config, state, and labels (first run). Calls `scripts/init-scaffold.mjs` (see Task 19).
- `--dry-run` — classify and score everything, write the report, but skip the actual `gh issue create` calls. Useful for previewing what would be filed.
- `--manifest` — classify and score, then print a compact JSON list of file-worthy candidates (`sha`, `severity`, `conflictRisk`, `hasGuidance`, `subject`) to stdout and exit. No diff read, payload build, dedup, report, state advance, or commit. Banners go to stderr so stdout is clean JSON. Single upstream → flat array; all upstreams → object keyed by name. Use it to drive cheap subagent dispatch (see "Context budget" above).
- `--no-issue-context` — skip the linked-PR/issue fetching step. Faster but reduces classifier accuracy.
- `--refresh-cache` — force re-fetch of all PR/issue contexts (bypasses `_cache/`).
- `--from <commit>` — override the starting commit/tag for this run (ignores stored state).
- `--no-commit` — file issues and advance state, but skip the closing git commit.
- `--guidance-dir <dir>` — directory of agent-authored `<sha7>.md` otto-cli analysis files to embed in issues (default `.planning/upstream-audits/guidance`).
- `--no-diff` — do not embed the upstream diff in issue bodies (smaller bodies).

## Background execution

This skill is safe to run as a same-session background subagent (`Agent` tool with `run_in_background: true`). All side effects are durable (gh issues, state file, report file) and the skill is idempotent on re-run thanks to per-issue sha-trailer dedup.

## References

- Design spec: `docs/superpowers/specs/2026-05-29-upstream-cherry-pick-skill-design.md`
- Divergence ledger: `docs/UPSTREAM-SYNC.md`
- Plan: `docs/superpowers/plans/2026-05-29-upstream-cherry-pick-skill.md`
