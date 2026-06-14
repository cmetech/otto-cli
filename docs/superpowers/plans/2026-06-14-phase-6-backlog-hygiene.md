# Phase 6 — Backlog Hygiene (Supersession Sweep + Alignment Fit-Check) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `/upstream-cherry-pick` with (a) a deterministic Class-A supersession sweep that tags stale open issues `status:superseded` with evidence, and (b) an `alignment:{core,adjacent,out-of-scope}` fit-check for feature candidates against `docs/OTTO-ALIGNMENT.md` — both tag-and-explain, never auto-close — plus teaching the pipeline `role: lineage|inspiration` per upstream.

**Architecture:** Pure decision modules with dependency-injected git/gh runners (the established pattern from Phases 2–5). New shared `alignment.mjs` helper (mirrors `_common/scripts/fix-strategy.mjs`). New `supersession-check.mjs` (Class-A detectors), `sweep-backlog.mjs` (orchestrator, DI gh/git/issue-updater), and `write-sweep-report.mjs` (§4 report). The `core/adjacent/out-of-scope` verdict and backlog alignment re-check are **agent-judged** (like guidance authoring); scripts provide taxonomy, parsing, rendering, label application, and the harness that collects which issues need a human/agent verdict.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, `gh`/`git` via injected runners. Canonical test suite: `node .claude/skills/_common/scripts/run-skill-tests.mjs` (baseline **409** green).

**Resolved decision:** `rewritten` is **advisory-only** (reported, never auto-tags `status:superseded`). Only `reverted` + `upstream-closed` auto-tag.

**Conventions for every task:**
- Editing `.claude/skills/` trips the self-modification block; the user has authorized it. Stage skill files with `git add -f <path>`.
- Branch: `feat/upstream-phase-6` (create once, before Task 1).
- After each task's implementation, run the canonical suite and confirm the new green total before committing.

---

## File Structure

**New files:**
- `.claude/skills/_common/scripts/alignment.mjs` — canonical alignment taxonomy + helpers (verdicts, label mapping, `parseAlignment`, `isFeatureSeverity`). Shared (cherry-pick now; swarm later).
- `.claude/skills/_common/scripts/__tests__/alignment.test.mjs`
- `.claude/skills/upstream-cherry-pick/scripts/supersession-check.mjs` — Class-A detectors (`detectReverted`, `detectRewritten`, `detectUpstreamClosed`, `checkSupersession`), DI git, pure decision.
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/supersession-check.test.mjs`
- `.claude/skills/upstream-cherry-pick/scripts/write-sweep-report.mjs` — §4 sweep report renderer.
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/write-sweep-report.test.mjs`
- `.claude/skills/upstream-cherry-pick/scripts/sweep-backlog.mjs` — sweep orchestrator (DI gh/git/fetchContext/issueUpdater).
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/sweep-backlog.test.mjs`

**Modified files:**
- `.claude/skills/upstream-cherry-pick/scripts/ensure-labels.mjs` — taxonomy 23 → **27** (1 `status:superseded` + 3 `alignment:*`).
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/ensure-labels.test.mjs` — count assertions.
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs` — `createCalls` 23 → 27; role assertions (Task 4).
- `.claude/skills/upstream-cherry-pick/scripts/parse-config.mjs` — `role` default per upstream.
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/parse-config.test.mjs`
- `.claude/skills/upstream-cherry-pick/scripts/__fixtures__/config.valid.json` — add `role` to one upstream.
- `.claude/skills/upstream-cherry-pick/scripts/init-scaffold.mjs` — `role` on lineage defaults + seed 3 `role:inspiration` repos.
- `.claude/skills/upstream-cherry-pick/scripts/parse-guidance.mjs` — optional Alignment parse (exposes `alignment`).
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/parse-guidance.test.mjs`
- `.claude/skills/upstream-cherry-pick/scripts/build-issue-payload.mjs` — render Alignment heading + apply `alignment:*` label (feature-gated).
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/build-issue-payload.test.mjs`
- `.claude/skills/upstream-cherry-pick/scripts/run-audit.mjs` — lineage-only iteration + inspiration guard + file-time feature alignment + `--sweep` wiring.
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-sweep.test.mjs` (new test file for run-audit's new exports).
- `.claude/skills/upstream-cherry-pick/SKILL.md` — document roles, the sweep, the fit-check, lineage/inspiration rule.

---

## Task 0: Create the branch

- [ ] **Step 1: Create and switch to the feature branch**

Run:
```bash
git checkout -b feat/upstream-phase-6
git branch --show-current
```
Expected: prints `feat/upstream-phase-6`.

- [ ] **Step 2: Confirm the baseline suite is green**

Run:
```bash
node .claude/skills/_common/scripts/run-skill-tests.mjs 2>&1 | grep -E "^# (tests|pass|fail)"
```
Expected: `# tests 409`, `# pass 409`, `# fail 0`.

---

## Task 1: Shared alignment taxonomy helper

**Files:**
- Create: `.claude/skills/_common/scripts/alignment.mjs`
- Test: `.claude/skills/_common/scripts/__tests__/alignment.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/_common/scripts/__tests__/alignment.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALIGNMENT_VERDICTS,
  ALIGNMENT_LABELS,
  isAlignmentVerdict,
  alignmentToLabel,
  alignmentFromLabels,
  parseAlignment,
  isFeatureSeverity,
} from "../alignment.mjs";

test("the three verdicts and their labels are canonical", () => {
  assert.deepEqual(ALIGNMENT_VERDICTS, ["core", "adjacent", "out-of-scope"]);
  assert.deepEqual(ALIGNMENT_LABELS, [
    "alignment:core",
    "alignment:adjacent",
    "alignment:out-of-scope",
  ]);
});

test("isAlignmentVerdict / alignmentToLabel reject junk", () => {
  assert.equal(isAlignmentVerdict("core"), true);
  assert.equal(isAlignmentVerdict("nope"), false);
  assert.equal(alignmentToLabel("adjacent"), "alignment:adjacent");
  assert.equal(alignmentToLabel("nope"), null);
});

test("alignmentFromLabels extracts the verdict from string or object labels", () => {
  assert.equal(alignmentFromLabels(["upstream:pi-dev", "alignment:out-of-scope"]), "out-of-scope");
  assert.equal(alignmentFromLabels([{ name: "alignment:core" }]), "core");
  assert.equal(alignmentFromLabels(["severity:feature"]), null);
  assert.equal(alignmentFromLabels([{ name: "alignment:bogus" }]), null);
});

test("parseAlignment reads an `alignment:` line anywhere, case-insensitively", () => {
  assert.equal(parseAlignment("alignment: core").alignment, "core");
  assert.equal(
    parseAlignment("## Alignment\n\nAlignment: `adjacent`\n\nReason: ...").alignment,
    "adjacent",
  );
  assert.equal(parseAlignment("strategy: adapted-port\n\nno alignment here").alignment, null);
  assert.equal(parseAlignment(null).alignment, null);
  assert.equal(parseAlignment("alignment: maybe").alignment, null);
});

test("isFeatureSeverity matches FEATURE case-insensitively only", () => {
  assert.equal(isFeatureSeverity("FEATURE"), true);
  assert.equal(isFeatureSeverity("feature"), true);
  assert.equal(isFeatureSeverity("NICE_TO_HAVE_FIX"), false);
  assert.equal(isFeatureSeverity(null), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node --test .claude/skills/_common/scripts/__tests__/alignment.test.mjs
```
Expected: FAIL — cannot find module `../alignment.mjs`.

- [ ] **Step 3: Write the implementation**

Create `.claude/skills/_common/scripts/alignment.mjs`:
```js
#!/usr/bin/env node
/**
 * alignment.mjs — canonical OTTO-ALIGNMENT fit-check taxonomy.
 *
 * Phase 6 of the upstream pipeline. A NEW FEATURE candidate from a lineage repo
 * is classified against docs/OTTO-ALIGNMENT.md §5 as one of three verdicts. The
 * verdict itself is AGENT-JUDGED (genuine reading of the alignment doc, like
 * guidance authoring) — this module is the single source of truth for the
 * taxonomy, its label mapping, the guidance-line parser, and the feature gate.
 * Imported by cherry-pick (parse-guidance, build-issue-payload, run-audit) and,
 * later, the swarm — never re-declare these constants elsewhere.
 *
 * Bug/stability/security/perf/correctness/dependency fixes are ALWAYS ported —
 * alignment is N/A for them (see isFeatureSeverity gate).
 */

/** The three alignment verdicts, in canonical order. */
export const ALIGNMENT_VERDICTS = ["core", "adjacent", "out-of-scope"];

/** Namespaced GitHub labels, one per verdict. */
export const ALIGNMENT_LABELS = ALIGNMENT_VERDICTS.map((v) => `alignment:${v}`);

/** @returns {boolean} whether `v` is one of the three canonical verdicts. */
export function isAlignmentVerdict(v) {
  return ALIGNMENT_VERDICTS.includes(v);
}

/** @returns {string|null} `alignment:<v>` label, or null if `v` is invalid. */
export function alignmentToLabel(v) {
  return isAlignmentVerdict(v) ? `alignment:${v}` : null;
}

/**
 * Extract the verdict from an issue's labels.
 * @param {Array<string|{name:string}>} labels
 * @returns {string|null}
 */
export function alignmentFromLabels(labels = []) {
  for (const l of labels) {
    const name = typeof l === "string" ? l : l?.name;
    if (name && name.startsWith("alignment:")) {
      const v = name.slice("alignment:".length);
      if (isAlignmentVerdict(v)) return v;
    }
  }
  return null;
}

/**
 * Parse the machine-readable alignment verdict from a guidance file's optional
 * Alignment section. Matches an `alignment: <core|adjacent|out-of-scope>` line
 * anywhere (backticks ok), case-insensitive.
 * @param {string|null} text
 * @returns {{alignment: string|null}}
 */
export function parseAlignment(text) {
  if (!text) return { alignment: null };
  const m = text.match(/^\s*alignment:\s*`?(core|adjacent|out-of-scope)`?/im);
  if (m && isAlignmentVerdict(m[1].toLowerCase())) {
    return { alignment: m[1].toLowerCase() };
  }
  return { alignment: null };
}

/**
 * The feature gate: alignment applies ONLY to feature-severity candidates.
 * @param {string} severity - the classifier severity (e.g. "FEATURE")
 * @returns {boolean}
 */
export function isFeatureSeverity(severity) {
  return typeof severity === "string" && severity.toUpperCase() === "FEATURE";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
node --test .claude/skills/_common/scripts/__tests__/alignment.test.mjs
```
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/_common/scripts/alignment.mjs .claude/skills/_common/scripts/__tests__/alignment.test.mjs
git commit -m "feat(upstream): shared alignment taxonomy helper (Phase 6 §3)"
```

---

## Task 2: Extend the label taxonomy 23 → 27

**Files:**
- Modify: `.claude/skills/upstream-cherry-pick/scripts/ensure-labels.mjs`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/ensure-labels.test.mjs`
- Test (count fix): `.claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs`

- [ ] **Step 1: Write the failing test additions**

In `.claude/skills/upstream-cherry-pick/scripts/__tests__/ensure-labels.test.mjs`, update the three count assertions and add a new test. First, change the two affected numbers in the existing tests:

In `"creates missing labels and reports existing"`: change `assert.equal(result.created.length, 21);` → `assert.equal(result.created.length, 25);` and `assert.equal(createCalls.length, 21);` → `assert.equal(createCalls.length, 25);` and the comment `// 23 total - 2 existing` → `// 27 total - 2 existing`.

In `"captures create errors without aborting"`: change `assert.equal(result.created.length, 22); // 23 - 1 failed` → `assert.equal(result.created.length, 26); // 27 - 1 failed`.

In `"returns all-existing when every label is present"`: append the four new labels to the `all` array (after `"claude-pickup",`):
```js
    "claude-pickup",
    "status:superseded",
    "alignment:core", "alignment:adjacent", "alignment:out-of-scope",
```
and change `assert.equal(result.existing.length, 23);` → `assert.equal(result.existing.length, 27);`.

Then append this new test to the end of the file:
```js
test("taxonomy includes status:superseded and the three alignment:* labels", async () => {
  const created = [];
  const ghRunner = (args) => {
    if (args[0] === "label" && args[1] === "list") return "";
    if (args[0] === "label" && args[1] === "create") { created.push(args[2]); return ""; }
    return "";
  };
  await ensureLabels({ targetRepo: "cmetech/otto-cli", ghRunner });
  for (const name of [
    "status:superseded",
    "alignment:core",
    "alignment:adjacent",
    "alignment:out-of-scope",
  ]) {
    assert.ok(created.includes(name), `expected ${name} to be created`);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/ensure-labels.test.mjs
```
Expected: FAIL — module throws `LABEL_TAXONOMY must have exactly 23 entries` only if you edited the guard first; otherwise count assertions fail (25 ≠ 23). Either way, red.

- [ ] **Step 3: Add the four labels and bump the guard**

In `.claude/skills/upstream-cherry-pick/scripts/ensure-labels.mjs`, add the new labels inside `LABEL_TAXONOMY`. Insert the `status:superseded` entry immediately after the `status:applied` line:
```js
  { name: "status:applied", color: "5319e7", description: "Cherry-pick or port applied" },
  { name: "status:superseded", color: "cfd3d7", description: "Stale — reverted/closed upstream; do not port (Phase 6 sweep)" },
```
Then add the three alignment labels immediately after the `claude-pickup` line (before the closing `];`):
```js
  { name: "claude-pickup", color: "7057ff", description: "Opt-in for autonomous Claude handling" },
  // Alignment (OTTO-ALIGNMENT.md fit-check; feature candidates only — Phase 6 §3)
  { name: "alignment:core", color: "0e8a16", description: "Advances the co-worker direction — port (OTTO-ALIGNMENT §5)" },
  { name: "alignment:adjacent", color: "fbca04", description: "Useful but off the critical path — defer (OTTO-ALIGNMENT §5)" },
  { name: "alignment:out-of-scope", color: "e11d21", description: "Coding-assistant-only or ethos-conflicting — surface for a human (OTTO-ALIGNMENT §5)" },
```
Then update the sanity guard:
```js
if (LABEL_TAXONOMY.length !== 27) {
  throw new Error(
    `LABEL_TAXONOMY must have exactly 27 entries, found ${LABEL_TAXONOMY.length}`,
  );
}
```

- [ ] **Step 4: Fix the init-scaffold count assertion (same suite, keep it green)**

In `.claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs`, in the test `"nonInteractive writes config + state + creates labels"`, change:
```js
    const createCalls = ghCalls.filter((a) => a[0] === "label" && a[1] === "create");
    assert.equal(createCalls.length, 23);
```
to:
```js
    const createCalls = ghCalls.filter((a) => a[0] === "label" && a[1] === "create");
    assert.equal(createCalls.length, 27);
```

- [ ] **Step 5: Run both test files to verify they pass**

Run:
```bash
node --test \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/ensure-labels.test.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/ensure-labels.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/ensure-labels.test.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs
git commit -m "feat(upstream): add status:superseded + alignment:* labels (taxonomy 23→27)"
```

---

## Task 3: `role` field in parse-config

**Files:**
- Modify: `.claude/skills/upstream-cherry-pick/scripts/parse-config.mjs:49-60`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/parse-config.test.mjs`
- Fixture: `.claude/skills/upstream-cherry-pick/scripts/__fixtures__/config.valid.json`

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/upstream-cherry-pick/scripts/__tests__/parse-config.test.mjs`:
```js
test("parseConfig defaults absent role to lineage and preserves an explicit role", () => {
  const tmpPath = join(__dirname, "..", "__fixtures__", "_tmp-roles.json");
  writeFileSync(
    tmpPath,
    JSON.stringify({
      version: 1,
      targetRepo: "cmetech/otto-cli",
      upstreams: {
        "pi-dev": { path: "../pi", ghRepo: "earendil-works/pi", branch: "main" },
        "hermes-agent": { path: "../hermes-agent", ghRepo: "inspiration/hermes-agent", role: "inspiration" },
      },
      classifier: { securityRegex: ".", stabilityRegex: ".", skipPrefixes: [] },
    }),
  );
  try {
    const cfg = parseConfig(tmpPath);
    assert.equal(cfg.upstreams["pi-dev"].role, "lineage"); // back-compat default
    assert.equal(cfg.upstreams["hermes-agent"].role, "inspiration");
  } finally {
    unlinkSync(tmpPath);
  }
});

test("parseConfig rejects an unknown role value", () => {
  const tmpPath = join(__dirname, "..", "__fixtures__", "_tmp-bad-role.json");
  writeFileSync(
    tmpPath,
    JSON.stringify({
      version: 1,
      targetRepo: "cmetech/otto-cli",
      upstreams: { "x": { path: "../x", ghRepo: "a/b", role: "bogus" } },
      classifier: { securityRegex: ".", stabilityRegex: ".", skipPrefixes: [] },
    }),
  );
  try {
    assert.throws(() => parseConfig(tmpPath), /role.*lineage.*inspiration|invalid role/i);
  } finally {
    unlinkSync(tmpPath);
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/parse-config.test.mjs
```
Expected: FAIL — `role` is `undefined` (no default) and the bad-role case does not throw.

- [ ] **Step 3: Add role validation + default**

In `.claude/skills/upstream-cherry-pick/scripts/parse-config.mjs`, inside the `for (const [name, u] of Object.entries(raw.upstreams))` loop, after the `u.label ??= u.ghRepo;` line, add:
```js
      u.branch ??= "main";
      u.label ??= u.ghRepo;
      u.role ??= "lineage";
      if (u.role !== "lineage" && u.role !== "inspiration") {
        throw new Error(
          `upstream ${name}: invalid role "${u.role}" (must be "lineage" or "inspiration")`,
        );
      }
```
(Replace the existing two `??=` lines with this block.)

- [ ] **Step 4: Add `role` to the fixture**

In `.claude/skills/upstream-cherry-pick/scripts/__fixtures__/config.valid.json`, add `"role": "lineage"` to the `pi-dev` upstream object (after `"label": ...`):
```json
    "pi-dev": {
      "path": "../pi",
      "remoteUrl": "https://github.com/earendil-works/pi.git",
      "ghRepo": "earendil-works/pi",
      "branch": "main",
      "label": "earendil-works/pi (pi-dev)",
      "role": "lineage"
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/parse-config.test.mjs
```
Expected: PASS (existing + 2 new tests).

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/parse-config.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/parse-config.test.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__fixtures__/config.valid.json
git commit -m "feat(upstream): role:lineage|inspiration per upstream in parse-config"
```

---

## Task 4: Seed roles + inspiration repos in init-scaffold

**Files:**
- Modify: `.claude/skills/upstream-cherry-pick/scripts/init-scaffold.mjs:28-41,170-186`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs`:
```js
test("nonInteractive seeds lineage roles and the three inspiration repos", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-init-"));
  try {
    const result = await initScaffold({ cwd: dir, nonInteractive: true, ghRunner: () => "" });
    const cfg = JSON.parse(readFileSync(result.configPath, "utf-8"));
    // Lineage repos carry an explicit role
    assert.equal(cfg.upstreams["pi-dev"].role, "lineage");
    assert.equal(cfg.upstreams["gsd-pi"].role, "lineage");
    // Inspiration repos are registered, reference-only
    assert.equal(cfg.upstreams["hermes-agent"].role, "inspiration");
    assert.equal(cfg.upstreams["anton"].role, "inspiration");
    assert.equal(cfg.upstreams["mempalace"].role, "inspiration");
    // State seeds lineage commits only — inspiration repos are not audited
    const state = JSON.parse(readFileSync(result.statePath, "utf-8"));
    assert.ok(state.upstreams["pi-dev"]);
    assert.ok(state.upstreams["gsd-pi"]);
    assert.equal(state.upstreams["hermes-agent"], undefined);
    assert.equal(state.upstreams["anton"], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs
```
Expected: FAIL — `cfg.upstreams["pi-dev"].role` is `undefined`; `hermes-agent` absent.

- [ ] **Step 3: Add roles to lineage defaults + a DEFAULT_INSPIRATION constant**

In `.claude/skills/upstream-cherry-pick/scripts/init-scaffold.mjs`, add `role: "lineage"` to each entry of `DEFAULT_UPSTREAMS`:
```js
const DEFAULT_UPSTREAMS = {
  "pi-dev": {
    path: "../pi",
    ghRepo: "earendil-works/pi",
    branch: "main",
    label: "earendil-works/pi (pi-dev)",
    role: "lineage",
  },
  "gsd-pi": {
    path: "../gsd-pi",
    ghRepo: "open-gsd/gsd-pi",
    branch: "main",
    label: "open-gsd/gsd-pi",
    role: "lineage",
  },
};

// Reference-only sibling repos (OTTO-ALIGNMENT.md §4): cloned locally so
// subagents can read their source while DESIGNING a co-worker feature, but
// NEVER audited and NEVER cherry-picked. ghRepo is registration-only (these are
// never gh-queried). Anton is AGPL-3.0 — reimplement the concept, don't vendor.
const DEFAULT_INSPIRATION = {
  "hermes-agent": {
    path: "../hermes-agent",
    ghRepo: "inspiration/hermes-agent",
    branch: "main",
    label: "Nous Research / hermes-agent (inspiration)",
    role: "inspiration",
  },
  "anton": {
    path: "../anton",
    ghRepo: "mindsdb/anton",
    branch: "main",
    label: "MindsDB / anton (inspiration — AGPL-3.0, reimplement)",
    role: "inspiration",
  },
  "mempalace": {
    path: "../mempalace",
    ghRepo: "inspiration/mempalace",
    branch: "main",
    label: "mempalace (inspiration)",
    role: "inspiration",
  },
};
```

- [ ] **Step 4: Merge inspiration repos into the non-interactive config**

In the `if (nonInteractive)` branch of `initScaffold`, change the `upstreams` assignment to include inspiration repos:
```js
    config = {
      version: 1,
      targetRepo: DEFAULT_TARGET_REPO,
      divergenceLedger: DEFAULT_DIVERGENCE_LEDGER,
      upstreams: { ...DEFAULT_UPSTREAMS, ...DEFAULT_INSPIRATION },
      issueFiling: DEFAULT_ISSUE_FILING,
      classifier: DEFAULT_CLASSIFIER,
      applicability: {
        notApplicable: DEFAULT_NOT_APPLICABLE,
      },
    };
```
The `stateUpstreams` loop already iterates `DEFAULT_STARTING_COMMITS` (lineage-only: `pi-dev`, `gsd-pi`), so inspiration repos correctly get no state entry — no change needed there.

In the **interactive** branch, after the loop that asks about each `DEFAULT_UPSTREAMS` entry and before the "Add another upstream?" loop, merge the inspiration defaults so they are always registered:
```js
      // Always register the reference-only inspiration repos (not prompted —
      // they are never audited; the user can delete entries from the config).
      for (const [name, defaults] of Object.entries(DEFAULT_INSPIRATION)) {
        upstreams[name] = { ...defaults };
      }
```
(Insert this immediately after the `for (const [name, defaults] of Object.entries(DEFAULT_UPSTREAMS))` block closes, before `// Ask whether to add more upstreams`.)

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs
```
Expected: PASS (existing + new role/inspiration test). Note: the existing `"interactive uses promptUser injection"` test only checks that a target prompt fired — adding inspiration repos unconditionally does not break it.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/init-scaffold.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs
git commit -m "feat(upstream): seed role + 3 inspiration repos in init-scaffold (Phase 6 §1)"
```

---

## Task 5: Optional Alignment parse in parse-guidance

**Files:**
- Modify: `.claude/skills/upstream-cherry-pick/scripts/parse-guidance.mjs`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/parse-guidance.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/upstream-cherry-pick/scripts/__tests__/parse-guidance.test.mjs`:
```js
test("validateGuidance exposes an optional alignment verdict when present", () => {
  const withAlignment = FULL
    .replace("strategy: essence-reimplement", "strategy: adapted-port")
    .replace(/\*\*Essence to preserve:\*\* .*/i, "Transcribe the guard.")
    + "\n## Alignment\n\nalignment: adjacent\n\nReason: no current persona home.\n";
  const r = validateGuidance(withAlignment, { path: "g/x.md" });
  assert.equal(r.valid, true, `errors: ${r.errors}`);
  assert.equal(r.alignment, "adjacent");
});

test("validateGuidance leaves alignment null when no Alignment section exists", () => {
  const r = validateGuidance(FULL, { path: "g/x.md" });
  assert.equal(r.alignment, null);
  // alignment is OPTIONAL — its absence is not a validation error
  assert.equal(r.valid, true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/parse-guidance.test.mjs
```
Expected: FAIL — `r.alignment` is `undefined`.

- [ ] **Step 3: Wire parseAlignment into validateGuidance**

In `.claude/skills/upstream-cherry-pick/scripts/parse-guidance.mjs`, add the import at the top (next to the existing fix-strategy import):
```js
import { parseStrategy } from "../../_common/scripts/fix-strategy.mjs";
import { parseAlignment } from "../../_common/scripts/alignment.mjs";
```
Then in `validateGuidance`, compute alignment and include it in BOTH return objects. Change the early-return for empty text:
```js
  if (!text || !text.trim()) {
    return { strategy: null, source: null, alignment: null, valid: false, errors: [`guidance missing or empty${at}`] };
  }
```
And change the final return:
```js
  const { alignment } = parseAlignment(text);
  return { strategy, source, alignment, valid: errors.length === 0, errors };
```
(Insert the `const { alignment } = parseAlignment(text);` line just before the final `return`.)

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/parse-guidance.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/parse-guidance.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/parse-guidance.test.mjs
git commit -m "feat(upstream): parse optional Alignment section in guidance (Phase 6 §3.1)"
```

---

## Task 6: Render Alignment + apply alignment:* label (feature-gated) in build-issue-payload

**Files:**
- Modify: `.claude/skills/upstream-cherry-pick/scripts/build-issue-payload.mjs`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/build-issue-payload.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/upstream-cherry-pick/scripts/__tests__/build-issue-payload.test.mjs`:
```js
// ---------------------------------------------------------------------------
// Alignment fit-check (Phase 6 §3) — feature-gated
// ---------------------------------------------------------------------------

test("feature candidate with alignment gets the alignment:* label + Alignment heading", () => {
  const { body, labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk("NONE", "no pi paths"),
    upstream,
    ccUser: "@claude",
    alignment: "adjacent",
  });
  assert.ok(labels.includes("alignment:adjacent"), `labels: ${labels}`);
  assert.match(body, /## Alignment/);
  assert.match(body, /alignment:adjacent/);
  assert.match(body, /OTTO-ALIGNMENT\.md/);
});

test("non-feature candidate never gets an alignment label even if one is passed", () => {
  const { body, labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
    alignment: "out-of-scope", // must be ignored — alignment is N/A for fixes
  });
  assert.ok(!labels.some((l) => l.startsWith("alignment:")), `labels: ${labels}`);
  assert.doesNotMatch(body, /## Alignment/);
});

test("feature candidate without an alignment verdict renders no alignment label", () => {
  const { labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(!labels.some((l) => l.startsWith("alignment:")), `labels: ${labels}`);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/build-issue-payload.test.mjs
```
Expected: FAIL — no `alignment:*` label; no `## Alignment` heading.

- [ ] **Step 3: Implement alignment label + section**

In `.claude/skills/upstream-cherry-pick/scripts/build-issue-payload.mjs`, add the import near the top (next to the fix-strategy import):
```js
import { strategyToLabel, strategyToTypeLabel } from "../../_common/scripts/fix-strategy.mjs";
import { alignmentToLabel, isFeatureSeverity } from "../../_common/scripts/alignment.mjs";
```

Add `alignment` to `buildLabels`'s destructured params and push the label when feature-gated. Change the signature and body:
```js
function buildLabels({ classification, conflictRisk, upstream, strategy, alignment }) {
```
and just before `return labels;` in `buildLabels`, add:
```js
  // Alignment fit-check label — feature candidates only (Phase 6 §3).
  if (isFeatureSeverity(classification.severity)) {
    const alignLabel = alignmentToLabel(alignment);
    if (alignLabel) labels.push(alignLabel);
  }

  return labels;
```

Add the renderer (place it next to `renderFixStrategy`):
```js
const ALIGNMENT_BLURB = {
  core: "advances the co-worker direction → port.",
  adjacent: "useful but off the critical path → defer.",
  "out-of-scope": "coding-assistant-only or ethos-conflicting → surface for a human to close.",
};

function renderAlignment({ classification, alignment }) {
  if (!isFeatureSeverity(classification.severity)) return "";
  const blurb = ALIGNMENT_BLURB[alignment];
  if (!blurb) return "";
  return (
    `\n## Alignment\n\n**\`alignment:${alignment}\`** — ${blurb} ` +
    "See `docs/OTTO-ALIGNMENT.md` §5. Advisory — a human makes the final call; nothing is auto-closed.\n"
  );
}
```

Thread `alignment` through `buildBody` and `buildIssuePayload`. In `buildBody`, add `alignment` to the destructured params, compute the section, and insert it after the fix-strategy section. Change the params line:
```js
function buildBody({ commit, classification, conflictRisk, upstream, prContext, issueContexts, ccUser, heavyFiles, implementationGuidance, diff, strategy, alignment }) {
```
Add after `const fixStrategySection = renderFixStrategy({ strategy });`:
```js
  const alignmentSection = renderAlignment({ classification, alignment });
```
Change the template line that currently reads:
```js
${guidanceSection}
${diffSection}${fixStrategySection}
## Classification
```
to:
```js
${guidanceSection}
${diffSection}${fixStrategySection}${alignmentSection}
## Classification
```

In `buildIssuePayload`, add `alignment = null,` to the destructured params (after `strategy = null,`), pass it to `buildLabels` and `buildBody`:
```js
  const labels = buildLabels({ classification, conflictRisk, upstream, strategy, alignment });
  const body = buildBody({
    commit,
    classification,
    conflictRisk,
    upstream,
    prContext,
    issueContexts,
    ccUser,
    heavyFiles,
    implementationGuidance,
    diff,
    strategy,
    alignment,
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/build-issue-payload.test.mjs
```
Expected: PASS (existing + 3 new tests).

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/build-issue-payload.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/build-issue-payload.test.mjs
git commit -m "feat(upstream): render Alignment + apply alignment:* label, feature-gated (Phase 6 §3.1)"
```

---

## Task 7: run-audit — lineage-only iteration, inspiration guard, file-time alignment

**Files:**
- Modify: `.claude/skills/upstream-cherry-pick/scripts/run-audit.mjs`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-sweep.test.mjs` (new)

This task adds three small **exported, unit-testable** helpers and wires them; the `--sweep` orchestration arrives in Task 11.

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-sweep.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectLineageNames, assertAuditable, resolveAlignment } from "../run-audit.mjs";

const cfg = {
  upstreams: {
    "pi-dev": { path: "../pi", ghRepo: "earendil-works/pi", role: "lineage" },
    "gsd-pi": { path: "../gsd-pi", ghRepo: "open-gsd/gsd-pi" }, // absent role → lineage
    "hermes-agent": { path: "../hermes-agent", ghRepo: "inspiration/hermes-agent", role: "inspiration" },
  },
};

test("selectLineageNames returns lineage repos (absent role defaults to lineage)", () => {
  assert.deepEqual(selectLineageNames(cfg).sort(), ["gsd-pi", "pi-dev"]);
});

test("assertAuditable throws for an inspiration repo and passes for lineage", () => {
  assert.doesNotThrow(() => assertAuditable(cfg, "pi-dev"));
  assert.doesNotThrow(() => assertAuditable(cfg, "gsd-pi"));
  assert.throws(() => assertAuditable(cfg, "hermes-agent"), /inspiration|reference-only|not audited/i);
});

test("assertAuditable throws for an unknown upstream", () => {
  assert.throws(() => assertAuditable(cfg, "nope"), /unknown upstream/i);
});

test("resolveAlignment only resolves for feature severity", () => {
  const guidance = "strategy: adapted-port\n\nalignment: core\n";
  assert.equal(resolveAlignment({ severity: "FEATURE", guidanceText: guidance }), "core");
  assert.equal(resolveAlignment({ severity: "NICE_TO_HAVE_FIX", guidanceText: guidance }), null);
  assert.equal(resolveAlignment({ severity: "FEATURE", guidanceText: "strategy: adapted-port\n" }), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-sweep.test.mjs
```
Expected: FAIL — `selectLineageNames`, `assertAuditable`, `resolveAlignment` are not exported.

- [ ] **Step 3: Add the helpers + the import + wire the main loop**

In `.claude/skills/upstream-cherry-pick/scripts/run-audit.mjs`, add the import near the other `_common` imports:
```js
import { parseStrategy } from "../../_common/scripts/fix-strategy.mjs";
import { parseAlignment, isFeatureSeverity } from "../../_common/scripts/alignment.mjs";
```

Add the three exported helpers (place them just after `compileRules`, before the `// ─── git helpers ───` block):
```js
// ─── role-aware upstream selection (Phase 6 §1) ───────────────────────────────

/** Lineage repos only — inspiration repos are reference-only, never audited. */
export function selectLineageNames(cfg) {
  return Object.keys(cfg.upstreams).filter(
    (n) => (cfg.upstreams[n].role ?? "lineage") === "lineage",
  );
}

/** Throw if `name` is unknown or not a lineage (auditable) repo. */
export function assertAuditable(cfg, name) {
  const u = cfg.upstreams[name];
  if (!u) {
    throw new Error(`Unknown upstream "${name}". Known: ${Object.keys(cfg.upstreams).join(", ")}`);
  }
  const role = u.role ?? "lineage";
  if (role !== "lineage") {
    throw new Error(
      `"${name}" is role:${role} (reference-only) — not audited or cherry-picked. ` +
        `Lineage repos: ${selectLineageNames(cfg).join(", ")}`,
    );
  }
}

/** File-time alignment verdict for a candidate — feature severity only (§3.1). */
export function resolveAlignment({ severity, guidanceText }) {
  return isFeatureSeverity(severity) ? parseAlignment(guidanceText).alignment : null;
}
```

In `scanUpstream`, thread alignment into the payload. After the existing block:
```js
    const { strategy } = resolveStrategy({
      guidanceText: implementationGuidance,
      guidancePath,
      flags,
    });
```
add:
```js
    const alignment = resolveAlignment({
      severity: classification.severity,
      guidanceText: implementationGuidance,
    });
```
and add `alignment,` to the `buildIssuePayload({ ... })` call (after the `strategy,` line):
```js
      diff,
      strategy,
      alignment,
    });
```

In `main`, replace the name-selection + unknown-upstream block. Change:
```js
  const names = only ? [only] : Object.keys(cfg.upstreams);
  const manifests = {};
  for (const name of names) {
    const upstream = cfg.upstreams[name];
    if (!upstream) throw new Error(`Unknown upstream "${name}". Known: ${Object.keys(cfg.upstreams).join(", ")}`);
```
to:
```js
  if (only) assertAuditable(cfg, only);
  const names = only ? [only] : selectLineageNames(cfg);
  const manifests = {};
  for (const name of names) {
    const upstream = cfg.upstreams[name];
```

- [ ] **Step 4: Run the new test + the guidance test to verify they pass**

Run:
```bash
node --test \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-sweep.test.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-guidance.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/run-audit.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-sweep.test.mjs
git commit -m "feat(upstream): lineage-only audit + inspiration guard + file-time alignment (Phase 6 §1/§3.1)"
```

---

## Task 8: Class-A supersession detectors

**Files:**
- Create: `.claude/skills/upstream-cherry-pick/scripts/supersession-check.mjs`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/supersession-check.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/upstream-cherry-pick/scripts/__tests__/supersession-check.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectReverted,
  detectRewritten,
  detectUpstreamClosed,
  checkSupersession,
} from "../supersession-check.mjs";

const SHA = "a3f9c12deadbeefa3f9c12deadbeefa3f9c12dea";

test("detectReverted hits when a later commit reverts the sha", () => {
  const gitRunner = (args) => {
    // git log <sha>..HEAD --grep "This reverts commit <sha>"
    if (args.join(" ").includes("This reverts commit")) {
      return "ff00aa1\tRevert \"fix(auth): redact tokens\"\n";
    }
    return "";
  };
  const r = detectReverted({ repoPath: "../pi", sha: SHA, subject: "fix(auth): redact tokens", gitRunner });
  assert.equal(r.hit, true);
  assert.equal(r.revertingSha, "ff00aa1");
});

test("detectReverted misses when log is empty", () => {
  const gitRunner = () => "";
  assert.equal(detectReverted({ repoPath: "../pi", sha: SHA, subject: "x", gitRunner }).hit, false);
});

test("detectReverted tolerates a throwing gitRunner (sha not in repo)", () => {
  const gitRunner = () => { throw new Error("bad revision"); };
  assert.equal(detectReverted({ repoPath: "../pi", sha: SHA, subject: "x", gitRunner }).hit, false);
});

test("detectRewritten hits when later commits touch the same files (advisory)", () => {
  const gitRunner = () => "deadbee fix follow-up\nc0ffee0 refactor settings\n";
  const r = detectRewritten({ repoPath: "../pi", sha: SHA, files: ["src/a.ts"], gitRunner });
  assert.equal(r.hit, true);
  assert.equal(r.laterCommits.length, 2);
});

test("detectRewritten misses with no files or empty log", () => {
  assert.equal(detectRewritten({ repoPath: "../pi", sha: SHA, files: [], gitRunner: () => "x" }).hit, false);
  assert.equal(detectRewritten({ repoPath: "../pi", sha: SHA, files: ["a"], gitRunner: () => "" }).hit, false);
});

test("detectUpstreamClosed hits only when ALL linked issues are closed not-planned/wontfix/duplicate", () => {
  const closed = [{ data: { state: "CLOSED", stateReason: "not-planned" } }];
  assert.equal(detectUpstreamClosed({ issueContexts: closed }).hit, true);
  const mixed = [
    { data: { state: "CLOSED", stateReason: "duplicate" } },
    { data: { state: "OPEN", stateReason: "" } },
  ];
  assert.equal(detectUpstreamClosed({ issueContexts: mixed }).hit, false);
  assert.equal(detectUpstreamClosed({ issueContexts: [] }).hit, false);
  const completed = [{ data: { state: "CLOSED", stateReason: "completed" } }];
  assert.equal(detectUpstreamClosed({ issueContexts: completed }).hit, false);
});

test("checkSupersession: reverted wins and is auto-taggable (superseded:true)", () => {
  const gitRunner = (args) =>
    args.join(" ").includes("This reverts commit") ? "ff00aa1\tRevert\n" : "";
  const v = checkSupersession({ repoPath: "../pi", sha: SHA, subject: "x", files: ["a"], issueContexts: [], gitRunner });
  assert.equal(v.superseded, true);
  assert.equal(v.rule, "reverted");
  assert.equal(v.evidence.revertingSha, "ff00aa1");
});

test("checkSupersession: upstream-closed wins over rewritten and is auto-taggable", () => {
  const gitRunner = () => "deadbee later\n"; // would be 'rewritten' on its own
  const v = checkSupersession({
    repoPath: "../pi", sha: SHA, subject: "x", files: ["a"],
    issueContexts: [{ data: { state: "CLOSED", stateReason: "wontfix" } }],
    gitRunner,
  });
  assert.equal(v.superseded, true);
  assert.equal(v.rule, "upstream-closed");
});

test("checkSupersession: rewritten is ADVISORY (superseded:false) — never auto-tags", () => {
  const gitRunner = (args) =>
    args.join(" ").includes("--oneline") ? "deadbee later edit\n" : "";
  const v = checkSupersession({ repoPath: "../pi", sha: SHA, subject: "x", files: ["a"], issueContexts: [], gitRunner });
  assert.equal(v.superseded, false);
  assert.equal(v.rule, "rewritten");
});

test("checkSupersession: nothing fires → not superseded, rule null", () => {
  const v = checkSupersession({ repoPath: "../pi", sha: SHA, subject: "x", files: [], issueContexts: [], gitRunner: () => "" });
  assert.equal(v.superseded, false);
  assert.equal(v.rule, null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/supersession-check.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the detectors**

Create `.claude/skills/upstream-cherry-pick/scripts/supersession-check.mjs`:
```js
#!/usr/bin/env node
/**
 * supersession-check.mjs — Class-A (deterministic, upstream-history) staleness
 * detectors for the Phase 6 backlog sweep.
 *
 * Three rules, in priority order:
 *   1. reverted        — a later commit reverts the sha → AUTO-TAG (superseded:true)
 *   2. upstream-closed — all linked upstream issues closed not-planned/wontfix/
 *                        duplicate (mirrors apply-context-upgrades Rule 5) → AUTO-TAG
 *   3. rewritten       — later commits touched the same files → ADVISORY ONLY
 *                        (superseded:false; reported, NEVER auto-tags — the least
 *                        precise signal, per the Phase 6 design risk note)
 *
 * Pure decision logic over an injected `gitRunner(args)` (full git arg list,
 * including `-C <repoPath>`) and already-fetched `issueContexts`. The orchestrator
 * (sweep-backlog.mjs) supplies the real git/gh I/O. `superseded === true` is the
 * single signal the orchestrator uses to decide whether to apply status:superseded.
 *
 * The decision is "never close" — the sweep only LABELS and COMMENTS; a human
 * always makes the final call.
 */
import { execFileSync } from "node:child_process";

// Same closed-as-unwanted reasons as apply-context-upgrades.mjs Rule 5.
const SKIP_STATE_REASON_RE = /^(not.planned|wontfix|duplicate)/i;

function defaultGitRunner(args) {
  return execFileSync("git", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
}

/**
 * Rule 1 — a later commit reverts the sha.
 * @returns {{hit: boolean, revertingSha?: string, revertingSubject?: string}}
 */
export function detectReverted({ repoPath, sha, subject, gitRunner = defaultGitRunner }) {
  const range = `${sha}..HEAD`;
  const greps = [`This reverts commit ${sha}`];
  if (subject) greps.push(`Revert "${subject}"`);
  for (const grep of greps) {
    let out = "";
    try {
      out = gitRunner(["-C", repoPath, "log", range, "--no-merges", "--format=%h%x09%s", `--grep=${grep}`, "--fixed-strings"]);
    } catch {
      continue; // sha not in repo / bad range — treat as no hit
    }
    const line = out.split("\n").map((s) => s.trim()).filter(Boolean)[0];
    if (line) {
      const [revertingSha, revertingSubject = ""] = line.split("\t");
      return { hit: true, revertingSha, revertingSubject };
    }
  }
  return { hit: false };
}

/**
 * Rule 3 — later commits materially touched the same files (ADVISORY ONLY).
 * @returns {{hit: boolean, laterCommits?: string[], fileCount?: number}}
 */
export function detectRewritten({ repoPath, sha, files = [], gitRunner = defaultGitRunner }) {
  if (!files.length) return { hit: false };
  let out = "";
  try {
    out = gitRunner(["-C", repoPath, "log", `${sha}..HEAD`, "--no-merges", "--oneline", "--", ...files]);
  } catch {
    return { hit: false };
  }
  const commits = out.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!commits.length) return { hit: false };
  return { hit: true, laterCommits: commits.slice(0, 10), fileCount: files.length };
}

/**
 * Rule 2 — all linked upstream issues are closed as not-planned/wontfix/duplicate.
 * Mirrors apply-context-upgrades.mjs Rule 5, run against the backlog now.
 * @returns {{hit: boolean, stateReason?: string}}
 */
export function detectUpstreamClosed({ issueContexts = [] }) {
  if (!issueContexts.length) return { hit: false };
  const all = issueContexts.every((ctx) => {
    const d = ctx.data ?? ctx;
    return (d.state ?? "").toUpperCase() === "CLOSED" && SKIP_STATE_REASON_RE.test(d.stateReason ?? "");
  });
  if (!all) return { hit: false };
  const d0 = issueContexts[0].data ?? issueContexts[0];
  return { hit: true, stateReason: d0.stateReason ?? "CLOSED" };
}

/**
 * Combine the three rules. Priority: reverted > upstream-closed > rewritten.
 * `superseded` is true ONLY for the two auto-taggable rules; rewritten is advisory.
 * @returns {{superseded: boolean, rule: "reverted"|"upstream-closed"|"rewritten"|null, evidence: object|null}}
 */
export function checkSupersession({ repoPath, sha, subject, files = [], issueContexts = [], gitRunner = defaultGitRunner }) {
  const reverted = detectReverted({ repoPath, sha, subject, gitRunner });
  if (reverted.hit) {
    return { superseded: true, rule: "reverted", evidence: { revertingSha: reverted.revertingSha, revertingSubject: reverted.revertingSubject } };
  }
  const closed = detectUpstreamClosed({ issueContexts });
  if (closed.hit) {
    return { superseded: true, rule: "upstream-closed", evidence: { stateReason: closed.stateReason } };
  }
  const rewritten = detectRewritten({ repoPath, sha, files, gitRunner });
  if (rewritten.hit) {
    return { superseded: false, rule: "rewritten", evidence: { laterCommits: rewritten.laterCommits, fileCount: rewritten.fileCount } };
  }
  return { superseded: false, rule: null, evidence: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/supersession-check.test.mjs
```
Expected: PASS (all 11 assertions/tests).

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/supersession-check.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/supersession-check.test.mjs
git commit -m "feat(upstream): Class-A supersession detectors (reverted/upstream-closed auto, rewritten advisory)"
```

---

## Task 9: Sweep report renderer

**Files:**
- Create: `.claude/skills/upstream-cherry-pick/scripts/write-sweep-report.mjs`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/write-sweep-report.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/upstream-cherry-pick/scripts/__tests__/write-sweep-report.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSweepReport, renderSweepMarkdown } from "../write-sweep-report.mjs";

const RESULT = {
  scanned: 5,
  superseded: [
    { number: 42, sha: "abc1234", rule: "reverted", evidence: { revertingSha: "ff00aa1", revertingSubject: "Revert x" } },
    { number: 43, sha: "def5678", rule: "upstream-closed", evidence: { stateReason: "not-planned" } },
  ],
  advisory: [
    { number: 44, sha: "9999999", rule: "rewritten", evidence: { laterCommits: ["aaa later"], fileCount: 2 } },
  ],
  features: [
    { number: 50, sha: "feab123", title: "[upstream/pi-dev] ✨ add foo" },
  ],
  skipped: [{ number: 60, reason: "no-sha" }],
};

test("renderSweepMarkdown reports counts, evidence, advisory, and feature re-check list", () => {
  const md = renderSweepMarkdown({ runData: RESULT, date: "2026-06-14" });
  assert.match(md, /# Upstream backlog sweep — 2026-06-14/);
  assert.match(md, /scanned.*5/i);
  assert.match(md, /#42/);
  assert.match(md, /reverted/);
  assert.match(md, /ff00aa1/); // evidence sha
  assert.match(md, /#43/);
  assert.match(md, /not-planned/);
  assert.match(md, /#44/); // advisory rewritten
  assert.match(md, /advisory/i);
  assert.match(md, /#50/); // feature needing alignment re-check
  assert.match(md, /OTTO-ALIGNMENT/);
  // never-close guarantee is stated
  assert.match(md, /no issue (is|was) closed|never auto-close/i);
});

test("renderSweepMarkdown handles all-empty result", () => {
  const md = renderSweepMarkdown({
    runData: { scanned: 0, superseded: [], advisory: [], features: [], skipped: [] },
    date: "2026-06-14",
  });
  assert.match(md, /scanned.*0/i);
  assert.match(md, /\(none\)/);
});

test("writeSweepReport writes <date>-backlog-sweep.md and returns its path", () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-sweep-"));
  try {
    const path = writeSweepReport({ outputDir: dir, runData: RESULT, date: "2026-06-14" });
    assert.ok(path.endsWith("2026-06-14-backlog-sweep.md"));
    const text = readFileSync(path, "utf-8");
    assert.match(text, /#42/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/write-sweep-report.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the renderer**

Create `.claude/skills/upstream-cherry-pick/scripts/write-sweep-report.mjs`:
```js
#!/usr/bin/env node
/**
 * write-sweep-report.mjs — §4 plain-language report for the Phase 6 backlog
 * sweep. Lists issues newly tagged status:superseded (with the superseding
 * evidence), advisory `rewritten` candidates (NOT tagged), and the feature
 * issues that need an alignment re-check (the agent judges those against
 * docs/OTTO-ALIGNMENT.md and applies alignment:* labels). No issue is closed by
 * the tool — a human always makes the final call.
 *
 * API:  writeSweepReport({ outputDir, runData, date }) → absoluteFilePath
 *       renderSweepMarkdown({ runData, date }) → markdown string
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

function renderSupersededSection(items) {
  const header = `## Tagged \`status:superseded\` (${items.length})`;
  if (!items.length) return [header, "", "(none)"].join("\n");
  const intro = "Deterministic Class-A hits — reverted or closed-as-unwanted upstream. Labeled + commented with evidence; **not closed**.";
  const rows = items.map((it) => {
    const ev =
      it.rule === "reverted"
        ? `reverted by \`${it.evidence?.revertingSha ?? "?"}\` (${it.evidence?.revertingSubject ?? ""})`
        : `upstream closed as \`${it.evidence?.stateReason ?? "?"}\``;
    return `- **#${it.number}** \`[sha=${it.sha}]\` — \`${it.rule}\`: ${ev}`;
  });
  return [header, "", intro, "", ...rows].join("\n");
}

function renderAdvisorySection(items) {
  const header = `## Advisory — possibly rewritten (${items.length})`;
  if (!items.length) return [header, "", "(none)"].join("\n");
  const intro = "Later commits touched the same files. **Advisory only — NOT tagged** (the least precise Class-A signal). A human should confirm before marking superseded.";
  const rows = items.map(
    (it) => `- **#${it.number}** \`[sha=${it.sha}]\` — ${it.evidence?.fileCount ?? "?"} file(s) later touched by: ${(it.evidence?.laterCommits ?? []).join("; ")}`,
  );
  return [header, "", intro, "", ...rows].join("\n");
}

function renderFeaturesSection(items) {
  const header = `## Feature issues needing an alignment re-check (${items.length})`;
  if (!items.length) return [header, "", "(none)"].join("\n");
  const intro = "Re-evaluate each against the current `docs/OTTO-ALIGNMENT.md` §5 and (re)apply `alignment:{core,adjacent,out-of-scope}` + a one-line reason via `issue-update.mjs`. Advisory — never auto-closed.";
  const rows = items.map((it) => `- **#${it.number}** \`[sha=${it.sha}]\` — ${it.title ?? ""}`);
  return [header, "", intro, "", ...rows].join("\n");
}

function renderSkippedSection(items) {
  const header = `## Skipped (${items.length})`;
  if (!items.length) return [header, "", "(none)"].join("\n");
  const rows = items.map((it) => `- **#${it.number}** — ${it.reason}`);
  return [header, "", ...rows].join("\n");
}

export function renderSweepMarkdown({ runData, date }) {
  const { scanned, superseded = [], advisory = [], features = [], skipped = [] } = runData;
  return [
    `# Upstream backlog sweep — ${date}`,
    "",
    `**Open actionable issues scanned**: ${scanned}`,
    `**Newly tagged \`status:superseded\`**: ${superseded.length}`,
    `**Advisory (rewritten, not tagged)**: ${advisory.length}`,
    `**Feature issues for alignment re-check**: ${features.length}`,
    "",
    "> Class A only (deterministic upstream-history). **No issue is closed by the tool** — every verdict is a label + evidence comment for a human to action.",
    "",
    renderSupersededSection(superseded),
    "",
    renderAdvisorySection(advisory),
    "",
    renderFeaturesSection(features),
    "",
    renderSkippedSection(skipped),
    "",
  ].join("\n");
}

export function writeSweepReport({ outputDir, runData, date }) {
  const markdown = renderSweepMarkdown({ runData, date });
  const absOutputDir = resolve(outputDir);
  mkdirSync(absOutputDir, { recursive: true });
  const filePath = join(absOutputDir, `${date}-backlog-sweep.md`);
  writeFileSync(filePath, markdown, "utf-8");
  return filePath;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/write-sweep-report.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/write-sweep-report.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/write-sweep-report.test.mjs
git commit -m "feat(upstream): sweep report renderer (Phase 6 §4)"
```

---

## Task 10: Sweep orchestrator (`sweep-backlog.mjs`)

**Files:**
- Create: `.claude/skills/upstream-cherry-pick/scripts/sweep-backlog.mjs`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/sweep-backlog.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/upstream-cherry-pick/scripts/__tests__/sweep-backlog.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectActionableIssues, extractSha, upstreamNameOf, sweepBacklog } from "../sweep-backlog.mjs";

test("selectActionableIssues keeps port-required/cherry-pick-candidate and drops applied/superseded", () => {
  const issues = [
    { number: 1, labels: [{ name: "type:cherry-pick-candidate" }] },
    { number: 2, labels: [{ name: "type:port-required" }, { name: "status:applied" }] },
    { number: 3, labels: [{ name: "type:port-required" }, { name: "status:superseded" }] },
    { number: 4, labels: [{ name: "type:do-not-port" }] },
    { number: 5, labels: ["type:cherry-pick-candidate", "status:in-progress"] },
  ];
  const kept = selectActionableIssues(issues).map((i) => i.number);
  assert.deepEqual(kept, [1, 5]);
});

test("extractSha / upstreamNameOf read the trailer and the upstream label", () => {
  const issue = {
    title: "[upstream/pi-dev] ✨ x [sha=abc1234]",
    body: "...\nDedup key: `[sha=abc1234]`",
    labels: [{ name: "upstream:pi-dev" }, { name: "type:port-required" }],
  };
  assert.equal(extractSha(issue), "abc1234");
  assert.equal(upstreamNameOf(issue), "pi-dev");
});

const CFG = {
  targetRepo: "cmetech/otto-cli",
  upstreams: {
    "pi-dev": { path: "../pi", ghRepo: "earendil-works/pi", role: "lineage" },
    "hermes-agent": { path: "../hermes-agent", ghRepo: "inspiration/hermes-agent", role: "inspiration" },
  },
};

function makeIssue(number, sha, extraLabels = []) {
  return {
    number,
    title: `[upstream/pi-dev] x [sha=${sha}]`,
    body: `Dedup key: \`[sha=${sha}]\``,
    labels: [{ name: "upstream:pi-dev" }, { name: "type:port-required" }, ...extraLabels.map((n) => ({ name: n }))],
  };
}

test("sweepBacklog auto-tags reverted issues and records evidence; never closes", async () => {
  const issues = [makeIssue(10, "abc1234")];
  const updates = [];
  const ghRunner = (args) =>
    args[0] === "issue" && args[1] === "list" ? JSON.stringify(issues) : "";
  const gitRunner = (args) => {
    const s = args.join(" ");
    if (s.includes("show") && s.includes("--format=%s%n%b")) return "fix: x\n\nbody #99\n";
    if (s.includes("--numstat")) return "1\t2\tsrc/a.ts\n";
    if (s.includes("This reverts commit")) return "ff00aa1\tRevert\n";
    return "";
  };
  const issueUpdater = (opts) => { updates.push(opts); return { number: opts.number, actions: ["add-label", "comment"] }; };
  const fetchContext = async () => { throw new Error("no network in test"); };

  const res = await sweepBacklog({ cfg: CFG, ghRunner, gitRunner, fetchContext, issueUpdater });
  assert.equal(res.scanned, 1);
  assert.equal(res.superseded.length, 1);
  assert.equal(res.superseded[0].rule, "reverted");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].addLabels, ["status:superseded"]);
  assert.equal(updates[0].close, undefined); // NEVER closes
  assert.match(updates[0].comment, /reverted|ff00aa1/);
});

test("sweepBacklog records rewritten as advisory WITHOUT calling the updater", async () => {
  const issues = [makeIssue(11, "bbb2222")];
  const updates = [];
  const ghRunner = (args) => (args[1] === "list" ? JSON.stringify(issues) : "");
  const gitRunner = (args) => {
    const s = args.join(" ");
    if (s.includes("--format=%s%n%b")) return "fix: y\n\nno refs\n";
    if (s.includes("--numstat")) return "3\t0\tsrc/b.ts\n";
    if (s.includes("This reverts commit")) return "";
    if (s.includes("--oneline")) return "deadbee later edit\n";
    return "";
  };
  const issueUpdater = (opts) => { updates.push(opts); return {}; };
  const res = await sweepBacklog({ cfg: CFG, ghRunner, gitRunner, fetchContext: async () => { throw new Error("x"); }, issueUpdater });
  assert.equal(res.superseded.length, 0);
  assert.equal(res.advisory.length, 1);
  assert.equal(res.advisory[0].rule, "rewritten");
  assert.equal(updates.length, 0); // advisory never mutates the issue
});

test("sweepBacklog collects feature issues for alignment re-check", async () => {
  const issues = [makeIssue(12, "ccc3333", ["severity:feature"])];
  const ghRunner = (args) => (args[1] === "list" ? JSON.stringify(issues) : "");
  const gitRunner = () => ""; // nothing supersedes it
  const res = await sweepBacklog({ cfg: CFG, ghRunner, gitRunner, fetchContext: async () => { throw new Error("x"); }, issueUpdater: () => ({}) });
  assert.equal(res.features.length, 1);
  assert.equal(res.features[0].number, 12);
});

test("sweepBacklog skips issues whose upstream is inspiration or unknown", async () => {
  const issues = [
    { number: 20, title: "x [sha=ddd4444]", body: "[sha=ddd4444]", labels: [{ name: "upstream:hermes-agent" }, { name: "type:port-required" }] },
    { number: 21, title: "x [sha=eee5555]", body: "[sha=eee5555]", labels: [{ name: "type:port-required" }] },
  ];
  const ghRunner = (args) => (args[1] === "list" ? JSON.stringify(issues) : "");
  const res = await sweepBacklog({ cfg: CFG, ghRunner, gitRunner: () => "", fetchContext: async () => { throw new Error("x"); }, issueUpdater: () => ({}) });
  assert.equal(res.superseded.length, 0);
  assert.equal(res.skipped.length, 2);
});

test("sweepBacklog dryRun never calls the updater", async () => {
  const issues = [makeIssue(13, "fff6666")];
  let called = 0;
  const ghRunner = (args) => (args[1] === "list" ? JSON.stringify(issues) : "");
  const gitRunner = (args) => (args.join(" ").includes("This reverts commit") ? "ff00aa1\tRevert\n" : (args.join(" ").includes("--format=%s%n%b") ? "fix\n\n\n" : ""));
  const res = await sweepBacklog({ cfg: CFG, ghRunner, gitRunner, fetchContext: async () => { throw new Error("x"); }, issueUpdater: () => { called++; return {}; }, dryRun: true });
  assert.equal(res.superseded.length, 1); // still detected
  assert.equal(called, 0);               // but not mutated
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/sweep-backlog.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Create `.claude/skills/upstream-cherry-pick/scripts/sweep-backlog.mjs`:
```js
#!/usr/bin/env node
/**
 * sweep-backlog.mjs — Phase 6 §2 supersession sweep orchestrator.
 *
 * Walks OPEN actionable issues (type:port-required + type:cherry-pick-candidate,
 * excluding status:applied/status:superseded), and for each runs the Class-A
 * supersession detectors in its LINEAGE repo. Auto-applies status:superseded +
 * an evidence comment for reverted/upstream-closed hits (via issue-update.mjs);
 * records rewritten as advisory (NOT tagged); and collects feature issues for
 * the agent's alignment re-check. NEVER closes an issue. Returns structured
 * runData for write-sweep-report.mjs.
 *
 * All I/O is injected (ghRunner / gitRunner / fetchContext / issueUpdater) so the
 * decision path is fully unit-testable with no network.
 */
import { execFileSync } from "node:child_process";
import { checkSupersession } from "./supersession-check.mjs";
import { updateIssue } from "../../_common/scripts/issue-update.mjs";
import { fetchPrContext } from "./fetch-pr-context.mjs";

const ACTIONABLE_LABELS = ["type:port-required", "type:cherry-pick-candidate"];
const EXCLUDE_LABELS = ["status:applied", "status:superseded"];
const SHA_RE = /sha=([0-9a-f]{7,40})/i;
const REF_RE = /#(\d+)/g;

function defaultGhRunner(args) {
  return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
}
function defaultGitRunner(args) {
  return execFileSync("git", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
}

function labelNames(labels = []) {
  return labels.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);
}

/** Filter fetched issues to the open actionable set (Phase 6 §2). */
export function selectActionableIssues(issues) {
  return issues.filter((i) => {
    const names = labelNames(i.labels);
    return names.some((n) => ACTIONABLE_LABELS.includes(n)) && !names.some((n) => EXCLUDE_LABELS.includes(n));
  });
}

/** Extract the 7-char sha from an issue's body trailer or title. */
export function extractSha(issue) {
  const fromBody = (issue.body ?? "").match(SHA_RE);
  if (fromBody) return fromBody[1].slice(0, 7);
  const fromTitle = (issue.title ?? "").match(SHA_RE);
  return fromTitle ? fromTitle[1].slice(0, 7) : null;
}

/** Read the upstream name from the `upstream:<name>` label. */
export function upstreamNameOf(issue) {
  for (const n of labelNames(issue.labels)) {
    if (n.startsWith("upstream:")) return n.slice("upstream:".length);
  }
  return null;
}

function renderSupersededComment(verdict, sha) {
  if (verdict.rule === "reverted") {
    return (
      `🧹 **Backlog sweep — \`status:superseded\` (reverted).** The upstream commit ` +
      `\`${sha}\` was reverted by \`${verdict.evidence.revertingSha}\` (${verdict.evidence.revertingSubject}). ` +
      `Porting it is likely wasted effort. Auto-tagged by \`/upstream-cherry-pick --sweep\` — **not closed**; a human decides.`
    );
  }
  // upstream-closed
  return (
    `🧹 **Backlog sweep — \`status:superseded\` (upstream-closed).** The linked upstream ` +
    `issue(s) for \`${sha}\` were closed as \`${verdict.evidence.stateReason}\`. Auto-tagged by ` +
    `\`/upstream-cherry-pick --sweep\` — **not closed**; a human decides.`
  );
}

/**
 * @param {{ cfg, ghRunner?, gitRunner?, fetchContext?, issueUpdater?, dryRun? }} opts
 * @returns {Promise<{scanned:number, superseded:[], advisory:[], features:[], skipped:[]}>}
 */
export async function sweepBacklog({
  cfg,
  ghRunner = defaultGhRunner,
  gitRunner = defaultGitRunner,
  fetchContext = fetchPrContext,
  issueUpdater = updateIssue,
  dryRun = false,
}) {
  const raw = ghRunner([
    "issue", "list",
    "--repo", cfg.targetRepo,
    "--state", "open",
    "--limit", "1000",
    "--json", "number,title,body,labels",
  ]);
  const all = JSON.parse(raw || "[]");
  const actionable = selectActionableIssues(all);

  const runData = { scanned: actionable.length, superseded: [], advisory: [], features: [], skipped: [] };

  for (const issue of actionable) {
    const sha = extractSha(issue);
    const upName = upstreamNameOf(issue);
    const up = upName ? cfg.upstreams[upName] : null;
    const role = up ? up.role ?? "lineage" : null;

    if (!sha || !up || role !== "lineage") {
      runData.skipped.push({ number: issue.number, reason: !sha ? "no-sha" : !up ? "unknown-upstream" : "non-lineage" });
      continue;
    }

    // Read commit metadata from the lineage repo (subject, touched files, refs).
    let subject = "";
    let files = [];
    let refs = [];
    try {
      const meta = gitRunner(["-C", up.path, "show", "-s", "--format=%s%n%b", sha]);
      subject = meta.split("\n")[0] ?? "";
      refs = [...meta.matchAll(REF_RE)].map((m) => m[1]);
    } catch { /* sha not in repo — detectors just won't hit */ }
    try {
      const numstat = gitRunner(["-C", up.path, "show", sha, "--numstat", "--format="]);
      files = numstat.split("\n").map((l) => l.trim().split("\t")[2]).filter(Boolean);
    } catch { /* no files — rewritten won't hit */ }

    // upstream-closed: fetch the linked upstream issue contexts.
    const issueContexts = [];
    for (const ref of refs) {
      try {
        const ctx = await fetchContext({ ghRepo: up.ghRepo, refNum: parseInt(ref, 10) });
        if (ctx?.kind === "issue") issueContexts.push(ctx);
      } catch { /* reduced signal — proceed */ }
    }

    const verdict = checkSupersession({ repoPath: up.path, sha, subject, files, issueContexts, gitRunner });

    if (verdict.superseded) {
      const comment = renderSupersededComment(verdict, sha);
      if (!dryRun) {
        issueUpdater({ number: issue.number, repo: cfg.targetRepo, addLabels: ["status:superseded"], comment });
      }
      runData.superseded.push({ number: issue.number, sha, rule: verdict.rule, evidence: verdict.evidence });
    } else if (verdict.rule === "rewritten") {
      runData.advisory.push({ number: issue.number, sha, rule: "rewritten", evidence: verdict.evidence });
    }

    if (labelNames(issue.labels).includes("severity:feature")) {
      runData.features.push({ number: issue.number, sha, title: issue.title });
    }
  }

  return runData;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/sweep-backlog.test.mjs
```
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/sweep-backlog.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/sweep-backlog.test.mjs
git commit -m "feat(upstream): backlog supersession sweep orchestrator (Phase 6 §2)"
```

---

## Task 11: Wire `--sweep` / `--revalidate-open` into run-audit

**Files:**
- Modify: `.claude/skills/upstream-cherry-pick/scripts/run-audit.mjs`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-sweep.test.mjs` (extend)

The sweep is wired into `main()` like the existing `--revalidate-do-not-port` branch. Because `main()` does live I/O, we test the **flag parsing** (an exported `parseArgs`) rather than `main` itself; the orchestration is already covered by Task 10.

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-sweep.test.mjs`:
```js
import { parseArgs } from "../run-audit.mjs";

test("parseArgs recognizes --sweep and its --revalidate-open alias", () => {
  assert.equal(parseArgs(["--sweep"]).flags.sweep, true);
  assert.equal(parseArgs(["--revalidate-open"]).flags.sweep, true);
  assert.equal(parseArgs([]).flags.sweep, false);
});

test("parseArgs still parses an upstream name + an existing flag", () => {
  const { upstream, flags } = parseArgs(["pi-dev", "--dry-run"]);
  assert.equal(upstream, "pi-dev");
  assert.equal(flags.dryRun, true);
  assert.equal(flags.sweep, false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-sweep.test.mjs
```
Expected: FAIL — `parseArgs` is not exported and `flags.sweep` does not exist.

- [ ] **Step 3: Export parseArgs, add the flag, and wire the branch**

In `.claude/skills/upstream-cherry-pick/scripts/run-audit.mjs`:

(a) Export `parseArgs` and add the `sweep` flag. Change `function parseArgs(argv) {` to `export function parseArgs(argv) {`, add `sweep: false,` to the `flags` object, and add the parse cases alongside the other `else if` branches:
```js
    else if (a === "--revalidate-do-not-port") flags.revalidateDoNotPort = true;
    else if (a === "--sweep" || a === "--revalidate-open") flags.sweep = true;
```

(b) Add the imports near the top:
```js
import { revalidateDoNotPort } from "./revalidate-do-not-port.mjs";
import { sweepBacklog } from "./sweep-backlog.mjs";
import { writeSweepReport } from "./write-sweep-report.mjs";
```

(c) In `main()`, add the sweep branch immediately after the existing `if (flags.revalidateDoNotPort) { ... }` block:
```js
  if (flags.sweep) {
    const runData = await sweepBacklog({ cfg, dryRun: flags.dryRun });
    const date = new Date().toISOString().slice(0, 10);
    const reportPath = writeSweepReport({ outputDir: AUDIT_OUTPUT_DIR, runData, date });
    console.error(
      `\n=== backlog sweep${flags.dryRun ? " (dry-run)" : ""} ===\n` +
        `  scanned: ${runData.scanned}\n` +
        `  superseded (auto-tagged): ${runData.superseded.length}\n` +
        `  advisory (rewritten, not tagged): ${runData.advisory.length}\n` +
        `  feature issues for alignment re-check: ${runData.features.length}\n` +
        `  report: ${reportPath}`,
    );
    process.stdout.write(JSON.stringify(runData, null, 2) + "\n");
    return;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-sweep.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Sanity-check the script still imports cleanly (no runtime regressions)**

Run:
```bash
node --check .claude/skills/upstream-cherry-pick/scripts/run-audit.mjs && echo "syntax-ok"
```
Expected: prints `syntax-ok`.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/run-audit.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-sweep.test.mjs
git commit -m "feat(upstream): wire --sweep/--revalidate-open into run-audit (Phase 6 §2/§4)"
```

---

## Task 12: Document roles, the sweep, and the fit-check in SKILL.md

**Files:**
- Modify: `.claude/skills/upstream-cherry-pick/SKILL.md`

No automated test — verify by reading. The doc must cover: the two repo roles (lineage vs inspiration, citing `OTTO-ALIGNMENT.md`), the `--sweep` mode, the alignment fit-check (file-time + backlog re-check), and the never-auto-close guarantee.

- [ ] **Step 1: Add a "Repo roles" subsection under "When to use"**

After the "When to use" section (around line 24), insert:
```markdown
## Repo roles — lineage vs inspiration

Each upstream in `.planning/upstream-sync-config.json` has a **`role`** (see `docs/OTTO-ALIGNMENT.md` §4):

- **`role: "lineage"`** — `pi` (`../pi`), `gsd-pi` (`../gsd-pi`). Our maintenance stream. The audit scans these for bugs/stability/security/perf/correctness/dependency fixes (always-port) and feature candidates (run through the alignment fit-check below). **These are the only repos the audit and sweep touch.**
- **`role: "inspiration"`** — `hermes-agent`, `anton`, `mempalace` (local siblings). A curated **reference library** read while *designing* a co-worker feature. **Never audited, never cherry-picked** (Anton is AGPL-3.0 — reimplement the idea, don't vendor the source). Absent `role` defaults to `lineage` for back-compat.

`run-audit.mjs` iterates lineage repos only; naming an inspiration repo (`node run-audit.mjs hermes-agent`) errors.
```

- [ ] **Step 2: Add an "Alignment fit-check" subsection under "Judgment calls"**

In the "Judgment calls" section (around line 196), add a new bullet after the implementation-guidance bullet:
```markdown
- **Alignment fit-check (features only)**: for a candidate classified `severity:feature`, judge its strategic fit against `docs/OTTO-ALIGNMENT.md` §5 and record it in the guidance file's optional `## Alignment` section with a machine-readable `alignment: <core|adjacent|out-of-scope>` line + a one-line reason citing the criterion. `core` → normal port flow; `adjacent` → defer; `out-of-scope` → surface for a human to close. **Bug/stability/security/perf/correctness/dependency fixes skip this — alignment is N/A.** When torn, prefer `adjacent` (defer, don't reject). `run-audit.mjs` reads the verdict and applies the `alignment:*` label; **nothing is auto-closed**.
```

- [ ] **Step 3: Add a "Backlog sweep" section before "## Flags"**

Insert before the "## Flags" heading (around line 216):
```markdown
## Backlog hygiene sweep (`--sweep`)

`node run-audit.mjs --sweep` (alias `--revalidate-open`) walks **open** actionable issues (`type:port-required` + `type:cherry-pick-candidate`, excluding `status:applied`/`status:superseded`) and, per issue, runs three deterministic **Class-A** checks in the issue's lineage repo:

1. **reverted** — a later commit reverts the sha → **auto-tag `status:superseded`** + evidence comment.
2. **upstream-closed** — the linked upstream issue(s) closed as not-planned/wontfix/duplicate → **auto-tag `status:superseded`** + evidence comment.
3. **rewritten** — later commits touched the same files → **advisory only** (reported, *not* tagged — least precise signal).

It also lists open **feature** issues for an **alignment re-check** — you re-judge each against the current `docs/OTTO-ALIGNMENT.md` and (re)apply `alignment:*` via `_common/scripts/issue-update.mjs`. Output: `.planning/upstream-audits/<date>-backlog-sweep.md`. **No issue is ever closed by the tool** — every verdict is a label + evidence comment for a human. Add `--dry-run` to detect without mutating. Class B (fork-state re-check) and Class C (within-backlog clustering) are deferred.
```

- [ ] **Step 4: Add the new flags to the "## Flags" list**

Append to the flags list (after `--no-diff`):
```markdown
- `--sweep` / `--revalidate-open` — run the backlog-hygiene supersession sweep (see "Backlog hygiene sweep"). Combine with `--dry-run` to detect without tagging.
```

- [ ] **Step 5: Verify the doc reads correctly**

Run:
```bash
grep -nE "Repo roles|Alignment fit-check|Backlog hygiene sweep|--sweep|inspiration" .claude/skills/upstream-cherry-pick/SKILL.md
```
Expected: matches in the four new locations.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/SKILL.md
git commit -m "docs(upstream): document repo roles, --sweep, and the alignment fit-check (Phase 6)"
```

---

## Task 13: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the canonical recursive suite**

Run:
```bash
node .claude/skills/_common/scripts/run-skill-tests.mjs 2>&1 | grep -E "^# (tests|pass|fail)"
```
Expected: `# fail 0`, and `# pass` ≥ **409 + the new tests** (Tasks 1, 3, 4, 5, 6, 7, 8, 9, 10, 11 each add tests; expect roughly **440+**). Record the exact number.

- [ ] **Step 2: If any test fails, STOP and debug**

Use superpowers:systematic-debugging. Do not "fix" by loosening assertions — find the root cause. Re-run Step 1 until green.

- [ ] **Step 3: Confirm no stray non-skill files changed**

Run:
```bash
git status --short && git log --oneline feat/upstream-phase-6 ^main
```
Expected: working tree clean (all changes committed); the log shows the Phase 6 commits (Tasks 1–12) plus this plan doc.

- [ ] **Step 4: Final self-review against the spec**

Re-read `docs/superpowers/specs/2026-06-14-phase-6-backlog-hygiene-design.md` §1–§4 and confirm each is delivered:
- §1 repo roles → Tasks 3, 4, 7, 12 ✓
- §2 supersession sweep (Class A) → Tasks 8, 10, 11 ✓ (`rewritten` advisory-only per resolved decision)
- §3 alignment fit-check (label taxonomy, file-time, backlog re-check) → Tasks 1, 2, 5, 6, 7, 10 ✓
- §4 sweep report → Tasks 9, 11 ✓
- Never auto-close → enforced in `sweep-backlog.mjs` (no `close`) + report copy ✓

---

## Spec coverage map

| Spec section | Tasks |
|---|---|
| §1 Repo roles (config) | 3 (parse-config), 4 (init-scaffold seed), 7 (lineage-only iteration + guard), 12 (docs) |
| §2 Supersession sweep (Class A) | 8 (detectors), 10 (orchestrator), 11 (`--sweep` wire) |
| §3 Alignment fit-check | 1 (taxonomy helper), 2 (labels), 5 (guidance parse), 6 (payload render+label), 7 (file-time resolve), 10 (backlog feature collection) |
| §4 Triage report | 9 (renderer), 11 (wire) |
| Labels 23→27 | 2 |
| Never auto-close | 9, 10 (no close path) |
| Class B/C deferred | not built (noted in §12 docs) |

## Notes for the executor

- **`rewritten` is advisory-only by design.** Do not make it auto-tag, even if it seems "stronger" on the real backlog — the spec flags it as the least precise signal and the conservative choice protects the never-close guarantee.
- **Alignment verdicts are agent work, not regex.** The scripts only carry/parse/render the verdict; the `core/adjacent/out-of-scope` judgment is the LLM reading `OTTO-ALIGNMENT.md`. The backlog re-check (Task 10's `features` list) is handed to the agent, who applies labels via `issue-update.mjs`.
- **Suite must be green after every task.** Task 2 deliberately bumps two test files in one commit (ensure-labels + init-scaffold count) so the canonical suite never goes red mid-stream.
- **`git add -f`** for every `.claude/skills/` file — the self-modification block is authorized for this work.
```
