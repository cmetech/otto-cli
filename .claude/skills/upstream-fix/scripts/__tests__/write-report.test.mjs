import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderReport, writeReport } from "../write-report.mjs";

const ledger = {
  version: 1, date: "2026-05-30", filter: "--severity critical-stability",
  integrationBranch: "integration/upstream-fix-2026-05-30",
  prUrl: "https://github.com/cmetech/otto-cli/pull/99", finalSuite: "green",
  lanes: { "1": { issues: ["63"], status: "merged" }, "2": { issues: ["71"], status: "failed" } },
  issues: {
    "63": { lane: 1, sha: "ce0e801", status: "applied", commitSha: "deadbee", gates: { regression: true, build: true, targeted: true }, reviewer: "approve", reviewerReason: null, reason: "ported rpc backpressure" },
    "71": { lane: 2, sha: "4b4641c", status: "unresolved", commitSha: null, gates: { regression: null, build: null, targeted: null }, reviewer: null, reviewerReason: null, reason: "otto-cli already handles this via X" },
  },
};

test("renderReport includes rollup counts and PR link", () => {
  const md = renderReport(ledger);
  assert.match(md, /1 resolved/);
  assert.match(md, /1 unresolved/);
  assert.match(md, /pull\/99/);
  assert.match(md, /green/);
});

test("renderReport lists the explicit reason for every unresolved issue", () => {
  const md = renderReport(ledger);
  assert.match(md, /#71/);
  assert.match(md, /already handles this via X/);
});

test("renderReport shows applied issue with commit sha and reviewer verdict", () => {
  const md = renderReport(ledger);
  assert.match(md, /#63/);
  assert.match(md, /deadbee/);
  assert.match(md, /approve/);
});

test("writeReport writes a dated file and returns its path", () => {
  const dir = mkdtempSync(join(tmpdir(), "uf-report-"));
  try {
    const { path, markdown } = writeReport(ledger, dir);
    assert.ok(existsSync(path));
    assert.match(path, /2026-05-30-fix-report\.md$/);
    assert.equal(readFileSync(path, "utf-8"), markdown);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
