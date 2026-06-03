# Plan: Fix excavate-validation gates (anchored citations, less flaky, still accurate)

This plan ports the proven local heuristics from the `mempalace` excavation run into the canonical `otto-cli` implementation.

Context / proof that this works:
- The `mempalace` excavation initially failed Gate 1 repeatedly under strict adjacency rules.
- After adjusting heuristics (anchored citations + tighter normative detection + scoped contradiction checks + assumption counting fixes), Gate 1 and Gate 2 both passed and Stage 7 completed.
- Reference artifacts (in mempalace repo):
  - Gate 1 PASS report: `mempalace/.otto/excavate/raw/specs/gate-1-report.md`
  - Gate 2 PASS report: `mempalace/.otto/excavate/raw/specs/gate-2-report.md`
  - Stage 7 summary: `mempalace/.otto/excavate/raw/specs/stage-7-summary.md`

Also captured in a human-readable fix note:
- `/Users/coreyellis/.agents/skills/excavate-vaildation/FIXES.md` (typo dir name intentional per request)

---

## Goals

1) Reduce false FAILURES (flake) from:
   - valid anchored citations being rejected
   - meta lines containing MUST/SHOULD being misclassified as behavioral claims
   - assumption markers counted inside HTML comments
   - contradiction checks spanning unrelated domains

2) Keep accuracy:
   - still fail for genuinely uncited normative claims
   - still detect real contradictions in user-facing overlap domains

3) Make strictness tunable without editing code (config knobs).

---

## Deliverables

- Update the `excavate-validation` skill and/or verifier implementation used by `gsd-verifier` to implement:
  1) anchored-citation coverage detection (heading-scoped preferred)
  2) normative-line classification improvements
  3) assumption-marker counting that ignores HTML comments
  4) contradiction checks limited to overlap domains
  5) severity levels: BLOCKER vs WARNING vs INFO

- Add/extend tests to prevent regression.

---

## Step-by-step implementation plan

### Step 0 — Locate the implementation points (repo reconnaissance)

1) Find where `excavate-validation` is defined in `otto-cli`:
   - is it a packaged skill under `.agents/skills/` or `.claude/skills/`?
   - is it referenced by name in `src/` (verifier runner)?

2) Find the code that implements Gate 1 / Gate 2 checks:
   - search for: `Gate 1`, `Gate 2`, `anchored`, `uncited_behavioral_lines`, `MUST`, `SHOULD`, `reimplementor test`, `implementation leakage`

3) Identify the interface:
   - is the verifier pure “skill prompt” (LLM-run) or is there a deterministic scanner?
   - this plan assumes there is at least a deterministic scanner or a hybrid of both.

**Output:** list of concrete files + functions to change.

---

### Step 1 — Gate 1 (c): anchored citation coverage detection

**Current problem:** strict adjacency is too brittle.

**Implement:** `is_cited(lineIndex)` returns true if any holds:
- inline `<!-- cite:` on the same line
- on the next non-blank line
- OR within an anchored window of N previous lines **within the same heading scope**

Prefer *heading-scoped anchoring* over a raw `previous 12 lines` heuristic:
- Determine the nearest preceding markdown heading (`^#{1,6} `)
- Only consider citations between that heading and the current line

Fallback: if heading parsing is too complex, keep a conservative window (default `N=12`).

**Also implement meta-line exclusions** (do not count as behavioral claims):
- `**Requirement Level:**` lines
- checklist lines like `Every behavioral claim has a requirement level (MUST/SHOULD/MAY)`

**Config knobs:**
- `anchored_citation_window_lines = 12` (default)
- `anchored_scope = heading | window` (default heading)
- `exclude_meta_normative_lines = true`

---

### Step 2 — Gate 1 (a): contradiction scan scope

**Current problem:** scanning all specs produces false positives.

**Implement:** contradiction checks only for overlap domains:
- CLI surface: flags/commands/exit codes
- Environment variables
- Configuration keys / precedence / defaults

Implementation approach:
- Build a token inventory per domain (e.g. env var names, config keys, CLI options)
- Only compare claims that mention those tokens

**Config knobs:**
- `contradiction_domains = ["cli", "env", "config"]`

---

### Step 3 — Gate 1 (d): assumption marker counting

**Current problem:** counts assumption markers inside HTML comments.

**Implement:** strip/ignore all HTML comments (`<!-- ... -->`) before scanning.

Optionally: count assumptions only in normative blocks (lines that are classified as behavioral claims).

**Config knobs:**
- `ignore_html_comments_for_assumptions = true`
- `assumption_scan_scope = all | behavioral_only` (recommend behavioral_only)

---

### Step 4 — Gate 2 leakage checks (reduce oscillation)

**Problem observed:** Gate 2 “implementation leakage” can falsely flag:
- spec filenames in AC titles
- citations to `.py` files in vectors/ACs

**Implement:**
- Explicitly allow references to *spec artifact filenames* in `**Spec:**` fields.
- Explicitly disallow:
  - `.py` paths
  - `def ` / `class `
  - imports
  - repository-internal paths (e.g. `src/`, `tests/`)

Also add an allowlist for *external contract names* (SQLite, Chroma, Ollama, etc.) so they don’t trigger leakage failures.

**Config knobs:**
- `allowed_external_contract_terms = [...]`
- `allow_spec_links = true`
- `disallow_source_paths = true`

---

### Step 5 — Severity levels (PASS with warnings)

Make gates output:
- `BLOCKER` findings (must fail)
- `WARNING` findings (should not fail, but should be printed)
- `INFO`

Examples:
- BLOCKER: uncited MUST/SHOULD claims
- WARNING: test vector output not exact string (substring match used)

This avoids “unwanted FAILURES” while still preserving correctness.

---

### Step 6 — Regression tests

Add unit tests / golden tests for:
1) anchored-citation block passes when cite is within heading scope
2) meta normative lines are excluded
3) assumption counter ignores HTML comments
4) contradiction scan ignores non-overlap domains
5) leakage checker: `.py` fails, spec links pass

---

## Acceptance criteria for this plan

- A spec set that uses anchored citations (block/section coverage) passes Gate 1(c).
- A spec set with genuinely uncited normative claims fails Gate 1(c).
- Assumption counting is stable (does not change if provenance comments add `confidence=inferred`).
- Contradictions are only flagged when they conflict on CLI/env/config tokens.
- Gate 2 does not fail for spec filename links but does fail for `.py` leakage.
- Gates can PASS with warnings for quality nits.

---

## Suggested execution commands (once code locations are found)

- Search for verifier implementation:
  - `rg -n "Gate 1|Gate 2|uncited|implementation leakage|reimplementor" src packages .claude .otto`

- Run tests:
  - `npm test` or `pnpm test` depending on repo conventions

---

## Notes / gotchas

- The improvements above should be implemented as *deterministic logic* where possible. If some gates are LLM-driven, bake these rules into the prompt and ALSO keep a lightweight deterministic pre-scan to reduce LLM flake.
- Avoid any verifier behavior that requires modifying the user’s spec content to “make it pass”; the verifier should correctly recognize valid structures.
