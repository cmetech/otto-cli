/**
 * Guard used at the entry of /otto subcommand handlers that require an
 * initialized project. Returns the project root path, or null after notifying
 * the user that no project is bound and how to fix it.
 */
import type { ExtensionCommandContext } from "@otto/pi-coding-agent";

import { workflowRootOrNull } from "../../paths.js";

const NO_PROJECT_MESSAGE =
  "No OTTO project here. Run /otto init in a project directory.";

export function requireProject(
  ctx: ExtensionCommandContext,
  basePath: string = process.cwd(),
): string | null {
  const root = workflowRootOrNull(basePath);
  if (root === null) {
    ctx.ui.notify(NO_PROJECT_MESSAGE, "warning");
    return null;
  }
  return root;
}
