import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initLedger, readLedger } from "../ledger.mjs";
import { parseResultLine, foldResult } from "../record-result.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "uf-rec-")); }
function seed(path) {
  initLedger(path, { date: "d", filter: "x", integrationBranch: "b",
    lanes: [{ id: 1, issues: ["63"], files: ["a.ts"] }],
    issues: [{ number: "63", sha: "ce0e801", guidancePath: "g", targetFiles: ["a.ts"] }] });
}

test("parseResultLine handles a resolved line with quoted reason", () => {
  const r = parseResultLine('#63 resolved deadbee "added rpc backpressure retry + test"');
  assert.equal(r.number, "63");
  assert.equal(r.status, "resolved");
  assert.equal(r.commitSha, "deadbee");
  assert.equal(r.reason, "added rpc backpressure retry + test");
});

test("parseResultLine handles unresolved with sha 'none'", () => {
  const r = parseResultLine('#71 unresolved none "otto-cli already handles this"');
  assert.equal(r.status, "unresolved");
  assert.equal(r.commitSha, null);
});

test("foldResult writes status into the ledger and acks", () => {
  const dir = tmp();
  try {
    const path = join(dir, "run.json"); seed(path);
    const ack = foldResult(path, '#63 resolved deadbee "ported"');
    assert.match(ack, /#63.*resolved/);
    const led = readLedger(path);
    assert.equal(led.issues["63"].status, "resolved");
    assert.equal(led.issues["63"].commitSha, "deadbee");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
