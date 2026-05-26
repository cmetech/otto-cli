/**
 * /otto init — bootstrap a new OTTO project in cwd.
 *
 * This creates `.otto/workflow/`, the canonical project workflow directory.
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
import type { ExtensionCommandContext } from "@otto/pi-coding-agent";

import { _clearWorkflowRootCache, workflowDirUnder, WORKFLOW_DIR_DISPLAY } from "../../paths.js";

const PROJECT_MARKER_OTTO = WORKFLOW_DIR_DISPLAY;

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
    "_New project. Run `/otto new-project` to start your first milestone._",
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
      `Refusing to create ${PROJECT_MARKER_OTTO}/ in your home directory. cd into a project dir first.`,
      "warning",
    );
    return;
  }

  const existingOtto = workflowDirUnder(cwd);
  if (existsSync(existingOtto)) {
    ctx.ui.notify(`Project already initialized at ${existingOtto}. Nothing to do.`, "info");
    return;
  }

  try {
    accessSync(cwd, fsConstants.W_OK);
  } catch (err) {
    ctx.ui.notify(
      `Cannot create ${PROJECT_MARKER_OTTO}/ in ${cwd}: ${(err as Error).message}`,
      "error",
    );
    return;
  }

  const version = process.env.OTTO_VERSION ?? "0.0.0";
  const target = existingOtto;

  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "manifest.json"), manifestContents(version), "utf-8");
    writeFileSync(join(target, "STATE.md"), stateMdContents(), "utf-8");
  } catch (err) {
    ctx.ui.notify(
      `Failed to create ${PROJECT_MARKER_OTTO}/: ${(err as Error).message}`,
      "error",
    );
    return;
  }

  _clearWorkflowRootCache();

  ctx.ui.notify(`OTTO project initialized at ${target}`, "success");
}
