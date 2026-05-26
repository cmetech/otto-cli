// Project/App: OTTO
// File Purpose: Verifies the forensics prompt renders required investigation and issue-routing guidance.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("forensics prompt renders compact investigation and issue routing guidance", async (t) => {
  const previousWorkflowHome = process.env.OTTO_HOME;
  const providedWorkflowHome = process.env.OTTO_TEST_HOME;
  const isolatedHome = providedWorkflowHome ?? mkdtempSync(join(tmpdir(), "gsd-forensics-render-"));
  process.env.OTTO_HOME = isolatedHome;
  t.after(() => {
    if (previousWorkflowHome === undefined) delete process.env.OTTO_HOME;
    else process.env.OTTO_HOME = previousWorkflowHome;
    if (!providedWorkflowHome) rmSync(isolatedHome, { recursive: true, force: true });
  });

  const { loadPrompt } = await import(`../prompt-loader.ts?test=${Date.now()}`);
  const prompt = loadPrompt("forensics", {
    problemDescription: "Auto-mode repeats the same unit.",
    forensicData: "stuck-detected event for execute-task/M001/S01/T01",
    workflowSourceDir: process.env.OTTO_TEST_WORKSPACE_ROOT ?? process.cwd(),
    dedupSection: "No duplicate issue found.",
  });

  assert.match(prompt, /Investigation Protocol/);
  assert.match(prompt, /otto_milestone_status/);
  assert.match(prompt, /sqlite3 .otto\/workflow\/otto.db/);
  assert.match(prompt, /gh issue create --repo open-gsd\/otto-pi/);
  assert.match(prompt, /Do NOT use the `github_issues` tool/);
  assert.match(prompt, /Redaction Rules/);
  assert.doesNotMatch(prompt, /\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/);
});
