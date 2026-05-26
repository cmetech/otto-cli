// Project/App: OTTO
// File Purpose: Custom-engine iteration-data adapter for auto-mode loop.

import type { WorkflowDbState } from "../types.js";
import type { IterationData } from "./types.js";

export interface CustomEngineStep {
  unitType: string;
  unitId: string;
  prompt: string;
}

export interface BuildCustomEngineIterationDataInput {
  step: CustomEngineStep;
  basePath: string;
  canonicalProjectRoot: string;
  currentMilestoneId?: string | null;
  deriveState: (basePath: string) => Promise<WorkflowDbState>;
  logPostDerive: (details: {
    site: "custom-engine-gsd-state";
    basePath: string;
    canonicalProjectRoot: string;
    derivedPhase: WorkflowDbState["phase"];
    activeUnit: string | undefined;
  }) => void;
}

export async function buildCustomEngineIterationData(
  input: BuildCustomEngineIterationDataInput,
): Promise<IterationData> {
  const workflowState = await input.deriveState(input.canonicalProjectRoot);
  input.logPostDerive({
    site: "custom-engine-gsd-state",
    basePath: input.basePath,
    canonicalProjectRoot: input.canonicalProjectRoot,
    derivedPhase: workflowState.phase,
    activeUnit: workflowState.activeTask?.id ?? workflowState.activeSlice?.id ?? workflowState.activeMilestone?.id,
  });

  return {
    unitType: input.step.unitType,
    unitId: input.step.unitId,
    prompt: input.step.prompt,
    finalPrompt: input.step.prompt,
    pauseAfterUatDispatch: false,
    state: workflowState,
    mid: input.currentMilestoneId ?? "workflow",
    midTitle: "Workflow",
    isRetry: false,
    previousTier: undefined,
  };
}
