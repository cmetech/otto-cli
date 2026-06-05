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

test("auto mode merges when refute verdict is approve", () => {
  const calls = [];
  const r = mergePr({
    number: 99,
    auto: true,
    refuteVerdict: "approve",
    ghRunner: (args) => { calls.push(args); return args[1] === "merge" ? "" : JSON.stringify({ mergeCommit: { oid: "abcdef1234" } }); },
    sleep: () => {},
  });
  assert.equal(r.merged, true);
  assert.equal(r.sha, "abcdef1");
  assert.ok(calls.some((c) => c[0] === "pr" && c[1] === "merge"), "expected gh pr merge invocation");
});

test("auto mode refuses to merge when refute verdict is refute", () => {
  const calls = [];
  const r = mergePr({
    number: 99,
    auto: true,
    refuteVerdict: "refute",
    refuteReason: "scope-discipline refuted",
    ghRunner: (args) => { calls.push(args); return ""; },
    sleep: () => {},
  });
  assert.equal(r.merged, false);
  assert.equal(r.blockedBy, "refute");
  assert.match(r.reason, /scope-discipline/);
  assert.ok(!calls.some((c) => c[0] === "pr" && c[1] === "merge"), "must NOT call gh pr merge");
});

test("auto mode refuses to merge when refute verdict is missing (fail-safe)", () => {
  const calls = [];
  const r = mergePr({
    number: 99,
    auto: true,
    ghRunner: (args) => { calls.push(args); return ""; },
    sleep: () => {},
  });
  assert.equal(r.merged, false);
  assert.equal(r.blockedBy, "refute-missing");
  assert.ok(!calls.some((c) => c[0] === "pr" && c[1] === "merge"), "must NOT call gh pr merge without a refute verdict");
});

test("non-auto mode still merges without consulting refute verdict (backward compatible)", () => {
  const r = mergePr({
    number: 99,
    ghRunner: (args) => args[1] === "merge" ? "" : JSON.stringify({ mergeCommit: { oid: "deadbee1234" } }),
    sleep: () => {},
  });
  assert.equal(r.merged, true);
  assert.equal(r.sha, "deadbee");
});
