import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateChecks, loadAllowlist } from "../evaluate-checks.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ALLOW = ["build", "test-unit", "test-packages", "fast-gates", "cargo audit", "npm audit (.)"];

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

test("a missing required check blocks", () => {
  const checks = PR64.filter((c) => c.name !== "cargo audit");
  const r = evaluateChecks(checks, ALLOW);
  assert.equal(r.pass, false);
  assert.ok(r.blocking.some((b) => b.name === "cargo audit" && /missing/.test(b.reason)));
});

test("loadAllowlist reads requiredChecks from config.json", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const cfg = join(here, "..", "..", "config.json");
  const allow = loadAllowlist(cfg);
  assert.deepEqual(allow, ALLOW);
});
