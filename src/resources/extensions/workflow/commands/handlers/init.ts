/**
 * /gsd init — bootstrap a new GSD project in cwd.
 *
 * This creates `.gsd/` during the legacy marker era. Detection already accepts
 * both `.gsd/` and `.otto/workflow/` for forward compatibility.
 */
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionCommandContext } from "@loop24/pi-coding-agent";

import { _clearWorkflowRootCache } from "../../paths.js";

const PROJECT_MARKER_GSD = ".gsd";
const PROJECT_MARKER_OTTO = join(".otto", "workflow");

function normHome(): string {
  return resolve(homedir());
}

function manifestContents(version: string): string {
  return JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    otto: version,
  }, null, 2) + "\n";
}

function stateMdContents(): string {
  return [
    "# Workflow State",
    "",
    "_New project. Run `/gsd new-project` to start your first milestone._",
    "",
  ].join("\n");
}

export async function runInit(
  ctx: ExtensionCommandContext,
  basePath: string = process.cwd(),
): Promise<void> {
  const cwd = resolve(basePath);

  if (cwd === normHome()) {
    ctx.ui.notify(
      "Refusing to create .gsd/ in your home directory. cd into a project dir first.",
      "warning",
    );
    return;
  }

  const existingGsd = join(cwd, PROJECT_MARKER_GSD);
  const existingOtto = join(cwd, PROJECT_MARKER_OTTO);
  if (existsSync(existingGsd)) {
    ctx.ui.notify(`Project already initialized at ${existingGsd}. Nothing to do.`, "info");
    return;
  }
  if (existsSync(existingOtto)) {
    ctx.ui.notify(`Project already initialized at ${existingOtto}. Nothing to do.`, "info");
    return;
  }

  try {
    accessSync(cwd, fsConstants.W_OK);
  } catch (err) {
    ctx.ui.notify(
      `Cannot create .gsd/ in ${cwd}: ${(err as Error).message}`,
      "error",
    );
    return;
  }

  const version = process.env.LOOP24_VERSION ?? process.env.GSD_VERSION ?? "0.0.0";
  const target = existingGsd;

  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "manifest.json"), manifestContents(version), "utf-8");
    writeFileSync(join(target, "STATE.md"), stateMdContents(), "utf-8");
  } catch (err) {
    ctx.ui.notify(
      `Failed to create .gsd/: ${(err as Error).message}`,
      "error",
    );
    return;
  }

  _clearWorkflowRootCache();

  ctx.ui.notify(`GSD project initialized at ${target}`, "success");
}
