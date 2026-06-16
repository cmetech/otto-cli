// .claude/skills/upstream-swarm/scripts/__tests__/control-phase-a.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { preflight } from "../control-phase-a.mjs";

// Stub git so preflightCleanMain's two rev-list counts are controlled by range.
function gitStub({ ahead = "0", behind = "0" }) {
  return (args) => {
    if (args[0] === "fetch") return "";
    if (args[0] === "rev-list") {
      const range = args[2];
      if (range === "origin/main..main") return ahead;   // ahead count
      if (range === "main..origin/main") return behind;   // behind count
      return "0";
    }
    return "";
  };
}
const noopWorktree = () => "";
const noopProvision = () => {};

test("preflight is ok when clean and baseline passes", async () => {
  const r = await preflight({
    skipBaseline: false, workdir: "/tmp/wt", log: "/tmp/b.log",
    gitRunner: gitStub({ ahead: "0" }),
    worktreeRunner: noopWorktree, provisionDeps: noopProvision,
    gateRunner: () => ({ pass: true, failTail: "" }),
  });
  assert.equal(r.clean, true);
  assert.equal(r.baseline.pass, true);
  assert.equal(r.ok, true);
});

test("preflight not ok when local main is ahead of origin", async () => {
  const r = await preflight({
    skipBaseline: true,
    gitRunner: gitStub({ ahead: "2" }),
  });
  assert.equal(r.clean, false);
  assert.equal(r.ok, false);
  assert.equal(r.baseline, null);
});

test("preflight not ok when baseline gate fails", async () => {
  const r = await preflight({
    skipBaseline: false, workdir: "/tmp/wt", log: "/tmp/b.log",
    gitRunner: gitStub({ ahead: "0" }),
    worktreeRunner: noopWorktree, provisionDeps: noopProvision,
    gateRunner: () => ({ pass: false, failTail: "boom" }),
  });
  assert.equal(r.clean, true);
  assert.equal(r.baseline.pass, false);
  assert.equal(r.ok, false);
});
