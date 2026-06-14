import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectReverted,
  detectRewritten,
  detectUpstreamClosed,
  checkSupersession,
} from "../supersession-check.mjs";

const SHA = "a3f9c12deadbeefa3f9c12deadbeefa3f9c12dea";

test("detectReverted hits when a later commit reverts the sha", () => {
  const gitRunner = (args) => {
    // git log <sha>..HEAD --grep "This reverts commit <sha>"
    if (args.join(" ").includes("This reverts commit")) {
      return "ff00aa1\tRevert \"fix(auth): redact tokens\"\n";
    }
    return "";
  };
  const r = detectReverted({ repoPath: "../pi", sha: SHA, subject: "fix(auth): redact tokens", gitRunner });
  assert.equal(r.hit, true);
  assert.equal(r.revertingSha, "ff00aa1");
});

test("detectReverted misses when log is empty", () => {
  const gitRunner = () => "";
  assert.equal(detectReverted({ repoPath: "../pi", sha: SHA, subject: "x", gitRunner }).hit, false);
});

test("detectReverted tolerates a throwing gitRunner (sha not in repo)", () => {
  const gitRunner = () => { throw new Error("bad revision"); };
  assert.equal(detectReverted({ repoPath: "../pi", sha: SHA, subject: "x", gitRunner }).hit, false);
});

test("detectRewritten hits when later commits touch the same files (advisory)", () => {
  const gitRunner = () => "deadbee fix follow-up\nc0ffee0 refactor settings\n";
  const r = detectRewritten({ repoPath: "../pi", sha: SHA, files: ["src/a.ts"], gitRunner });
  assert.equal(r.hit, true);
  assert.equal(r.laterCommits.length, 2);
});

test("detectRewritten misses with no files or empty log", () => {
  assert.equal(detectRewritten({ repoPath: "../pi", sha: SHA, files: [], gitRunner: () => "x" }).hit, false);
  assert.equal(detectRewritten({ repoPath: "../pi", sha: SHA, files: ["a"], gitRunner: () => "" }).hit, false);
});

test("detectUpstreamClosed hits only when ALL linked issues are closed not-planned/wontfix/duplicate", () => {
  const closed = [{ data: { state: "CLOSED", stateReason: "not-planned" } }];
  assert.equal(detectUpstreamClosed({ issueContexts: closed }).hit, true);
  const mixed = [
    { data: { state: "CLOSED", stateReason: "duplicate" } },
    { data: { state: "OPEN", stateReason: "" } },
  ];
  assert.equal(detectUpstreamClosed({ issueContexts: mixed }).hit, false);
  assert.equal(detectUpstreamClosed({ issueContexts: [] }).hit, false);
  const completed = [{ data: { state: "CLOSED", stateReason: "completed" } }];
  assert.equal(detectUpstreamClosed({ issueContexts: completed }).hit, false);
});

test("checkSupersession: reverted wins and is auto-taggable (superseded:true)", () => {
  const gitRunner = (args) =>
    args.join(" ").includes("This reverts commit") ? "ff00aa1\tRevert\n" : "";
  const v = checkSupersession({ repoPath: "../pi", sha: SHA, subject: "x", files: ["a"], issueContexts: [], gitRunner });
  assert.equal(v.superseded, true);
  assert.equal(v.rule, "reverted");
  assert.equal(v.evidence.revertingSha, "ff00aa1");
});

test("checkSupersession: upstream-closed wins over rewritten and is auto-taggable", () => {
  const gitRunner = () => "deadbee later\n"; // would be 'rewritten' on its own
  const v = checkSupersession({
    repoPath: "../pi", sha: SHA, subject: "x", files: ["a"],
    issueContexts: [{ data: { state: "CLOSED", stateReason: "wontfix" } }],
    gitRunner,
  });
  assert.equal(v.superseded, true);
  assert.equal(v.rule, "upstream-closed");
});

test("checkSupersession: rewritten is ADVISORY (superseded:false) — never auto-tags", () => {
  const gitRunner = (args) =>
    args.join(" ").includes("--oneline") ? "deadbee later edit\n" : "";
  const v = checkSupersession({ repoPath: "../pi", sha: SHA, subject: "x", files: ["a"], issueContexts: [], gitRunner });
  assert.equal(v.superseded, false);
  assert.equal(v.rule, "rewritten");
});

test("checkSupersession: nothing fires → not superseded, rule null", () => {
  const v = checkSupersession({ repoPath: "../pi", sha: SHA, subject: "x", files: [], issueContexts: [], gitRunner: () => "" });
  assert.equal(v.superseded, false);
  assert.equal(v.rule, null);
});
