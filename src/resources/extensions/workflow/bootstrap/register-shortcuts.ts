// Project/App: LOOP24
// File Purpose: Registers workflow keyboard shortcuts for dashboard, notifications, and parallel overlays.

import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@gsd/pi-coding-agent";
import { Key } from "@gsd/pi-tui";

import { SHORTCUTS } from "../shortcut-defs.js";
import { shortcutDesc } from "../../shared/mod.js";

async function getProjectRoot(): Promise<string> {
  const { projectRoot } = await import("../commands/context.js");
  return projectRoot();
}

export function registerShortcuts(pi: ExtensionAPI): void {
  const overlayOptions = {
    width: "90%",
    minWidth: 80,
    maxHeight: "92%",
    anchor: "center",
  } as const;

  const openDashboardOverlay = async (ctx: ExtensionContext) => {
    const [{ DashboardOverlay }, basePath] = await Promise.all([
      import("../dashboard-overlay.js"),
      getProjectRoot(),
    ]);
    if (!existsSync(join(basePath, ".gsd"))) {
      ctx.ui.notify("No .gsd/ directory found. Run /gsd to start.", "info");
      return;
    }
    await ctx.ui.custom<boolean>(
      (tui, theme, _kb, done) => new DashboardOverlay(tui, theme, () => done(true)),
      {
        overlay: true,
        overlayOptions,
      },
    );
  };

  const openNotificationsOverlay = async (ctx: ExtensionContext) => {
    const { NotificationOverlay, notificationOverlayOptions } = await import("../notification-overlay.js");
    await ctx.ui.custom<boolean>(
      (tui, theme, _kb, done) => new NotificationOverlay(tui, theme, () => done(true)),
      {
        overlay: true,
        overlayOptions: notificationOverlayOptions(),
      },
    );
  };

  const openParallelOverlay = async (ctx: ExtensionContext) => {
    const basePath = await getProjectRoot();
    const parallelDir = join(basePath, ".gsd", "parallel");
    if (!existsSync(parallelDir)) {
      ctx.ui.notify("No parallel workers found. Run /gsd parallel start first.", "info");
      return;
    }
    const { ParallelMonitorOverlay } = await import("../parallel-monitor-overlay.js");
    await ctx.ui.custom<boolean>(
      (tui, theme, _kb, done) => new ParallelMonitorOverlay(tui, theme, () => done(true), basePath),
      {
        overlay: true,
        overlayOptions,
      },
    );
  };

  pi.registerShortcut(Key.ctrlAlt(SHORTCUTS.dashboard.key), {
    description: shortcutDesc(SHORTCUTS.dashboard.action, SHORTCUTS.dashboard.command),
    handler: openDashboardOverlay,
  });

  // Fallback for terminals where Ctrl+Alt letter chords are not forwarded reliably.
  pi.registerShortcut(Key.ctrlShift(SHORTCUTS.dashboard.key), {
    description: shortcutDesc(`${SHORTCUTS.dashboard.action} (fallback)`, SHORTCUTS.dashboard.command),
    handler: openDashboardOverlay,
  });

  pi.registerShortcut(Key.ctrlAlt(SHORTCUTS.notifications.key), {
    description: shortcutDesc(SHORTCUTS.notifications.action, SHORTCUTS.notifications.command),
    handler: openNotificationsOverlay,
  });

  // Fallback for terminals where Ctrl+Alt letter chords are not forwarded reliably.
  pi.registerShortcut(Key.ctrlShift(SHORTCUTS.notifications.key), {
    description: shortcutDesc(`${SHORTCUTS.notifications.action} (fallback)`, SHORTCUTS.notifications.command),
    handler: openNotificationsOverlay,
  });

  pi.registerShortcut(Key.ctrlAlt(SHORTCUTS.parallel.key), {
    description: shortcutDesc(SHORTCUTS.parallel.action, SHORTCUTS.parallel.command),
    handler: openParallelOverlay,
  });

  // No Ctrl+Shift+P fallback — conflicts with cycleModelBackward (shift+ctrl+p).
  // Use Ctrl+Alt+P or /loop24 parallel watch instead.
}
