// Wires /persona slash commands + the persona status-bar chip into Otto.
// Spec §2.5 + §5.2. Pure handlers live in ./persona-commands.ts; this module
// adapts them to Otto's ExtensionAPI (command registry + footer status).
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@otto/pi-coding-agent";
import { PersonaRegistry, type PersonaManifest } from "@otto/coworker-persona";
import { appRoot } from "../app-paths.js";
import {
  handleList,
  handleCurrent,
  handleSwitch,
  handleReset,
  handleInstall,
  handleUninstall,
} from "./persona-commands.js";

// Sorts ahead of alphabetic extension status keys so the chip lands leftmost
// in the footer's extension-status block.
const STATUS_KEY = "00-persona";

const SUBCOMMANDS = ["list", "current", "switch", "install", "uninstall", "reset"] as const;

function getRegistry(): PersonaRegistry {
  return new PersonaRegistry({ ottoHome: appRoot });
}

function formatPersonaChip(persona: PersonaManifest): string {
  const { icon, label } = persona.status_line;
  return `${icon} ${label}`.trim();
}

async function refreshPersonaChip(ctx: ExtensionContext, registry: PersonaRegistry): Promise<void> {
  if (!ctx.hasUI) return;
  try {
    const active = await registry.activeInWorkspace(ctx.cwd);
    ctx.ui.setStatus(STATUS_KEY, formatPersonaChip(active));
  } catch {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  }
}

// Called on session_start to seed the default persona and render the chip.
export async function initPersonaWidget(ctx: ExtensionContext): Promise<void> {
  const registry = getRegistry();
  try {
    await registry.ensureDefaultInstalled();
  } catch {
    // Non-fatal: chip simply won't render if the default can't be installed.
  }
  await refreshPersonaChip(ctx, registry);
}

export function registerPersonaCommands(pi: ExtensionAPI): void {
  pi.registerCommand("persona", {
    description: "Manage Otto co-worker personas (list, current, switch, install, uninstall, reset)",
    getArgumentCompletions: (prefix: string) =>
      SUBCOMMANDS.filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s })),
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const registry = getRegistry();
      await registry.ensureDefaultInstalled();
      const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const ws = ctx.cwd;
      try {
        let lines: string[];
        switch (sub ?? "current") {
          case "list":
            lines = await handleList(registry, ws);
            break;
          case "current":
            lines = await handleCurrent(registry, ws);
            break;
          case "switch":
            lines = await handleSwitch(registry, ws, rest[0]);
            await refreshPersonaChip(ctx, registry);
            break;
          case "reset":
            lines = await handleReset(registry, ws);
            await refreshPersonaChip(ctx, registry);
            break;
          case "install":
            lines = await handleInstall(registry, rest[0]);
            break;
          case "uninstall":
            lines = await handleUninstall(registry, rest[0], [ws]);
            await refreshPersonaChip(ctx, registry);
            break;
          default:
            ctx.ui.notify(
              `Unknown subcommand: ${sub}. Try: ${SUBCOMMANDS.join(", ")}`,
              "warning",
            );
            return;
        }
        ctx.ui.notify(lines.join("\n"), "info");
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
    },
  });
}
