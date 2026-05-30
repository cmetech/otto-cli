import { test } from "node:test";
import assert from "node:assert/strict";
import { updateIssue } from "../issue-update.mjs";

function recorder() {
  const calls = [];
  const r = (args) => { calls.push(args); return ""; };
  r.calls = calls;
  return r;
}

test("adds a label", () => {
  const gh = recorder();
  const out = updateIssue({ number: 63, repo: "cmetech/otto-cli", addLabels: ["status:in-progress"], ghRunner: gh });
  const edit = gh.calls.find((c) => c[0] === "issue" && c[1] === "edit");
  assert.ok(edit.includes("--add-label"));
  assert.ok(edit.includes("status:in-progress"));
  assert.ok(out.actions.includes("add-label"));
});

test("posts a comment and closes", () => {
  const gh = recorder();
  updateIssue({ number: 63, repo: "cmetech/otto-cli", comment: "applied in abc1234", close: true, ghRunner: gh });
  assert.ok(gh.calls.some((c) => c[0] === "issue" && c[1] === "comment"));
  assert.ok(gh.calls.some((c) => c[0] === "issue" && c[1] === "close"));
});

test("swaps status label: remove triaged, add applied", () => {
  const gh = recorder();
  updateIssue({ number: 7, repo: "r", addLabels: ["status:applied"], removeLabels: ["status:triaged", "status:in-progress"], ghRunner: gh });
  const edit = gh.calls.find((c) => c[1] === "edit");
  assert.ok(edit.includes("--remove-label"));
  assert.ok(edit.filter((x) => x === "--remove-label").length === 2);
});

test("no-op when nothing requested", () => {
  const gh = recorder();
  const out = updateIssue({ number: 7, repo: "r", ghRunner: gh });
  assert.equal(gh.calls.length, 0);
  assert.deepEqual(out.actions, []);
});
