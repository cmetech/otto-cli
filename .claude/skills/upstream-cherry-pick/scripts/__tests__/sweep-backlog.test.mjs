import { test } from "node:test";
import assert from "node:assert/strict";
import { selectActionableIssues, extractSha, upstreamNameOf, sweepBacklog, numstatNewPath } from "../sweep-backlog.mjs";

test("numstatNewPath resolves git rename rows to the post-rename path", () => {
  // normal + binary rows pass through unchanged
  assert.equal(numstatNewPath("src/a.ts"), "src/a.ts");
  assert.equal(numstatNewPath(""), "");
  // simple rename
  assert.equal(numstatNewPath("old.ts => new.ts"), "new.ts");
  // braced rename with a common prefix and suffix
  assert.equal(numstatNewPath("src/{old => new}/file.ts"), "src/new/file.ts");
  // braced rename adding a directory (empty old segment)
  assert.equal(numstatNewPath("src/{ => sub}/file.ts"), "src/sub/file.ts");
  // braced rename removing a directory (empty new segment) collapses the slash
  assert.equal(numstatNewPath("src/{old => }/file.ts"), "src/file.ts");
});

test("sweep passes post-rename paths to the rewritten detector", async () => {
  const issues = [{
    number: 30,
    title: "[upstream/pi-dev] x [sha=cab1234]",
    body: "[sha=cab1234]",
    labels: [{ name: "upstream:pi-dev" }, { name: "type:port-required" }],
  }];
  const seenFileArgs = [];
  const ghRunner = (args) => (args[1] === "list" ? JSON.stringify(issues) : "");
  const gitRunner = (args) => {
    const s = args.join(" ");
    if (s.includes("--format=%s%n%b")) return "rename it\n\n\n";
    if (s.includes("--numstat")) return "2\t1\tsrc/{old => new}/file.ts\n";
    if (s.includes("--oneline")) { seenFileArgs.push(args.slice(args.indexOf("--") + 1)); return "later edit\n"; }
    return "";
  };
  const res = await sweepBacklog({
    cfg: {
      targetRepo: "cmetech/otto-cli",
      upstreams: { "pi-dev": { path: "../pi", ghRepo: "earendil-works/pi", role: "lineage" } },
    },
    ghRunner, gitRunner, fetchContext: async () => { throw new Error("x"); }, issueUpdater: () => ({}),
  });
  assert.equal(res.advisory.length, 1);
  // the rewritten git-log query received the resolved new path, not the raw "old => new" string
  assert.ok(seenFileArgs.flat().includes("src/new/file.ts"), `git log got: ${JSON.stringify(seenFileArgs)}`);
});

test("selectActionableIssues keeps port-required/cherry-pick-candidate and drops applied/superseded", () => {
  const issues = [
    { number: 1, labels: [{ name: "type:cherry-pick-candidate" }] },
    { number: 2, labels: [{ name: "type:port-required" }, { name: "status:applied" }] },
    { number: 3, labels: [{ name: "type:port-required" }, { name: "status:superseded" }] },
    { number: 4, labels: [{ name: "type:do-not-port" }] },
    { number: 5, labels: ["type:cherry-pick-candidate", "status:in-progress"] },
  ];
  const kept = selectActionableIssues(issues).map((i) => i.number);
  assert.deepEqual(kept, [1, 5]);
});

test("extractSha / upstreamNameOf read the trailer and the upstream label", () => {
  const issue = {
    title: "[upstream/pi-dev] ✨ x [sha=abc1234]",
    body: "...\nDedup key: `[sha=abc1234]`",
    labels: [{ name: "upstream:pi-dev" }, { name: "type:port-required" }],
  };
  assert.equal(extractSha(issue), "abc1234");
  assert.equal(upstreamNameOf(issue), "pi-dev");
});

const CFG = {
  targetRepo: "cmetech/otto-cli",
  upstreams: {
    "pi-dev": { path: "../pi", ghRepo: "earendil-works/pi", role: "lineage" },
    "hermes-agent": { path: "../hermes-agent", ghRepo: "inspiration/hermes-agent", role: "inspiration" },
  },
};

function makeIssue(number, sha, extraLabels = []) {
  return {
    number,
    title: `[upstream/pi-dev] x [sha=${sha}]`,
    body: `Dedup key: \`[sha=${sha}]\``,
    labels: [{ name: "upstream:pi-dev" }, { name: "type:port-required" }, ...extraLabels.map((n) => ({ name: n }))],
  };
}

test("sweepBacklog auto-tags reverted issues and records evidence; never closes", async () => {
  const issues = [makeIssue(10, "abc1234")];
  const updates = [];
  const ghRunner = (args) =>
    args[0] === "issue" && args[1] === "list" ? JSON.stringify(issues) : "";
  const gitRunner = (args) => {
    const s = args.join(" ");
    if (s.includes("show") && s.includes("--format=%s%n%b")) return "fix: x\n\nbody #99\n";
    if (s.includes("--numstat")) return "1\t2\tsrc/a.ts\n";
    if (s.includes("This reverts commit")) return "ff00aa1\tRevert\n";
    return "";
  };
  const issueUpdater = (opts) => { updates.push(opts); return { number: opts.number, actions: ["add-label", "comment"] }; };
  const fetchContext = async () => { throw new Error("no network in test"); };

  const res = await sweepBacklog({ cfg: CFG, ghRunner, gitRunner, fetchContext, issueUpdater });
  assert.equal(res.scanned, 1);
  assert.equal(res.superseded.length, 1);
  assert.equal(res.superseded[0].rule, "reverted");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].addLabels, ["status:superseded"]);
  assert.equal(updates[0].close, undefined); // NEVER closes
  assert.match(updates[0].comment, /reverted|ff00aa1/);
});

test("sweepBacklog records rewritten as advisory WITHOUT calling the updater", async () => {
  const issues = [makeIssue(11, "bbb2222")];
  const updates = [];
  const ghRunner = (args) => (args[1] === "list" ? JSON.stringify(issues) : "");
  const gitRunner = (args) => {
    const s = args.join(" ");
    if (s.includes("--format=%s%n%b")) return "fix: y\n\nno refs\n";
    if (s.includes("--numstat")) return "3\t0\tsrc/b.ts\n";
    if (s.includes("This reverts commit")) return "";
    if (s.includes("--oneline")) return "deadbee later edit\n";
    return "";
  };
  const issueUpdater = (opts) => { updates.push(opts); return {}; };
  const res = await sweepBacklog({ cfg: CFG, ghRunner, gitRunner, fetchContext: async () => { throw new Error("x"); }, issueUpdater });
  assert.equal(res.superseded.length, 0);
  assert.equal(res.advisory.length, 1);
  assert.equal(res.advisory[0].rule, "rewritten");
  assert.equal(updates.length, 0); // advisory never mutates the issue
});

test("sweepBacklog collects feature issues for alignment re-check", async () => {
  const issues = [makeIssue(12, "ccc3333", ["severity:feature"])];
  const ghRunner = (args) => (args[1] === "list" ? JSON.stringify(issues) : "");
  const gitRunner = () => ""; // nothing supersedes it
  const res = await sweepBacklog({ cfg: CFG, ghRunner, gitRunner, fetchContext: async () => { throw new Error("x"); }, issueUpdater: () => ({}) });
  assert.equal(res.features.length, 1);
  assert.equal(res.features[0].number, 12);
});

test("sweepBacklog skips issues whose upstream is inspiration or unknown", async () => {
  const issues = [
    { number: 20, title: "x [sha=ddd4444]", body: "[sha=ddd4444]", labels: [{ name: "upstream:hermes-agent" }, { name: "type:port-required" }] },
    { number: 21, title: "x [sha=eee5555]", body: "[sha=eee5555]", labels: [{ name: "type:port-required" }] },
  ];
  const ghRunner = (args) => (args[1] === "list" ? JSON.stringify(issues) : "");
  const res = await sweepBacklog({ cfg: CFG, ghRunner, gitRunner: () => "", fetchContext: async () => { throw new Error("x"); }, issueUpdater: () => ({}) });
  assert.equal(res.superseded.length, 0);
  assert.equal(res.skipped.length, 2);
});

test("sweepBacklog dryRun never calls the updater", async () => {
  const issues = [makeIssue(13, "fff6666")];
  let called = 0;
  const ghRunner = (args) => (args[1] === "list" ? JSON.stringify(issues) : "");
  const gitRunner = (args) => (args.join(" ").includes("This reverts commit") ? "ff00aa1\tRevert\n" : (args.join(" ").includes("--format=%s%n%b") ? "fix\n\n\n" : ""));
  const res = await sweepBacklog({ cfg: CFG, ghRunner, gitRunner, fetchContext: async () => { throw new Error("x"); }, issueUpdater: () => { called++; return {}; }, dryRun: true });
  assert.equal(res.superseded.length, 1); // still detected
  assert.equal(called, 0);               // but not mutated
});
