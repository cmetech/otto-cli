/**
 * Flow-trigger loader.
 *
 * Scans a directory for `*.yaml` files (skipping anything starting with
 * underscore — those are loader-internal helpers like _schema.ts), parses
 * each one, validates against the FlowTrigger schema, and returns:
 *   - commands: the valid FlowTrigger objects ready to register
 *   - errors:   per-file diagnostics for invalid files
 *
 * Never throws — bad YAML in one file should not block others.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { validateFlowTrigger, type FlowTrigger } from "./_schema.js";

export interface FlowTriggerLoadResult {
  commands: FlowTrigger[];
  errors: { file: string; message: string }[];
}

export async function loadFlowTriggers(dir: string): Promise<FlowTriggerLoadResult> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return { commands: [], errors: [] };  // dir doesn't exist → no commands, no errors
  }

  const yamlFiles = entries
    .filter((f) => (f.endsWith(".yaml") || f.endsWith(".yml")) && !f.startsWith("_"))
    .sort();

  const commands: FlowTrigger[] = [];
  const errors: { file: string; message: string }[] = [];

  for (const file of yamlFiles) {
    const path = join(dir, file);
    let text: string;
    try {
      text = await readFile(path, "utf-8");
    } catch (err) {
      errors.push({ file: path, message: `cannot read: ${(err as Error).message}` });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch (err) {
      errors.push({ file: path, message: `invalid YAML: ${(err as Error).message}` });
      continue;
    }
    const validated = validateFlowTrigger(parsed);
    if (!validated.ok) {
      errors.push({ file: path, message: validated.errors.join("; ") });
      continue;
    }
    commands.push(validated.value);
  }

  return { commands, errors };
}
