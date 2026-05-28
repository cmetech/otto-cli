/**
 * Extensions Command — /otto extensions
 *
 * Manage the extension registry: list, enable, disable, info, validate.
 * Self-contained — no imports outside the extensions tree (extensions are loaded
 * via jiti at runtime from ~/.otto/agent/, not compiled by tsc).
 */

import type { ExtensionCommandContext } from "@otto/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { workflowHome } from "./home.js";

const _require = createRequire(import.meta.url);
const { lockSync, unlockSync } = _require("proper-lockfile") as {
  lockSync: (
    path: string,
    options?: {
      retries?: number | { retries?: number; minTimeout?: number; maxTimeout?: number; factor?: number };
      stale?: number;
    },
  ) => () => void;
  unlockSync: (path: string) => void;
};

// ─── Types (mirrored from extension-registry.ts) ────────────────────────────

interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  tier: "core" | "bundled" | "community";
  requires: { platform: string };
  provides?: {
    tools?: string[];
    commands?: string[];
    hooks?: string[];
    shortcuts?: string[];
  };
  dependencies?: {
    extensions?: string[];
    runtime?: string[];
  };
}

interface ExtensionRegistryEntry {
  id: string;
  enabled: boolean;
  source: "bundled" | "user" | "project";
  disabledAt?: string;
  disabledReason?: string;
  version?: string;
  installedFrom?: string;
  installType?: "npm" | "git" | "local";
}

interface ExtensionRegistry {
  version: 1;
  entries: Record<string, ExtensionRegistryEntry>;
}

// ─── Registry I/O ───────────────────────────────────────────────────────────

function getRegistryPath(): string {
  return join(workflowHome(), "extensions", "registry.json");
}

function getAgentExtensionsDir(): string {
  return join(workflowHome(), "agent", "extensions");
}

function loadRegistry(): ExtensionRegistry {
  const filePath = getRegistryPath();
  try {
    if (!existsSync(filePath)) return { version: 1, entries: {} };
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && parsed.version === 1 && typeof parsed.entries === "object") {
      return parsed as ExtensionRegistry;
    }
    return { version: 1, entries: {} };
  } catch {
    return { version: 1, entries: {} };
  }
}

function saveRegistry(registry: ExtensionRegistry): void {
  const filePath = getRegistryPath();
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmp = filePath + ".tmp";
    writeFileSync(tmp, JSON.stringify(registry, null, 2), "utf-8");
    renameSync(tmp, filePath);
  } catch { /* non-fatal */ }
}

/**
 * Run a registry load → mutate → save transaction under a cross-process lock.
 * Prevents two concurrent extension state mutations from trampling each
 * other's registry changes.
 *
 * Uses proper-lockfile.lockSync against the registry path. Directory is created
 * first so locking works on fresh installs. Lock is always released via finally.
 */
function withRegistryLock<T>(mutate: (registry: ExtensionRegistry) => T): T {
  const filePath = getRegistryPath();
  mkdirSync(dirname(filePath), { recursive: true });
  // lockSync requires the file to exist — ensure it does before acquiring.
  if (!existsSync(filePath)) {
    writeFileSync(filePath, JSON.stringify({ version: 1, entries: {} }, null, 2), "utf-8");
  }
  lockSync(filePath, { retries: { retries: 5, minTimeout: 50, maxTimeout: 500 } });
  try {
    const registry = loadRegistry();
    const result = mutate(registry);
    saveRegistry(registry);
    return result;
  } finally {
    try { unlockSync(filePath); } catch { /* lock may already be gone */ }
  }
}

function isEnabled(registry: ExtensionRegistry, id: string): boolean {
  const entry = registry.entries[id];
  if (!entry) return true;
  return entry.enabled;
}

function readManifest(dir: string): ExtensionManifest | null {
  const mPath = join(dir, "extension-manifest.json");
  if (!existsSync(mPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(mPath, "utf-8"));
    if (typeof raw?.id === "string" && typeof raw?.name === "string") return raw as ExtensionManifest;
    return null;
  } catch {
    return null;
  }
}

// ─── Package Validation (mirrored — D-14, no src/ imports) ────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateExtensionPackage(packageDir: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check package.json exists
  const pkgPath = join(packageDir, "package.json");
  if (!existsSync(pkgPath)) {
    return { valid: false, errors: ["package.json not found"], warnings };
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return { valid: false, errors: ["package.json is invalid JSON"], warnings };
  }

  // (a) otto.extension: true marker (D-12a)
  const workflowField = pkg.otto as Record<string, unknown> | undefined;
  if (workflowField?.extension !== true) {
    errors.push('package.json missing "otto": { "extension": true }');
  }

  // (b) otto.extensions entry paths exist and are resolvable.
  const ottoField = pkg.otto as Record<string, unknown> | undefined;
  const extensionEntries = ottoField?.extensions;
  if (!Array.isArray(extensionEntries) || extensionEntries.length === 0) {
    errors.push('package.json missing "otto": { "extensions": [...] }');
  } else {
    for (const entry of extensionEntries) {
      if (typeof entry === "string") {
        const resolved = join(packageDir, entry);
        if (!existsSync(resolved)) {
          errors.push(`otto.extensions entry not found: ${entry}`);
        }
      }
    }
  }

  // (c) @otto/* packages must be in peerDependencies, not dependencies/devDependencies (D-12c)
  // Mirrors validateExtensionManifest below and extension-validator.ts:checkDependencyPlacement.
  for (const field of ["dependencies", "devDependencies"] as const) {
    const deps = (pkg[field] as Record<string, unknown> | undefined) ?? {};
    for (const dep of Object.keys(deps)) {
      if (dep.startsWith("@otto/")) {
        errors.push(`"${dep}" must be in peerDependencies, not ${field}`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function discoverManifests(): Map<string, ExtensionManifest> {
  const manifests = new Map<string, ExtensionManifest>();
  // Scan both bundled/agent dir and user-installed dir so CLI (list/info/
  // enable/disable) sees the same set the loader will merge at runtime.
  // Bundled entries are scanned first so user-installed IDs override on collision.
  const dirs = [getAgentExtensionsDir(), getInstalledExtDir()];
  for (const extDir of dirs) {
    if (!existsSync(extDir)) continue;
    for (const entry of readdirSync(extDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const m = readManifest(join(extDir, entry.name));
      if (m) manifests.set(m.id, m);
    }
  }
  return manifests;
}

function getInstalledExtDir(): string {
  return join(workflowHome(), "extensions");
}

// ─── Command Handler ────────────────────────────────────────────────────────

export async function handleExtensions(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const parts = args.split(/\s+/).filter(Boolean);
  const subCmd = parts[0] ?? "list";

  if (subCmd === "list") {
    handleList(ctx);
    return;
  }

  if (subCmd === "enable") {
    handleEnable(parts[1], ctx);
    return;
  }

  if (subCmd === "disable") {
    handleDisable(parts[1], parts.slice(2).join(" "), ctx);
    return;
  }

  if (subCmd === "info") {
    handleInfo(parts[1], ctx);
    return;
  }

  if (subCmd === "install" || subCmd === "uninstall" || subCmd === "update") {
    const replacement =
      subCmd === "install"
        ? "otto install <source>"
        : subCmd === "uninstall"
          ? "otto remove <source>"
          : "otto package update [source]";
    ctx.ui.notify(
      `/otto extensions ${subCmd} has been removed. Use ${replacement} from the terminal; /otto extensions only manages loaded extension state.`,
      "warning",
    );
    return;
  }

  if (subCmd === "validate") {
    handleValidate(parts[1], ctx);
    return;
  }

  ctx.ui.notify(
    `Unknown: /otto extensions ${subCmd}. Usage: /otto extensions [list|enable|disable|info|validate]`,
    "warning",
  );
}

function handleList(ctx: ExtensionCommandContext): void {
  const manifests = discoverManifests();
  const registry = loadRegistry();

  if (manifests.size === 0) {
    ctx.ui.notify("No extension manifests found.", "warning");
    return;
  }

  // Sort: core first, then alphabetical
  const sorted = [...manifests.values()].sort((a, b) => {
    if (a.tier === "core" && b.tier !== "core") return -1;
    if (b.tier === "core" && a.tier !== "core") return 1;
    return a.id.localeCompare(b.id);
  });

  const lines: string[] = [];
  const hdr = padRight("Extensions", 38) + padRight("Status", 10) + padRight("Tier", 10) + padRight("Tools", 7) + "Commands";
  lines.push(hdr);
  lines.push("─".repeat(hdr.length));

  for (const m of sorted) {
    const enabled = isEnabled(registry, m.id);
    const status = enabled ? "enabled" : "disabled";
    const toolCount = m.provides?.tools?.length ?? 0;
    const cmdCount = m.provides?.commands?.length ?? 0;
    const label = `${m.id} (${m.name})`;

    lines.push(
      padRight(label, 38) +
      padRight(status, 10) +
      padRight(m.tier, 10) +
      padRight(String(toolCount), 7) +
      String(cmdCount),
    );

    // Show source indicator and install info for user-installed extensions
    const regEntry = registry.entries[m.id];
    if (regEntry?.source === "user") {
      // Append [user] tag to the last line
      const lastLine = lines[lines.length - 1];
      lines[lines.length - 1] = lastLine + "      [user]";
      if (regEntry.installedFrom) {
        const typePrefix = regEntry.installType ? `${regEntry.installType}:` : "";
        const versionSuffix = regEntry.version ? `@${regEntry.version}` : "";
        lines.push(`  installed from: ${typePrefix}${regEntry.installedFrom}${versionSuffix}`);
      }
    }

    if (!enabled) {
      lines.push(`  ↳ /otto extensions enable ${m.id}`);
    }
  }

  ctx.ui.notify(lines.join("\n"), "info");
}

function handleEnable(id: string | undefined, ctx: ExtensionCommandContext): void {
  if (!id) {
    ctx.ui.notify("Usage: /otto extensions enable <id>", "warning");
    return;
  }

  const manifests = discoverManifests();
  if (!manifests.has(id)) {
    ctx.ui.notify(`Extension "${id}" not found. Run /otto extensions list to see available extensions.`, "warning");
    return;
  }

  const alreadyEnabled = withRegistryLock((registry) => {
    if (isEnabled(registry, id)) return true;
    const entry = registry.entries[id];
    if (entry) {
      entry.enabled = true;
      delete entry.disabledAt;
      delete entry.disabledReason;
    } else {
      registry.entries[id] = { id, enabled: true, source: "bundled" };
    }
    return false;
  });
  if (alreadyEnabled) {
    ctx.ui.notify(`Extension "${id}" is already enabled.`, "info");
    return;
  }
  ctx.ui.notify(`Enabled "${id}". Restart OTTO to activate.`, "info");
}

function handleDisable(id: string | undefined, reason: string, ctx: ExtensionCommandContext): void {
  if (!id) {
    ctx.ui.notify("Usage: /otto extensions disable <id>", "warning");
    return;
  }

  const manifests = discoverManifests();
  const manifest = manifests.get(id) ?? null;

  if (!manifests.has(id)) {
    ctx.ui.notify(`Extension "${id}" not found. Run /otto extensions list to see available extensions.`, "warning");
    return;
  }

  if (manifest?.tier === "core") {
    ctx.ui.notify(`Cannot disable "${id}" — it is a core extension.`, "warning");
    return;
  }

  const alreadyDisabled = withRegistryLock((registry) => {
    if (!isEnabled(registry, id)) return true;
    const entry = registry.entries[id];
    if (entry) {
      entry.enabled = false;
      entry.disabledAt = new Date().toISOString();
      entry.disabledReason = reason || undefined;
    } else {
      registry.entries[id] = {
        id,
        enabled: false,
        source: "bundled",
        disabledAt: new Date().toISOString(),
        disabledReason: reason || undefined,
      };
    }
    return false;
  });
  if (alreadyDisabled) {
    ctx.ui.notify(`Extension "${id}" is already disabled.`, "info");
    return;
  }
  ctx.ui.notify(`Disabled "${id}". Restart OTTO to deactivate.`, "info");
}

function handleInfo(id: string | undefined, ctx: ExtensionCommandContext): void {
  if (!id) {
    ctx.ui.notify("Usage: /otto extensions info <id>", "warning");
    return;
  }

  const manifests = discoverManifests();
  const manifest = manifests.get(id);
  if (!manifest) {
    ctx.ui.notify(`Extension "${id}" not found.`, "warning");
    return;
  }

  const registry = loadRegistry();
  const enabled = isEnabled(registry, id);
  const entry = registry.entries[id];

  const lines: string[] = [
    `${manifest.name} (${manifest.id})`,
    "",
    `  Version:     ${manifest.version}`,
    `  Description: ${manifest.description}`,
    `  Tier:        ${manifest.tier}`,
    `  Status:      ${enabled ? "enabled" : "disabled"}`,
  ];

  if (entry?.disabledAt) {
    lines.push(`  Disabled at: ${entry.disabledAt}`);
  }
  if (entry?.disabledReason) {
    lines.push(`  Reason:      ${entry.disabledReason}`);
  }

  // Phase 8 fields for user-installed extensions (per UI-SPEC)
  if (entry?.source === "user") {
    if (entry.installedFrom) {
      lines.push(`  Installed from: ${entry.installedFrom}`);
    }
    if (entry.installType) {
      lines.push(`  Install type:   ${entry.installType}`);
    }
  }

  if (manifest.provides) {
    lines.push("");
    lines.push("  Provides:");
    if (manifest.provides.tools?.length) {
      lines.push(`    Tools:     ${manifest.provides.tools.join(", ")}`);
    }
    if (manifest.provides.commands?.length) {
      lines.push(`    Commands:  ${manifest.provides.commands.join(", ")}`);
    }
    if (manifest.provides.hooks?.length) {
      lines.push(`    Hooks:     ${manifest.provides.hooks.join(", ")}`);
    }
    if (manifest.provides.shortcuts?.length) {
      lines.push(`    Shortcuts: ${manifest.provides.shortcuts.join(", ")}`);
    }
  }

  if (manifest.dependencies) {
    lines.push("");
    lines.push("  Dependencies:");
    if (manifest.dependencies.extensions?.length) {
      lines.push(`    Extensions: ${manifest.dependencies.extensions.join(", ")}`);
    }
    if (manifest.dependencies.runtime?.length) {
      lines.push(`    Runtime:    ${manifest.dependencies.runtime.join(", ")}`);
    }
  }

  ctx.ui.notify(lines.join("\n"), "info");
}

function handleValidate(path: string | undefined, ctx: ExtensionCommandContext): void {
  if (!path) {
    ctx.ui.notify("Usage: /otto extensions validate <path>", "warning");
    return;
  }
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    ctx.ui.notify(`Path not found: ${resolved}`, "warning");
    return;
  }
  const result = validateExtensionPackage(resolved);
  if (result.valid) {
    ctx.ui.notify(`Valid extension package: ${resolved}`, "info");
  } else {
    ctx.ui.notify(
      `Invalid extension package: ${resolved}\n` +
      result.errors.map(e => `  - ${e}`).join("\n"),
      "warning",
    );
  }
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str + " " : str + " ".repeat(len - str.length);
}
