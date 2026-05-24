// Project/App: LOOP24
// File Purpose: Clears stale run surfaces before starting new workflow work.

import type { ExtensionCommandContext } from "@loop24/pi-coding-agent";

const FRESH_RUN_COMMANDS = new Set([
  "",
  "auto",
  "next",
  "quick",
  "start",
  "new-milestone",
]);

const WIDGET_KEYS = [
  "gsd-outcome",
  "gsd-progress",
  "gsd-health",
];

const STATUS_KEYS = [
  "gsd-step",
  "gsd-auto",
];

export function isFreshWorkflowWorkCommand(trimmed: string): boolean {
  const command = trimmed.trim();
  if (!command) return true;

  const [name] = command.split(/\s+/, 1);
  if (FRESH_RUN_COMMANDS.has(name)) return true;
  return name === "do";
}

export function clearFreshWorkflowRunSurfaces(ctx: ExtensionCommandContext): void {
  const ui = ctx.ui;
  for (const key of WIDGET_KEYS) {
    ui.setWidget?.(key, undefined);
  }
  for (const key of STATUS_KEYS) {
    ui.setStatus?.(key, undefined);
  }
}
