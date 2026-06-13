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
  assert.deepEqual(parseStrategy("strategy: wibble"), { strategy: null, source: null });
});

test("parseStrategy handles mixed-case strategy and verdict (i flag + toLowerCase)", () => {
  assert.deepEqual(parseStrategy("strategy: ESSENCE-Reimplement"), { strategy: "essence-reimplement", source: "strategy" });
  assert.deepEqual(parseStrategy("verdict: Manual-Port"), { strategy: "adapted-port", source: "verdict" });
});

test("parseStrategy tolerates no space after the colon", () => {
  assert.equal(parseStrategy("strategy:direct-merge").strategy, "direct-merge");
});
