import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSweepReport, renderSweepMarkdown } from "../write-sweep-report.mjs";

const RESULT = {
  scanned: 5,
  superseded: [
    { number: 42, sha: "abc1234", rule: "reverted", evidence: { revertingSha: "ff00aa1", revertingSubject: "Revert x" } },
    { number: 43, sha: "def5678", rule: "upstream-closed", evidence: { stateReason: "not-planned" } },
  ],
  advisory: [
    { number: 44, sha: "9999999", rule: "rewritten", evidence: { laterCommits: ["aaa later"], fileCount: 2 } },
  ],
  features: [
    { number: 50, sha: "feab123", title: "[upstream/pi-dev] ✨ add foo" },
  ],
  skipped: [{ number: 60, reason: "no-sha" }],
};

test("renderSweepMarkdown reports counts, evidence, advisory, and feature re-check list", () => {
  const md = renderSweepMarkdown({ runData: RESULT, date: "2026-06-14" });
  assert.match(md, /# Upstream backlog sweep — 2026-06-14/);
  assert.match(md, /scanned.*5/i);
  assert.match(md, /#42/);
  assert.match(md, /reverted/);
  assert.match(md, /ff00aa1/); // evidence sha
  assert.match(md, /#43/);
  assert.match(md, /not-planned/);
  assert.match(md, /#44/); // advisory rewritten
  assert.match(md, /advisory/i);
  assert.match(md, /#50/); // feature needing alignment re-check
  assert.match(md, /OTTO-ALIGNMENT/);
  // never-close guarantee is stated
  assert.match(md, /no issue (is|was) closed|never auto-close/i);
});

test("renderSweepMarkdown handles all-empty result", () => {
  const md = renderSweepMarkdown({
    runData: { scanned: 0, superseded: [], advisory: [], features: [], skipped: [] },
    date: "2026-06-14",
  });
  assert.match(md, /scanned.*0/i);
  assert.match(md, /\(none\)/);
});

test("writeSweepReport writes <date>-backlog-sweep.md and returns its path", () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-sweep-"));
  try {
    const path = writeSweepReport({ outputDir: dir, runData: RESULT, date: "2026-06-14" });
    assert.ok(path.endsWith("2026-06-14-backlog-sweep.md"));
    const text = readFileSync(path, "utf-8");
    assert.match(text, /#42/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
