import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateChecks, loadAllowlist } from "../evaluate-checks.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Legacy flat shape — still supported (treats all entries as required).
const ALLOW = ["build", "test-unit", "test-packages", "fast-gates", "cargo audit", "npm audit (.)"];
// New split shape — required vs conditional (path-conditional CI checks).
const SPLIT = {
  required: ["build", "test-unit", "test-packages", "fast-gates"],
  conditional: ["cargo audit", "npm audit (.)"],
};

// Mirrors PR #64: all required green; 3 fail + 1 cancel + 1 skipping are NOT required.
const PR64 = [
  { name: "test-packages", bucket: "pass" },
  { name: "e2e", bucket: "fail" },
  { name: "test-unit", bucket: "pass" },
  { name: "integration-tests", bucket: "fail" },
  { name: "docker-e2e", bucket: "fail" },
  { name: "windows-portability", bucket: "cancel" },
  { name: "test-coverage", bucket: "skipping" },
  { name: "build", bucket: "pass" },
  { name: "fast-gates", bucket: "pass" },
  { name: "npm audit (.)", bucket: "pass" },
  { name: "cargo audit", bucket: "pass" },
];

test("passes when all required green; informational reds collected; skipping not red", () => {
  const r = evaluateChecks(PR64, ALLOW);
  assert.equal(r.pass, true);
  assert.equal(r.pending.length, 0);
  assert.equal(r.blocking.length, 0);
  assert.deepEqual(
    [...r.informationalReds].sort(),
    ["docker-e2e", "e2e", "integration-tests", "windows-portability"],
  );
});

test("a red required check blocks", () => {
  const checks = PR64.map((c) => (c.name === "build" ? { ...c, bucket: "fail" } : c));
  const r = evaluateChecks(checks, ALLOW);
  assert.equal(r.pass, false);
  assert.equal(r.blocking[0].name, "build");
  assert.match(r.blocking[0].reason, /fail/);
});

test("a pending required check triggers wait, not pass", () => {
  const checks = PR64.map((c) => (c.name === "test-unit" ? { ...c, bucket: "pending" } : c));
  const r = evaluateChecks(checks, ALLOW);
  assert.equal(r.pass, false);
  assert.deepEqual(r.pending, ["test-unit"]);
});

test("a missing required check blocks (flat allowlist)", () => {
  const checks = PR64.filter((c) => c.name !== "cargo audit");
  const r = evaluateChecks(checks, ALLOW);
  assert.equal(r.pass, false);
  assert.ok(r.blocking.some((b) => b.name === "cargo audit" && /missing/.test(b.reason)));
});

test("split allowlist: missing CONDITIONAL check does not block (path-conditional CI)", () => {
  // Simulates PR #74: no lock-file changes → cargo audit / npm audit (.) don't run.
  const checks = PR64.filter((c) => c.name !== "cargo audit" && c.name !== "npm audit (.)");
  const r = evaluateChecks(checks, SPLIT);
  assert.equal(r.pass, true);
  assert.equal(r.blocking.length, 0);
});

test("split allowlist: a present CONDITIONAL check that fails still blocks", () => {
  const checks = PR64.map((c) => (c.name === "cargo audit" ? { ...c, bucket: "fail" } : c));
  const r = evaluateChecks(checks, SPLIT);
  assert.equal(r.pass, false);
  assert.ok(r.blocking.some((b) => b.name === "cargo audit" && /conditional check fail/.test(b.reason)));
});

test("split allowlist: missing REQUIRED check still blocks", () => {
  const checks = PR64.filter((c) => c.name !== "build");
  const r = evaluateChecks(checks, SPLIT);
  assert.equal(r.pass, false);
  assert.ok(r.blocking.some((b) => b.name === "build" && /missing/.test(b.reason)));
});

test("a `skipping` required check counts as pass (workflow path-filter said skip)", () => {
  // Docs-only PRs trigger workflow-level path filters that skip heavy jobs.
  // `skipping` is GitHub's signal that the workflow decided not to run, not a
  // failure. Treating it as pass avoids false-positive blocks on docs PRs.
  const checks = PR64.map((c) => (c.name === "build" || c.name === "test-unit" || c.name === "test-packages") ? { ...c, bucket: "skipping" } : c);
  const r = evaluateChecks(checks, SPLIT);
  assert.equal(r.pass, true, JSON.stringify(r));
  assert.equal(r.blocking.length, 0);
});

test("a `skipping` conditional check also counts as pass", () => {
  const checks = PR64.map((c) => (c.name === "cargo audit") ? { ...c, bucket: "skipping" } : c);
  const r = evaluateChecks(checks, SPLIT);
  assert.equal(r.pass, true);
  assert.equal(r.blocking.length, 0);
});

test("loadAllowlist reads requiredChecks + conditionalChecks from config.json", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cfg = join(here, "..", "..", "config.json");
  const allow = loadAllowlist(cfg);
  assert.deepEqual(allow, SPLIT);
});
