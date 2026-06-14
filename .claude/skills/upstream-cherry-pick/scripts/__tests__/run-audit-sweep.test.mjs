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
