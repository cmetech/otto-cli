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

// ---------------------------------------------------------------------------
// Phase 3: idempotency
// ---------------------------------------------------------------------------

/** Recorder whose `issue view --json` returns a canned view; other calls echo "". */
function viewRecorder(view) {
  const calls = [];
  const r = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify(view);
    return "";
  };
  r.calls = calls;
  return r;
}

test("skips a duplicate comment and a redundant close (no-op on already-applied)", () => {
  const body = "Applied in abc1234 (PR https://github.com/cmetech/otto-cli/pull/9).";
  const gh = viewRecorder({ state: "CLOSED", comments: [{ body }] });
  const out = updateIssue({ number: 63, repo: "cmetech/otto-cli", comment: body, close: true, ghRunner: gh });
  assert.ok(!gh.calls.some((c) => c[0] === "issue" && c[1] === "comment"), "must NOT post a second comment");
  assert.ok(!gh.calls.some((c) => c[0] === "issue" && c[1] === "close"), "must NOT re-close");
  assert.ok(out.actions.includes("comment-skipped"), `actions: ${out.actions}`);
  assert.ok(out.actions.includes("close-skipped"), `actions: ${out.actions}`);
});

test("first run on an open issue with no matching comment posts + closes", () => {
  const gh = viewRecorder({ state: "OPEN", comments: [] });
  const out = updateIssue({ number: 63, repo: "r", comment: "Applied in abc1234.", close: true, ghRunner: gh });
  assert.ok(gh.calls.some((c) => c[0] === "issue" && c[1] === "comment"), "posts the comment");
  assert.ok(gh.calls.some((c) => c[0] === "issue" && c[1] === "close"), "closes the issue");
  assert.ok(out.actions.includes("comment") && out.actions.includes("close"), `actions: ${out.actions}`);
});

test("posts the comment when existing comments differ", () => {
  const gh = viewRecorder({ state: "OPEN", comments: [{ body: "an unrelated comment" }] });
  updateIssue({ number: 63, repo: "r", comment: "Applied in abc1234.", ghRunner: gh });
  assert.ok(gh.calls.some((c) => c[0] === "issue" && c[1] === "comment"), "different body → posts");
});

test("label-only call makes no pre-check view request", () => {
  const gh = viewRecorder({ state: "OPEN", comments: [] });
  updateIssue({ number: 7, repo: "r", addLabels: ["status:in-progress"], ghRunner: gh });
  assert.ok(!gh.calls.some((c) => c[0] === "issue" && c[1] === "view"), "no precheck when only labels");
  assert.ok(gh.calls.some((c) => c[0] === "issue" && c[1] === "edit"), "edits labels");
});

test("a failing pre-check does not block the op (best-effort)", () => {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "view") throw new Error("gh view boom");
    return "";
  };
  const out = updateIssue({ number: 7, repo: "r", comment: "Applied in abc1234.", close: true, ghRunner: gh });
  assert.ok(calls.some((c) => c[1] === "comment"), "still posts when precheck fails");
  assert.ok(calls.some((c) => c[1] === "close"), "still closes when precheck fails");
  assert.ok(out.actions.includes("comment") && out.actions.includes("close"));
});
