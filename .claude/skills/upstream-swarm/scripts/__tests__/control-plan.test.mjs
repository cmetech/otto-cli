// .claude/skills/upstream-swarm/scripts/__tests__/control-plan.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tick, report, plan } from "../control-plan.mjs";

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

test("tick enriches single-issue actions with sha/targetFiles/prNumber/branch", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctl-enrich-"));
  const path = join(dir, "l.json");
  writeFileSync(path, JSON.stringify({
    version: 1, abortStreak: { signature: null, count: 0 },
    issues: { "5": { state: "selected", severity: "nice-to-have-fix", retryCount: 0, sha: "4ba1821", targetFiles: ["a.ts","b.ts"], prNumber: null, refute: null } },
  }));
  const { actions } = tick({ ledger: path, caps: JSON.stringify({ fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5 }), now: "1000" });
  const a = actions.find(x => x.kind === "start-fix");
  assert.equal(a.issueNumber, 5);
  assert.equal(a.sha, "4ba1821");
  assert.deepEqual(a.targetFiles, ["a.ts","b.ts"]);
  assert.equal(a.branch, "fix/upstream-issue-5-4ba1821");
});

test("plan combines tick + driverPlan into one dispatch plan", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctl-plan-combine-"));
  const path = join(dir, "l.json");
  writeFileSync(path, JSON.stringify({
    version: 1, abortStreak: { signature: null, count: 0 },
    issues: { "5": { state: "selected", severity: "nice-to-have-fix", retryCount: 0, sha: "abc1234", targetFiles: ["a.ts"], prNumber: null, refute: null } },
  }));
  const out = plan({
    ledger: path,
    caps: JSON.stringify({ fixConcurrency: 3, prWindow: 10, refuteConcurrency: 5 }),
    now: "1000",
    gateLogDir: "/tmp/g",
  });
  assert.equal(out.fixes[0].issueNumber, 5);
  assert.match(out.fixes[0].prompt, /--single-issue/);
});

test("report renders markdown to the out path and returns it", () => {
  const { path, dir } = tmpLedger(LEDGER);
  const out = join(dir, "report.md");
  const r = report({ ledger: path, out });
  assert.equal(r.out, out);
  const md = readFileSync(out, "utf-8");
  assert.match(md, /Upstream-Swarm Report/i);
});
