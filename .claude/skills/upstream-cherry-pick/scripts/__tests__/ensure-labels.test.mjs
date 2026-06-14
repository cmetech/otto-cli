import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureLabels } from "../ensure-labels.mjs";

test("creates missing labels and reports existing", async () => {
  const existing = new Set(["upstream:pi-dev", "status:triaged"]);
  const createCalls = [];
  const ghRunner = (args) => {
    if (args[0] === "label" && args[1] === "list") {
      return [...existing].join("\n") + "\n";
    }
    if (args[0] === "label" && args[1] === "create") {
      createCalls.push(args[2]); // label name
      return "";
    }
    throw new Error("unexpected gh call: " + args.join(" "));
  };
  const result = await ensureLabels({ targetRepo: "foo/bar", ghRunner });
  assert.equal(result.existing.length, 2);
  assert.ok(result.existing.includes("upstream:pi-dev"));
  assert.equal(result.created.length, 25); // 27 total - 2 existing
  assert.equal(result.errors.length, 0);
  assert.equal(createCalls.length, 25);
  // Verify a specific created label
  assert.ok(createCalls.includes("severity:critical-security"));
});

test("captures create errors without aborting", async () => {
  let createCallCount = 0;
  const ghRunner = (args) => {
    if (args[0] === "label" && args[1] === "list") return "";
    if (args[0] === "label" && args[1] === "create") {
      createCallCount++;
      if (createCallCount === 5) throw new Error("rate limited");
      return "";
    }
    throw new Error("unexpected");
  };
  const result = await ensureLabels({ targetRepo: "foo/bar", ghRunner });
  assert.equal(result.created.length, 26); // 27 - 1 failed
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /rate limited/);
});

test("returns all-existing when every label is present", async () => {
  // 27 labels exact taxonomy
  const all = [
    "upstream:pi-dev", "upstream:gsd-pi",
    "type:cherry-pick-candidate", "type:port-required", "type:do-not-port",
    "fix-strategy:direct-merge", "fix-strategy:adapted-port",
    "fix-strategy:essence-reimplement", "fix-strategy:not-needed",
    "severity:critical-security", "severity:critical-stability",
    "severity:nice-to-have-fix", "severity:feature",
    "conflict-risk:none", "conflict-risk:low", "conflict-risk:medium", "conflict-risk:high",
    "status:triaged", "status:in-spec", "status:in-plan", "status:in-progress", "status:applied",
    "claude-pickup",
    "status:superseded",
    "alignment:core", "alignment:adjacent", "alignment:out-of-scope",
  ];
  const ghRunner = (args) => {
    if (args[1] === "list") return all.join("\n") + "\n";
    throw new Error("should not create anything");
  };
  const result = await ensureLabels({ targetRepo: "foo/bar", ghRunner });
  assert.equal(result.existing.length, 27);
  assert.equal(result.created.length, 0);
  assert.equal(result.errors.length, 0);
});

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
