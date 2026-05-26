/**
 * Repo conventions for /otto build-flow.
 *
 * Idempotent. Creates four directories under the workspace and patches
 * .gitignore to keep the (regenerable) catalog cache out of source control.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIRS = [
  "flows/generated",
  "flows/templates",
  "flows/imported",
  "catalog",
] as const;

const GITIGNORE_ENTRIES = [
  "# OTTO flow-builder catalog cache (regenerable)",
  "catalog/components.raw.json",
  "catalog/components.normalized.json",
  "catalog/component-index.md",
] as const;

export interface ScaffoldResult {
  created: string[];        // dirs newly created this call (relative to cwd)
  gitignoreUpdated: boolean;
}

export async function ensureRepoConventions(cwd: string): Promise<ScaffoldResult> {
  const created: string[] = [];
  for (const rel of DIRS) {
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
