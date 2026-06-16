// .claude/skills/upstream-swarm/scripts/__tests__/control-plan.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tick, report } from "../control-plan.mjs";

function tmpLedger(obj) {
  const dir = mkdtempSync(join(tmpdir(), "ctl-plan-"));
  const path = join(dir, "ledger.json");
  writeFileSync(path, JSON.stringify(obj));
  return { dir, path };
}

const LEDGER = {
  version: 1, date: "2026-06-16", filter: "x", abortStreak: { signature: null, count: 0 },
  issues: { "5": { state: "selected", severity: "nice-to-have-fix", retryCount: 0, targetFiles: ["a.ts"], prNumber: null, refute: null } },
};

test("tick returns scheduler actions for the ledger", () => {
  const { path } = tmpLedger(LEDGER);
  const caps = { fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5 };
  const out = tick({ ledger: path, caps: JSON.stringify(caps), now: "1000" });
  assert.ok(Array.isArray(out.actions));
  assert.equal(out.actions[0].kind, "start-fix");
  assert.equal(out.actions[0].issueNumber, 5);
});

test("report renders markdown to the out path and returns it", () => {
  const { path, dir } = tmpLedger(LEDGER);
  const out = join(dir, "report.md");
  const r = report({ ledger: path, out });
  assert.equal(r.out, out);
  const md = readFileSync(out, "utf-8");
  assert.match(md, /Upstream-Swarm Report/i);
});
