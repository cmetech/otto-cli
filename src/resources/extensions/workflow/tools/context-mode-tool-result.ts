// Project/App: OTTO
// File Purpose: Shared Context Mode tool result helpers.

export interface ToolExecutionResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError?: boolean;
}

export type ContextModeToolName = "otto_exec" | "otto_exec_search" | "otto_resume";

export function contextModeDisabledResult(operation: ContextModeToolName): ToolExecutionResult {
  return {
    content: [
      {
        type: "text",
        text:
          `${operation} is disabled by \`context_mode.enabled: false\` in preferences. ` +
          "Remove that override or set it to true to re-enable Context Mode tools.",
      },
    ],
    details: { operation, error: "context_mode_disabled" },
    isError: true,
  };
}
