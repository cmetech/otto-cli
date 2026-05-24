/**
 * Reference-doc system-context loader.
 *
 * Reads the four bundled reference/*.md files and concatenates them into a
 * single string the build-flow command injects as the leading context for
 * the agent turn.
 *
 * The reference docs are verbatim copies from the upstream langflow-flow-builder
 * skill. Order matters: workflow.md first (establishes process), then the
 * rules docs (catalog → edges → JSON).
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const _here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REFERENCE_DIR = join(_here, "..", "..", "reference");

export const REFERENCE_DOC_NAMES = [
  "workflow.md",
  "component-catalog-rules.md",
  "edge-handle-rules.md",
  "flow-json-rules.md",
] as const;

export async function loadReferenceDocs(referenceDir: string = DEFAULT_REFERENCE_DIR): Promise<string> {
  const parts: string[] = [];
  for (const name of REFERENCE_DOC_NAMES) {
    const path = join(referenceDir, name);
    let body: string;
    try {
      body = await readFile(path, "utf-8");
    } catch (err) {
      throw new Error(`reference doc not found: ${path} (${(err as Error).message})`);
    }
    parts.push(`<!-- ──────── ${name} ──────── -->\n\n${body}`);
  }
  return parts.join("\n\n");
}
