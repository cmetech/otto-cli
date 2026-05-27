/**
 * Repo conventions for /otto build-flow.
 *
 * Idempotent. Creates four directories under the workspace and patches
 * .gitignore to keep the (regenerable) catalog cache out of source control.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REL_DIRS = [
  ".otto/langflow/generated",
  ".otto/langflow/samples",
  ".otto/langflow/imported",
  ".otto/langflow/catalog",
  ".otto/langflow/runs",
] as const;

const GITIGNORE_ENTRIES = [
  "# OTTO flow-builder catalog cache (regenerable)",
  ".otto/langflow/catalog/components.raw.json",
  ".otto/langflow/catalog/components.normalized.json",
  ".otto/langflow/catalog/component-index.md",
] as const;

export interface ScaffoldResult {
  created: string[];        // dirs newly created this call (relative to cwd)
  gitignoreUpdated: boolean;
}

export async function ensureRepoConventions(cwd: string): Promise<ScaffoldResult> {
  const created: string[] = [];
  for (const rel of REL_DIRS) {
    const abs = join(cwd, rel);
    if (!existsSync(abs)) {
      mkdirSync(abs, { recursive: true });
      created.push(rel);
    }
  }

  const giPath = join(cwd, ".gitignore");
  const existing = existsSync(giPath) ? readFileSync(giPath, "utf-8") : "";
  const linesToAdd = GITIGNORE_ENTRIES.filter((line) => !existing.includes(line));
  let gitignoreUpdated = false;
  if (linesToAdd.length > 0) {
    const sep = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    const block = (existing.length > 0 ? "\n" : "") + linesToAdd.join("\n") + "\n";
    writeFileSync(giPath, existing + sep + block);
    gitignoreUpdated = true;
  }

  return { created, gitignoreUpdated };
}
