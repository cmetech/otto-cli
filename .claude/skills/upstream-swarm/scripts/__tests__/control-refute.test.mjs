// .claude/skills/upstream-swarm/scripts/__tests__/control-refute.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refuteBundle, refuteTally } from "../control-refute.mjs";

const PR = 42;
const ISSUE = 7;
const SHA = "deadbeef";

// ghRunner stub: matches buildInputBundle's exact argv shapes.
//   ["pr","view",...]  → JSON { title, body, headRefOid }
//   ["pr","diff",...]  → "diff text"
//   ["issue","view",...] → JSON { number, body, labels }
function ghRunner(args) {
  if (args[0] === "pr" && args[1] === "view") {
    return JSON.stringify({ number: PR, title: "t", body: "b", headRefOid: "sha" });
  }
  if (args[0] === "pr" && args[1] === "diff") {
    return "diff text";
  }
  if (args[0] === "issue" && args[1] === "view") {
    return JSON.stringify({
      number: ISSUE,
      body: "ib",
      labels: [{ name: "fix-strategy:adapted-port" }, { name: "severity:nice-to-have-fix" }],
    });
  }
  throw new Error(`unexpected gh argv: ${JSON.stringify(args)}`);
}

// gitRunner stub: ["-C", root, "show", sha] → commit show text
function gitRunner(args) {
  if (args[0] === "-C" && args[2] === "show" && args[3] === SHA) {
    return "commit show text";
  }
  throw new Error(`unexpected git argv: ${JSON.stringify(args)}`);
}

test("refuteBundle writes the bundle and returns path + 4 lens prompts", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctl-refute-"));
  const out = join(dir, "bundle.json");
  const r = refuteBundle({
    pr: PR,
    issue: ISSUE,
    sha: SHA,
    out,
    upstreamRoot: "/tmp", // bypass label-based resolveUpstreamRoot
    ghRunner,
    gitRunner,
  });
  assert.ok(existsSync(out), "bundle file should exist");
  assert.equal(r.bundlePath, out);
  assert.equal(r.lensPrompts.length, 4);
  for (const lp of r.lensPrompts) {
    assert.match(lp.prompt, new RegExp(out.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("refuteBundle throws when required flags missing", () => {
  assert.throws(() => refuteBundle({ pr: PR, issue: ISSUE }), /out|pr|issue/i);
  assert.throws(() => refuteBundle({ out: "/tmp/x", issue: ISSUE }), /out|pr|issue/i);
  assert.throws(() => refuteBundle({ out: "/tmp/x", pr: PR }), /out|pr|issue/i);
});

test("refuteTally approves with 4 approve verdicts", () => {
  const r = refuteTally({
    verdicts: JSON.stringify([
      { lens: "a", verdict: "approve" },
      { lens: "b", verdict: "approve" },
      { lens: "c", verdict: "approve" },
      { lens: "d", verdict: "approve" },
    ]),
  });
  assert.equal(r.panelVerdict, "approve");
});

test("refuteTally refutes when any lens refutes", () => {
  const r = refuteTally({
    verdicts: JSON.stringify([
      { lens: "a", verdict: "approve" },
      { lens: "b", verdict: "refute" },
      { lens: "c", verdict: "approve" },
      { lens: "d", verdict: "abstain" },
    ]),
  });
  assert.equal(r.panelVerdict, "refute");
});

test("refuteTally accepts an already-parsed array", () => {
  const r = refuteTally({
    verdicts: [
      { lens: "a", verdict: "approve" },
      { lens: "b", verdict: "approve" },
    ],
  });
  assert.equal(r.panelVerdict, "approve");
});

test("refuteTally throws when verdicts missing", () => {
  assert.throws(() => refuteTally({}), /verdicts/i);
});
