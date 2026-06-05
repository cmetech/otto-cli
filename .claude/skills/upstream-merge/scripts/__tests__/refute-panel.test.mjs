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
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ number: 53, body: "sha=baf4028\nTarget: x.ts", labels: [{name:"upstream:pi-dev"},{name:"severity:nice-to-have-fix"},{name:"conflict-risk:none"}] });
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  const fakeGit = (args) => {
    // After the auto-resolution fix, git is called as ["-C", <root>, "show", <sha>].
    if (args[0] === "-C" && args[2] === "show") return "commit baf4028\nAuthor: x\n\ndiff --git ...\n+foo\n";
    if (args[0] === "show") return "commit baf4028\nAuthor: x\n\ndiff --git ...\n+foo\n";
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  // Pass upstreamRoot explicitly so this test does not depend on a real
  // .planning/upstream-sync-config.json on disk — the resolution flow has
  // its own coverage below.
  const bundle = buildInputBundle({ prNumber: 74, issueNumber: 53, upstreamSha: "baf4028", repo: "cmetech/otto-cli", ghRunner: fakeGh, gitRunner: fakeGit, upstreamRoot: "/fake/pi" });
  assert.equal(bundle.prNumber, 74);
  assert.equal(bundle.issueNumber, 53);
  assert.match(bundle.prDiff, /diff --git a\/x/);
  assert.match(bundle.upstreamShow, /commit baf4028/);
  assert.equal(bundle.upstreamRoot, "/fake/pi");
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

// -----------------------------------------------------------------------
// resolveUpstreamRoot + buildInputBundle auto-resolution
// -----------------------------------------------------------------------

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeRepoRoot({ upstreams = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "refute-resolve-"));
  mkdirSync(join(dir, ".planning"), { recursive: true });
  writeFileSync(join(dir, ".planning", "upstream-sync-config.json"), JSON.stringify({ version: 1, upstreams }));
  // Materialize upstream paths so existsSync passes.
  for (const v of Object.values(upstreams)) {
    if (v.path && !v.path.startsWith("/")) mkdirSync(join(dir, v.path), { recursive: true });
  }
  return dir;
}

test("resolveUpstreamRoot picks pi-dev path from upstream:pi-dev label", async () => {
  const { resolveUpstreamRoot } = await import("../refute-panel.mjs");
  const repoRoot = makeRepoRoot({ upstreams: { "pi-dev": { path: "../pi" } } });
  // Place ../pi as a sibling of repoRoot.
  mkdirSync(join(repoRoot, "..", "pi"), { recursive: true });
  try {
    const labels = [{ name: "upstream:pi-dev" }, { name: "severity:nice-to-have-fix" }];
    const r = resolveUpstreamRoot({ labels, repoRoot });
    assert.match(r, /\/pi$/);
  } finally { rmSync(repoRoot, { recursive: true, force: true }); rmSync(join(repoRoot, "..", "pi"), { recursive: true, force: true }); }
});

test("resolveUpstreamRoot throws when label is missing (no silent fallback)", async () => {
  const { resolveUpstreamRoot } = await import("../refute-panel.mjs");
  const repoRoot = makeRepoRoot({ upstreams: { "pi-dev": { path: "../pi" } } });
  try {
    assert.throws(
      () => resolveUpstreamRoot({ labels: [{ name: "severity:nice-to-have-fix" }], repoRoot }),
      /upstream:<key> label/,
    );
  } finally { rmSync(repoRoot, { recursive: true, force: true }); }
});

test("resolveUpstreamRoot throws when key is not in config", async () => {
  const { resolveUpstreamRoot } = await import("../refute-panel.mjs");
  const repoRoot = makeRepoRoot({ upstreams: { "pi-dev": { path: "../pi" } } });
  try {
    assert.throws(
      () => resolveUpstreamRoot({ labels: [{ name: "upstream:unknown-fork" }], repoRoot }),
      /upstreams\.unknown-fork\.path/,
    );
  } finally { rmSync(repoRoot, { recursive: true, force: true }); }
});

test("resolveUpstreamRoot throws when the upstream directory is missing on disk", async () => {
  const { resolveUpstreamRoot } = await import("../refute-panel.mjs");
  // Hand-roll the repo root so the helper does NOT auto-materialize the
  // upstream path — we need it genuinely absent to exercise the guard.
  const repoRoot = mkdtempSync(join(tmpdir(), "refute-missing-"));
  mkdirSync(join(repoRoot, ".planning"), { recursive: true });
  writeFileSync(
    join(repoRoot, ".planning", "upstream-sync-config.json"),
    JSON.stringify({ version: 1, upstreams: { "gsd-pi": { path: "../definitely-missing-gsd-pi" } } }),
  );
  try {
    assert.throws(
      () => resolveUpstreamRoot({ labels: [{ name: "upstream:gsd-pi" }], repoRoot }),
      /not found on disk/,
    );
  } finally { rmSync(repoRoot, { recursive: true, force: true }); }
});

test("buildInputBundle passes -C <upstreamRoot> to gitRunner (not cwd)", async () => {
  const { buildInputBundle } = await import("../refute-panel.mjs");
  const repoRoot = makeRepoRoot({ upstreams: { "pi-dev": { path: "../pi" } } });
  mkdirSync(join(repoRoot, "..", "pi"), { recursive: true });
  const gitCalls = [];
  const fakeGit = (args) => { gitCalls.push(args); return "commit abc\nAuthor: x\n\n    subject\n\n+code\n"; };
  const fakeGh = (args) => {
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ number: 1, title: "t", body: "b", headRefOid: "deadbeef" });
    if (args[0] === "pr" && args[1] === "diff") return "diff";
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ number: 99, body: "issue body", labels: [{ name: "upstream:pi-dev" }, { name: "severity:nice-to-have-fix" }, { name: "conflict-risk:none" }] });
    throw new Error(`unexpected gh: ${args.join(" ")}`);
  };
  try {
    const bundle = buildInputBundle({ prNumber: 1, issueNumber: 99, upstreamSha: "abc123", ghRunner: fakeGh, gitRunner: fakeGit, repoRoot });
    // gitRunner was called as ["-C", <pi path>, "show", "abc123"]
    assert.equal(gitCalls.length, 1);
    assert.equal(gitCalls[0][0], "-C");
    assert.match(gitCalls[0][1], /\/pi$/);
    assert.deepEqual(gitCalls[0].slice(2), ["show", "abc123"]);
    assert.equal(bundle.upstreamSha, "abc123");
    assert.match(bundle.upstreamRoot, /\/pi$/);
    assert.equal(bundle.severity, "nice-to-have-fix");
    assert.equal(bundle.conflictRisk, "none");
  } finally { rmSync(repoRoot, { recursive: true, force: true }); rmSync(join(repoRoot, "..", "pi"), { recursive: true, force: true }); }
});

test("buildInputBundle throws on empty upstreamShow (fail loud, no silent panel)", async () => {
  const { buildInputBundle } = await import("../refute-panel.mjs");
  const repoRoot = makeRepoRoot({ upstreams: { "pi-dev": { path: "../pi" } } });
  mkdirSync(join(repoRoot, "..", "pi"), { recursive: true });
  const fakeGit = () => "   "; // whitespace = silent fallback hazard
  const fakeGh = (args) => {
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ number: 1, title: "t", body: "b", headRefOid: "x" });
    if (args[0] === "pr" && args[1] === "diff") return "diff";
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ number: 99, body: "b", labels: [{ name: "upstream:pi-dev" }] });
    throw new Error("unexpected");
  };
  try {
    assert.throws(
      () => buildInputBundle({ prNumber: 1, issueNumber: 99, upstreamSha: "abc", ghRunner: fakeGh, gitRunner: fakeGit, repoRoot }),
      /empty git show/,
    );
  } finally { rmSync(repoRoot, { recursive: true, force: true }); rmSync(join(repoRoot, "..", "pi"), { recursive: true, force: true }); }
});

test("buildInputBundle honors explicit upstreamRoot override (skips label resolution)", async () => {
  const { buildInputBundle } = await import("../refute-panel.mjs");
  const repoRoot = makeRepoRoot({ upstreams: {} }); // empty config — would normally throw
  mkdirSync(join(repoRoot, "..", "pi"), { recursive: true });
  const gitCalls = [];
  const fakeGit = (args) => { gitCalls.push(args); return "commit abc\nsubject\n"; };
  const fakeGh = (args) => {
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify({ number: 1, title: "t", body: "b", headRefOid: "x" });
    if (args[0] === "pr" && args[1] === "diff") return "diff";
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify({ number: 99, body: "b", labels: [] });
    throw new Error("unexpected");
  };
  try {
    const bundle = buildInputBundle({ prNumber: 1, issueNumber: 99, upstreamSha: "abc", ghRunner: fakeGh, gitRunner: fakeGit, upstreamRoot: "/abs/override/path", repoRoot });
    assert.equal(gitCalls[0][1], "/abs/override/path");
    assert.equal(bundle.upstreamRoot, "/abs/override/path");
  } finally { rmSync(repoRoot, { recursive: true, force: true }); rmSync(join(repoRoot, "..", "pi"), { recursive: true, force: true }); }
});
