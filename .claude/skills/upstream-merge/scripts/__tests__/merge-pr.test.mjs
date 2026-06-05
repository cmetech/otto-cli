import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePr } from "../merge-pr.mjs";

test("squash-merges with delete-branch and returns the merge sha", () => {
  const calls = [];
  const ghRunner = (args) => {
    calls.push(args.join(" "));
    if (args[1] === "view") return JSON.stringify({ mergeCommit: { oid: "abc1234567" } });
    return "";
  };
  const r = mergePr({ number: 64, ghRunner });
  assert.equal(r.merged, true);
  assert.equal(r.sha, "abc1234");
  const mergeCall = calls.find((c) => c.startsWith("pr merge"));
  assert.ok(mergeCall.includes("--squash"));
  assert.ok(mergeCall.includes("--delete-branch"));
});

test("never passes bypass flags", () => {
  const calls = [];
  const ghRunner = (args) => { calls.push(args.join(" ")); return args[1] === "view" ? JSON.stringify({ mergeCommit: { oid: "deadbee" } }) : ""; };
  mergePr({ number: 64, ghRunner });
  const mergeCall = calls.find((c) => c.startsWith("pr merge"));
  assert.ok(!/--admin|--no-verify|--bypass/.test(mergeCall));
});

test("rejects a non-integer PR number", () => {
  assert.throws(() => mergePr({ number: "64; rm -rf /", ghRunner: () => "" }), /integer/);
});
