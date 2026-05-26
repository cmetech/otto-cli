// Project/App: OTTO
// File Purpose: Verifies the headless discussion prompt renders compact required guidance.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("discuss-headless prompt renders compact investigation and audit guidance", async (t) => {
  const previousWorkflowHome = process.env.OTTO_HOME;
  const providedWorkflowHome = process.env.OTTO_TEST_HOME;
  const isolatedHome = providedWorkflowHome ?? mkdtempSync(join(tmpdir(), "gsd-discuss-headless-render-"));
  process.env.OTTO_HOME = isolatedHome;
  t.after(() => {
    if (previousWorkflowHome === undefined) delete process.env.OTTO_HOME;
    else process.env.OTTO_HOME = previousWorkflowHome;
    if (!providedWorkflowHome) rmSync(isolatedHome, { recursive: true, force: true });
  });

  const { loadPrompt } = await import(`../prompt-loader.ts?test=${Date.now()}`);
  const prompt = loadPrompt("discuss-headless", {
    seedContext: "# Spec\n\nBuild the thing.",
    milestoneId: "M001",
    contextPath: ".otto/workflow/milestones/M001/M001-CONTEXT.md",
    commitInstruction: "Commit the created milestone artifacts.",
    multiMilestoneCommitInstruction: "Commit the created milestone artifacts.",
    inlinedTemplates: "## Template\n\nUse standard Workflow artifacts.",
  });

  assert.match(prompt, /Investigate before making decisions:/);
  assert.match(prompt, /Budget searches across investigation and focused research\./);
  assert.match(prompt, /Resolve all of these from the spec and investigation before writing artifacts:/);
  assert.match(prompt, /Print a structured depth summary in chat/);
  assert.match(prompt, /Document every assumption in CONTEXT\.md/);
  assert.doesNotMatch(prompt, /\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/);
});
