// Project/App: LOOP24
// File Purpose: Verifies the queue prompt renders compact discussion and write-gate guidance.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("queue prompt renders compact draft, verification, and persistence guidance", async (t) => {
  const previousWorkflowHome = process.env.GSD_HOME;
  const providedWorkflowHome = process.env.GSD_TEST_HOME;
  const isolatedHome = providedWorkflowHome ?? mkdtempSync(join(tmpdir(), "gsd-queue-render-"));
  process.env.GSD_HOME = isolatedHome;
  t.after(() => {
    if (previousWorkflowHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = previousWorkflowHome;
    if (!providedWorkflowHome) rmSync(isolatedHome, { recursive: true, force: true });
  });

  const { loadPrompt } = await import(`../prompt-loader.ts?test=${Date.now()}`);
  const prompt = loadPrompt("queue", {
    preamble: "Queue preamble.",
    existingMilestonesContext: "No existing milestones.",
    commitInstruction: "Commit queued milestone artifacts.",
    inlinedTemplates: "## Context Template\n\nUse standard GSD context.",
  });

  assert.match(prompt, /Draft Awareness/);
  assert.match(prompt, /What do you want to add\?/);
  assert.match(prompt, /Investigate between question rounds/);
  assert.match(prompt, /Pre-Write Verification/);
  assert.match(prompt, /depth_verification/);
  assert.match(prompt, /gsd_milestone_generate_id/);
  assert.match(prompt, /gsd_summary_save/);
  assert.doesNotMatch(prompt, /\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/);
});
