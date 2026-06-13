import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBaselineGate } from "../../baseline-gate.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "swarm-int-")); }

test("baseline gate red → swarm must abort before any issue work", () => {
  const dir = tmp();
  try {
    const r = runBaselineGate({
      workdir: join(dir, "wt"),
      logPath: join(dir, "baseline.log"),
      worktreeRunner: () => ({ status: 0, stdout: "" }),
      provisionDeps: () => {}, // DI: skip the real node_modules symlink (matches the unit + sibling integration tests)
      gateRunner: () => ({ pass: false, failTail: "vendor xlsx tarball missing\nENOENT dist-test/vendor/xlsx-0.20.3.tgz" }),
    });
    assert.equal(r.pass, false);
    assert.match(r.failTail, /vendor xlsx/);
    // Contract: when this returns pass:false, SKILL.md MUST not start any issue work.
    // We cannot assert that from JS alone; this test pins the gate contract.
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
