// Project/App: OTTO
// File Purpose: Verifies the milestone planning prompt renders compact required guidance.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("plan-milestone prompt renders compact DB-backed planning guidance", async (t) => {
  const previousWorkflowHome = process.env.OTTO_HOME;
  const providedWorkflowHome = process.env.OTTO_TEST_HOME;
  const isolatedHome = providedWorkflowHome ?? mkdtempSync(join(tmpdir(), "gsd-plan-milestone-render-"));
  const fixtureRoot = process.env.OTTO_TEST_WORKSPACE_ROOT ?? process.cwd();
  process.env.OTTO_HOME = isolatedHome;
  t.after(() => {
    if (previousWorkflowHome === undefined) delete process.env.OTTO_HOME;
    else process.env.OTTO_HOME = previousWorkflowHome;
    if (!providedWorkflowHome) rmSync(isolatedHome, { recursive: true, force: true });
  });

  const { loadPrompt } = await import(`../prompt-loader.ts?test=${Date.now()}`);
  const prompt = loadPrompt("plan-milestone", {
    milestoneId: "M001",
    milestoneTitle: "Reduce prompt cost",
    workingDirectory: fixtureRoot,
    inlinedContext: "## Roadmap\n\nUse the roadmap template.",
    outputPath: ".otto/workflow/milestones/M001/M001-ROADMAP.md",
    skillDiscoveryMode: "filtered",
    skillDiscoveryInstructions: "Use only relevant skills.",
    sourceFilePaths: "- src/resources/extensions/workflow/prompts/plan-milestone.md",
    researchOutputPath: ".otto/workflow/milestones/M001/M001-RESEARCH.md",
    secretsOutputPath: ".otto/workflow/milestones/M001/SECRETS.md",
  });

  assert.match(prompt, /Explore First, Then Decompose/);
  assert.match(prompt, /Call `otto_plan_milestone`/);
  assert.match(prompt, /call `otto_decision_save`/);
  assert.match(prompt, /Every relevant Active requirement must end as mapped/);
  assert.match(prompt, /Risk-first means proof-first/);
  assert.match(prompt, /Progressive Planning \(ADR-011\)/);
  assert.match(prompt, /Single-Slice Fast Path/);
  assert.match(prompt, /Secret Forecasting/);
  assert.doesNotMatch(prompt, /\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/);
});
