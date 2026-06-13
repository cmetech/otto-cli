# Upstream Pipeline Hardening — Phase 2 (Fork-Divergence-Aware Fix Analysis) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the upstream-port pipeline understand upstream *intent / root cause*, judge *relevance to our hard fork*, and classify *how to port* (`direct-merge` / `adapted-port` / `essence-reimplement` / `not-needed`) — and represent that on the issue and through the fix/merge reviewer gates — so ported fixes are correct for a hard fork, not just transcribed.

**Architecture:** A new canonical `_common/scripts/fix-strategy.mjs` defines the 4-way taxonomy, its label/type mappings, and the guidance-line parser (new `strategy:` first line, with grandfathered legacy `verdict:` back-compat). A cherry-pick `parse-guidance.mjs` enforces the required-section schema and fails the audit fast on malformed *new-format* guidance (legacy verdict-only files are grandfathered, per the Phase-2 decision). `ensure-labels.mjs` gains the `fix-strategy:*` label dimension. `build-issue-payload.mjs` emits the strategy label + a dedicated "Fix strategy" heading + an "Essence to preserve" callout. `run-audit.mjs` swaps the silent verdict-parse for fail-fast validation and adds `--skip-guidance-check` + `--revalidate-do-not-port`. The fix and merge/swarm SKILL.md contracts branch on strategy: essence-reimplement reviewers judge "addresses the upstream root cause?" not "matches the diff?", and the fix subagent classifies old issues inline + authors a root-cause regression test.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, dependency-injected `gh`/`git` runners (no network in tests). Skill files live under `.claude/skills/` (gitignored at `.gitignore:43`; commit with `git add -f`). Editing `.claude/skills/` trips the self-modification block — obtain operator authorization at session start.

---

## Pre-flight (read before Task 1)

**Self-modification block:** every task edits `.claude/skills/`. Confirm Corey has authorized skill edits for this session before starting.

**Branch:** all work happens on `feat/upstream-hardening-phase-2` off `main`.

**Regression net (the full skill suite — run after every task, must stay green):**

```bash
node --test \
  .claude/skills/_common/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-cherry-pick/__tests__/*.test.mjs \
  .claude/skills/upstream-fix/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-merge/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-swarm/scripts/__tests__/*.test.mjs
```

> NOTE: this is the *complete* glob (314 tests green at baseline). It adds `upstream-cherry-pick/scripts/__tests__/` to the command in the kickoff prompt — that directory holds the cherry-pick unit tests this phase modifies, so it MUST be included. Do not use the shorter 190-test command for Phase 2.

**Commit convention:** Conventional Commits, scope `upstream`. End every commit message body with the required `Co-Authored-By` trailer. `git add -f` for `.claude/skills/` files.

## File Structure

**Create:**
- `.claude/skills/_common/scripts/fix-strategy.mjs` — canonical 4-way taxonomy: constants, label/type mappings, `parseStrategy(text)`, `strategyFromLabels(labels)`. The single source of truth imported everywhere else.
- `.claude/skills/_common/scripts/__tests__/fix-strategy.test.mjs`
- `.claude/skills/upstream-cherry-pick/scripts/parse-guidance.mjs` — `validateGuidance(text, {path})`: required-section schema + grandfather rule + essence rule.
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/parse-guidance.test.mjs`
- `.claude/skills/upstream-cherry-pick/scripts/revalidate-do-not-port.mjs` — `buildRevalidationManifest(issues)` + gh-query CLI.
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/revalidate-do-not-port.test.mjs`

**Modify:**
- `.claude/skills/upstream-cherry-pick/scripts/ensure-labels.mjs` — add 4 `fix-strategy:*` labels (taxonomy 19→23).
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs` — 19→23 create calls.
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/ensure-labels.test.mjs` — taxonomy-count assertions.
- `.claude/skills/upstream-cherry-pick/scripts/build-issue-payload.mjs` — `verdict`→`strategy`; emit `fix-strategy:*` label, "Fix strategy" heading, "Essence to preserve" callout.
- `.claude/skills/upstream-cherry-pick/scripts/__tests__/build-issue-payload.test.mjs` — strategy label + body assertions.
- `.claude/skills/upstream-cherry-pick/scripts/run-audit.mjs` — fail-fast `validateGuidance`; add `--skip-guidance-check`, `--revalidate-do-not-port`; thread `strategy`.
- `.claude/skills/upstream-cherry-pick/SKILL.md` — replace the `verdict:` contract with the strategy schema; document new flags + taxonomy.
- `.claude/skills/upstream-fix/SKILL.md` — strategy-branching fix subagent (inline-classify old issues, essence root-cause regression test) + strategy-aware reviewer gate.
- `.claude/skills/upstream-merge/scripts/refute-panel.mjs` — `buildInputBundle` carries `fixStrategy` from labels.
- `.claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs` — bundle-carries-strategy + helper tests.
- `.claude/skills/upstream-merge/SKILL.md` and `.claude/skills/upstream-swarm/SKILL.md` — `upstream-alignment` lens prompt branches on strategy.

---

### Task 1: `_common/fix-strategy.mjs` — canonical taxonomy module

**Files:**
- Create: `.claude/skills/_common/scripts/fix-strategy.mjs`
- Test: `.claude/skills/_common/scripts/__tests__/fix-strategy.test.mjs`

This is the single source of truth. Every later task imports from it — do not duplicate these constants anywhere.

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/_common/scripts/__tests__/fix-strategy.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIX_STRATEGIES,
  STRATEGY_LABELS,
  VERDICT_TO_STRATEGY,
  isFixStrategy,
  strategyToLabel,
  strategyToTypeLabel,
  strategyFromLabels,
  parseStrategy,
} from "../fix-strategy.mjs";

test("FIX_STRATEGIES is the canonical 4-way list", () => {
  assert.deepEqual(FIX_STRATEGIES, [
    "direct-merge",
    "adapted-port",
    "essence-reimplement",
    "not-needed",
  ]);
});

test("STRATEGY_LABELS namespaces each strategy under fix-strategy:", () => {
  assert.deepEqual(STRATEGY_LABELS, [
    "fix-strategy:direct-merge",
    "fix-strategy:adapted-port",
    "fix-strategy:essence-reimplement",
    "fix-strategy:not-needed",
  ]);
});

test("isFixStrategy validates membership", () => {
  assert.equal(isFixStrategy("essence-reimplement"), true);
  assert.equal(isFixStrategy("nonsense"), false);
  assert.equal(isFixStrategy(null), false);
});

test("strategyToLabel maps valid strategies and null otherwise", () => {
  assert.equal(strategyToLabel("adapted-port"), "fix-strategy:adapted-port");
  assert.equal(strategyToLabel("nope"), null);
  assert.equal(strategyToLabel(null), null);
});

test("strategyToTypeLabel preserves type:* routing back-compat", () => {
  assert.equal(strategyToTypeLabel("direct-merge"), "type:cherry-pick-candidate");
  assert.equal(strategyToTypeLabel("adapted-port"), "type:port-required");
  assert.equal(strategyToTypeLabel("essence-reimplement"), "type:port-required");
  assert.equal(strategyToTypeLabel("not-needed"), "type:do-not-port");
  assert.equal(strategyToTypeLabel("bogus"), null);
});

test("VERDICT_TO_STRATEGY maps the legacy 3-way verdict", () => {
  assert.equal(VERDICT_TO_STRATEGY["cherry-pick"], "direct-merge");
  assert.equal(VERDICT_TO_STRATEGY["manual-port"], "adapted-port");
  assert.equal(VERDICT_TO_STRATEGY["do-not-port"], "not-needed");
});

test("strategyFromLabels reads fix-strategy:* from string or {name} labels", () => {
  assert.equal(strategyFromLabels(["upstream:pi-dev", "fix-strategy:essence-reimplement"]), "essence-reimplement");
  assert.equal(strategyFromLabels([{ name: "fix-strategy:not-needed" }]), "not-needed");
  assert.equal(strategyFromLabels([{ name: "type:port-required" }]), null);
  assert.equal(strategyFromLabels([]), null);
  assert.equal(strategyFromLabels([{ name: "fix-strategy:garbage" }]), null);
});

test("parseStrategy reads the new strategy: first line", () => {
  const text = "strategy: essence-reimplement\n\n## Upstream intent\n...";
  assert.deepEqual(parseStrategy(text), { strategy: "essence-reimplement", source: "strategy" });
});

test("parseStrategy accepts backticked strategy values", () => {
  assert.equal(parseStrategy("strategy: `direct-merge`").strategy, "direct-merge");
});

test("parseStrategy grandfathers a legacy verdict: line (mapped)", () => {
  const text = "verdict: manual-port\n\nsome prose";
  assert.deepEqual(parseStrategy(text), { strategy: "adapted-port", source: "verdict" });
});

test("parseStrategy prefers the new strategy line over a stray verdict mention", () => {
  const text = "strategy: not-needed\n\nverdict: cherry-pick (old note)";
  assert.deepEqual(parseStrategy(text), { strategy: "not-needed", source: "strategy" });
});

test("parseStrategy returns null strategy when neither line is present", () => {
  assert.deepEqual(parseStrategy("# just a heading\nno machine line"), { strategy: null, source: null });
  assert.deepEqual(parseStrategy(""), { strategy: null, source: null });
  assert.deepEqual(parseStrategy(null), { strategy: null, source: null });
});

test("parseStrategy ignores an invalid strategy value on the first line", () => {
  // invalid first-line value → not matched as strategy; no verdict fallback → null
  assert.deepEqual(parseStrategy("strategy: wibble"), { strategy: null, source: null });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/_common/scripts/__tests__/fix-strategy.test.mjs`
Expected: FAIL — `Cannot find module '../fix-strategy.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `.claude/skills/_common/scripts/fix-strategy.mjs`:

```js
#!/usr/bin/env node
/**
 * fix-strategy.mjs — canonical fork-divergence-aware fix-strategy taxonomy.
 *
 * otto-cli is a HARD FORK, not a mirror. An upstream fix is ported in one of
 * four modes; this module is the single source of truth for the taxonomy, its
 * label/type mappings, and the guidance-line parser. Imported by cherry-pick
 * (parse-guidance, build-issue-payload, ensure-labels), and by merge/swarm
 * (refute panel) — never re-declare these constants elsewhere.
 */

/** The four fork-divergence-aware port strategies, in canonical order. */
export const FIX_STRATEGIES = [
  "direct-merge",        // cherry-pick / git am -3 applies clean
  "adapted-port",        // same fix, transcribed to our renamed/restructured paths
  "essence-reimplement", // diverged in behavior; re-solve the upstream root cause
  "not-needed",          // problem does not exist in our fork
];

/** Namespaced GitHub labels, one per strategy. */
export const STRATEGY_LABELS = FIX_STRATEGIES.map((s) => `fix-strategy:${s}`);

/** Legacy 3-way verdict → strategy (back-compat for pre-Phase-2 guidance). */
export const VERDICT_TO_STRATEGY = {
  "cherry-pick": "direct-merge",
  "manual-port": "adapted-port",
  "do-not-port": "not-needed",
};

/** Strategy → existing type:* label, preserving routing back-compat. */
const STRATEGY_TO_TYPE_LABEL = {
  "direct-merge": "type:cherry-pick-candidate",
  "adapted-port": "type:port-required",
  "essence-reimplement": "type:port-required",
  "not-needed": "type:do-not-port",
};

/** @returns {boolean} whether `v` is one of the four canonical strategies. */
export function isFixStrategy(v) {
  return FIX_STRATEGIES.includes(v);
}

/** @returns {string|null} `fix-strategy:<v>` label, or null if `v` is invalid. */
export function strategyToLabel(v) {
  return isFixStrategy(v) ? `fix-strategy:${v}` : null;
}

/** @returns {string|null} the type:* label for routing back-compat, or null. */
export function strategyToTypeLabel(v) {
  return STRATEGY_TO_TYPE_LABEL[v] ?? null;
}

/**
 * Extract the strategy from an issue's labels.
 * @param {Array<string|{name:string}>} labels
 * @returns {string|null}
 */
export function strategyFromLabels(labels = []) {
  for (const l of labels) {
    const name = typeof l === "string" ? l : l?.name;
    if (name && name.startsWith("fix-strategy:")) {
      const v = name.slice("fix-strategy:".length);
      if (isFixStrategy(v)) return v;
    }
  }
  return null;
}

/**
 * Parse the machine-readable strategy from a guidance file.
 * New format: the first non-empty line is `strategy: <value>` (backticks ok).
 * Legacy (grandfathered): a `verdict: <cherry-pick|manual-port|do-not-port>`
 * token anywhere → mapped via VERDICT_TO_STRATEGY.
 *
 * @returns {{strategy: string|null, source: "strategy"|"verdict"|null}}
 */
export function parseStrategy(text) {
  if (!text) return { strategy: null, source: null };
  const firstLine = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? "";
  const sm = firstLine.match(/^strategy:\s*`?([a-z-]+)`?/i);
  if (sm && isFixStrategy(sm[1].toLowerCase())) {
    return { strategy: sm[1].toLowerCase(), source: "strategy" };
  }
  const vm = text.match(/verdict:\s*`?(cherry-pick|manual-port|do-not-port)`?/i);
  if (vm) return { strategy: VERDICT_TO_STRATEGY[vm[1].toLowerCase()], source: "verdict" };
  return { strategy: null, source: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/_common/scripts/__tests__/fix-strategy.test.mjs`
Expected: PASS (all tests).

- [ ] **Step 5: Run the full regression net**

Run the full skill suite (see Pre-flight). Expected: 314 + new tests, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/_common/scripts/fix-strategy.mjs .claude/skills/_common/scripts/__tests__/fix-strategy.test.mjs
git commit -m "feat(upstream): add canonical fix-strategy taxonomy module"
```

---

### Task 2: `parse-guidance.mjs` — required-section schema with grandfather rule

**Files:**
- Create: `.claude/skills/upstream-cherry-pick/scripts/parse-guidance.mjs`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/parse-guidance.test.mjs`

Enforces the §2.1 schema. **Decision D:** strict required-section enforcement applies only to *new* (`strategy:`-format) files; legacy `verdict:`-only files are grandfathered (accepted as-is). Missing/empty guidance is invalid (the audit fails fast unless `--skip-guidance-check`).

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/upstream-cherry-pick/scripts/__tests__/parse-guidance.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateGuidance, REQUIRED_SECTIONS } from "../parse-guidance.mjs";

const FULL = `strategy: essence-reimplement

## Upstream intent / root cause
Upstream fixed a TOCTOU race in the settings writer.

## Fork relevance
yes — our pi-coding-agent settings manager has the same window.

## Divergence
We renamed the module and use an async lock; the patch won't apply.

## Concrete approach
**Essence to preserve:** the write must be atomic under concurrent saves.
Wrap our async lock around the read-modify-write.
`;

test("REQUIRED_SECTIONS lists the four human sections", () => {
  assert.deepEqual(
    REQUIRED_SECTIONS.map((s) => s.key),
    ["intent", "relevance", "divergence", "approach"],
  );
});

test("a complete new-format guidance file validates", () => {
  const r = validateGuidance(FULL, { path: "g/abc1234.md" });
  assert.equal(r.valid, true);
  assert.equal(r.strategy, "essence-reimplement");
  assert.equal(r.source, "strategy");
  assert.deepEqual(r.errors, []);
});

test("missing guidance (null/empty) is invalid", () => {
  for (const text of [null, "", "   \n  "]) {
    const r = validateGuidance(text, { path: "g/abc1234.md" });
    assert.equal(r.valid, false);
    assert.equal(r.strategy, null);
    assert.ok(r.errors.some((e) => /missing or empty/i.test(e)));
    assert.ok(r.errors.some((e) => /g\/abc1234\.md/.test(e)), "error names the path");
  }
});

test("new-format file missing a required section is invalid and names the section", () => {
  const noDivergence = FULL.replace(/## Divergence[\s\S]*?(?=## Concrete approach)/, "");
  const r = validateGuidance(noDivergence, { path: "g/x.md" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /Divergence/i.test(e)), `errors: ${r.errors}`);
});

test("essence-reimplement without an 'Essence to preserve' statement is invalid", () => {
  const noEssence = FULL.replace(/\*\*Essence to preserve:\*\* .*/i, "Just do the thing.");
  const r = validateGuidance(noEssence, { path: "g/x.md" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /essence to preserve/i.test(e)), `errors: ${r.errors}`);
});

test("non-essence new-format file does NOT require an essence statement", () => {
  const direct = FULL
    .replace("strategy: essence-reimplement", "strategy: adapted-port")
    .replace(/\*\*Essence to preserve:\*\* .*/i, "Transcribe the guard to pi-coding-agent.");
  const r = validateGuidance(direct, { path: "g/x.md" });
  assert.equal(r.valid, true, `errors: ${r.errors}`);
  assert.equal(r.strategy, "adapted-port");
});

test("legacy verdict-only file is grandfathered (valid, no section enforcement)", () => {
  const legacy = "verdict: manual-port\n\nTarget: packages/pi-ai/src/foo.ts. Apply the same guard.";
  const r = validateGuidance(legacy, { path: "g/legacy.md" });
  assert.equal(r.valid, true, `errors: ${r.errors}`);
  assert.equal(r.strategy, "adapted-port");
  assert.equal(r.source, "verdict");
  assert.deepEqual(r.errors, []);
});

test("a file with neither strategy nor verdict line is invalid", () => {
  const r = validateGuidance("## Some heading\nprose only", { path: "g/x.md" });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => /strategy:.*verdict:|machine-readable/i.test(e)));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/parse-guidance.test.mjs`
Expected: FAIL — `Cannot find module '../parse-guidance.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `.claude/skills/upstream-cherry-pick/scripts/parse-guidance.mjs`:

```js
#!/usr/bin/env node
/**
 * parse-guidance.mjs — required-section schema for otto-cli port guidance.
 *
 * §2.1 of the Phase-2 design. A new-format guidance file declares
 * `strategy: <value>` on its first line and must carry the four human
 * sections below; essence-reimplement must additionally state the essence to
 * preserve. Legacy `verdict:`-only files are GRANDFATHERED (accepted as-is, no
 * section enforcement) so re-runs over historical guidance dirs do not break.
 * Missing/empty guidance is invalid — run-audit fails fast unless
 * --skip-guidance-check.
 */
import { parseStrategy } from "../../_common/scripts/fix-strategy.mjs";

/** The four required human sections (the strategy line is validated separately). */
export const REQUIRED_SECTIONS = [
  { key: "intent", label: "Upstream intent / root cause", re: /upstream intent|root cause/i },
  { key: "relevance", label: "Fork relevance", re: /fork relevance/i },
  { key: "divergence", label: "Divergence", re: /divergence/i },
  { key: "approach", label: "Concrete approach", re: /concrete approach|essence to preserve/i },
];

/**
 * Validate a guidance file's text against the Phase-2 schema.
 * @param {string|null} text
 * @param {{path?: string}} [opts]
 * @returns {{strategy: string|null, source: "strategy"|"verdict"|null, valid: boolean, errors: string[]}}
 */
export function validateGuidance(text, { path } = {}) {
  const at = path ? ` (${path})` : "";
  if (!text || !text.trim()) {
    return { strategy: null, source: null, valid: false, errors: [`guidance missing or empty${at}`] };
  }

  const { strategy, source } = parseStrategy(text);
  const errors = [];

  if (!strategy) {
    errors.push(`no machine-readable \`strategy:\` (or legacy \`verdict:\`) line${at}`);
  }

  // Grandfather: enforce required sections ONLY on the new strategy: format.
  if (source === "strategy") {
    for (const sec of REQUIRED_SECTIONS) {
      if (!sec.re.test(text)) errors.push(`missing required section "${sec.label}"${at}`);
    }
    if (strategy === "essence-reimplement" && !/essence to preserve/i.test(text)) {
      errors.push(`strategy is essence-reimplement but no "Essence to preserve" statement${at}`);
    }
  }

  return { strategy, source, valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/parse-guidance.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full regression net** — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/parse-guidance.mjs .claude/skills/upstream-cherry-pick/scripts/__tests__/parse-guidance.test.mjs
git commit -m "feat(upstream): add guidance schema validator with grandfather rule"
```

---

### Task 3: `ensure-labels.mjs` — add the `fix-strategy:*` label dimension

**Files:**
- Modify: `.claude/skills/upstream-cherry-pick/scripts/ensure-labels.mjs:16-49`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/ensure-labels.test.mjs`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs:38-39`

Taxonomy grows 19→23. Two existing tests assert the count (`ensure-labels.test.mjs` and `init-scaffold.test.mjs`) — update both.

- [ ] **Step 1: Inspect the existing count assertions**

Run: `grep -rn "19\|23\|length" .claude/skills/upstream-cherry-pick/scripts/__tests__/ensure-labels.test.mjs`
Note every place `19` (or the taxonomy length) is asserted — these become `23`.

- [ ] **Step 2: Update the taxonomy and sanity check (implementation)**

In `.claude/skills/upstream-cherry-pick/scripts/ensure-labels.mjs`, add a Fix-strategy block after the `// Type` block (after line 23, the `type:do-not-port` entry):

```js
  // Fix-strategy (fork-divergence-aware port mode; coexists with type:*)
  { name: "fix-strategy:direct-merge", color: "0e8a16", description: "Cherry-pick / git am -3 applies clean" },
  { name: "fix-strategy:adapted-port", color: "fbca04", description: "Same fix, transcribed to renamed/restructured paths" },
  { name: "fix-strategy:essence-reimplement", color: "d93f0b", description: "Diverged in behavior; re-solve the upstream root cause" },
  { name: "fix-strategy:not-needed", color: "e11d21", description: "Problem does not exist in our fork" },
```

Then change the sanity check at `ensure-labels.mjs:45-48`:

```js
if (LABEL_TAXONOMY.length !== 23) {
  throw new Error(
    `LABEL_TAXONOMY must have exactly 23 entries, found ${LABEL_TAXONOMY.length}`,
  );
}
```

- [ ] **Step 3: Update the count assertions in the tests**

In `.claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs`, change the assertion at lines 38-39 from `19` to `23`:

```js
    const createCalls = ghCalls.filter((a) => a[0] === "label" && a[1] === "create");
    assert.equal(createCalls.length, 23);
```

In `.claude/skills/upstream-cherry-pick/scripts/__tests__/ensure-labels.test.mjs`, update every assertion that expects 19 labels/create-calls to 23 (use the grep output from Step 1). Add a focused assertion that the new dimension exists — append this test:

```js
test("taxonomy includes the four fix-strategy:* labels", async () => {
  const created = [];
  const ghRunner = (args) => {
    if (args[0] === "label" && args[1] === "list") return "";
    if (args[0] === "label" && args[1] === "create") { created.push(args[2]); return ""; }
    return "";
  };
  await ensureLabels({ targetRepo: "cmetech/otto-cli", ghRunner });
  for (const name of [
    "fix-strategy:direct-merge",
    "fix-strategy:adapted-port",
    "fix-strategy:essence-reimplement",
    "fix-strategy:not-needed",
  ]) {
    assert.ok(created.includes(name), `expected ${name} to be created`);
  }
});
```

> If `ensure-labels.test.mjs` does not already import `ensureLabels`, add `import { ensureLabels } from "../ensure-labels.mjs";` at the top.

- [ ] **Step 4: Run the affected tests**

Run: `node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/ensure-labels.test.mjs .claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs`
Expected: PASS (including the new fix-strategy test and the 23-count assertions).

- [ ] **Step 5: Run the full regression net** — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/ensure-labels.mjs .claude/skills/upstream-cherry-pick/scripts/__tests__/ensure-labels.test.mjs .claude/skills/upstream-cherry-pick/scripts/__tests__/init-scaffold.test.mjs
git commit -m "feat(upstream): add fix-strategy:* label dimension to taxonomy"
```

---

### Task 4: `build-issue-payload.mjs` — strategy label, heading, and essence callout

**Files:**
- Modify: `.claude/skills/upstream-cherry-pick/scripts/build-issue-payload.mjs` (`buildLabels` :89-106, `buildBody` :231-309, `verdictToTypeLabel` :75-87)
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/build-issue-payload.test.mjs`

Thread `strategy` (replacing the `verdict` param). When present: add the `fix-strategy:*` label (labels go 5→6), derive the type:* label from the strategy (back-compat routing), render a dedicated "Fix strategy" heading, and an "Essence to preserve" callout when `essence-reimplement`. When absent (no guidance / `--skip-guidance-check`): behavior is unchanged — 5 labels, risk-based type, no strategy section.

- [ ] **Step 1: Write the failing tests**

Append to `.claude/skills/upstream-cherry-pick/scripts/__tests__/build-issue-payload.test.mjs`:

```js
// ---------------------------------------------------------------------------
// Phase 2: fix-strategy label + body section
// ---------------------------------------------------------------------------

test("strategy adds the fix-strategy:* label (labels become 6) and drives type", () => {
  const { labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("CRITICAL_STABILITY"),
    conflictRisk: makeRisk("LOW", "touches pi-*"),
    upstream,
    ccUser: "@claude",
    strategy: "essence-reimplement",
  });
  assert.ok(labels.includes("fix-strategy:essence-reimplement"), `Got: ${labels}`);
  // essence-reimplement routes to type:port-required even at LOW risk
  assert.ok(labels.includes("type:port-required"), `Got: ${labels}`);
  assert.equal(labels.length, 6, `Expected 6 labels, got ${labels.length}: ${labels}`);
});

test("strategy not-needed routes type:do-not-port", () => {
  const { labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("NICE_TO_HAVE_FIX"),
    conflictRisk: makeRisk("HIGH", "heavy"),
    upstream,
    ccUser: "@claude",
    strategy: "not-needed",
  });
  assert.ok(labels.includes("fix-strategy:not-needed"), `Got: ${labels}`);
  assert.ok(labels.includes("type:do-not-port"), `Got: ${labels}`);
  assert.ok(!labels.includes("type:port-required"), `Got: ${labels}`);
});

test("no strategy → 5 labels, risk-based type (back-compat unchanged)", () => {
  const { labels } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk("MEDIUM", "reason"),
    upstream,
    ccUser: "@claude",
  });
  assert.equal(labels.length, 5, `Got: ${labels}`);
  assert.ok(!labels.some((l) => l.startsWith("fix-strategy:")), `Got: ${labels}`);
});

test("body renders a Fix strategy heading when strategy present", () => {
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("CRITICAL_STABILITY"),
    conflictRisk: makeRisk("LOW", "touches pi-*"),
    upstream,
    ccUser: "@claude",
    strategy: "adapted-port",
    implementationGuidance: "strategy: adapted-port\n\nTranscribe the guard.",
  });
  assert.ok(body.includes("## Fix strategy"), "Fix strategy heading present");
  assert.ok(body.includes("fix-strategy:adapted-port"), "strategy value shown");
});

test("essence-reimplement renders an 'Essence to preserve' callout", () => {
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("CRITICAL_STABILITY"),
    conflictRisk: makeRisk("LOW", "x"),
    upstream,
    ccUser: "@claude",
    strategy: "essence-reimplement",
    implementationGuidance: "strategy: essence-reimplement\n\n**Essence to preserve:** atomic write.",
  });
  assert.ok(body.includes("## Fix strategy"), "heading present");
  assert.ok(/Essence to preserve/i.test(body), "essence callout present");
  assert.ok(/re-solve|root cause/i.test(body), "callout signals re-solve, not transcribe");
});

test("no strategy → no Fix strategy heading (back-compat)", () => {
  const { body } = buildIssuePayload({
    commit: makeCommit(),
    classification: makeClassification("FEATURE"),
    conflictRisk: makeRisk(),
    upstream,
    ccUser: "@claude",
  });
  assert.ok(!body.includes("## Fix strategy"), "no strategy section when strategy absent");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/build-issue-payload.test.mjs`
Expected: FAIL — new tests fail (`fix-strategy:*` not in labels; no "## Fix strategy"). Pre-existing tests still pass.

- [ ] **Step 3: Update the implementation**

In `.claude/skills/upstream-cherry-pick/scripts/build-issue-payload.mjs`:

(a) Add the import at the top (after the file header comment, before `EMOJI_MAP`):

```js
import { strategyToLabel, strategyToTypeLabel } from "../../_common/scripts/fix-strategy.mjs";
```

(b) Replace `verdictToTypeLabel` (`:75-87`) and `buildLabels` (`:89-106`) with strategy-driven versions:

```js
/** Map a strategy to its type:* label (routing back-compat), or null. */
function typeLabelFor(strategy) {
  return strategyToTypeLabel(strategy);
}

function buildLabels({ classification, conflictRisk, upstream, strategy }) {
  const severityKebab = toKebab(classification.severity);
  const riskKebab = toKebab(conflictRisk.risk);

  // The analyzed strategy, when present, is authoritative over the deterministic
  // risk-based fallback (HIGH → port-required, else cherry-pick-candidate).
  const typeLabel =
    typeLabelFor(strategy) ??
    (conflictRisk.risk === "HIGH" ? "type:port-required" : "type:cherry-pick-candidate");

  const labels = [
    `upstream:${upstream.name}`,
    typeLabel,
    `severity:${severityKebab}`,
    `conflict-risk:${riskKebab}`,
    "status:triaged",
  ];

  // New audits set both type:* (routing) and fix-strategy:* (fork-divergence).
  const stratLabel = strategyToLabel(strategy);
  if (stratLabel) labels.push(stratLabel);

  return labels;
}
```

(c) Add a "Fix strategy" section builder before `buildBody` (after `renderUpstreamDiff`, around `:225`):

```js
const STRATEGY_BLURB = {
  "direct-merge": "Cherry-pick / `git am -3` applies clean. Apply the upstream change; the reviewer checks fidelity to the upstream diff.",
  "adapted-port": "Same fix, transcribed to our renamed/restructured paths. The reviewer checks fidelity to the upstream diff against the mapped files.",
  "essence-reimplement": "otto-cli has diverged in **behavior** — the upstream patch will not apply. **Re-solve the upstream root cause in our code; do not transcribe the diff.** The reviewer gate checks *“does this address the upstream root cause?”*, and the fix must author a root-cause regression test.",
  "not-needed": "The problem does not exist in our fork (justified by `Fork relevance: no`). Close without porting.",
};

function renderFixStrategy({ strategy }) {
  if (!strategy) return "";
  const blurb = STRATEGY_BLURB[strategy] ?? "";
  let out = `\n## Fix strategy\n\n**\`fix-strategy:${strategy}\`** — ${blurb}\n`;
  if (strategy === "essence-reimplement") {
    out +=
      "\n> ⚠️ **Essence to preserve.** This is a re-solve, not a transcribe. The " +
      "upstream diff is a reference for *intent*, not a target to match. Read the " +
      "guidance above for the documented essence (root cause + the property that " +
      "must hold), implement it the otto-cli way, and pin it with a new regression " +
      "test against our code.\n";
  }
  return out;
}
```

(d) In `buildBody` (`:231`), change the destructured param `verdict` to `strategy`, recompute `typeLabel` via `typeLabelFor`, build the strategy section, and insert it into the returned template. Replace the `typeLabel` line at `:236-238`:

```js
  const typeLabel =
    typeLabelFor(strategy) ??
    (conflictRisk.risk === "HIGH" ? "type:port-required" : "type:cherry-pick-candidate");
```

Add after the `diffSection` line (`:247`):

```js
  const fixStrategySection = renderFixStrategy({ strategy });
```

Insert `${fixStrategySection}` into the returned markdown immediately after the `${diffSection}` line and before `## Classification` (between `:263` and `:264`):

```js
${guidanceSection}
${diffSection}${fixStrategySection}
## Classification
```

(e) The top-level `buildIssuePayload` export (further down the file) currently destructures `verdict` and passes it to `buildLabels`/`buildBody`. Rename `verdict` → `strategy` at the export boundary so the public param is `strategy`. Find the `export function buildIssuePayload({ ... verdict ... })` and its internal calls, and replace `verdict` with `strategy` throughout.

> Run `grep -n verdict .claude/skills/upstream-cherry-pick/scripts/build-issue-payload.mjs` and confirm **zero** remaining references after the edit.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/build-issue-payload.test.mjs`
Expected: PASS (all old + new tests).

- [ ] **Step 5: Run the full regression net** — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/build-issue-payload.mjs .claude/skills/upstream-cherry-pick/scripts/__tests__/build-issue-payload.test.mjs
git commit -m "feat(upstream): emit fix-strategy label + strategy heading + essence callout"
```

---

### Task 5: `run-audit.mjs` — fail-fast guidance validation + thread strategy + `--skip-guidance-check`

**Files:**
- Modify: `.claude/skills/upstream-cherry-pick/scripts/run-audit.mjs` (parseArgs :64-90, parseVerdict :141-150, payload loop :303-320)
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/run.test.mjs` (or a new `run-audit-guidance.test.mjs` if `run.test.mjs` is integration-heavy)

Replace the silent `parseVerdict` + `runData.unanalyzed++` with fail-fast `validateGuidance`. Skip validation in `--dry-run` (the scan stage authors guidance) and under `--skip-guidance-check`. Thread `strategy` into `buildIssuePayload`.

- [ ] **Step 1: Inspect the existing run-audit test surface**

Run: `grep -n "verdict\|unanalyzed\|guidance\|skipGuidance\|export\|function run" .claude/skills/upstream-cherry-pick/scripts/run-audit.mjs .claude/skills/upstream-cherry-pick/scripts/__tests__/run.test.mjs`
Decide: if `run-audit.mjs` exposes a unit-testable helper (e.g. exports `parseArgs` or a guidance-resolver), test it directly; otherwise add a small exported helper `resolveStrategy({ guidanceText, guidancePath, flags })` and unit-test that. Prefer the helper — it keeps the new behavior testable without a full pipeline run.

- [ ] **Step 2: Write the failing test**

Create `.claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-guidance.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveStrategy } from "../run-audit.mjs";

const FULL = `strategy: adapted-port

## Upstream intent / root cause
x
## Fork relevance
yes
## Divergence
y
## Concrete approach
z
`;

test("real run: valid guidance resolves the strategy", () => {
  const r = resolveStrategy({ guidanceText: FULL, guidancePath: "g/a.md", flags: {} });
  assert.equal(r.strategy, "adapted-port");
});

test("real run: missing guidance throws fail-fast naming the path", () => {
  assert.throws(
    () => resolveStrategy({ guidanceText: null, guidancePath: "g/abc1234.md", flags: {} }),
    /abc1234\.md/,
  );
});

test("real run: malformed new-format guidance throws fail-fast", () => {
  const bad = "strategy: adapted-port\n\n## Upstream intent\nx"; // missing relevance/divergence/approach
  assert.throws(() => resolveStrategy({ guidanceText: bad, guidancePath: "g/x.md", flags: {} }), /Divergence|Fork relevance|Concrete approach/);
});

test("--dry-run skips validation and never throws on missing guidance", () => {
  const r = resolveStrategy({ guidanceText: null, guidancePath: "g/x.md", flags: { dryRun: true } });
  assert.equal(r.strategy, null);
});

test("--skip-guidance-check bypasses fail-fast but still parses a present strategy", () => {
  const r1 = resolveStrategy({ guidanceText: null, guidancePath: "g/x.md", flags: { skipGuidanceCheck: true } });
  assert.equal(r1.strategy, null);
  const r2 = resolveStrategy({ guidanceText: FULL, guidancePath: "g/x.md", flags: { skipGuidanceCheck: true } });
  assert.equal(r2.strategy, "adapted-port");
});

test("legacy verdict-only guidance is grandfathered on a real run", () => {
  const r = resolveStrategy({ guidanceText: "verdict: do-not-port\n\nsuperseded", guidancePath: "g/x.md", flags: {} });
  assert.equal(r.strategy, "not-needed");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-guidance.test.mjs`
Expected: FAIL — `resolveStrategy` is not exported.

- [ ] **Step 4: Update the implementation**

In `.claude/skills/upstream-cherry-pick/scripts/run-audit.mjs`:

(a) Add imports near the other script imports (`:35-48`):

```js
import { validateGuidance } from "./parse-guidance.mjs";
import { parseStrategy } from "../../_common/scripts/fix-strategy.mjs";
```

(b) Add the two flags in `parseArgs` defaults (`:65-74`) and the parse switch (`:78-86`):

```js
    skipGuidanceCheck: false,
    revalidateDoNotPort: false,
```
```js
    else if (a === "--skip-guidance-check") flags.skipGuidanceCheck = true;
    else if (a === "--revalidate-do-not-port") flags.revalidateDoNotPort = true;
```

(c) Replace `parseVerdict` (`:141-150`) with an exported `resolveStrategy`:

```js
/**
 * Resolve the fix-strategy for a candidate, failing fast on invalid guidance.
 * Real runs require valid guidance; --dry-run (scan stage) and
 * --skip-guidance-check bypass the fail-fast and best-effort parse instead.
 */
export function resolveStrategy({ guidanceText, guidancePath, flags = {} }) {
  if (flags.dryRun || flags.skipGuidanceCheck) {
    return { strategy: parseStrategy(guidanceText).strategy };
  }
  const result = validateGuidance(guidanceText, { path: guidancePath });
  if (!result.valid) {
    throw new Error(
      `Guidance validation failed:\n  - ${result.errors.join("\n  - ")}\n` +
        `Author/repair the guidance file, or re-run with --skip-guidance-check (audit/dry-run only).`,
    );
  }
  return { strategy: result.strategy };
}
```

(d) Rewrite the payload-loop block (`:303-320`). Replace:

```js
    const implementationGuidance = readGuidance(flags.guidanceDir, commit.sha);
    const verdict = parseVerdict(implementationGuidance);
    const diff = flags.embedDiff ? readDiff(upstream.path, commit.sha) : null;
    const payload = buildIssuePayload({
      ...
      verdict,
    });
    if (!implementationGuidance) runData.unanalyzed = (runData.unanalyzed ?? 0) + 1;
```

with:

```js
    const sha7 = commit.sha.slice(0, 7);
    const guidancePath = join(flags.guidanceDir, `${sha7}.md`);
    const implementationGuidance = readGuidance(flags.guidanceDir, commit.sha);
    const { strategy } = resolveStrategy({
      guidanceText: implementationGuidance,
      guidancePath,
      flags,
    });
    const diff = flags.embedDiff ? readDiff(upstream.path, commit.sha) : null;
    const payload = buildIssuePayload({
      commit,
      classification,
      conflictRisk,
      upstream: { name, ghRepo: upstream.ghRepo, path: upstream.path },
      prContext,
      issueContexts,
      ccUser: cfg.issueFiling.ccUser,
      heavyFiles,
      implementationGuidance,
      diff,
      strategy,
    });
    if (!implementationGuidance) runData.unanalyzed = (runData.unanalyzed ?? 0) + 1;
```

> The `runData.unanalyzed` counter now only ever increments under `--skip-guidance-check` (a real run without guidance throws before reaching it); keep it so the report still flags placeholder issues in skip mode.

(e) Document the two new flags in the header comment block (`:16-27`):

```js
 *   --skip-guidance-check  bypass fail-fast guidance schema validation
 *                          (audit/dry-run only; files placeholder issues).
 *   --revalidate-do-not-port  re-surface existing type:do-not-port issues for a
 *                          fresh Fork-relevance check (see revalidate-do-not-port.mjs).
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-guidance.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the full regression net** — expected 0 fail. If `run.test.mjs`/`integration.test.mjs` exercised the old `verdict` path or the silent-unanalyzed behavior, update those expectations to the fail-fast/strategy behavior.

- [ ] **Step 7: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/run-audit.mjs .claude/skills/upstream-cherry-pick/scripts/__tests__/run-audit-guidance.test.mjs
git commit -m "feat(upstream): fail-fast guidance validation + thread strategy in run-audit"
```

---

### Task 6: `revalidate-do-not-port.mjs` — re-surface mechanically-classified do-not-port issues

**Files:**
- Create: `.claude/skills/upstream-cherry-pick/scripts/revalidate-do-not-port.mjs`
- Test: `.claude/skills/upstream-cherry-pick/scripts/__tests__/revalidate-do-not-port.test.mjs`
- Modify: `.claude/skills/upstream-cherry-pick/scripts/run-audit.mjs` (wire `--revalidate-do-not-port` early-return)

**Decision B:** build the flag. The 147 existing `type:do-not-port` issues were classified *mechanically* (paths don't align), before the intent-first Fork-relevance model — some may actually be `essence-reimplement`. This pass produces a manifest of those issues (number, sha, subject) so a dispatcher can re-author guidance under the new criterion. It does **not** mass-relabel.

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/upstream-cherry-pick/scripts/__tests__/revalidate-do-not-port.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRevalidationManifest } from "../revalidate-do-not-port.mjs";

test("includes only type:do-not-port issues and extracts the sha", () => {
  const issues = [
    { number: 10, title: "[upstream/pi-dev] 🐛 fix x [sha=abc1234]", labels: [{ name: "type:do-not-port" }], body: "...sha=abc1234..." },
    { number: 11, title: "keep me out", labels: [{ name: "type:cherry-pick-candidate" }], body: "sha=def5678" },
  ];
  const m = buildRevalidationManifest(issues);
  assert.equal(m.length, 1);
  assert.equal(m[0].number, 10);
  assert.equal(m[0].sha, "abc1234");
  assert.equal(m[0].hasNewGuidance, false);
});

test("falls back to title sha when body lacks one and tolerates missing sha", () => {
  const issues = [
    { number: 12, title: "x [sha=9999999]", labels: [{ name: "type:do-not-port" }], body: "no key here" },
    { number: 13, title: "no sha anywhere", labels: [{ name: "type:do-not-port" }], body: "none" },
  ];
  const m = buildRevalidationManifest(issues);
  assert.equal(m.find((x) => x.number === 12).sha, "9999999");
  assert.equal(m.find((x) => x.number === 13).sha, null);
});

test("accepts string labels too", () => {
  const m = buildRevalidationManifest([
    { number: 14, title: "t [sha=aaaaaaa]", labels: ["type:do-not-port"], body: "" },
  ]);
  assert.equal(m.length, 1);
  assert.equal(m[0].sha, "aaaaaaa");
});

test("empty input yields empty manifest", () => {
  assert.deepEqual(buildRevalidationManifest([]), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/revalidate-do-not-port.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `.claude/skills/upstream-cherry-pick/scripts/revalidate-do-not-port.mjs`:

```js
#!/usr/bin/env node
/**
 * revalidate-do-not-port.mjs — re-surface mechanically-classified do-not-port
 * issues for a fresh Fork-relevance check (Phase-2 §2 / open question).
 *
 * The pre-Phase-2 do-not-port issues were classified by path-alignment alone.
 * The intent-first model may reclassify some as essence-reimplement (the patch
 * was inapplicable, but the underlying bug still affects our fork). This pass
 * lists those issues as a manifest; it does NOT mass-relabel.
 *
 * CLI:  node revalidate-do-not-port.mjs [targetRepo]
 *       Prints a JSON manifest to stdout.
 */
import { execFileSync } from "node:child_process";

const SHA_RE = /sha=([0-9a-f]{7,40})/i;

function labelNames(labels = []) {
  return labels.map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);
}

function extractSha(issue) {
  const fromBody = (issue.body ?? "").match(SHA_RE);
  if (fromBody) return fromBody[1].slice(0, 7);
  const fromTitle = (issue.title ?? "").match(SHA_RE);
  return fromTitle ? fromTitle[1].slice(0, 7) : null;
}

/**
 * Build the revalidation manifest from a list of fetched issues.
 * @param {Array<{number:number, title:string, body:string, labels:Array}>} issues
 * @returns {Array<{number:number, sha:string|null, title:string, hasNewGuidance:boolean}>}
 */
export function buildRevalidationManifest(issues) {
  return issues
    .filter((i) => labelNames(i.labels).includes("type:do-not-port"))
    .map((i) => ({ number: i.number, sha: extractSha(i), title: i.title, hasNewGuidance: false }));
}

function defaultGhRunner(args) {
  return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
}

/** Fetch all type:do-not-port issues and build the manifest. */
export function revalidateDoNotPort({ targetRepo, ghRunner = defaultGhRunner }) {
  const raw = ghRunner([
    "issue", "list",
    "--repo", targetRepo,
    "--label", "type:do-not-port",
    "--state", "all",
    "--limit", "1000",
    "--json", "number,title,body,labels",
  ]);
  const issues = JSON.parse(raw || "[]");
  return buildRevalidationManifest(issues);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const targetRepo = process.argv[2] ?? "cmetech/otto-cli";
  try {
    const manifest = revalidateDoNotPort({ targetRepo });
    process.stdout.write(JSON.stringify({ count: manifest.length, manifest }, null, 2) + "\n");
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message ?? String(err) }) + "\n");
    process.exit(1);
  }
}
```

- [ ] **Step 4: Wire the flag into run-audit**

In `.claude/skills/upstream-cherry-pick/scripts/run-audit.mjs`, import and handle the early-return. Add import:

```js
import { revalidateDoNotPort } from "./revalidate-do-not-port.mjs";
```

In the main run function, after config is loaded but before the harvest/commit loop, add:

```js
  if (flags.revalidateDoNotPort) {
    const manifest = revalidateDoNotPort({ targetRepo: cfg.targetRepo });
    process.stdout.write(JSON.stringify({ count: manifest.length, manifest }, null, 2) + "\n");
    return;
  }
```

> Place this where the other early-return modes (e.g. `--manifest`) are handled so it short-circuits before issue filing. Confirm the surrounding function can `return` cleanly here (mirror the `--manifest` handling pattern).

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test .claude/skills/upstream-cherry-pick/scripts/__tests__/revalidate-do-not-port.test.mjs`
Expected: PASS.

- [ ] **Step 6: Run the full regression net** — expected 0 fail.

- [ ] **Step 7: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/scripts/revalidate-do-not-port.mjs .claude/skills/upstream-cherry-pick/scripts/__tests__/revalidate-do-not-port.test.mjs .claude/skills/upstream-cherry-pick/scripts/run-audit.mjs
git commit -m "feat(upstream): add --revalidate-do-not-port manifest pass"
```

---

### Task 7: `upstream-cherry-pick/SKILL.md` — strategy schema contract (doc-only)

**Files:**
- Modify: `.claude/skills/upstream-cherry-pick/SKILL.md` (`:55-111` — the guidance contract + machine-readable verdict section + two-stage workflow)

Documentation must match the new code. No test; verify by grep.

- [ ] **Step 1: Replace the guidance-points list (`:55-69`)**

Update the four numbered guidance points to the five required §2.1 sections. Replace the list at `:60-69` so it reads:

```markdown
1. **Upstream intent / root cause** — what bug or behavior was upstream fixing?
   (Not "what the diff does" — *why* it exists.)
2. **Fork relevance** — is that problem present in *our* hard fork given our
   customizations? `yes` / `partial` / `no`, with reasoning. A `no` is the
   positive justification for `not-needed`.
3. **Fix strategy** — one of the four values below (machine-readable first line).
4. **Divergence** — how otto-cli's code differs from upstream here.
5. **Concrete approach** — exact edits for `direct-merge`/`adapted-port`; a design
   sketch (**Essence to preserve** + how to realize it in our code) for
   `essence-reimplement`.
```

- [ ] **Step 2: Replace the "machine-readable `verdict:` line" section (`:71-89`)**

Replace the entire `### The machine-readable verdict: line (REQUIRED)` block with:

```markdown
### The machine-readable `strategy:` line (REQUIRED)

Each guidance file's **first line** must be a literal, machine-readable strategy:

```
strategy: essence-reimplement   # direct-merge | adapted-port | essence-reimplement | not-needed
```

`run-audit.mjs` validates the guidance via `parse-guidance.mjs` (schema: the four
sections above must be present; `essence-reimplement` must state **Essence to
preserve**). A missing/malformed *new-format* file **fails the run fast** and names
the offending path — repair it, or re-run with `--skip-guidance-check`
(audit/dry-run only) to file placeholder issues.

**The four strategies (fork-divergence-aware):**

- `direct-merge` — cherry-pick / `git am -3` applies clean. → `type:cherry-pick-candidate`
- `adapted-port` — same fix, transcribed to our renamed/restructured paths. → `type:port-required`
- `essence-reimplement` — diverged in *behavior*; the patch won't apply; re-solve
  the upstream root cause in our code (requires **Essence to preserve**). → `type:port-required`
- `not-needed` — the problem does not exist in our fork (justified by
  `Fork relevance: no`). → `type:do-not-port`

The parsed strategy drives **two** labels: the new `fix-strategy:*` dimension and
(for routing back-compat) the existing `type:*` label. **Back-compat:** a legacy
`verdict:` line is grandfathered — `cherry-pick → direct-merge`,
`manual-port → adapted-port`, `do-not-port → not-needed` — and legacy files skip
section enforcement. New guidance uses `strategy:`.
```

- [ ] **Step 3: Update the two-stage workflow wording (`:103-111`)**

In the "File." paragraph (`:102-108`), replace the "missing a guidance file is filed with an explicit ⚠️ Not yet analyzed banner" sentence to reflect fail-fast:

```markdown
2. **File.** Run the orchestrator *without* `--dry-run`. It reads
   `guidance/<sha7>.md` for each candidate, **validates it against the schema**,
   embeds it plus the upstream diff into the issue body, and files. A candidate
   with **missing or malformed** guidance **aborts the run** (naming the path) so
   no thin issue is filed — author the guidance and re-run, or pass
   `--skip-guidance-check` to deliberately file placeholders.
```

Add a `--revalidate-do-not-port` bullet near the `--no-diff`/`--guidance-dir` note (`:110-111`):

```markdown
`--revalidate-do-not-port` prints a JSON manifest of existing `type:do-not-port`
issues to re-examine against the new `Fork relevance` criterion (no relabeling).
```

- [ ] **Step 4: Verify the doc matches the code**

Run: `grep -n "strategy:\|fix-strategy\|skip-guidance-check\|revalidate-do-not-port\|Essence to preserve" .claude/skills/upstream-cherry-pick/SKILL.md`
Expected: the new terms present. Run: `grep -n "verdict:" .claude/skills/upstream-cherry-pick/SKILL.md` — only the grandfather mention should remain.

- [ ] **Step 5: Run the full regression net** — expected 0 fail (no code changed, but confirm).

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-cherry-pick/SKILL.md
git commit -m "docs(upstream): document fix-strategy schema, flags, and taxonomy"
```

---

### Task 8: `upstream-fix/SKILL.md` — strategy-branching fix subagent + reviewer gate (doc-only)

**Files:**
- Modify: `.claude/skills/upstream-fix/SKILL.md` (fix-subagent prompt `:111-166`, reviewer-subagent prompt `:170-188`)

**Decision A:** when an issue has no `fix-strategy:*` label and no new-format guidance, the fix subagent classifies inline (reads the upstream diff + our code, picks one of four, sets the label) — no full guidance-file regen. **Spec risk note:** `essence-reimplement` has no upstream test that maps, so the subagent must author a root-cause regression test against our code.

- [ ] **Step 1: Add a strategy-resolution step to the fix-subagent prompt**

In `.claude/skills/upstream-fix/SKILL.md`, after the CONFIDENCE GATE (step 0, `:130-137`) and before REGRESSION TEST (step 1, `:139`), insert a new step:

````markdown
0b. STRATEGY. Determine the fix-strategy for this issue:
    - If the issue carries a `fix-strategy:*` label, use it.
    - Else read the guidance file's first line (`strategy: <value>`), or a
      grandfathered `verdict:` line.
    - Else (pre-Phase-2 issue, no strategy): CLASSIFY INLINE — from the upstream
      diff + the actual otto-cli source, pick exactly one of `direct-merge`,
      `adapted-port`, `essence-reimplement`, `not-needed`, and set the label:
        gh issue edit <num> --repo cmetech/otto-cli --add-label fix-strategy:<value>
      For `essence-reimplement`, write a one-line **Essence to preserve** note in
      your issue comment (the root cause + the property that must hold in our code).
    The strategy decides how the REGRESSION TEST and the reviewer gate are judged.
````

- [ ] **Step 2: Make the regression-test step strategy-aware**

In the REGRESSION TEST step (`:139-147`), append an essence clause:

````markdown
   For `essence-reimplement` there is usually **no upstream test that maps** — you
   MUST AUTHOR a regression test that pins the **root cause in our code** (the
   Essence to preserve), not a transcription of an upstream test. It MUST fail
   before your fix and pass after. This is the anchor that keeps an essence port
   from landing without a real failing-then-passing gate.
````

- [ ] **Step 3: Make the reviewer-subagent prompt branch on strategy**

Replace the Judge line in the reviewer-subagent prompt template (`:180-181`) with a strategy-aware version:

````markdown
   - Determine the issue's `fix-strategy:*` (label or guidance).
   - Judge by strategy:
     - `direct-merge` / `adapted-port`: does the diff faithfully apply/transcribe
       the upstream change to the correct otto-cli files, without regressions or
       scope creep? (Catch "passes tests but wrong/incomplete".)
     - `essence-reimplement`: **does this address the upstream ROOT CAUSE** in our
       diverged code? The upstream diff is a reference for *intent*, NOT a target
       to match — do not reject for failing to mirror the diff; reject if the root
       cause is not actually resolved or the regression test does not pin it.
````

- [ ] **Step 4: Verify**

Run: `grep -n "fix-strategy\|essence-reimplement\|root cause\|Essence to preserve\|STRATEGY" .claude/skills/upstream-fix/SKILL.md`
Expected: the new branching prose present in both the fix and reviewer templates.

- [ ] **Step 5: Run the full regression net** — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-fix/SKILL.md
git commit -m "docs(upstream-fix): strategy-aware fix subagent + divergence-aware reviewer gate"
```

---

### Task 9: refute panel + merge/swarm reviewer — strategy-aware (Decision C: include swarm)

**Files:**
- Modify: `.claude/skills/upstream-merge/scripts/refute-panel.mjs` (`buildInputBundle` :108-147)
- Test: `.claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs`
- Modify: `.claude/skills/upstream-merge/SKILL.md` and `.claude/skills/upstream-swarm/SKILL.md` (the `upstream-alignment` lens prompt)

The refute panel lives in `upstream-merge` and is reused by `upstream-swarm` — making the bundle carry `fixStrategy` and the `upstream-alignment` lens branch on it covers **both** the supervised and autonomous paths.

- [ ] **Step 1: Write the failing test**

Append to `.claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs`:

```js
import { buildInputBundle } from "../refute-panel.mjs";

test("buildInputBundle carries fixStrategy from the issue's labels", () => {
  const ghRunner = (args) => {
    if (args[1] === "pr" && args[2] === "view") return JSON.stringify({ number: 5, title: "t", body: "b", headRefOid: "sha" });
    if (args[1] === "pr" && args[2] === "diff") return "diff";
    if (args[1] === "issue" && args[2] === "view") {
      return JSON.stringify({ number: 9, body: "ib", labels: [
        { name: "upstream:pi-dev" }, { name: "severity:critical-stability" },
        { name: "fix-strategy:essence-reimplement" },
      ] });
    }
    return "";
  };
  const gitRunner = () => "commit show output";
  const bundle = buildInputBundle({
    prNumber: 5, issueNumber: 9, upstreamSha: "abc1234",
    ghRunner, gitRunner, upstreamRoot: "/tmp/pi",
  });
  assert.equal(bundle.fixStrategy, "essence-reimplement");
});

test("buildInputBundle fixStrategy is null when no fix-strategy label", () => {
  const ghRunner = (args) => {
    if (args[1] === "pr" && args[2] === "view") return JSON.stringify({ number: 5, title: "t", body: "b", headRefOid: "sha" });
    if (args[1] === "pr" && args[2] === "diff") return "diff";
    if (args[1] === "issue" && args[2] === "view") return JSON.stringify({ number: 9, body: "ib", labels: [{ name: "upstream:pi-dev" }] });
    return "";
  };
  const bundle = buildInputBundle({
    prNumber: 5, issueNumber: 9, upstreamSha: "abc1234",
    ghRunner, gitRunner: () => "show", upstreamRoot: "/tmp/pi",
  });
  assert.equal(bundle.fixStrategy, null);
});
```

> Match the import style already used at the top of `refute-panel.test.mjs` (it may already import from `../refute-panel.mjs` — if so, add `buildInputBundle` to the existing import instead of adding a duplicate line). Confirm the `ghRunner` arg-shape matches how the existing tests stub it (the real calls are `["pr","view",...]` — adjust the `args[1]/args[2]` indices in the stub to match the actual `execFileSync("gh", args)` convention where `args[0]` is `"pr"`). Verify against an existing passing test in the file before finalizing indices.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs`
Expected: FAIL — `bundle.fixStrategy` is `undefined`.

- [ ] **Step 3: Update `buildInputBundle`**

In `.claude/skills/upstream-merge/scripts/refute-panel.mjs`:

(a) Add the import (after the existing imports, `:9-11`):

```js
import { strategyFromLabels } from "../../_common/scripts/fix-strategy.mjs";
```

(b) In `buildInputBundle`, add `fixStrategy` to the returned bundle (after `conflictRisk:` at `:145`):

```js
    severity: severityFromLabels(issueView.labels),
    conflictRisk: riskFromLabels(issueView.labels),
    fixStrategy: strategyFromLabels(issueView.labels),
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test .claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs`
Expected: PASS.

- [ ] **Step 5: Make the `upstream-alignment` lens prompt strategy-aware (doc, both skills)**

The lens prompts are wired by the SKILL.md orchestration (the `agentRunner`). Find the `upstream-alignment` lens prompt in `.claude/skills/upstream-merge/SKILL.md` (search: `grep -n "upstream-alignment" .claude/skills/upstream-merge/SKILL.md`) and add a strategy branch to its instruction. Insert:

```markdown
When `bundle.fixStrategy` is `essence-reimplement`, judge **alignment to the
upstream INTENT / root cause**, NOT diff-fidelity — otto-cli has diverged in
behavior, so the PR will (correctly) not mirror the upstream diff. Refute only if
the PR fails to resolve the documented root cause. For `direct-merge` /
`adapted-port`, judge fidelity to the upstream change as before.
```

Apply the **same** insertion to the swarm's refute-lens description in
`.claude/skills/upstream-swarm/SKILL.md` (search: `grep -n "upstream-alignment\|refute" .claude/skills/upstream-swarm/SKILL.md`). If the swarm references the merge skill's lens definitions rather than restating them, add a one-line pointer noting the strategy branch instead of duplicating.

- [ ] **Step 6: Verify**

Run: `grep -n "fixStrategy\|essence-reimplement\|root cause" .claude/skills/upstream-merge/SKILL.md .claude/skills/upstream-swarm/SKILL.md`
Expected: the strategy branch present in both (or the merge SKILL.md + a swarm pointer).

- [ ] **Step 7: Run the full regression net** — expected 0 fail.

- [ ] **Step 8: Commit**

```bash
git add -f .claude/skills/upstream-merge/scripts/refute-panel.mjs .claude/skills/upstream-merge/scripts/__tests__/refute-panel.test.mjs .claude/skills/upstream-merge/SKILL.md .claude/skills/upstream-swarm/SKILL.md
git commit -m "feat(upstream): strategy-aware refute panel + alignment lens (merge + swarm)"
```

---

### Task 10: Final verification + branch finalize

**Files:** none (verification only)

- [ ] **Step 1: Run the complete skill suite**

Run the full glob from Pre-flight.
Expected: all pass (314 baseline + the new Phase-2 tests), 0 fail.

- [ ] **Step 2: Grep for stragglers**

Run: `grep -rn "parseVerdict\|verdictToTypeLabel" .claude/skills/upstream-cherry-pick/scripts/`
Expected: no references in production code (only the grandfather mapping lives in `_common/fix-strategy.mjs` via `VERDICT_TO_STRATEGY`).

Run: `grep -rn "import.*upstream-\(fix\|merge\|swarm\)/scripts" .claude/skills/`
Expected: still zero cross-skill imports (Phase 1 invariant preserved — new imports point only at `../../_common/scripts/`).

- [ ] **Step 3: Confirm the strategy threading is end-to-end consistent**

Run: `grep -rn "strategy" .claude/skills/upstream-cherry-pick/scripts/run-audit.mjs .claude/skills/upstream-cherry-pick/scripts/build-issue-payload.mjs`
Expected: `run-audit` resolves `strategy` and passes it to `buildIssuePayload`; `build-issue-payload` consumes `strategy` (no `verdict` param remains).

- [ ] **Step 4: Finalize the branch**

Use `superpowers:finishing-a-development-branch`. Per the established workflow, this phase merges to `main` (one PR per phase). Confirm with Corey whether to open a PR or merge `feat/upstream-hardening-phase-2` directly (`--no-ff`), matching how Phase 0+1 landed (`0cf2b583`).

- [ ] **Step 5: Update the memory file**

After merge, update `project_upstream_pipeline_hardening.md`: mark Phase 2 DONE (commit sha, final suite count), and note the decisions baked in (inline-classify for old issues, `--revalidate-do-not-port` flag built, swarm included via shared refute panel, legacy verdict grandfathered).

---

## Self-Review (run before execution)

**Spec coverage (§2.1–§2.5 + open questions):**
- §2.1 Required guidance schema (enforced, fail-fast) → Task 2 (`validateGuidance`) + Task 5 (`resolveStrategy` fail-fast in run-audit). ✅
- §2.2 Fix-strategy taxonomy + legacy verdict back-compat → Task 1 (`FIX_STRATEGIES`, `VERDICT_TO_STRATEGY`, `parseStrategy`). ✅
- §2.3 Label dimension + issue representation (own heading, essence callout, no mass relabel) → Task 3 (labels) + Task 4 (payload heading/callout/label). Lazy backfill → Task 8 (fix subagent sets the label). ✅
- §2.4 upstream-fix branches on strategy (essence reviewer checks root cause; author regression test) → Task 8. ✅
- §2.5 robust dedup DROPPED → not in plan. ✅
- Sharpened Phase-0 item: verdict regex scanned whole file + silent risk fallback → folded into schema validation (Task 1 `parseStrategy` first-line + Task 5 fail-fast replaces the silent fallback). ✅
- Open question "essence weakens regression anchor" → Task 8 Step 2 makes the root-cause regression test explicit in the subagent contract. ✅
- Decision A (inline classify) → Task 8 Step 1. Decision B (`--revalidate-do-not-port` built) → Task 6. Decision C (include swarm) → Task 9. Decision D (grandfather verdict-only) → Task 2 (`source === "strategy"` gate). ✅

**Placeholder scan:** every code step has full source; SKILL.md steps have exact insertion text + a grep verification. No TBD/TODO.

**Type consistency:** `strategy` (string) is the single threaded value; `resolveStrategy` returns `{strategy}`; `buildIssuePayload`/`buildLabels`/`buildBody` all consume `strategy`; `strategyFromLabels`/`strategyToLabel`/`strategyToTypeLabel`/`parseStrategy`/`validateGuidance` names are used identically across Tasks 1, 2, 4, 5, 9. `bundle.fixStrategy` is the only camelCase variant (a bundle field, matching the file's existing `conflictRisk` style).

**Known watch-points for the executor:**
- Task 9 Step 1: the `ghRunner` stub arg indices must match the file's existing test convention — verify against a passing test before trusting the indices in the snippet.
- Task 5 Step 4(d): confirm the early-return for `--revalidate-do-not-port` (Task 6 Step 4) sits with the other early-return modes so it short-circuits before filing.
- Tasks 7/8/9 doc edits change no code but still run the suite to prove nothing regressed.
