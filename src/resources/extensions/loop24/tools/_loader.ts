/**
 * Tools loader.
 *
 * Registers the seven flow-builder tools with the Pi extension API. Called
 * from the loop24 extension's index.ts at extension load.
 *
 * Tools are always registered (not lazy), so the model can call them from any
 * conversation — not only inside /otto build-flow. This is intentional:
 * users may want to refresh the catalog from a normal chat, or have the
 * agent inspect a component while debugging an existing flow.
 */

import type { ExtensionAPI } from "@loop24/pi-coding-agent";
import { refreshCatalogTool } from "./refresh-catalog.js";
import { normalizeCatalogTool } from "./normalize-catalog.js";
import { checkCatalogHealthTool } from "./check-catalog-health.js";
import { inspectComponentTool } from "./inspect-component.js";
import { validateFlowTool } from "./validate-flow.js";
import { importFlowTool } from "./import-flow.js";
import { smokeTestFlowTool } from "./smoke-test-flow.js";

export const LOOP24_TOOL_NAMES = [
  "loop24__refresh_catalog",
  "loop24__normalize_catalog",
  "loop24__check_catalog_health",
  "loop24__inspect_component",
  "loop24__validate_flow",
  "loop24__import_flow",
  "loop24__smoke_test_flow",
] as const;

export function registerLoop24Tools(pi: ExtensionAPI): void {
  pi.registerTool(refreshCatalogTool);
  pi.registerTool(normalizeCatalogTool);
  pi.registerTool(checkCatalogHealthTool);
  pi.registerTool(inspectComponentTool);
  pi.registerTool(validateFlowTool);
  pi.registerTool(importFlowTool);
  pi.registerTool(smokeTestFlowTool);
}
