# Upstream Cherry-Pick Skill — Design Spec

**Status**: Draft for review
**Date**: 2026-05-29
**Owner**: OTTO maintainers
**Repo paths assumed**: `~/code/github.com/cmetech/otto_app/{otto-cli,pi,gsd-pi}`

---

## 1. Problem statement

OTTO is a permanent hard fork of `open-gsd/gsd-pi` @ v1.0.1, which is itself a fork of `earendil-works/pi` (pi-dev). Both upstream rivers continue to evolve:

- **pi-dev** is at v0.78.0 today; very active; most new features and many fixes originate here.
- **gsd-pi** is at v1.0.2 today; 187 commits since OTTO's fork point at v1.0.1; smaller but still receives targeted fixes worth pulling.

Today there is no systematic way to:

1. Discover which upstream commits have landed since OTTO last looked.
2. Decide which of those commits are critical (security, crash, data-loss) and should be applied now.
3. Track nice-to-have fixes and new features so they aren't forgotten.
4. Surface enough context to decide *quickly* — including the original bug report and PR review discussion, not just the commit subject.
5. Account for conflict risk against OTTO's own divergence (already tracked in `docs/UPSTREAM-SYNC.md`).

The result of *not* having this system: critical upstream fixes age in the upstream branch unseen; OTTO carries known regressions; the divergence widens silently.

## 2. Goals

- **G1**. Surface upstream commits with enough context to triage in seconds.
- **G2**. Classify by severity and conflict-risk so triage order is obvious.
- **G3**. Produce a managed backlog (GitHub issues), not an ephemeral report.
- **G4**. Be repeatable, incremental, and idempotent — running the skill twice in a row produces no duplicate issues.
- **G5**. Avoid breaking OTTO's existing customizations: conflict-risk scoring cross-references `UPSTREAM-SYNC.md` so the user sees overlap with diverged files before attempting a cherry-pick.
- **G6**. Fail fast on environment issues (auth, missing tools, missing config) instead of partial runs.

## 3. Non-goals

- **NG1**. Auto-applying cherry-picks. The skill **suggests** the command; the user decides when and how to apply.
- **NG2**. Solving the actual port / cherry-pick workflow for individual issues. That belongs to a future companion skill (working title: `/upstream-port-from-issue <N>`) that owns spec → plan → execute for one cherry-pick at a time.
- **NG3**. Continuous monitoring (cron / GitHub Action). v2 evolution; not in this design.
- **NG4**. Tracking upstream's upstream. The chain is pi-dev → gsd-pi → OTTO; the skill watches the immediate two parents, not pi-dev's own ancestors.

## 4. Architecture

**Skill location**: `.claude/skills/upstream-cherry-pick/SKILL.md`, committed to otto-cli. OTTO-specific knowledge of the two upstreams and their lineage lives in the skill body and supporting config.

**Surface**:

```sh
/upstream-cherry-pick             # audit all configured upstreams
/upstream-cherry-pick <name>      # audit one (e.g. pi-dev, gsd-pi)
/upstream-cherry-pick --init      # scaffold config + state + labels on first install
/upstream-cherry-pick --no-issue-context   # fast scan; skip linked-issue/PR fetching
/upstream-cherry-pick --refresh-cache      # purge .planning/upstream-audits/_cache/ before run
/upstream-cherry-pick --dry-run            # run classifier + scoring, write report; skip gh issue creation
```

### 4.1 Files read / written

| Path | Direction | Purpose |
|---|---|---|
| `.planning/upstream-sync-config.json` | Read | Per-upstream path, branch, labels, gh target repo |
| `.planning/upstream-sync-state.json` | Read + write | Per-upstream `lastAnalyzedCommit` (incremental marker) |
| `docs/UPSTREAM-SYNC.md` | Read | Divergence ledger powering conflict-risk scoring |
| `.planning/upstream-audits/_cache/<repo-slug>/(pr-N\|issue-N).json` | Read + write | Cached upstream PR / issue JSON to avoid re-fetching |
| `.planning/upstream-audits/YYYY-MM-DD-<upstream>-audit.md` | Write | One report per run — directory index of issues filed + skip list |
| GitHub issues on target repo (default `cmetech/otto-cli`) | Write | Auto-filed for every non-SKIP candidate |

### 4.2 Data flow per run

```
/upstream-cherry-pick pi-dev
   ↓
Preflight checks (Section 7) — abort on any required failure
   ↓
Read state file → lastAnalyzedCommit for pi-dev
Read config → upstream path, branch, target gh repo, labels
Read UPSTREAM-SYNC.md → parse divergence ledger into HeavyFiles / HeavyPackages sets
   ↓
Run: git -C <upstream-path> log <lastAnalyzedCommit>..origin/<branch> --no-merges --format=%H
   → returns N candidate commit SHAs (newest first)
   ↓
For each commit (in order):
  • git show <sha> --stat → touched files + LOC
  • Classify by subject/body keywords (first-pass severity, Section 8)
  • Extract #NNN references → fetch PR / issue context (with cache, Section 9)
  • Apply context-driven severity upgrades (third-pass)
  • Score conflict-risk against HeavyFiles / HeavyPackages (Section 10)
  • If SKIP: append to report appendix, continue
  • Else: build issue body, dedup against existing issues, file via gh
   ↓
Write report → .planning/upstream-audits/YYYY-MM-DD-pi-dev-audit.md
Update state file → lastAnalyzedCommit = HEAD of upstream branch
Commit state file + report (single commit, message: "audit(upstream): pi-dev scan YYYY-MM-DD (<N> issues filed)")
```

### 4.3 Idempotency

Two mechanisms:

1. **State file marker** — `lastAnalyzedCommit` per upstream advances only after a successful run; re-running on the same range scans nothing new.
2. **Per-issue dedup** — each filed issue includes `[sha=<7chars>]` in the title and body. Before filing, skill queries `gh issue list --search "sha=<7> in:body" --state all` and skips if any result exists (regardless of open/closed state). This protects against a partial-failure scenario where the state file didn't advance but some issues were filed.

## 5. Config schema

**`.planning/upstream-sync-config.json`** (committed; team-shared):

```json
{
  "version": 1,
  "targetRepo": "cmetech/otto-cli",
  "divergenceLedger": "docs/UPSTREAM-SYNC.md",
  "upstreams": {
    "pi-dev": {
      "path": "../pi",
      "remoteUrl": "https://github.com/earendil-works/pi.git",
      "ghRepo": "earendil-works/pi",
      "branch": "main",
      "label": "earendil-works/pi (pi-dev)"
    },
    "gsd-pi": {
      "path": "../gsd-pi",
      "remoteUrl": "https://github.com/open-gsd/gsd-pi.git",
      "ghRepo": "open-gsd/gsd-pi",
      "branch": "main",
      "label": "open-gsd/gsd-pi"
    }
  },
  "issueFiling": {
    "ccUser": "@claude",
    "defaultStatusLabel": "status:triaged",
    "filePolicy": {
      "CRITICAL_SECURITY": "always",
      "CRITICAL_STABILITY": "always",
      "NICE_TO_HAVE_FIX": "always",
      "FEATURE": "always",
      "SKIP": "never"
    }
  },
  "classifier": {
    "securityRegex": "(?i)\\b(cve|vulnerab|auth\\s*bypass|sandbox\\s*escape|secret\\s*leak|exfiltr|rce|injection|xss|csrf)\\b",
    "stabilityRegex": "(?i)\\b(crash|hang|oom|infinite\\s*loop|data\\s*loss|corrupt|lockup|deadlock|panic|unrecover)\\b",
    "skipPrefixes": ["chore:", "docs:", "test:", "ci:", "style:", "refactor:", "build:"]
  }
}
```

**`.planning/upstream-sync-state.json`** (committed; advances per run):

```json
{
  "version": 1,
  "upstreams": {
    "pi-dev": {
      "lastAnalyzedCommit": "<full sha>",
      "lastAnalyzedAt": "2026-05-29T15:30:00Z",
      "lastReportPath": ".planning/upstream-audits/2026-05-29-pi-dev-audit.md"
    },
    "gsd-pi": { "...": "..." }
  }
}
```

First run for any upstream: state entry is absent. Skill prompts user to seed the starting commit/tag (defaults documented in §13).

## 6. Skill body shape

The SKILL.md is markdown instructions for an LLM agent, following the superpowers-skill convention. Top-level structure:

```
---
name: upstream-cherry-pick
description: Audit OTTO's two upstream forks (pi-dev, gsd-pi) for fixes and
  features worth porting. Files GitHub issues for triage with severity,
  conflict-risk, and upstream context. Use when checking what's new
  upstream or building the cherry-pick backlog.
---

# Upstream Cherry-Pick Audit

## When to use
- "What's new upstream in pi-dev?"
- "Have we missed any gsd-pi fixes since the last sync?"
- "Build me a backlog of cherry-pick candidates."

## Process
1. Preflight (Section 7 of design spec)
2. Load config + state + divergence ledger
3. Harvest commits per upstream
4. Classify + fetch context + score
5. File issues + write report
6. Update state, commit

## Inputs
…

## Outputs
…

## References
- Design spec: docs/superpowers/specs/2026-05-29-upstream-cherry-pick-skill-design.md
- Divergence ledger: docs/UPSTREAM-SYNC.md
```

The implementation detail (regex patterns, label colors, edge cases) lives in this design spec and in the skill body — both the spec and the SKILL.md travel with the code.

## 6.1 Scripted core, agent orchestration (NEW)

Two design principles, applied throughout:

1. **Deterministic mechanical operations live in scripts** under `.claude/skills/upstream-cherry-pick/scripts/`. Each script has a single responsibility, well-defined inputs/outputs (JSON in, JSON out), and is unit-testable in isolation. Behavior is guaranteed identical across runs because the code is the source of truth — no interpretation drift.

2. **Agent prose in SKILL.md is the orchestration layer**: it tells the agent *when* to run which script, *how* to interpret the outputs, and *which decisions require judgment* (e.g., summarizing a PR review thread into a 3-line excerpt, deciding whether an UNCLASSIFIED commit warrants a manual-triage flag with elevated visibility, or recommending a specific cherry-pick approach for a HIGH-conflict-risk port).

### 6.1.1 Script inventory

| Script | Input | Output | Purpose |
|---|---|---|---|
| `preflight.mjs` | (none) | exit code + JSON of pass/fail per check | All §7 preflight checks |
| `parse-config.mjs` | (none, reads config file) | JSON | Parses + validates `.planning/upstream-sync-config.json` (schema, regex compilability, path existence) |
| `parse-ledger.mjs` | (none, reads UPSTREAM-SYNC.md) | JSON `{ heavyFiles: [...], heavyPackages: [...] }` | Single canonical parse of the divergence ledger |
| `state-read.mjs` | `<upstream-name>` | JSON `{ lastAnalyzedCommit, lastAnalyzedAt, lastReportPath }` | Reads state for one upstream |
| `state-write.mjs` | JSON `{ upstream, lastAnalyzedCommit }` | (writes to state file) | Atomic state update |
| `harvest-commits.mjs` | `<upstream-name>` | JSON array of commit objects (sha, subject, body, author, date, touchedFiles, locDelta, refs[]) | Runs `git log` + `git show --numstat`; returns enriched commit records |
| `classify-applicability.mjs` | commit JSON + applicability rules | JSON `{ applicable: bool, ruleId?, reason? }` | Applies §8.0 rules deterministically |
| `classify-severity.mjs` | commit JSON | JSON `{ severity: CRITICAL_SECURITY \| CRITICAL_STABILITY \| FEATURE \| NICE_TO_HAVE_FIX \| SKIP \| UNCLASSIFIED }` | Applies §8.1 first-pass rubric (regex matching) |
| `fetch-pr-context.mjs` | `<upstream-ghRepo> <pr-or-issue-num>` | JSON (cached at `_cache/<slug>/(pr\|issue)-N.json`) | Wraps `gh pr view` / `gh issue view`; idempotent and cache-aware |
| `apply-context-upgrades.mjs` | commit JSON + first-pass severity + PR/issue JSON | JSON `{ severity, upgradeReason? }` | Applies §8.3 third-pass upgrades deterministically (label match, keyword match, state-reason check) |
| `score-conflict-risk.mjs` | commit JSON + ledger JSON | JSON `{ risk: NONE \| LOW \| MEDIUM \| HIGH, reason }` | Applies §10 conflict-risk model |
| `build-issue-payload.mjs` | classification JSON + context JSON | JSON `{ title, body, labels }` | Renders the issue template from §11 |
| `dedup-check.mjs` | `<targetRepo> <sha-short>` | JSON `{ existing: number? \| null, state? }` | Queries `gh issue list --search "sha=<7> in:body"` |
| `file-issue.mjs` | issue payload JSON | JSON `{ number, url }` | `gh issue create` + returns reference |
| `ensure-labels.mjs` | `<targetRepo>` | JSON `{ created: [...], existing: [...] }` | Creates any missing labels from §11.1 taxonomy |
| `write-report.mjs` | run-results JSON | (writes markdown to disk) | Renders §12 report from structured data |

All scripts:
- Are Node ESM (`.mjs`), match the existing OTTO `scripts/` convention.
- Read inputs from argv or stdin, write outputs to stdout, log diagnostics to stderr.
- Exit non-zero on error with a JSON `{ error: "...", details: "..." }` on stderr.
- Are individually unit-testable; fixtures live at `.claude/skills/upstream-cherry-pick/scripts/__fixtures__/`.

### 6.1.2 SKILL.md orchestration layer

The SKILL.md body tells the agent the *flow*, not the *mechanics*:

```markdown
## Process

1. Run `scripts/preflight.mjs`. If it exits non-zero, print the diagnostics
   and stop — do not attempt remediation autonomously beyond auto-fix
   actions (label creation, dir mkdir) which the script handles internally.

2. Parse config (`scripts/parse-config.mjs`) and the divergence ledger
   (`scripts/parse-ledger.mjs`). Hold both as in-memory references for the
   rest of the run.

3. For each upstream in config.upstreams:
   a. Read state (`scripts/state-read.mjs <name>`).
   b. Harvest commits (`scripts/harvest-commits.mjs <name>`).
   c. For each commit (newest-first):
      i.   Classify applicability (`scripts/classify-applicability.mjs`).
           If NOT_APPLICABLE → append to report appendix; continue.
      ii.  Classify first-pass severity (`scripts/classify-severity.mjs`).
           If SKIP → append to skipped appendix; continue.
      iii. For non-SKIP: fetch PR/issue context per fetch policy (§8.2)
           via `scripts/fetch-pr-context.mjs`.
      iv.  Apply context upgrades (`scripts/apply-context-upgrades.mjs`).
      v.   Score conflict risk (`scripts/score-conflict-risk.mjs`).
      vi.  Build issue payload (`scripts/build-issue-payload.mjs`).
      vii. Dedup check (`scripts/dedup-check.mjs`). If existing issue found,
           record as "already filed as #N" and continue.
      viii.File the issue (`scripts/file-issue.mjs`).

4. Write the report (`scripts/write-report.mjs`).
5. Update state (`scripts/state-write.mjs`).
6. Commit state + report with a message of the form
   "audit(upstream): <name> scan YYYY-MM-DD (<N> issues filed)".

## Judgment calls (NOT scripted — agent decides)

- **PR review-thread summarization**: agent reads the fetched JSON and writes
  the 3-5 line "review highlights" block of the issue body. The script
  provides the raw JSON; the agent provides the prose. This is the only
  significant prose-generation point in the flow.

- **UNCLASSIFIED recommendation in the report**: for commits the classifier
  cannot resolve, the agent suggests next steps (e.g., "this looks
  feature-adjacent but is in a touched area — may be worth manual review").

- **Edge cases**: cache corruption, unexpected gh API errors, partial
  context fetches. Agent decides whether to abort, retry, or proceed with
  reduced signal — using the principles documented in §14.

That's it. Everything else is scripts.
```

### 6.1.3 Why this split matters

| Without scripted core | With scripted core |
|---|---|
| Severity regex applied differently each run (agent re-interprets the spec) | Identical regex evaluation; behavior tested |
| Dedup logic re-derived each run | Single dedup query; no false-duplicates |
| Ledger parsing might miss a `### \`<path>\`` heading variant | Parser handles all known forms; new ones caught by fixture tests |
| gh command flags drift over CLI versions | Wrapped in scripts; version pinned and tested |
| Agent context bloated with mechanical detail | Agent context focused on judgment + flow |

### 6.1.4 Test surface implications

§15 (testing strategy) gets two test layers:

1. **Per-script unit tests** in `.claude/skills/upstream-cherry-pick/scripts/__tests__/` — each script has its own test file using fixtures.
2. **Integration test** that runs the full skill flow against a fixture pair of upstream repos (cloned to a tmp dir as part of the test setup), asserts the resulting report markdown matches an expected snapshot, and asserts gh calls were stubbed correctly.

Both run via `npm run test:packages` (existing OTTO test runner) when the skill ships.

## 7. Preflight checks

Skill runs all checks before any commit harvesting. Each failed required check is collected and reported together (not aborted on first failure), so the user fixes everything in one pass.

### 7.1 Required (abort on failure)

| # | Check | Method | Failure message |
|---|---|---|---|
| 1 | `gh` on PATH | `which gh` (POSIX) / `where gh` (Windows) | "gh CLI not found. Install: https://cli.github.com/" |
| 2 | `git` on PATH | `which git` | "git not found on PATH." |
| 3 | Authenticated to `github.com` | `gh auth status --hostname github.com` (exit 0) | "gh not authenticated. Run: `gh auth login`" |
| 4 | Auth has `repo` + `read:org` scopes | `gh auth status` output parsed for scopes | "gh token missing scopes. Run: `gh auth refresh -s repo,read:org`" |
| 5 | Current dir is a git repo | `git rev-parse --git-dir` | "Not inside a git repo. Run this from otto-cli." |
| 6 | `docs/UPSTREAM-SYNC.md` readable | `fs.existsSync` + read | "UPSTREAM-SYNC.md not found. Conflict-risk scoring requires it." |
| 7 | Config file exists | `fs.existsSync(.planning/upstream-sync-config.json)` | "Config not initialized. Run `/upstream-cherry-pick --init`." |
| 8 | Each configured upstream path exists + is a git repo | `fs.existsSync(path) && git -C path rev-parse --git-dir` | "Upstream `<name>` at `<path>` is not a git repo." |
| 9 | Target repo reachable | `gh repo view <targetRepo> --json url --jq .url` | "Cannot reach `<targetRepo>`. Check repo name + scopes." |
| 10 | Per-upstream `gh repo view <ghRepo>` succeeds | as named | "Cannot reach upstream gh repo `<ghRepo>`." |

### 7.2 Soft (auto-fix, log to report)

| Check | Auto-fix |
|---|---|
| Required labels exist on target repo | `gh label create <name> --color <hex> --description "<desc>"` for each missing |
| `.planning/upstream-audits/` dir | `mkdir -p` |
| `.planning/upstream-audits/_cache/` dir | `mkdir -p` |
| State file exists | Initialize with `{ "version": 1, "upstreams": {} }` |

### 7.3 Preflight output

**Failure**:
```
❌ Preflight failed (2):

  1. gh is not authenticated.
     → Run: gh auth login

  2. Upstream `pi-dev` at ../pi is not a git repo.
     → Either clone it (git clone https://github.com/earendil-works/pi.git ../pi)
     → Or update `.planning/upstream-sync-config.json` to remove pi-dev.

After fixing, re-run /upstream-cherry-pick.
```

**Success**:
```
✓ Preflight: 10/10 required checks passed; 2 labels auto-created.
Scanning upstreams: pi-dev (../pi @ origin/main), gsd-pi (../gsd-pi @ origin/main)…
```

### 7.4 `--init` subcommand

`/upstream-cherry-pick --init` runs an interactive scaffold:

1. Prompts for target repo (defaults `cmetech/otto-cli`).
2. For each upstream the user wants to track, prompts for: name, local path, gh repo, branch, and (if no state exists) the starting commit/tag.
3. Writes config + state files.
4. Creates the full label taxonomy on the target repo.
5. Commits the scaffold ("feat(skill): scaffold upstream-cherry-pick config").

## 8. Classifier

Per candidate commit, classifier runs an **applicability pre-pass** followed by three severity passes. Applicability and severity are independent dimensions; both are reported and only the applicable + non-SKIP results become issues.

### 8.0 Applicability pre-pass (NEW)

Before severity classification, the skill decides whether the commit is relevant to OTTO's product surface at all. This is the difference between "we saw it and don't want it" (NOT_APPLICABLE — captured in report) and "we missed it" (which the skill should never do).

The applicability filter is **config-driven** so the OTTO team can tune what we ignore over time without editing the skill body. Patterns live in `.planning/upstream-sync-config.json`:

```json
{
  "applicability": {
    "notApplicable": [
      {
        "id": "bun-distribution",
        "reason": "OTTO decided 2026-05-29 to stay npm-only (CHANGELOG v1.1.0 era discussion). Bun support already exists for install-via-bun users; we don't build or distribute bun binaries.",
        "matchAny": {
          "subjectRegex": "(?i)\\b(bun build|bun --compile|bun upgrade|bun install)\\b",
          "filePathRegex": "(bun\\.config|\\.bunfig|bun-build|/bun/)",
          "labels": ["bun", "distribution:bun"]
        }
      },
      {
        "id": "upstream-ci-only",
        "reason": "Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise.",
        "matchAll": {
          "filePathRegex": "^\\.github/workflows/",
          "subjectRegex": "(?i)\\b(ci|workflow|gha|github\\s*action)\\b"
        }
      },
      {
        "id": "upstream-docs-site",
        "reason": "Changes to upstream's docs site (Astro/Starlight setup, deployment hooks). OTTO doesn't host a docs site; user-facing docs live in CHANGELOG.md and HARNESS-COMPAT.md.",
        "matchAll": {
          "filePathRegex": "^(docs-site|website|astro\\.config|starlight\\.config)/"
        }
      },
      {
        "id": "upstream-release-tooling",
        "reason": "Changes to upstream's release/publish/changelog-generator tooling. OTTO has its own scripts/bump-version.mjs, scripts/sync-release-notes.mjs, etc.",
        "matchAll": {
          "filePathRegex": "^scripts/(release|publish|changelog|bump-)",
          "subjectRegex": "(?i)\\b(release|publish|changelog|version\\s*bump)\\b"
        }
      },
      {
        "id": "upstream-rebrand",
        "reason": "Changes to pi-dev's branding (logo, package names, etc.) that OTTO has already overridden with its own brand pipeline (scripts/sync-brand-colors.mjs).",
        "matchAny": {
          "subjectRegex": "(?i)\\b(rebrand|logo|brand color|package name)\\b",
          "filePathRegex": "(brand-colors|brand\\.config|assets/logo)"
        }
      }
    ]
  }
}
```

**Matching semantics:**

- `matchAny` = at least one of the listed conditions matches → NOT_APPLICABLE
- `matchAll` = every listed condition must match → NOT_APPLICABLE (used for narrower rules)
- `subjectRegex` applies to commit subject + body
- `filePathRegex` applies to every touched file path; rule matches if **every** touched path matches the regex (defensive — if a bun-related commit also touches a real OTTO file, we still see it)
- `labels` applies to PR/issue labels (requires the context fetch from §8.2)

**Decision tree per commit:**

```
git show <sha>
  ↓
Does it match a SKIP prefix (chore/docs/...) or is it a merge commit?
  → YES: severity = SKIP, applicability = N/A
  → NO: continue
  ↓
For each rule in applicability.notApplicable[]:
  → matches according to its matchAll/matchAny semantics?
    → YES: applicability = NOT_APPLICABLE, reason = rule.id + rule.reason
       severity check is skipped; commit goes to report's "Not applicable" appendix
    → NO: try next rule
  ↓
If no rule matched: applicability = APPLICABLE
  → proceed to severity rubric (§8.1–§8.3)
```

**The report appendix** records every NOT_APPLICABLE commit with its matched rule ID and reasoning. This serves two purposes:

1. **Audit trail** — future-you can see "yes, we did consider commit X, and we decided not to track it because of rule Y."
2. **Rule tuning** — if a NOT_APPLICABLE rule starts matching things you actually wanted to track, you'll see them in the appendix and can refine the rule.

**No issue is filed for NOT_APPLICABLE commits.** State file still advances past them so the next run doesn't re-process.

### 8.1 First pass — severity from commit message keywords

### 8.1 First pass — severity from commit message keywords

(Only runs for commits classified APPLICABLE in §8.0.)

Priority order; first match wins:

| Pattern | Severity |
|---|---|
| Subject/body matches `securityRegex` (Section 5) | `CRITICAL_SECURITY` |
| Subject/body matches `stabilityRegex` | `CRITICAL_STABILITY` |
| Subject matches `^feat(\\(.*\\))?:` | `FEATURE` |
| Subject matches `^fix(\\(.*\\))?:` | `NICE_TO_HAVE_FIX` |
| Subject starts with any `skipPrefixes` | `SKIP` |
| Merge commit (`Merge pull request`, `Merge branch`, `Apply PatchDeck`) | `SKIP` |
| Otherwise | `UNCLASSIFIED` |

### 8.2 Second pass — linked PR / issue context fetching

For each commit that is not `SKIP`, the classifier extracts `#NNN` references from subject + body. Each reference is resolved via gh:

1. `gh pr view N --repo <upstream-ghRepo> --json title,body,state,labels,reviews,reviewDecision,closingIssuesReferences --jq .` → if a PR exists, it becomes the primary context object.
2. From the PR, follow `closingIssuesReferences` to fetch each linked issue: `gh issue view M --repo <upstream-ghRepo> --json title,body,state,labels,comments --jq .`.
3. Fall back to `gh issue view N` if the reference is an issue, not a PR.

Results cached at `.planning/upstream-audits/_cache/<repo-slug>/(pr|issue)-N.json`. Cache never expires automatically — use `--refresh-cache` to purge.

**Fetch policy** (avoid 187 sequential gh calls):

| Severity after first pass | Fetch? |
|---|---|
| `CRITICAL_*` | Always — high stakes; want to verify |
| `UNCLASSIFIED` | Always — need more signal |
| `FEATURE` | Always — context goes into the gh issue body for future-you |
| `NICE_TO_HAVE_FIX` with `#NNN` reference | Always (cached) |
| `NICE_TO_HAVE_FIX` without reference | No — rely on commit msg |
| `SKIP` | No |

### 8.3 Third pass — context-driven severity upgrades

Based on fetched PR / issue data:

| Signal | Upgrade |
|---|---|
| Linked issue labels match `(?i)\\b(security\|cve\|vulnerab)\\b` | → `CRITICAL_SECURITY` |
| Linked issue labels match `(?i)\\b(regression\|priority/critical\|p0\|p1\|severity:high\|crash\|data.loss)\\b` | → `CRITICAL_STABILITY` |
| Linked issue body mentions `(production\|users affected\|blocks startup\|unrecoverable\|all users)` | → `CRITICAL_STABILITY` |
| PR labels match `(?i)\\b(hotfix\|backport)\\b` | → `CRITICAL_STABILITY` |
| PR review comments mention `(?i)\\b(backport to|backport this)` | → `CRITICAL_STABILITY` |
| Linked issue state-reason is `not-planned`, `duplicate`, or `wontfix` | → `SKIP` (with note in report) |
| `UNCLASSIFIED` with PR + 2+ approvals + `bug` label | → `NICE_TO_HAVE_FIX` |
| `UNCLASSIFIED` with PR + `enhancement` label | → `FEATURE` |
| `UNCLASSIFIED` with no PR resolution | Remains `UNCLASSIFIED` — listed in report under "needs manual triage" |

## 9. PR review-comment extraction

For each PR fetched in pass 2, the skill also pulls review threads via `gh pr view N --json reviews,comments`:

- **PR description** (often deeper than the merge commit subject — author's full rationale)
- **Approval / changes-requested cycles** — count and order, signal of contentiousness
- **Tests added** — if PR diff includes `*test*` file paths, note "regression coverage exists"
- **Individual review comments** matching `(?i)\\b(regression|breaking|user-facing|affects production|hotfix|backport)\\b`

These get summarized into the "Upstream context" block of the filed issue (template in Section 11).

## 10. Conflict-risk model

The skill parses `docs/UPSTREAM-SYNC.md` once per run to build:

- **HeavyFiles** = set of all file paths appearing under any `### \`<path>\`` heading in the patch log section.
- **HeavyPackages** = packages flagged `Heavy` or `Moderate` in the divergence-status table (today: `packages/pi-coding-agent`, `packages/pi-tui`).

For each candidate commit, the skill enumerates touched files via `git show <sha> --name-only` and assigns a single risk score:

| Condition | Risk |
|---|---|
| No touched file lives under any `packages/pi-*` path | `NONE` |
| Touches `packages/pi-*` but no specific OTTO-edited file | `LOW` |
| Touches at least one file in `HeavyFiles` | `MEDIUM` |
| Touches at least one file in `HeavyFiles` AND the commit modifies >50 LOC in that file (via `git show --numstat`) | `HIGH` |

Risk maps to label and to suggested action:

| Risk | Label | Action |
|---|---|---|
| `NONE` | `conflict-risk:none` | Cherry-pick suggested as `git am -3` |
| `LOW` | `conflict-risk:low` | Cherry-pick suggested as `git am -3` |
| `MEDIUM` | `conflict-risk:medium` | Cherry-pick suggested with note: "may require conflict resolution; see UPSTREAM-SYNC.md entry for `<file>`" |
| `HIGH` | `conflict-risk:high` | `type:port-required`; report says "manual port required, diff: `git -C ../<upstream> show <sha>`" |

## 11. Issue lifecycle & filing

**Applicability is not a label**: per §8.0, NOT_APPLICABLE commits never reach the issue-filing stage. They live in the report appendix only. This keeps the issue backlog clean — every open issue is something we plausibly want to act on.

### 11.1 Label taxonomy

Skill ensures these exist on the target repo via `gh label create` on first run:

| Group | Labels (color hex) | Purpose |
|---|---|---|
| Upstream | `upstream:pi-dev` (#5319e7), `upstream:gsd-pi` (#0052cc) | Source of the commit |
| Type | `type:cherry-pick-candidate` (#0e8a16), `type:port-required` (#d93f0b) | Mechanical vs manual application |
| Severity | `severity:critical-security` (#b60205), `severity:critical-stability` (#d93f0b), `severity:nice-to-have-fix` (#fbca04), `severity:feature` (#0075ca) | Triage priority |
| Conflict-risk | `conflict-risk:none` (#c2e0c6), `conflict-risk:low` (#ddf4ff), `conflict-risk:medium` (#fff5b1), `conflict-risk:high` (#f9d0c4) | Effort signal |
| Status | `status:triaged` (#ededed), `status:in-spec` (#a2eeef), `status:in-plan` (#a2eeef), `status:in-progress` (#1d76db), `status:applied` (#5319e7) | Downstream workflow phases |
| Tag | `claude-pickup` (#7057ff) | Optional opt-in for autonomous Claude handling |

### 11.2 Title pattern

```
[upstream/<name>] <severity-emoji> <commit subject — truncated to 80 chars> [sha=<7>]
```

Examples:
- `[upstream/pi-dev] 🛡️ fix(auth): redact tokens in error envelopes [sha=a3f9c12]`
- `[upstream/gsd-pi] 🐛 fix(issue): Artifact renderers use inconsistent gsdRoot… [sha=03e229d]`
- `[upstream/pi-dev] ✨ feat: named startup sessions via --name flag [sha=0897f17]`

Severity emoji: 🛡️ security, 🐛 stability, 🩹 nice-to-have, ✨ feature.

### 11.3 Issue body template

```markdown
> /cc @claude — auto-filed by `/upstream-cherry-pick`. Severity, labels,
> and conflict-risk are populated below. Pick this up via
> `/upstream-port-from-issue {{N}}` when ready to start the spec → plan →
> execute cycle.

## Classification

| Field | Value |
|---|---|
| Severity | `severity:critical-stability` |
| Conflict risk | `conflict-risk:medium` |
| Action | `type:port-required` — touches HeavyFile `packages/pi-coding-agent/src/core/settings-manager.ts` |
| Upstream | open-gsd/gsd-pi |
| Tracked since | `lastAnalyzedCommit` (2026-05-22) |

## Upstream commit

- **SHA**: `03e229d4b1c9c9a4…`
- **Date**: 2026-05-25
- **Author**: @jeremymcs
- **Subject**: `fix(issue): Artifact renderers use inconsistent gsdRoot vs gsdProjectionRoot…`
- **Body**: (full commit body)

## Upstream context

**PR**: open-gsd/gsd-pi#138 — merged, 2 approvals, 1 change-request cycle
**Linked issue(s)**: open-gsd/gsd-pi#137 — closed, labels: `bug`, `regression`

### Issue #137 — reporter excerpt
> Reproduction: clone, worktree add, cd to subdir, run gsd verify.
> Expected: PASS. Actual: "stale-mirror detected at /weird/path".

### PR #138 — review highlights
- @jeremymcs (reviewer): "Backport to v1.0.x?" → author: "Yes, hits all
  worktree users. Tagging for v1.0.2."
- Regression test added at `test/worktree-render.test.ts`.

### Why this was upgraded to CRITICAL_STABILITY
- Linked issue labeled `regression` → §8.3 upgrade rule
- Maintainer explicitly flagged for backport → §9 review-text upgrade

## Files touched (3)
- `packages/pi-coding-agent/src/core/settings-manager.ts` ⚠️ HeavyFile (see UPSTREAM-SYNC.md)
- `packages/pi-coding-agent/src/core/render-context.ts`
- `test/worktree-render.test.ts`

## Suggested next steps

```sh
# Inspect upstream change
git -C ../gsd-pi show 03e229d

# Attempt cherry-pick (will need conflict resolution on settings-manager.ts)
git -C ../gsd-pi show 03e229d | git -C . am -3

# Or hand off to the port workflow
/upstream-port-from-issue {{N}}
```

---

Auto-filed on 2026-05-29 by the upstream-cherry-pick skill.
Dedup key: `[sha=03e229d]`.
```

### 11.4 Dedup

Before filing, skill runs:

```sh
gh issue list --repo <targetRepo> --search "sha=<7> in:body" --state all --json number,state --jq .
```

If any result: skip filing, log `already filed as #<n> (state=<open|closed>)` in the report.

### 11.5 Status label evolution (designed for downstream workflows)

| Phase | Label | Set by |
|---|---|---|
| Filed | `status:triaged` | `/upstream-cherry-pick` (this skill) |
| Spec written | `status:in-spec` | `/upstream-port-from-issue` (future skill) |
| Plan written | `status:in-plan` | same |
| Implementation in progress | `status:in-progress` | same |
| Cherry-pick applied + verified | `status:applied` | same |
| Issue closed | (status:applied required) | same |

This skill creates issues; future companion skills evolve them.

## 12. Report shape

`.planning/upstream-audits/YYYY-MM-DD-<upstream>-audit.md`:

```markdown
# Upstream audit — <upstream> — 2026-05-29

**Scope**: <lastAnalyzedCommit-shortname> → HEAD (<full sha>)
**Commits scanned**: 187
**Issues filed**: 24
**Not applicable to OTTO**: 18 (matched applicability rules)
**Skipped (mechanical)**: 134 (merge / chore / docs / already filed)
**Unclassified (manual triage)**: 11

## Critical — security (0)

(none)

## Critical — stability (3)

- #1234 — 🐛 [sha=03e229d] fix(issue): Artifact renderers use… — `conflict-risk:medium`
- #1235 — 🐛 [sha=e208fba] fix(issue): Unusuable, unresponsive, fresh install — `conflict-risk:high`
- #1236 — 🐛 [sha=355d835] fix(issue): execute-task re-dispatched after task complete — `conflict-risk:low`

## Nice-to-have fixes (12)

- #1237 — 🩹 [sha=5754851] fix(issue): Unusuable, unresponsive — `conflict-risk:medium`
- (etc.)

## Features (9)

- #1238 — ✨ [sha=86e7d8b] feat: add Cloud MCP Gateway local runtime hybrid — `conflict-risk:low`
- (etc.)

## Unclassified — needs manual triage (11)

- `1f3a92c` — fix: repair descriptor roadmap renders (no PR reference, no clear severity signal)
- (etc.)

## Not applicable to OTTO (18)

These commits were reviewed against the applicability rules in `.planning/upstream-sync-config.json` and intentionally not filed as issues. The rule ID and reasoning are recorded so we can audit (and refine the rules) over time.

| Commit | Subject | Rule | Reason |
|---|---|---|---|
| `a3f9c12` | feat: bun --compile single-binary publish path | `bun-distribution` | OTTO decided 2026-05-29 to stay npm-only. |
| `5e7d234` | ci: parallelize matrix on upstream Actions | `upstream-ci-only` | OTTO's CI lives in cmetech/otto-cli/.github/workflows. |
| `…` | … | … | … |

<details>
<summary>Expand full list</summary>

(all 18 with full subjects)

</details>

## Skipped (152)

Mechanical filter — `chore:` / `docs:` / `test:` / `ci:` / `style:` / `refactor:` / `build:` prefixes plus merge commits and PatchDeck syncs. No applicability or severity judgment made; not filed.

<details>
<summary>Expand</summary>

- `886fa6c` chore: Audit unreleased changelog entries — `SKIP`
- (etc.)

</details>

## Preflight results

- All 10 required checks passed
- Auto-created labels: 0

---

State advanced: `lastAnalyzedCommit` → `dbb9911a` (gsd-pi HEAD as of 2026-05-29).
```

## 13. State persistence & first-run

### 13.1 Subsequent runs

State file's `lastAnalyzedCommit` advances only after a successful run end-to-end (all issues filed, report written). On failure mid-run, state file is *not* updated, so re-running picks up where we left off; per-issue dedup prevents duplicates.

### 13.2 First-run defaults

| Upstream | First-run starting point | Source |
|---|---|---|
| `gsd-pi` | `v1.0.1` (commit `dec23dd…`) | `UPSTREAM-SYNC.md` documents this as the fork point |
| `pi-dev` | `v0.75.4` (commit `3533843d`, 2026-05-20) | Researched fork-time alignment — see derivation below |

**Derivation of the pi-dev default**:

- gsd-pi's `Initial Commit` is `4c87bb3` (2026-05-22 11:58:16 -0500 = 2026-05-22 18:58 +0200). This is the rebrand cutover from pi-dev → gsd-pi.
- pi-dev tags around that moment:

  | Date (UTC+2) | Tag | Note |
  |---|---|---|
  | 2026-05-17 | v0.74.1, v0.75.0 | |
  | 2026-05-18 | v0.75.1, v0.75.2, v0.75.3 | |
  | **2026-05-20 16:11** | **v0.75.4** | **Last release before fork** |
  | 2026-05-22 00:18 | v0.74.2 | Back-port patch on 0.74 line, not on 0.75 trunk |
  | 2026-05-22 18:40 | (main HEAD `9b62f1f8`) | Part of unreleased v0.75.5 work |
  | **2026-05-22 18:58** | **gsd-pi `Initial Commit` `4c87bb3`** | **Fork happens here** |
  | 2026-05-23 12:07 | v0.75.5 | Chronologically post-fork |

- **`v0.75.4` is the safe default**: it's the last tagged pi-dev release before gsd-pi was created. Using v0.75.5 risks missing v0.75.5 changes that gsd-pi had already pulled in at fork time.
- The initial scan from v0.75.4 → v0.78.0 covers ~3 minor versions of pi-dev development (estimate: a few hundred commits, ~40-60 after SKIP filtering). Manageable for one audit run.
- **Trade-off**: slight over-counting is preferable to under-counting. The skill's dedup against already-filed issues will handle any "already-applied" upstream commits gracefully (we'd just see them once, classify, file, and the user closes the issue noting "already in tree").

The `--init` flow still asks the user to confirm; the default value is pre-filled as `v0.75.4` so the user just hits enter unless they have a reason to override.

## 14. Error handling

| Failure mode | Behavior |
|---|---|
| Preflight required check fails | Skill aborts, prints all failures, no state change |
| `gh issue create` fails for one issue | Skill logs the failure with the issue body, continues with next candidate; report includes a "failed to file" section |
| `gh issue list` rate-limited | Skill waits 60s, retries up to 3x, then aborts (state not updated) |
| Upstream `git log` returns empty | Happy no-op: "Up to date. Last scan: <date>, scanned <N> commits." |
| Upstream HEAD has rewound (lastAnalyzedCommit unreachable) | Skill detects via `git merge-base --is-ancestor`, prints warning, asks user whether to reset state |
| `UPSTREAM-SYNC.md` malformed | Skill warns prominently, degrades conflict-risk to `UNKNOWN` for every candidate, continues |
| Network unreachable during context fetch | Skill warns, marks affected commits as "context unavailable", proceeds with reduced signal |

## 15. Testing strategy

### 15.1 Unit-testable functions

- **Applicability filter** — given fixture commits + a fixture applicability rule set, assert correct APPLICABLE / NOT_APPLICABLE outcome with correct rule ID. Cover: each shipped rule (`bun-distribution`, `upstream-ci-only`, `upstream-docs-site`, `upstream-release-tooling`, `upstream-rebrand`); `matchAny` vs `matchAll` semantics; mixed-file commits where some files match the rule and some don't (must be APPLICABLE).
- **Classifier rubric** — given fixture commits (subject + body + files), assert correct severity. Cover: each securityRegex match, each stabilityRegex match, each conventional-commit prefix, merge commits, ambiguous cases.
- **Conflict-risk scorer** — given fixture UPSTREAM-SYNC.md + fixture commit (files + LOC), assert correct risk level for each of NONE / LOW / MEDIUM / HIGH cases.
- **UPSTREAM-SYNC.md parser** — given fixture markdown, assert correct HeavyFiles / HeavyPackages sets.
- **Issue title + body builder** — given a classified commit, assert the rendered title and body match the template (smoke test the dedup key is present).
- **Dedup key extractor** — given an issue body, assert the `[sha=<7>]` is extracted correctly.

### 15.2 Integration tests (manual / fixture-driven)

- **Full first-run dry-run** against fixture upstream paths in `test/fixtures/upstream/`. Asserts: report generated, issues *not* filed (dry-run), state file updated.
- **Idempotency** — run twice, assert second run files zero issues.
- **State-file rollback on failure** — simulate gh failure, assert state file unchanged.

### 15.3 Preflight tests

- Each preflight check has a unit test for its detection logic and its message.

## 16. Open questions

1. **gh-cli scope handling on first run**: `gh auth status` reports scopes for the current token. If the token lacks `repo`, we tell the user to refresh. But OAuth-app auth shows scopes differently than PAT auth — need to verify the parse handles both.
2. **Which target repo for OTTO-team-shared backlog?** The default `cmetech/otto-cli` is the obvious answer but the design assumes a single target. If multiple OTTO downstreams emerge, the config would need `target` per-team.
3. **gh API rate limit headroom on first run**: ~187 gsd-pi commits + ~hundreds of pi-dev commits + maybe 100 PR/issue fetches = within the 5000/hr authenticated limit, but worth tracking. Future enhancement: parallelize fetches with a small concurrency cap.

## 17. Workflow architecture — how the backlog gets worked

This skill emits issues. **Working** the issues — applying the cherry-pick, resolving conflicts, running tests, opening a PR — is a separate scope addressed by other skills and/or external integrations. This section documents the three viable consumption paths and what each requires.

### 17.1 Consumption paths

| Path | How it works | External setup required |
|---|---|---|
| **A. Manual operator** | OTTO team member runs `/upstream-port-from-issue <N>` (future companion skill — §17.3) in a local session. Skill walks them through spec → plan → cherry-pick → verify → status label updates → close. | None beyond this skill. |
| **B. Claude autonomous via GitHub Action** | The `@claude` cc in the issue body triggers Claude Code's GitHub Action when installed on `cmetech/otto-cli`. Claude works the issue inside the CI runner, opens a PR with the cherry-pick, and posts back to the issue. | [Claude Code GitHub Action](https://code.claude.com/docs/en/github-actions) installed on `cmetech/otto-cli` with appropriate Anthropic API credentials in repo secrets. |
| **C. Hybrid** | GH Action handles low-stakes work (`severity:nice-to-have-fix` + `conflict-risk:none/low`). Manual operator handles `severity:critical-*` and `conflict-risk:high`. The `claude-pickup` label is a per-issue opt-in to the autonomous path. | Same as B, plus a label-based workflow filter so the GH Action only acts on opt-in issues. |

### 17.2 Why this skill is unchanged by the choice

The issues this skill files are well-formed for any of the three paths:

- The `@claude` cc is **harmless text** when no GH Action is installed; it just looks like a note in the body.
- All metadata needed by a downstream executor (commit SHA, upstream repo, touched files, conflict risk, PR/issue links) is in the issue body.
- `status:triaged` is the universal entry point; any executor (human or Claude) advances from there.

The OTTO team can defer the path choice until after the first backlog is built. You'll have data to decide.

### 17.3 Companion skill: `/upstream-port-from-issue <N>` (separate spec)

This is a separate design effort and a separate spec. Scope outline (for orientation, not commitment):

- **Inputs**: an issue number filed by this skill.
- **Output**: a PR against `cmetech/otto-cli` with the cherry-pick applied (or a hand-written port for high-conflict cases), test results, and a status-label transition to `status:applied`.
- **Design questions**:
  1. Isolation model — git worktree per port, or in-place branch?
  2. Conflict-resolution flow — when to ask the operator vs attempt automatic 3-way merge.
  3. Test execution — which tests to run (full `test:packages`, or a targeted subset based on touched packages)?
  4. Status label state machine — clear transitions, with safety rails (e.g., can't go `in-progress` → `applied` without test pass).
  5. PR template — how the cherry-pick PR references the source issue and upstream commit.
  6. Multi-commit ports — when one issue corresponds to multiple upstream commits that should be applied together.

When that skill is built, it gets its own spec at `docs/superpowers/specs/YYYY-MM-DD-upstream-port-from-issue-design.md`.

### 17.4 Background execution modes

The skill is well-suited to background execution because it's deterministic, non-interactive after `--init`, I/O-bound on the gh API, and produces durable artifacts (issues + report file). Three flavors of background, each answering a different problem:

| Mode | Mechanism | Skill changes needed | Use when |
|---|---|---|---|
| **Same-session background agent** | Claude Code's `Agent` tool with `run_in_background: true` invokes the skill in a subagent context. Main session keeps going; user is notified on completion. | None — `--no-prompts` flag added for non-interactive runs after first setup (already implied by non-interactive design). | "Run it now, I'll keep working on something else." |
| **Scheduled remote agent** | Claude Code's `/schedule` skill creates a cron-driven remote agent that invokes `/upstream-cherry-pick` autonomously on a cadence. Output lands as issues + report; user reviews when convenient. | Same `--no-prompts` flag; needs a way to default-confirm the pi-dev starting commit during `--init` (since no user is present). | "I want this to keep happening weekly without me thinking about it." |
| **GitHub Actions scheduled workflow** | `.github/workflows/upstream-audit.yml` with a cron trigger runs the skill in CI. Doesn't require Claude Code in the loop at all — the scripted core (§6.1) is just Node, runnable anywhere with `gh` + `git`. | A thin CLI entrypoint at `.claude/skills/upstream-cherry-pick/bin/run.mjs` that invokes the scripts in order without an agent. | "I want this in our team's existing CI infrastructure, not tied to anyone's session." |

**Key design implication**: the skill's scripted core (§6.1) means **none of these modes need an LLM agent**. The agent's only judgment calls (PR review-thread summarization, UNCLASSIFIED recommendations) are nice-to-haves; in agent-free runs, the issue body just omits the prose summary and includes the raw `gh` JSON instead. The team can decide per-mode whether they want the agent prose or not.

**Recommended adoption sequence**:

1. **v1 of skill**: ships with `--init` + interactive run. Operator runs locally; full agent participation.
2. **First convenience win**: same-session background agent. Operator types `/upstream-cherry-pick`, agent runs in background, operator keeps working. No code changes.
3. **First automation win**: scheduled remote agent via `/schedule`. Weekly cadence; produces issues and a report; no operator intervention.
4. **Team-scale win**: GH Actions scheduled workflow. Lives in the repo; team-visible cron schedule; runs without anyone's local session.

Each step is additive. Adopt as the pain of the previous step exceeds the cost of the next.

### 17.5 Claude Code GitHub Action — what it would buy us

Briefly, for context:

- **What it is**: Anthropic's official GitHub Action that runs Claude Code inside a CI workflow, responding to events on the repo (issue opened, `@claude` mentioned in a comment, PR opened).
- **What we'd get**: autonomous work on any issue tagged `claude-pickup` (a label this skill already emits). Claude would read the issue body, fetch the upstream commit, attempt the cherry-pick, run tests, open a PR.
- **What it'd cost**: API usage per autonomous run; some configuration overhead; a workflow file in `.github/workflows/`.
- **Setup not in this spec**: installing it on the repo, choosing the right trigger filters, deciding which severity/conflict-risk combinations are safe for autonomous handling.

If/when the team installs the GH Action, this skill needs **no changes** — the `@claude` cc already in the body becomes the trigger.

## 18. Other future enhancements (post-v1)

- **Scheduled CI run of this skill**: weekly GitHub Action that runs `/upstream-cherry-pick` autonomously and pushes any new issues. Becomes attractive once running it manually feels old. Distinct from the Claude Code GH Action (which works *individual issues*); this one *generates the backlog*.
- **Tier-aware dedup**: if an issue is closed `wontfix`, don't keep re-filing it on every scan; if closed `applied`, don't re-file even if upstream cherry-picks the same commit twice (extends §11.4 dedup with state-aware skip rules).
- **pi-dev → gsd-pi → OTTO triple-hop**: detect when pi-dev has a fix that gsd-pi has already pulled, and report the gsd-pi version (lower conflict risk) instead. Avoids filing two issues for the same logical change.
- **Per-package routing**: a `routing` block in config that automatically applies sub-labels based on which OTTO package the touched files belong to (e.g., `area:subagent`, `area:tui`, `area:theme`).
- **Issue-to-spec auto-link**: if an upstream PR links to a design doc/RFC, surface that link in our issue so the operator/Claude has the full context one click away.

## 19. First-run plan against OTTO's actual upstreams

This is documented in the implementation plan (a separate doc following this spec); the highlights:

- After skill is installed and `--init` is run, the first invocation will:
  - Scan **187 gsd-pi commits** from `v1.0.1` to HEAD
  - Scan **N pi-dev commits** from the user-chosen starting point (TBD at init) to HEAD
  - File ~20–40 issues across the two upstreams (estimate, based on `fix:` / `feat:` ratio in the gsd-pi log)
  - Set the initial backlog the OTTO team works through

---

## Spec self-review

- [x] Placeholder scan: no TBD / TODO except §13.2 first-run choice (correctly marked as user-decided) and §18 (deferred to implementation plan)
- [x] Internal consistency: severity → label → action matrix aligned across §8, §10, §11
- [x] Scope check: focused on the skill design; downstream port workflow explicitly out of scope (§3 NG2)
- [x] Ambiguity check: filePolicy explicit per severity in §5; dedup key explicit in §11.4; preflight failures listed concretely in §7
