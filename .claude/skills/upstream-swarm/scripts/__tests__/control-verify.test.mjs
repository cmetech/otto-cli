import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyFixArtifacts } from "../control-verify.mjs";

function fakes({ prState = "OPEN", lsRemote = "abc123\trefs/heads/b\n", diffFiles = [] }) {
  return {
    ghRunner: (args) => {
      if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ state: prState });
      if (args[0] === "pr" && args[1] === "diff") return diffFiles.join("\n") + (diffFiles.length ? "\n" : "");
      throw new Error("unexpected gh " + args.join(" "));
    },
    gitRunner: (args) => {
      if (args[0] === "ls-remote") return lsRemote;
      throw new Error("unexpected git " + args.join(" "));
    },
  };
}

test("passes when PR open, branch pushed, diff scoped to targets", () => {
  const r = verifyFixArtifacts({ pr: 400, issue: 114, branch: "fix/x", targets: ["a.ts", "a.test.ts"], ...fakes({ diffFiles: ["a.ts", "a.test.ts"] }) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.scopeNotes, []);
});

test("extra files become scopeNotes, not a hard fail", () => {
  const r = verifyFixArtifacts({ pr: 395, issue: 88, branch: "fix/y", targets: ["pm.ts", "pm.test.ts"], ...fakes({ diffFiles: ["pm.ts", "pm.test.ts", "worktree-lifecycle.ts"] }) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.scopeNotes, ["worktree-lifecycle.ts"]);
});

test("fails when PR is not open", () => {
  const r = verifyFixArtifacts({ pr: 1, issue: 1, branch: "fix/z", targets: ["a.ts"], ...fakes({ prState: "CLOSED", diffFiles: ["a.ts"] }) });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /not open/i);
});

test("fails when branch is not pushed", () => {
  const r = verifyFixArtifacts({ pr: 1, issue: 1, branch: "fix/z", targets: ["a.ts"], ...fakes({ lsRemote: "", diffFiles: ["a.ts"] }) });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /not pushed/i);
});

test("fails when diff touches none of the declared targets", () => {
  const r = verifyFixArtifacts({ pr: 1, issue: 1, branch: "fix/z", targets: ["a.ts"], ...fakes({ diffFiles: ["totally-unrelated.ts"] }) });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /none of the declared targets/i);
});

test("fails when diff is empty", () => {
  const r = verifyFixArtifacts({ pr: 1, issue: 1, branch: "fix/z", targets: ["a.ts"], ...fakes({ diffFiles: [] }) });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(" "), /empty diff/i);
});
