import type { LangFlowToolAction } from "../../tools/langflow.js";

export interface LangFlowIntentEval {
  prompt: string;
  action: LangFlowToolAction;
  notes: string;
}

export const LANGFLOW_INTENT_EVALS: LangFlowIntentEval[] = [
  {
    prompt: "I want to build a langflow flow that sends chat input to OTTO gateway and returns the response",
    action: "build_flow",
    notes: "Natural build requests should invoke the builder path, not ask the user for slash syntax.",
  },
  {
    prompt: "Show me all LangFlow flows starting with otto",
    action: "list_flows",
    notes: "Prefix/list phrasing maps to a filtered flow listing.",
  },
  {
    prompt: "Import .otto/langflow/generated/otto-hello-world.json and update the existing flow",
    action: "import_flow",
    notes: "Import/update phrasing maps to import_flow with update semantics.",
  },
  {
    prompt: "Export the otto-hello-world flow and overwrite the local json",
    action: "export_flow",
    notes: "Export/overwrite phrasing maps to export_flow with overwrite enabled.",
  },
  {
    prompt: "Run otto-hello-world with the message hello from otto",
    action: "run_flow",
    notes: "Run/execute phrasing maps to run_flow with input text.",
  },
  {
    prompt: "Remove the old test-flow from LangFlow",
    action: "delete_flow",
    notes: "Destructive delete requires an explicit confirmation field in the tool call.",
  },
];

