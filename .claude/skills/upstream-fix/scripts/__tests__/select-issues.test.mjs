import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectIssues, parseGuidanceTargets, buildSearchArgs } from "../select-issues.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "uf-select-")); }

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
