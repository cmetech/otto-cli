import { test } from "node:test";
import assert from "node:assert/strict";
import { tallyVerdicts, formatRefuteComment, LENS_NAMES } from "../refute-panel.mjs";

const A = (lens, verdict, reason = "ok") => ({ lens, verdict, reason, confidence: 0.9, blocking: verdict === "refute" });

test("LENS_NAMES has the four lenses in expected order", () => {
  assert.deepEqual(LENS_NAMES, ["upstream-alignment", "scope-discipline", "test-quality", "blast-radius"]);
});

test("panel approves when ≥2 approve and 0 refute", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "approve"),
    A("scope-discipline", "approve"),
    A("test-quality", "abstain"),
    A("blast-radius", "abstain"),
  ]);
  assert.equal(r.panelVerdict, "approve");
  assert.equal(r.approves, 2);
  assert.equal(r.refutes, 0);
});

test("panel refutes when any refute present", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "approve"),
    A("scope-discipline", "refute", "touches unrelated file"),
    A("test-quality", "approve"),
    A("blast-radius", "approve"),
  ]);
  assert.equal(r.panelVerdict, "refute");
  assert.equal(r.refutes, 1);
});

test("panel refutes (fail-safe) when all four abstain", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "abstain"),
    A("scope-discipline", "abstain"),
    A("test-quality", "abstain"),
    A("blast-radius", "abstain"),
  ]);
  assert.equal(r.panelVerdict, "refute");
  assert.match(r.reason, /no non-abstain verdicts/);
});

test("panel refutes (fail-safe) when fewer than 2 approves", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "approve"),
    A("scope-discipline", "abstain"),
    A("test-quality", "abstain"),
    A("blast-radius", "abstain"),
  ]);
  assert.equal(r.panelVerdict, "refute");
  assert.match(r.reason, /need.*2 approve/i);
});

test("panel refutes when a lens errored (treated as abstain) and condition not met", () => {
  const r = tallyVerdicts([
    A("upstream-alignment", "approve"),
    { lens: "scope-discipline", verdict: "abstain", reason: "lens errored", confidence: 0, blocking: false },
    A("test-quality", "abstain"),
    A("blast-radius", "abstain"),
  ]);
  assert.equal(r.panelVerdict, "refute");
});

test("formatRefuteComment renders a markdown table with lens verdicts", () => {
  const verdicts = [
    A("upstream-alignment", "approve"),
    A("scope-discipline", "refute", "PR touches packages/x/y.ts which is not in upstream baf4028"),
    A("test-quality", "approve"),
    A("blast-radius", "abstain"),
  ];
  const md = formatRefuteComment(verdicts, { runId: "swarm-run-3" });
  assert.match(md, /Refute panel blocked/);
  assert.match(md, /upstream-alignment.*approve/);
  assert.match(md, /scope-discipline.*refute/);
  assert.match(md, /PR touches packages\/x\/y\.ts/);
  assert.match(md, /Run id: swarm-run-3/);
});

test("buildInputBundle gathers PR + upstream + issue context once", async () => {
  const { buildInputBundle } = await import("../refute-panel.mjs");
  const fakeGh = (args) => {
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ number: 74, title: "fix(x): y", body: "closes #53", headRefOid: "abc1234" });
    if (args[0] === "pr" && args[1] === "diff") return "diff --git a/x b/x\n+foo\n";
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ number: 53, body: "sha=baf4028\nTarget: x.ts", labels: [{name:"severity:nice-to-have-fix"},{name:"conflict-risk:none"}] });
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  const fakeGit = (args) => {
    if (args[0] === "show") return "commit baf4028\nAuthor: x\n\ndiff --git ...\n+foo\n";
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  const bundle = buildInputBundle({ prNumber: 74, issueNumber: 53, upstreamSha: "baf4028", repo: "cmetech/otto-cli", ghRunner: fakeGh, gitRunner: fakeGit });
  assert.equal(bundle.prNumber, 74);
  assert.equal(bundle.issueNumber, 53);
  assert.match(bundle.prDiff, /diff --git a\/x/);
  assert.match(bundle.upstreamShow, /commit baf4028/);
  assert.equal(bundle.severity, "nice-to-have-fix");
  assert.equal(bundle.conflictRisk, "none");
});

test("runPanel dispatches one subagent per lens in parallel and tallies", async () => {
  const { runPanel } = await import("../refute-panel.mjs");
  const dispatched = [];
  const fakeAgentRunner = async ({ lens }) => {
    dispatched.push(lens);
    return { lens, verdict: "approve", confidence: 0.9, reason: `${lens} ok`, blocking: false };
  };
  const r = await runPanel({
    bundle: { prNumber: 74, prDiff: "x", upstreamShow: "y", issueBody: "z", severity: "nice-to-have-fix", conflictRisk: "none" },
    agentRunner: fakeAgentRunner,
  });
  assert.deepEqual(dispatched.sort(), ["blast-radius", "scope-discipline", "test-quality", "upstream-alignment"]);
  assert.equal(r.verdicts.length, 4);
  assert.equal(r.tally.panelVerdict, "approve");
});

test("runPanel treats a lens error as an abstain verdict", async () => {
  const { runPanel } = await import("../refute-panel.mjs");
  const fakeAgentRunner = async ({ lens }) => {
    if (lens === "scope-discipline") throw new Error("lens crashed");
    return { lens, verdict: "approve", confidence: 0.9, reason: "ok", blocking: false };
  };
  const r = await runPanel({ bundle: { prNumber: 1, prDiff: "x", upstreamShow: "y", issueBody: "z" }, agentRunner: fakeAgentRunner });
  const scope = r.verdicts.find((v) => v.lens === "scope-discipline");
  assert.equal(scope.verdict, "abstain");
  assert.match(scope.reason, /lens crashed|error/i);
  // 3 approve + 1 abstain → approves >=2 and 0 refutes → approve
  assert.equal(r.tally.panelVerdict, "approve");
});
