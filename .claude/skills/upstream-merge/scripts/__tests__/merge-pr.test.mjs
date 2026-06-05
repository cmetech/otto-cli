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

test("polls for mergeCommit.oid when GitHub lags after merge", () => {
  let views = 0;
  const sleeps = [];
  const ghRunner = (args) => {
    if (args[1] === "view") {
      views += 1;
      return JSON.stringify({ mergeCommit: views >= 2 ? { oid: "feedface99" } : null });
    }
    return "";
  };
  const r = mergePr({ number: 64, ghRunner, sleep: (ms) => sleeps.push(ms) });
  assert.equal(r.sha, "feedfac");
  assert.equal(views, 2);
  assert.deepEqual(sleeps, [1000]); // slept once between the two view polls
});

test("returns null sha when mergeCommit never populates within budget", () => {
  const ghRunner = (args) => (args[1] === "view" ? JSON.stringify({ mergeCommit: null }) : "");
  const r = mergePr({ number: 64, ghRunner, attempts: 3, sleep: () => {} });
  assert.equal(r.merged, true);
  assert.equal(r.sha, null);
});

test("rejects a non-integer PR number", () => {
  assert.throws(() => mergePr({ number: "64; rm -rf /", ghRunner: () => "" }), /integer/);
});
