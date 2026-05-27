/**
 * Command — /otto codebase
 *
 * Generate, inspect, and query codebase knowledge.
 * Subcommands: ask, excavate, generate, update, stats, help
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@otto/pi-coding-agent";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  generateCodebaseMap,
  updateCodebaseMap,
  writeCodebaseMap,
  getCodebaseMapStats,
  readCodebaseMap,
} from "./codebase-generator.js";
import { loadEffectiveGSDPreferences } from "./preferences.js";
import type { CodebaseMapOptions } from "./codebase-generator.js";
import { currentDirectoryRoot } from "./commands/context.js";
import { BRAND, slashCommand } from "./strings.js";

const USAGE =
  `Usage: ${slashCommand("codebase")} [ask|excavate|generate|update|stats]\n\n` +
  "  ask <question>                                      — Answer using excavation artifacts plus source code\n" +
  "  excavate [path] [--workspace dir]                   — Build the excavation knowledge base (alias for /otto excavate)\n" +
  "  generate [--max-files N] [--collapse-threshold N]  — Generate or regenerate CODEBASE.md\n" +
  "  update [--max-files N] [--collapse-threshold N]    — Refresh the CODEBASE.md cache immediately\n" +
  "  stats                                              — Show file count, coverage, and generation time\n" +
  "  help                                               — Show this help\n\n" +
  "With no subcommand, shows stats if a map exists or help if not.\n" +
  `${BRAND} also refreshes CODEBASE.md automatically before prompt injection and after completed units when tracked files change.\n\n` +
  "Configure defaults via preferences.md:\n" +
  "  codebase:\n" +
  "    exclude_patterns: [\"docs/\", \"fixtures/\"]\n" +
  "    max_files: 1000\n" +
  "    collapse_threshold: 15";

export async function handleCodebase(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  const basePath = currentDirectoryRoot();
  const parts = args.trim().split(/\s+/);
  const sub = parts[0] ?? "";

  switch (sub) {
    case "ask": {
      const question = args.trim().replace(/^ask\s*/, "").trim();
      if (!question) {
        ctx.ui.notify(`Usage: ${slashCommand("codebase ask")} <question>`, "warning");
        return;
      }

      const status = getCodebaseKnowledgeStatus(basePath);
      if (!status.hasExcavation) {
        ctx.ui.notify(
          `No excavation artifacts found at ${status.excavationDir}.\n` +
          `I can still inspect source directly, but answers will be less durable and less citation-rich.\n` +
          `Run ${slashCommand("codebase excavate")} to build the reusable codebase knowledge base.`,
          "warning",
        );
      }
      pi.sendUserMessage(buildCodebaseAskPrompt(question, basePath, status));
      return;
    }

    case "excavate": {
      const excavateArgs = args.trim().replace(/^excavate\s*/, "").trim();
      const { handleExcavateCommand } = await import("../excavate/command.js");
      await handleExcavateCommand(excavateArgs, ctx, pi);
      return;
    }

    case "generate": {
      const options = resolveCodebaseOptions(args, ctx);
      if (options === false) return; // validation failed, message already shown

      const existing = readCodebaseMap(basePath);
      const existingDescriptions = existing
        ? (await import("./codebase-generator.js")).parseCodebaseMap(existing)
        : undefined;

      const result = generateCodebaseMap(basePath, options, existingDescriptions);

      if (result.fileCount === 0) {
        ctx.ui.notify(
          "Codebase map generated with 0 files.\n" +
          "Is this a git repository? Run 'git ls-files' to verify.",
          "warning",
        );
        return;
      }

      const outPath = writeCodebaseMap(basePath, result.content);
      ctx.ui.notify(
        `Codebase map generated: ${result.fileCount} files\n` +
        `Written to: ${outPath}` +
        (result.truncated ? `\n⚠ Truncated — increase --max-files to include all files` : ""),
        "success",
      );
      return;
    }

    case "update": {
      const existing = readCodebaseMap(basePath);
      if (!existing) {
        ctx.ui.notify(
          `No codebase map found. Run ${slashCommand("codebase generate")} to create one.`,
          "warning",
        );
        return;
      }

      const options = resolveCodebaseOptions(args, ctx);
      if (options === false) return;

      const result = updateCodebaseMap(basePath, options);
      writeCodebaseMap(basePath, result.content);

      ctx.ui.notify(
        `Codebase map updated: ${result.fileCount} files\n` +
        `  Added: ${result.added} | Removed: ${result.removed} | Unchanged: ${result.unchanged}` +
        (result.truncated ? `\n⚠ Truncated — increase --max-files to include all files` : ""),
        "success",
      );
      return;
    }

    case "stats": {
      showStats(basePath, ctx);
      return;
    }

    case "help":
      ctx.ui.notify(USAGE, "info");
      return;

    case "": {
      // Safe default: show stats if map exists, help if not
      const existing = readCodebaseMap(basePath);
      if (existing) {
        showStats(basePath, ctx);
      } else {
        ctx.ui.notify(USAGE, "info");
      }
      return;
    }

    default:
      ctx.ui.notify(
        `Unknown subcommand "${sub}".\n\n${USAGE}`,
        "warning",
      );
  }
}

export interface CodebaseKnowledgeStatus {
  excavationDir: string;
  workspaceJson: string;
  codebaseMap: string;
  hasExcavation: boolean;
  hasWorkspaceJson: boolean;
  hasCodebaseMap: boolean;
}

export function getCodebaseKnowledgeStatus(basePath: string): CodebaseKnowledgeStatus {
  const excavationDir = join(basePath, ".otto", "excavate");
  const workspaceJson = join(excavationDir, "workspace.json");
  const codebaseMap = join(basePath, ".otto", "workflow", "CODEBASE.md");
  return {
    excavationDir,
    workspaceJson,
    codebaseMap,
    hasExcavation: existsSync(excavationDir),
    hasWorkspaceJson: existsSync(workspaceJson),
    hasCodebaseMap: existsSync(codebaseMap),
  };
}

export function buildCodebaseAskPrompt(
  question: string,
  basePath: string,
  status: CodebaseKnowledgeStatus = getCodebaseKnowledgeStatus(basePath),
): string {
  const artifactInstruction = status.hasExcavation
    ? [
        `Excavation artifacts are available at \`${status.excavationDir}\`.`,
        "Use them as the retrieval map and behavioral knowledge base before reading source.",
      ].join("\n")
    : [
        `No excavation artifacts were found at \`${status.excavationDir}\`.`,
        `Tell the user that \`${slashCommand("codebase excavate")}\` can build a reusable, citation-rich knowledge base, then answer from source inspection as well as possible.`,
      ].join("\n");

  return `Answer this codebase question using OTTO codebase knowledge plus direct source verification.

Question:
${question}

Repository root:
${basePath}

Available knowledge:
- CODEBASE map: ${status.hasCodebaseMap ? status.codebaseMap : "(missing)"}
- Excavation workspace: ${status.hasExcavation ? status.excavationDir : "(missing)"}
- Excavation manifest: ${status.hasWorkspaceJson ? status.workspaceJson : "(missing)"}

Retrieval policy:
${artifactInstruction}
- Start with \`.otto/workflow/CODEBASE.md\` when present to identify candidate files.
- When excavation exists, read \`.otto/excavate/workspace.json\`, \`raw/synthesis/module-map.md\`, \`raw/synthesis/features.md\`, and \`raw/synthesis/architecture.md\` if relevant.
- Read only the relevant specs under \`.otto/excavate/raw/specs/\`: modules, journeys, contracts, test-vectors, and acceptance criteria as needed.
- Follow embedded \`<!-- cite: file:Lx-Ly -->\` source citations into the actual source files.
- Always inspect source directly when the answer depends on current implementation, when artifacts are missing/stale/ambiguous, or when the question asks "where/how in code".
- Do not answer solely from excavation artifacts if the claim is implementation-sensitive and source can be checked.

Answer format:
- Start with the direct answer.
- Include "Evidence" bullets with artifact paths and source file references.
- Include "Confidence: High/Medium/Low" and explain briefly based on citation/source coverage.
- If artifacts are missing or insufficient, say exactly what was missing and recommend \`${slashCommand("codebase excavate")}\` only when useful.`;
}

function showStats(basePath: string, ctx: ExtensionCommandContext): void {
  const stats = getCodebaseMapStats(basePath);
  if (!stats.exists) {
    ctx.ui.notify(`No codebase map found. Run ${slashCommand("codebase generate")} to create one.`, "info");
    return;
  }

  const coverage = stats.fileCount > 0
    ? Math.round((stats.describedCount / stats.fileCount) * 100)
    : 0;

  ctx.ui.notify(
    `Codebase Map Stats:\n` +
    `  Files: ${stats.fileCount}\n` +
    `  Described: ${stats.describedCount} (${coverage}%)\n` +
    `  Undescribed: ${stats.undescribedCount}\n` +
    `  Generated: ${stats.generatedAt ?? "unknown"}\n\n` +
    (stats.undescribedCount > 0
      ? `Tip: Auto-refresh keeps the cache current, but ${slashCommand("codebase update")} forces an immediate refresh.`
      : `Coverage is complete.`),
    "info",
  );
}

/**
 * Resolve codebase map options by merging preferences with CLI flags.
 * CLI flags override preferences; preferences override built-in defaults.
 * Returns false if validation failed (error already shown to user).
 */
function resolveCodebaseOptions(args: string, ctx: ExtensionCommandContext): CodebaseMapOptions | false {
  // Load preferences defaults
  const prefs = loadEffectiveGSDPreferences()?.preferences?.codebase;

  // Parse CLI flags
  const maxFilesStr = extractFlag(args, "--max-files");
  const collapseStr = extractFlag(args, "--collapse-threshold");

  // Validate --max-files
  let maxFiles: number | undefined;
  if (maxFilesStr) {
    maxFiles = parseInt(maxFilesStr, 10);
    if (isNaN(maxFiles) || maxFiles < 1) {
      ctx.ui.notify("--max-files must be a positive integer (e.g. --max-files 200).", "warning");
      return false;
    }
  }

  // Validate --collapse-threshold
  let collapseThreshold: number | undefined;
  if (collapseStr) {
    collapseThreshold = parseInt(collapseStr, 10);
    if (isNaN(collapseThreshold) || collapseThreshold < 1) {
      ctx.ui.notify("--collapse-threshold must be a positive integer (e.g. --collapse-threshold 15).", "warning");
      return false;
    }
  }

  return {
    // CLI flags override preferences
    maxFiles: maxFiles ?? prefs?.max_files,
    collapseThreshold: collapseThreshold ?? prefs?.collapse_threshold,
    excludePatterns: prefs?.exclude_patterns,
  };
}

function extractFlag(args: string, flag: string): string | undefined {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}[=\\s]+(\\S+)`);
  const match = args.match(regex);
  return match?.[1];
}
