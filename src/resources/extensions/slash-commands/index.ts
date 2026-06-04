import type { ExtensionAPI } from "@otto/pi-coding-agent";
import createSlashCommand from "./create-slash-command.js";
import createExtension from "./create-extension.js";
import auditCodebaseCommand from "./audit-codebase.js";
import clearCommand from "./clear.js";

export default function slashCommands(pi: ExtensionAPI) {
  createSlashCommand(pi);
  createExtension(pi);
  auditCodebaseCommand(pi);
  clearCommand(pi);
}
