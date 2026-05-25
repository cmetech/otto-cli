import type { ExtensionAPI, ExtensionCommandContext } from "@loop24/pi-coding-agent";
import { parseExcavateArgs } from "./args.js";
import { resolveSkillPaths } from "./paths.js";
import { buildPlaybook } from "./playbook.js";

export default function registerExcavate(pi: ExtensionAPI): void {
  pi.registerCommand("excavate", {
    description: "Reverse-engineer a codebase into provenance-cited behavioral specs",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parsed = parseExcavateArgs(typeof args === "string" ? args : "");
      if (!parsed.ok) {
        ctx.ui.notify(parsed.error, "error");
        return;
      }
      const playbook = buildPlaybook({
        target: parsed.target,
        workspace: parsed.workspace,
        skillPaths: resolveSkillPaths(),
      });
      // sendUserMessage always triggers a turn; the agent then executes the playbook.
      pi.sendUserMessage(playbook);
    },
  });
}
