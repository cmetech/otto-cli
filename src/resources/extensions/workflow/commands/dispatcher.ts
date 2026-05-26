// Project/App: OTTO
// File Purpose: Routes /otto commands through global guards and command handlers.

import type { ExtensionAPI, ExtensionCommandContext } from "@otto/pi-coding-agent";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { slashCommand } from "../strings.js";
import { NoProjectError, projectRoot, withCommandCwd } from "./context.js";
import { handleAutoCommand } from "./handlers/auto.js";
import { handleCoreCommand } from "./handlers/core.js";
import { handleOpsCommand } from "./handlers/ops.js";
import { handleParallelCommand } from "./handlers/parallel.js";
import { handleWorkflowCommand } from "./handlers/workflow.js";
import {
  getValidationBlockMessageForBase,
  isValidationBlockAllowedCommand,
} from "../validation-block-guard.js";
import {
  getUnmergedMilestoneBlockMessageForBase,
  isUnmergedMilestoneAllowedCommand,
} from "../unmerged-milestone-guard.js";
import { clearFreshWorkflowRunSurfaces, isFreshWorkflowWorkCommand } from "../fresh-run-ui.js";

const REQUIRES_PROJECT = new Set([
  "",
  "next", "start", "auto", "stop", "pause", "status", "visualize", "widget", "brief",
  "report", "export", "queue", "quick", "discuss", "capture", "triage",
  "dispatch", "verdict", "history", "undo", "undo-task", "reset-slice",
  "rate", "skip", "cleanup", "closeout", "new-milestone", "new-project",
  "parallel", "park", "unpark", "inspect", "doctor", "migrate", "remote",
  "steer", "knowledge", "rethink", "workflow", "codebase", "ship", "do",
  "session-report", "backlog", "pr-branch", "add-tests", "scan", "worktree",
  "wt", "eval-review", "extract-learnings", "memory", "mode", "prefs",
  "cmux", "hooks", "run-hook", "skill-health", "forensics", "logs",
  "debug", "recover", "escalate",
]);

function commandName(trimmed: string): string {
  return trimmed.trim().split(/\s+/, 1)[0] ?? "";
}

function commandCwd(ctx: ExtensionCommandContext): string {
  if (ctx.cwd) return ctx.cwd;
  try {
    return process.cwd();
  } catch {
    return homedir();
  }
}

function isHomePath(path: string): boolean {
  return resolve(path) === resolve(homedir());
}

function emitVisibleCommandBlock(
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  message: string,
): void {
  if (pi && typeof pi.sendMessage === "function") {
    pi.sendMessage({
      customType: "gsd-command-block",
      content: message,
      display: true,
    });
    return;
  }
  ctx.ui.notify(message, "warning");
}

export async function dispatchWorkflowCommand(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  const trimmed = (typeof args === "string" ? args : "").trim();
  const subcommand = commandName(trimmed);

  const handlers = [
    () => handleCoreCommand(trimmed, ctx, pi),
    () => handleAutoCommand(trimmed, ctx, pi),
    () => handleParallelCommand(trimmed, ctx, pi),
    () => handleWorkflowCommand(trimmed, ctx, pi),
    () => handleOpsCommand(trimmed, ctx, pi),
  ];

  let handled = false;
  try {
    handled = await withCommandCwd(ctx.cwd, async () => {
      if (isFreshWorkflowWorkCommand(trimmed)) {
        clearFreshWorkflowRunSurfaces(ctx);
      }
      const cwd = commandCwd(ctx);
      if (trimmed === "init") {
        const { workflowRootOrNull } = await import("../paths.js");
        if (workflowRootOrNull(cwd) === null || isHomePath(cwd)) {
          const { runInit } = await import("./handlers/init.js");
          await runInit(ctx, cwd);
          return true;
        }
      }
      const needsProject = REQUIRES_PROJECT.has(subcommand);
      if (needsProject) {
        const { requireProject } = await import("./handlers/require-project.js");
        if (requireProject(ctx, cwd) === null) return true;

        const base = projectRoot();
        if (!isUnmergedMilestoneAllowedCommand(trimmed)) {
          const blockedMessage = await getUnmergedMilestoneBlockMessageForBase(base, trimmed);
          if (blockedMessage) {
            emitVisibleCommandBlock(ctx, pi, blockedMessage);
            return true;
          }
        }
        if (!isValidationBlockAllowedCommand(trimmed)) {
          const blockedMessage = await getValidationBlockMessageForBase(base, trimmed);
          if (blockedMessage) {
            emitVisibleCommandBlock(ctx, pi, blockedMessage);
            return true;
          }
        }
      }
      for (const handler of handlers) {
        if (await handler()) {
          return true;
        }
      }
      return false;
    });
  } catch (err) {
    if (err instanceof NoProjectError) {
      ctx.ui.notify(
        `${err.message} \`cd\` into a project directory first.`,
        "warning",
      );
      return;
    }
    throw err;
  }

  if (handled) return;

  if (trimmed.includes(" ")) {
    const { handleDo } = await import("../commands-do.js");
    await handleDo(trimmed, ctx, pi);
    return;
  }

  ctx.ui.notify(
    `Unknown: ${slashCommand(trimmed)}. Run ${slashCommand("help")} for available commands.`,
    "warning",
  );
}
