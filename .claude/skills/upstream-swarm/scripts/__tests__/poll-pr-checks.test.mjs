import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pollPrChecks } from "../poll-pr-checks.mjs";

function configFile(allowlist) {
  const dir = mkdtempSync(join(tmpdir(), "poll-pr-checks-cfg-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(allowlist));
  return { path, dir };
}

const ALLOWLIST = { requiredChecks: ["build", "test-unit", "test-packages", "fast-gates"], conditionalChecks: ["cargo audit"] };

function fakeGh(checks) {
  return (args) => {
    assert.deepEqual(args.slice(0, 2), ["pr", "checks"]);
    return JSON.stringify(checks);
  };
}

test("state:pass when every required check is pass; informational reds surface but don't block", () => {
  const { path, dir } = configFile(ALLOWLIST);
  try {
    const r = pollPrChecks({
      prNumber: 77,
      configPath: path,
      ghRunner: fakeGh([
        { name: "build", bucket: "pass", state: "COMPLETED" },
        { name: "test-unit", bucket: "pass", state: "COMPLETED" },
        { name: "test-packages", bucket: "pass", state: "COMPLETED" },
        { name: "fast-gates", bucket: "pass", state: "COMPLETED" },
        { name: "e2e", bucket: "fail", state: "COMPLETED" },          // not required
        { name: "triage", bucket: "fail", state: "COMPLETED" },       // not required
      ]),
    });
    assert.equal(r.state, "pass");
    assert.deepEqual(r.pending, []);
    assert.deepEqual(r.blocking, []);
    assert.deepEqual(r.informationalReds.sort(), ["e2e", "triage"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("state:pending when at least one required check is still running", () => {
  const { path, dir } = configFile(ALLOWLIST);
  try {
    const r = pollPrChecks({
      prNumber: 77,
      configPath: path,
      ghRunner: fakeGh([
        { name: "build", bucket: "pass", state: "COMPLETED" },
        { name: "test-unit", bucket: "pending", state: "IN_PROGRESS" },
        { name: "test-packages", bucket: "pending", state: "QUEUED" },
        { name: "fast-gates", bucket: "pass", state: "COMPLETED" },
      ]),
    });
    assert.equal(r.state, "pending");
    assert.deepEqual(r.pending.sort(), ["test-packages", "test-unit"]);
    assert.deepEqual(r.blocking, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("state:fail when ANY required check is in a blocking bucket (cancel / fail)", () => {
  const { path, dir } = configFile(ALLOWLIST);
  try {
    const r = pollPrChecks({
      prNumber: 77,
      configPath: path,
      ghRunner: fakeGh([
        { name: "build", bucket: "fail", state: "COMPLETED" },
        { name: "test-unit", bucket: "pass", state: "COMPLETED" },
        { name: "test-packages", bucket: "pass", state: "COMPLETED" },
        { name: "fast-gates", bucket: "pass", state: "COMPLETED" },
      ]),
    });
    assert.equal(r.state, "fail");
    assert.equal(r.blocking.length, 1);
    assert.equal(r.blocking[0].name, "build");
    assert.match(r.blocking[0].reason, /fail/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("state:fail when a required check is missing from the gh response (silent CI skip)", () => {
  const { path, dir } = configFile(ALLOWLIST);
  try {
    const r = pollPrChecks({
      prNumber: 77,
      configPath: path,
      ghRunner: fakeGh([
        { name: "build", bucket: "pass", state: "COMPLETED" },
        { name: "test-unit", bucket: "pass", state: "COMPLETED" },
        // test-packages MISSING
        { name: "fast-gates", bucket: "pass", state: "COMPLETED" },
      ]),
    });
    assert.equal(r.state, "fail");
    assert.ok(r.blocking.find((b) => b.name === "test-packages"), "missing required check should block");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("state:pass treats `skipping` bucket as ok (path-filtered heavy jobs in .claude/-only diffs)", () => {
  const { path, dir } = configFile(ALLOWLIST);
  try {
    const r = pollPrChecks({
      prNumber: 78,
      configPath: path,
      ghRunner: fakeGh([
        { name: "build", bucket: "skipping", state: "COMPLETED" },
        { name: "test-unit", bucket: "skipping", state: "COMPLETED" },
        { name: "test-packages", bucket: "skipping", state: "COMPLETED" },
        { name: "fast-gates", bucket: "pass", state: "COMPLETED" },
      ]),
    });
    assert.equal(r.state, "pass");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("state:error when gh CLI throws (network down / not authenticated)", () => {
  const { path, dir } = configFile(ALLOWLIST);
  try {
    const r = pollPrChecks({
      prNumber: 77,
      configPath: path,
      ghRunner: () => { throw new Error("gh: not authenticated"); },
    });
    assert.equal(r.state, "error");
    assert.match(r.message, /not authenticated/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("state:error when gh returns non-JSON (rate limit HTML, etc.)", () => {
  const { path, dir } = configFile(ALLOWLIST);
  try {
    const r = pollPrChecks({
      prNumber: 77,
      configPath: path,
      ghRunner: () => "rate limited",
    });
    assert.equal(r.state, "error");
    assert.match(r.message, /non-JSON/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("state:pending when matrix children are missing but their gating job is still pending (fresh-PR race)", () => {
  // GitHub's check-runs API does not surface a matrix child until its
  // upstream job (e.g. build) completes. evaluateChecks correctly
  // reports test-unit/test-packages as `blocking: required check missing`
  // — but if `build` is still pending, the right semantic is "wait, not
  // dead." Before this carve-out, every fresh PR was quarantined on
  // its first poll.
  const { path, dir } = configFile(ALLOWLIST);
  try {
    const r = pollPrChecks({
      prNumber: 370,
      configPath: path,
      ghRunner: fakeGh([
        { name: "build", bucket: "pending", state: "IN_PROGRESS" },
        // test-unit and test-packages not yet registered — they're
        // matrix children of build.
        { name: "fast-gates", bucket: "pass", state: "COMPLETED" },
        { name: "triage", bucket: "fail", state: "COMPLETED" },
      ]),
    });
    assert.equal(r.state, "pending", "should re-poll, not quarantine, while matrix gate is in flight");
    assert.ok(r.pending.includes("build"));
    // The matrix children are still listed as `blocking` from
    // evaluateChecks — the carve-out is at the state level only, so the
    // caller can still inspect them if it cares.
    assert.ok(r.blocking.find((b) => b.name === "test-unit"));
    assert.ok(r.blocking.find((b) => b.name === "test-packages"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("state:fail when a real blocking check (cancel / fail) co-occurs with pending — pending does NOT shield real reds", () => {
  const { path, dir } = configFile(ALLOWLIST);
  try {
    const r = pollPrChecks({
      prNumber: 370,
      configPath: path,
      ghRunner: fakeGh([
        { name: "build", bucket: "fail", state: "COMPLETED" },
        { name: "test-unit", bucket: "pending", state: "IN_PROGRESS" },
        { name: "test-packages", bucket: "pass", state: "COMPLETED" },
        { name: "fast-gates", bucket: "pass", state: "COMPLETED" },
      ]),
    });
    assert.equal(r.state, "fail", "real reds always win over pending");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("does NOT block — the runner is called exactly once per poll (no --watch)", () => {
  const { path, dir } = configFile(ALLOWLIST);
  try {
    let calls = 0;
    pollPrChecks({
      prNumber: 77,
      configPath: path,
      ghRunner: (args) => {
        calls += 1;
        assert.ok(!args.includes("--watch"), "gh must not be invoked with --watch (would block)");
        return JSON.stringify([{ name: "build", bucket: "pending", state: "IN_PROGRESS" }]);
      },
    });
    assert.equal(calls, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
