// Canonical shortcut definitions used by registration, help text, and overlays.

import { formatShortcut } from "./files.js";
import { slashCommand } from "./strings.js";

export type ShortcutId = "dashboard" | "notifications" | "parallel";

type ShortcutDef = {
  key: "g" | "n" | "p";
  action: string;
  command: string;
  /** Whether the Ctrl+Shift fallback is registered (false when it conflicts with an app keybinding). */
  hasFallback: boolean;
};

export const SHORTCUTS: Record<ShortcutId, ShortcutDef> = {
  dashboard: {
    key: "g",
    action: "Open GSD dashboard",
    command: slashCommand("status"),
    hasFallback: true,
  },
  notifications: {
    key: "n",
    action: "Open notification history",
    command: slashCommand("notifications"),
    hasFallback: true,
  },
  parallel: {
    key: "p",
    action: "Open parallel worker monitor",
    command: slashCommand("parallel watch"),
    hasFallback: false, // Ctrl+Shift+P conflicts with cycleModelBackward
  },
};

function combo(prefix: "Ctrl+Alt+" | "Ctrl+Shift+", key: string): string {
  return `${prefix}${key.toUpperCase()}`;
}

export function primaryShortcutCombo(id: ShortcutId): string {
  return combo("Ctrl+Alt+", SHORTCUTS[id].key);
}

export function fallbackShortcutCombo(id: ShortcutId): string {
  return combo("Ctrl+Shift+", SHORTCUTS[id].key);
}

export function shortcutPair(id: ShortcutId, formatter: (combo: string) => string = (combo) => combo): string {
  const primary = formatter(primaryShortcutCombo(id));
  if (!SHORTCUTS[id].hasFallback) return primary;
  return `${primary} / ${formatter(fallbackShortcutCombo(id))}`;
}

export function formattedShortcutPair(id: ShortcutId): string {
  return shortcutPair(id, formatShortcut);
}
