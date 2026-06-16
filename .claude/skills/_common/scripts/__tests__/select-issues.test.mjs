import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectIssues, parseGuidanceTargets, buildSearchArgs, buildAppliedCheckArgs, parseAppliedFromGraphql, parseDependsOn, buildIssueStateArgs } from "../select-issues.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "uf-select-")); }

test("parseDependsOn extracts #N issue refs and hex sha refs from a depends-on directive", () => {
  assert.deepEqual(parseDependsOn("depends-on: #134, #150"), { issues: [134, 150], shas: [] });
  assert.deepEqual(parseDependsOn("Depends On: 03465a4"), { issues: [], shas: ["03465a4"] });
  assert.deepEqual(parseDependsOn("blah\ndepends-on: #99 3f5e830 (apply together)\nmore"), { issues: [99], shas: ["3f5e830"] });
  assert.deepEqual(parseDependsOn("no directive here, just prose depends on something"), { issues: [], shas: [] });
  assert.deepEqual(parseDependsOn(""), { issues: [], shas: [] });
});

test("buildIssueStateArgs queries an issue's open/closed state", () => {
  assert.deepEqual(buildIssueStateArgs(134, "cmetech/otto-cli"), ["issue", "view", "134", "--repo", "cmetech/otto-cli", "--json", "state"]);
});

test("buildSearchArgs maps --severity to a label filter", () => {
  const args = buildSearchArgs({ severity: "critical-stability" });
  assert.ok(args.includes("--label"));
  assert.ok(args.includes("severity:critical-stability"));
});

test("buildSearchArgs maps --issues to no label filter (numbers handled post-fetch)", () => {
  const args = buildSearchArgs({ issues: ["62", "63"] });
  assert.ok(!args.includes("severity:"));
});

test("parseGuidanceTargets reads Target file(s) bullet list", () => {
  const dir = tmp();
  try {
    const g = join(dir, "ce0e801.md");
    writeFileSync(g, "verdict: manual-port\n\n## Target file(s)\n\n- `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts`\n- `packages/pi-ai/src/x.ts`\n\n## Divergence\n\nfoo\n");
    const targets = parseGuidanceTargets(g);
    assert.deepEqual(targets, ["packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts", "packages/pi-ai/src/x.ts"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("parseGuidanceTargets returns [] for 'no equivalent exists'", () => {
  const dir = tmp();
  try {
    const g = join(dir, "x.md");
    writeFileSync(g, "verdict: do-not-port\n\n## Target file(s)\n\nno equivalent exists\n");
    assert.deepEqual(parseGuidanceTargets(g), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("selectIssues excludes do-not-port and applied, flags missing-guidance as needsTriage", () => {
  const dir = tmp();
  try {
    const gdir = join(dir, "guidance");
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, "ce0e801.md"), "verdict: manual-port\n\n## Target file(s)\n\n- `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts`\n");
    const fakeIssues = [
      { number: 63, title: "x", labels: [{ name: "severity:critical-stability" }, { name: "type:port-required" }], body: "[sha=ce0e801]\nGuidance | .planning/upstream-audits/guidance/ce0e801.md" },
      { number: 2, title: "y", labels: [{ name: "type:do-not-port" }], body: "[sha=d0d1d8e]" },
      { number: 9, title: "z", labels: [{ name: "status:applied" }], body: "[sha=abc1234]" },
      { number: 11, title: "w", labels: [{ name: "type:port-required" }], body: "[sha=4b4641c]" },
    ];
    const ghRunner = () => JSON.stringify(fakeIssues);
    const out = join(dir, "selected.json");
    const result = selectIssues({ filter: { all: true }, ghRunner, guidanceDir: gdir, outPath: out });
    assert.equal(result.count, 1);
    assert.equal(result.needsTriage, 1); // #11 has no guidance file
    const written = JSON.parse(readFileSync(out, "utf-8"));
    const sel = written.filter((r) => !r.needsTriage);
    assert.equal(sel.length, 1);
    assert.equal(sel[0].number, 63);
    assert.deepEqual(sel[0].targetFiles, ["packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts"]);
    assert.equal(sel[0].sha, "ce0e801");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("selectIssues defers a candidate whose depends-on prerequisite is still OPEN (#7)", () => {
  const dir = tmp();
  try {
    const gdir = join(dir, "guidance"); mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, "ce0e801.md"), "verdict: manual-port\n\n## Target file(s)\n\n- `a.ts`\n");
    const fakeIssues = [{ number: 63, title: "x", labels: [{ name: "type:port-required" }], body: "[sha=ce0e801]\ndepends-on: #134" }];
    const ghRunner = (args) => {
      if (args[0] === "issue" && args[1] === "list") return JSON.stringify(fakeIssues);
      if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ state: "OPEN" }); // #134 still open
      return "[]";
    };
    const rec = selectIssues({ filter: { all: true }, ghRunner, guidanceDir: gdir }).records.find((r) => r.number === 63);
    assert.equal(rec.deferred, true);
    assert.match(rec.deferredReason, /#134/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("selectIssues does NOT defer when the depends-on prerequisite is CLOSED (#7)", () => {
  const dir = tmp();
  try {
    const gdir = join(dir, "guidance"); mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, "ce0e801.md"), "verdict: manual-port\n\n## Target file(s)\n\n- `a.ts`\n");
    const fakeIssues = [{ number: 63, title: "x", labels: [{ name: "type:port-required" }], body: "[sha=ce0e801]\ndepends-on: #134" }];
    const ghRunner = (args) => {
      if (args[0] === "issue" && args[1] === "list") return JSON.stringify(fakeIssues);
      if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ state: "CLOSED" });
      return "[]";
    };
    const rec = selectIssues({ filter: { all: true }, ghRunner, guidanceDir: gdir }).records.find((r) => r.number === 63);
    assert.notEqual(rec.deferred, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("selectIssues --issues filters to the requested numbers post-fetch", () => {
  const dir = tmp();
  try {
    const gdir = join(dir, "guidance");
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, "ce0e801.md"), "verdict: manual-port\n\n## Target file(s)\n\n- `a.ts`\n");
    writeFileSync(join(gdir, "abc1234.md"), "verdict: manual-port\n\n## Target file(s)\n\n- `b.ts`\n");
    const fakeIssues = [
      { number: 63, title: "x", labels: [{ name: "type:port-required" }], body: "[sha=ce0e801]" },
      { number: 7, title: "y", labels: [{ name: "type:port-required" }], body: "[sha=abc1234]" },
    ];
    const ghRunner = () => JSON.stringify(fakeIssues);
    const out = join(dir, "selected.json");
    const result = selectIssues({ filter: { issues: ["63"] }, ghRunner, guidanceDir: gdir, outPath: out });
    assert.equal(result.count, 1);
    const written = JSON.parse(readFileSync(out, "utf-8")).filter((r) => !r.needsTriage);
    assert.equal(written[0].number, 63);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("buildAppliedCheckArgs targets the gh graphql API with owner/name/num", () => {
  const args = buildAppliedCheckArgs(63, "cmetech/otto-cli");
  assert.equal(args[0], "api");
  assert.equal(args[1], "graphql");
  assert.ok(args.some((a) => a === "owner=cmetech"), `args: ${args}`);
  assert.ok(args.some((a) => a === "name=otto-cli"), `args: ${args}`);
  assert.ok(args.some((a) => a === "num=63"), `args: ${args}`);
  assert.ok(args.some((a) => /^query=/.test(a)), "carries a graphql query");
});

test("parseAppliedFromGraphql is true when a linked PR is merged", () => {
  const json = JSON.stringify({
    data: { repository: { issue: { timelineItems: { nodes: [
      { __typename: "CrossReferencedEvent", source: { __typename: "PullRequest", merged: true } },
    ] } } } },
  });
  assert.equal(parseAppliedFromGraphql(json), true);
});

test("parseAppliedFromGraphql is false when no linked PR is merged", () => {
  const json = JSON.stringify({
    data: { repository: { issue: { timelineItems: { nodes: [
      { __typename: "CrossReferencedEvent", source: { __typename: "PullRequest", merged: false } },
      { __typename: "ConnectedEvent", subject: { __typename: "Issue" } },
    ] } } } },
  });
  assert.equal(parseAppliedFromGraphql(json), false);
});

test("parseAppliedFromGraphql tolerates empty / malformed payloads", () => {
  assert.equal(parseAppliedFromGraphql("{}"), false);
  assert.equal(parseAppliedFromGraphql(""), false);
  assert.equal(parseAppliedFromGraphql("not json"), false);
});

test("selectIssues excludeApplied drops issues with a linked merged PR (incl. out-of-band)", () => {
  const dir = tmp();
  try {
    const gdir = join(dir, "guidance");
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, "ce0e801.md"), "strategy: adapted-port\n\n## Target file(s)\n\n- `a.ts`\n");
    writeFileSync(join(gdir, "4b4641c.md"), "strategy: adapted-port\n\n## Target file(s)\n\n- `b.ts`\n");
    const fakeIssues = [
      { number: 63, title: "x", labels: [{ name: "type:port-required" }], body: "[sha=ce0e801]" },
      { number: 11, title: "w", labels: [{ name: "type:port-required" }], body: "[sha=4b4641c]" },
    ];
    const mergedFor = new Set([63]);
    const ghRunner = (args) => {
      if (args[0] === "issue" && args[1] === "list") return JSON.stringify(fakeIssues);
      if (args[0] === "api" && args[1] === "graphql") {
        const numArg = args.find((a) => /^num=/.test(a)) ?? "";
        const num = Number(numArg.slice("num=".length));
        return JSON.stringify({
          data: { repository: { issue: { timelineItems: { nodes: [
            { __typename: "CrossReferencedEvent", source: { __typename: "PullRequest", merged: mergedFor.has(num) } },
          ] } } } },
        });
      }
      return "";
    };
    const out = join(dir, "selected.json");
    const result = selectIssues({ filter: { all: true }, ghRunner, guidanceDir: gdir, outPath: out, excludeApplied: true });
    const kept = result.records.map((r) => r.number).sort();
    assert.deepEqual(kept, [11], `kept: ${kept}`);
    assert.equal(result.excludedApplied, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("selectIssues without excludeApplied makes no graphql calls (back-compat)", () => {
  const dir = tmp();
  try {
    const gdir = join(dir, "guidance");
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, "ce0e801.md"), "strategy: adapted-port\n\n## Target file(s)\n\n- `a.ts`\n");
    let graphqlCalls = 0;
    const ghRunner = (args) => {
      if (args[0] === "api") graphqlCalls++;
      return JSON.stringify([{ number: 63, title: "x", labels: [{ name: "type:port-required" }], body: "[sha=ce0e801]" }]);
    };
    selectIssues({ filter: { all: true }, ghRunner, guidanceDir: gdir, outPath: join(dir, "s.json") });
    assert.equal(graphqlCalls, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
