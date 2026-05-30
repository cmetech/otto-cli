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

      vi. **Build issue payload**: `scripts/build-issue-payload.mjs` with all the above + ccUser from config.

      vii. **Dedup check**: `scripts/dedup-check.mjs <targetRepo> <shaShort>`. If existing issue found, record as "already filed as #N (state=<OPEN|CLOSED>)" in the report; skip step viii.

      viii. **File the issue**: `scripts/file-issue.mjs <targetRepo>` (with `--dry-run` flag, skip this step but still record what would have been filed).

4. **Write report**: `scripts/write-report.mjs <outputDir>` with the accumulated run data → `.planning/upstream-audits/YYYY-MM-DD-<upstream>-audit.md`.

5. **Update state**: `scripts/state-write.mjs <upstream>` with `lastAnalyzedCommit = HEAD of upstream`, `lastAnalyzedAt = now`, `lastReportPath = <report-path>`.

6. **Commit**: stage the state file + report; commit with message `"audit(upstream): <name> scan YYYY-MM-DD (<N> issues filed)"`.

## Judgment calls (NOT scripted — agent decides)

These are the only places the LLM contributes prose. Everything else is deterministic script output.

- **PR review-thread summarization**: when `fetch-pr-context.mjs` returns a PR with reviews/comments, build-issue-payload.mjs renders a generic "Review highlights" section using only flat label/state info. The agent (controller) may enrich this by reading the fetched JSON and writing a 3-5 line excerpt of the most informative review threads into the issue body BEFORE invoking `scripts/file-issue.mjs`. This is optional — in fully scripted mode (e.g., a scheduled CI run), the payload uses the raw flat info.

- **UNCLASSIFIED commits' "manual triage" notes**: the report lists each unclassified commit. Optionally, the agent may add a one-line note per commit (e.g., "this looks feature-adjacent but in a touched area — may be worth manual review"). Without these notes, the report just lists subjects.

- **Edge case decisions**: cache corruption, unexpected gh errors, partial context fetches. The agent decides whether to abort, retry, or proceed with reduced signal — using the principles documented in §14 of the design spec.

## Outputs

- **GitHub issues** filed on `cmetech/otto-cli` (or whatever `config.targetRepo` is) — one per non-SKIP, APPLICABLE commit, with full labels and `[sha=<7>]` dedup trailer.
- **Report file** at `.planning/upstream-audits/YYYY-MM-DD-<upstream>-audit.md`.
- **State file update** at `.planning/upstream-sync-state.json` — advances `lastAnalyzedCommit`.
- **Commit** on the current branch including the report + state file.

## Flags

- `--init` — scaffold config, state, and labels (first run). Calls `scripts/init-scaffold.mjs` (see Task 19).
- `--dry-run` — classify and score everything, write the report, but skip the actual `gh issue create` calls. Useful for previewing what would be filed.
- `--no-issue-context` — skip the linked-PR/issue fetching step. Faster but reduces classifier accuracy.
- `--refresh-cache` — force re-fetch of all PR/issue contexts (bypasses `_cache/`).

## Background execution

This skill is safe to run as a same-session background subagent (`Agent` tool with `run_in_background: true`). All side effects are durable (gh issues, state file, report file) and the skill is idempotent on re-run thanks to per-issue sha-trailer dedup.

## References

- Design spec: `docs/superpowers/specs/2026-05-29-upstream-cherry-pick-skill-design.md`
- Divergence ledger: `docs/UPSTREAM-SYNC.md`
- Plan: `docs/superpowers/plans/2026-05-29-upstream-cherry-pick-skill.md`
