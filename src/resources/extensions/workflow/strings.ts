import { BRAND_NAME, COMMAND_NAMESPACE, CONFIG_DIR_NAME } from "@gsd/pi-coding-agent";

// User-facing brand strings for the workflow extension.
// Centralizing here means changing piConfig.brandName / commandNamespace in
// package.json updates every prompt and help message in one place.
//
// Internal identifiers (customType strings like "gsd-add-tests", error codes
// like "MISSING_WORKFLOW_MARKER", function names like registerWorkflowCommand) are
// NOT routed through here — they're not user-visible.

export const BRAND = BRAND_NAME;                          // "LOOP24"
export const CMD = COMMAND_NAMESPACE;                     // "loop24"
export const BRAND_FULL = `${BRAND_NAME} Agent`;          // "LOOP24 Agent"
export const PLANNING_DIR = ".planning";                  // unchanged across brands
export const STATE_DB_NAME = `.${COMMAND_NAMESPACE}.db`;  // ".loop24.db"
export { CONFIG_DIR_NAME };                               // e.g. ".loop24"

/** Build a user-facing slash command reference, e.g. slashCommand("plan") -> "/loop24 plan". */
export const slashCommand = (sub: string) => `/${COMMAND_NAMESPACE} ${sub}`;
