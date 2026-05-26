/**
 * Tools loader.
 *
 * Registers the seven flow-builder tools with the Pi extension API. Called
 * from the otto extension's index.ts at extension load.
 *
 * Tools are always registered (not lazy), so the model can call them from any
 * conversation — not only inside /otto build-flow. This is intentional:
 * users may want to refresh the catalog from a normal chat, or have the
 * agent inspect a component while debugging an existing flow.
 */

import type { ExtensionAPI } from "@otto/pi-coding-agent";
import { refreshCatalogTool } from "./refresh-catalog.js";
import { normalizeCatalogTool } from "./normalize-catalog.js";
import { checkCatalogHealthTool } from "./check-catalog-health.js";
import { inspectComponentTool } from "./inspect-component.js";
import { validateFlowTool } from "./validate-flow.js";
import { importFlowTool } from "./import-flow.js";
import { smokeTestFlowTool } from "./smoke-test-flow.js";

export const OTTO_TOOL_NAMES = [
  "otto__refresh_catalog",
  "otto__normalize_catalog",
  "otto__check_catalog_health",
  "otto__inspect_component",
  "otto__validate_flow",
  "otto__import_flow",
  "otto__smoke_test_flow",
] as const;

export function registerOttoTools(pi: ExtensionAPI): void {
  pi.registerTool(refreshCatalogTool);
  pi.registerTool(normalizeCatalogTool);
  pi.registerTool(checkCatalogHealthTool);
  pi.registerTool(inspectComponentTool);
  pi.registerTool(validateFlowTool);
  pi.registerTool(importFlowTool);
  pi.registerTool(smokeTestFlowTool);
}
