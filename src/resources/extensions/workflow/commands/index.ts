import { COMMAND_NAMESPACE, type ExtensionAPI, type ExtensionCommandContext } from "@gsd/pi-coding-agent";

import { WORKFLOW_COMMAND_DESCRIPTION, getWorkflowArgumentCompletions } from "./catalog.js";

export function registerWorkflowCommand(pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND_NAMESPACE, {
    description: WORKFLOW_COMMAND_DESCRIPTION,
    getArgumentCompletions: getWorkflowArgumentCompletions,
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const { dispatchWorkflowCommand } = await import("./dispatcher.js");
      const { setStderrLoggingEnabled } = await import("../workflow-logger.js");
      const previousStderrSetting = setStderrLoggingEnabled(false);
      try {
        await dispatchWorkflowCommand(args, ctx, pi);
      } finally {
        setStderrLoggingEnabled(previousStderrSetting);
      }
    },
  });
}
