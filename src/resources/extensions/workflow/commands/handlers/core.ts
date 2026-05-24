import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@gsd/pi-coding-agent";
import type { Model } from "@gsd/pi-ai";
import type { WorkflowDbState } from "../../types.js";
import { createRequire } from "node:module";

import { computeProgressScore, formatProgressLine } from "../../progress-score.js";
import { getGlobalGSDPreferencesPath, getProjectGSDPreferencesPath } from "../../preferences.js";
import { ensurePreferencesFile, handlePrefs, handlePrefsMode, handlePrefsWizard, handleLanguage } from "../../commands-prefs-wizard.js";
import { runEnvironmentChecks } from "../../doctor-environment.js";
import { deriveState } from "../../state.js";
import { handleCmux } from "../../commands-cmux.js";
import { setSessionModelOverride } from "../../session-model-override.js";
import { projectRoot } from "../context.js";
import { formattedShortcutPair } from "../../shortcut-defs.js";
import { getVisualBriefOutputDir } from "../../../visual-brief/artifact-policy.js";
import { buildVisualBriefPrompt, parseVisualBriefArgs, VISUAL_BRIEF_USAGE } from "../../../visual-brief/prompts.js";
import { BRAND, CMD, slashCommand } from "../../strings.js";

/**
 * Pad a slash-command reference (e.g. "/loop24 status") to a target visual width
 * so help-text columns stay aligned regardless of the active command namespace.
 */
function padSlash(sub: string, targetWidth: number): string {
  const ref = slashCommand(sub);
  const pad = Math.max(1, targetWidth - ref.length);
  return ref + " ".repeat(pad);
}

export function showHelp(ctx: ExtensionCommandContext, args = ""): void {
  // Column width chosen so the longest reference we display (e.g. "/loop24 parallel watch")
  // still leaves at least one space before the description.
  const COL_SHORT = 20; // for the summary block
  const COL_FULL = 22;  // for the wider full block
  const p = (sub: string, col: number = COL_SHORT) => `  ${padSlash(sub, col)}`;

  const summaryLines = [
    `${BRAND} — Get Shit Done\n`,
    "QUICK START",
    `${p("start <tpl>")} Start a workflow template`,
    `  ${slashCommand("").trimEnd()}${" ".repeat(Math.max(1, COL_SHORT - slashCommand("").trimEnd().length))}Open the state-aware home menu`,
    `${p("auto")} Run all queued units continuously`,
    `${p("pause")} Pause auto-mode`,
    `${p("stop")} Stop auto-mode gracefully`,
    "",
    "VISIBILITY",
    `${p("status")} Interactive 10-tab TUI  (${formattedShortcutPair("dashboard")})`,
    `${p("parallel watch")} Parallel monitor  (${formattedShortcutPair("parallel")})`,
    `${p("notifications")} Notification history  (${formattedShortcutPair("notifications")})`,
    `${p("visualize")} Interactive 10-tab TUI`,
    `${p("report")} Generate all HTML reports and open browser`,
    `${p("brief <mode>")} Visual HTML brief (diagram, plan, diff, recap, table, slides)`,
    `${p("queue")} Show queued/dispatched units`,
    "",
    "COURSE CORRECTION",
    `${p("steer <desc>")} Apply user override to active work`,
    `${p("capture <text>")} Quick-capture a thought to CAPTURES.md`,
    `${p("triage")} Classify and route pending captures`,
    `${p("undo")} Revert last completed unit  [--force]`,
    `${p("rethink")} Conversational project reorganization`,
    "",
    "OBSERVABILITY",
    `${p("logs")} Browse activity and debug logs`,
    `${p("debug")} Create/list/continue persistent debug sessions`,
    "",
    "SETUP",
    `${p("onboarding")} Re-run setup wizard  [--resume|--reset|--step <name>]`,
    `${p("setup")} Configuration hub  [llm|model|search|remote|keys|prefs|onboarding]`,
    `${p("init")} Project init wizard`,
    `${p("model")} Switch active session model`,
    `${p("prefs")} Manage preferences (alias for ${slashCommand("setup")} prefs)`,
    `${p("keys")} API key manager (LLM + tool keys)`,
    `${p("doctor")} Diagnose and repair .gsd/ state`,
    `${p("closeout")} Recover failed git closeout actions`,
    "",
    `Use ${slashCommand("help")} full for the complete command reference.`,
  ];

  const pf = (sub: string) => `  ${padSlash(sub, COL_FULL)}`;
  const fullLines = [
    `${BRAND} — Get Shit Done\n`,
    "WORKFLOW",
    `${pf("start <tpl>")} Start a workflow template (bugfix, spike, feature, hotfix, etc.)`,
    `${pf("templates")} List available workflow templates  [info <name>]`,
    `  ${slashCommand("").trimEnd()}${" ".repeat(Math.max(1, COL_FULL - slashCommand("").trimEnd().length))}Open the state-aware home menu`,
    `${pf("next")} Execute next task, then pause  [--dry-run] [--verbose]`,
    `${pf("auto")} Run all queued units continuously  [--verbose]`,
    `${pf("stop")} Stop auto-mode gracefully`,
    `${pf("pause")} Pause auto-mode (preserves state, ${slashCommand("auto")} to resume)`,
    `${pf("discuss")} Start guided milestone/slice discussion`,
    `${pf("new-milestone")} Create milestone from headless context (used by ${CMD} headless)`,
    `${pf("new-project")} Bootstrap a new project (use --deep for staged project-level discovery)`,
    `${pf("quick")} Execute a quick task without full planning overhead`,
    `${pf("dispatch")} Dispatch a specific phase directly  [research|plan|execute|complete|uat|replan]`,
    `${pf("verdict <v>")} Override milestone validation verdict  [pass|needs-attention|needs-remediation] [--milestone Mxxx] [--rationale \"...\"]`,
    `${pf("parallel")} Parallel milestone orchestration  [start|status|stop|pause|resume|merge|watch]`,
    `${pf("workflow")} Custom workflow lifecycle  [new|run|list|validate|pause|resume]`,
    "",
    "VISIBILITY",
    `${pf("status")} Interactive 10-tab TUI  (${formattedShortcutPair("dashboard")})`,
    `${pf("parallel watch")} Open parallel worker monitor  (${formattedShortcutPair("parallel")})`,
    `${pf("widget")} Cycle status widget  [full|small|min|off]`,
    `${pf("visualize")} Interactive 10-tab TUI (progress, timeline, deps, metrics, health, agent, changes, knowledge, captures, export)`,
    `${pf("brief <mode>")} Generate a visual HTML brief  [diagram|plan|diff|recap|table|slides] [topic] [--slides]`,
    `${pf("queue")} Show queued/dispatched units and execution order`,
    `${pf("history")} View execution history  [--cost] [--phase] [--model] [N]`,
    `${pf("changelog")} Show categorized release notes  [version]`,
    `${pf("notifications")} View persistent notification history  [clear|tail|filter]  (${formattedShortcutPair("notifications")})`,
    `${pf("logs")} Browse activity logs, debug logs, and metrics  [debug|tail|clear]`,
    `${pf("debug")} Create/list/continue persistent debug sessions`,
    "",
    "COURSE CORRECTION",
    `${pf("steer <desc>")} Apply user override to active work`,
    `${pf("capture <text>")} Quick-capture a thought to CAPTURES.md`,
    `${pf("triage")} Classify and route pending captures`,
    `${pf("skip <unit>")} Prevent a unit from auto-mode dispatch`,
    `${pf("undo")} Revert last completed unit  [--force]`,
    `${pf("undo-task")} Reset a specific task's completion state  [DB + markdown]`,
    `${pf("reset-slice")} Reset a slice and all its tasks  [DB + markdown]`,
    `${pf("rate")} Rate last unit's model tier  [over|ok|under]`,
    `${pf("rethink")} Conversational project reorganization — reorder, park, discard, add milestones`,
    `${pf("park [id]")} Park a milestone — skip without deleting  [reason]`,
    `${pf("unpark [id]")} Reactivate a parked milestone`,
    "",
    "PROJECT KNOWLEDGE",
    `${pf("knowledge <type> <text>")} Add a rule to KNOWLEDGE.md or capture a pattern/lesson to memories`,
    `${pf("codebase [generate|update|stats]")} Manage the CODEBASE.md cache used in prompt context`,
    "",
    "SHIPPING & BACKLOG",
    `${pf("ship")} Create a PR from milestone artifacts  [--dry-run|--draft|--base|--force]`,
    `${pf("do <text>")} Route freeform text to the right ${BRAND} command`,
    `${pf("session-report")} Show session cost, tokens, and work summary  [--json|--save]`,
    `${pf("backlog")} Manage backlog items  [add|promote|remove|list]`,
    `${pf("pr-branch")} Create a clean PR branch filtering .gsd/ commits  [--dry-run|--name]`,
    `${pf("add-tests")} Generate tests for completed slices`,
    `${pf("eval-review <sliceId>")} Audit a slice's AI evaluation strategy  [--force|--show]`,
    `${pf("scan")} Rapid codebase assessment  [--focus tech|arch|quality|concerns|tech+arch]`,
    "",
    "SETUP & CONFIGURATION",
    `${pf("onboarding")} Re-run setup wizard  [--resume|--reset|--step <name>]`,
    `${pf("setup")} Configuration hub  [llm|model|search|remote|keys|prefs|onboarding]`,
    `${pf("init")} Project init wizard — detect, configure, bootstrap .gsd/`,
    `${pf("model")} Switch active session model  [provider/model|model-id]`,
    `${pf("mode")} Set workflow mode (solo/team)  [global|project]`,
    `${pf("prefs")} Manage preferences  [global|project|status|wizard|setup|import-claude]  (alias for ${slashCommand("setup")} prefs)`,
    `${pf("cmux")} Manage cmux integration  [status|on|off|notifications|sidebar|splits|browser]`,
    `${pf("keys")} API key manager (LLM + tool keys)  [list|add|remove|test|rotate|doctor]`,
    `${pf("config")} (deprecated) Set tool API keys — use ${slashCommand("keys")} instead`,
    `${pf("show-config")} Show effective configuration (models, routing, toggles)`,
    `${pf("hooks")} Show post-unit hook configuration`,
    `${pf("run-hook")} Manually trigger a specific hook`,
    `${pf("skill-health")} Skill lifecycle dashboard`,
    `${pf("extensions")} Manage extensions  [list|enable|disable|info]`,
    `${pf("fast")} Toggle OpenAI service tier  [on|off|flex|status]`,
    `${pf("mcp")} MCP server management  [status|check|test|enable|disable|import|delete|init]`,
    "",
    "MAINTENANCE",
    `${pf("doctor")} Diagnose and repair .gsd/ state  [audit|fix|heal] [scope]`,
    `${pf("forensics")} Examine execution logs and post-mortem analysis`,
    `${pf("report")} Generate all HTML reports and open browser  [--json|--markdown|--html] [--all]`,
    `${pf("export")} Alias for ${slashCommand("report")}`,
    `${pf("cleanup")} Remove merged branches or snapshots  [branches|snapshots]`,
    `${pf("closeout")} Recover failed git closeout actions  [status|retry|resolve] [unit-id]`,
    `${pf("worktree")} Manage worktrees from the TUI  [list|merge|clean|remove]`,
    `${pf("migrate")} Migrate .planning/ (v1) to DB-backed .gsd/ with backup + audit`,
    `${pf("remote")} Control remote auto-mode  [slack|discord|status|disconnect]`,
    `${pf("inspect")} Show SQLite DB diagnostics (schema, row counts, recent entries)`,
    `${pf("update")} Update ${BRAND} to the latest version via npm`,
    `${pf("upgrade")} Alias for ${slashCommand("update")}`,
    `${pf("language")} Set or clear the global response language  [off|clear|<language>]`,
  ];
  const full = ["full", "--full", "all"].includes(args.trim().toLowerCase());
  ctx.ui.notify((full ? fullLines : summaryLines).join("\n"), "info");
}

export async function handleStatus(ctx: ExtensionCommandContext): Promise<void> {
  const basePath = projectRoot();
  // Open DB in cold sessions so status uses DB-backed state, not filesystem fallback (#3385)
  const { ensureDbOpen } = await import("../../bootstrap/dynamic-tools.js");
  await ensureDbOpen();
  const state = await deriveState(basePath);

  if (state.registry.length === 0) {
    ctx.ui.notify(`No ${BRAND} milestones found. Run /${CMD} to start.`, "info");
    return;
  }

  const { DashboardOverlay } = await import("../../dashboard-overlay.js");
  const result = await ctx.ui.custom<boolean>(
    (tui, theme, _kb, done) => new DashboardOverlay(tui, theme, () => done(true)),
    {
      overlay: true,
      overlayOptions: {
        width: "90%",
        minWidth: 80,
        maxHeight: "92%",
        anchor: "center",
      },
    },
  );

  if (result === undefined) {
    ctx.ui.notify(formatTextStatus(state), "info");
  }
}

export async function fireStatusViaCommand(ctx: ExtensionContext): Promise<void> {
  await handleStatus(ctx as ExtensionCommandContext);
}

export async function handleVisualize(ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("Visualizer requires an interactive terminal.", "warning");
    return;
  }

  const { VisualizerOverlay } = await import("../../visualizer-overlay.js");
  const result = await ctx.ui.custom<boolean>(
    (tui, theme, _kb, done) => new VisualizerOverlay(tui, theme, () => done(true)),
    {
      overlay: true,
      overlayOptions: {
        width: "80%",
        minWidth: 80,
        maxHeight: "90%",
        anchor: "center",
      },
    },
  );

  if (result === undefined) {
    ctx.ui.notify(`Visualizer requires an interactive terminal. Use ${slashCommand("status")} for a text-based overview.`, "warning");
  }
}

export async function handleBrief(args: string, ctx: ExtensionCommandContext, pi?: ExtensionAPI): Promise<void> {
  const request = parseVisualBriefArgs(args);
  if (!request) {
    ctx.ui.notify(VISUAL_BRIEF_USAGE, "info");
    return;
  }

  if (!pi?.sendUserMessage) {
    ctx.ui.notify("Visual brief generation is unavailable in this context.", "warning");
    return;
  }

  const outputDir = getVisualBriefOutputDir();
  const version = resolveGsdVersion();
  pi.sendUserMessage(buildVisualBriefPrompt(request, { outputDir, version }));
}

const briefRequire = createRequire(import.meta.url);

function resolveGsdVersion(): string | undefined {
  const envVersion = (process.env.LOOP24_VERSION ?? process.env.GSD_VERSION)?.trim();
  if (envVersion) return envVersion;
  try {
    const pkg = briefRequire("../../../../../../package.json") as { version?: unknown };
    const fromPkg = typeof pkg.version === "string" ? pkg.version.trim() : "";
    return fromPkg || undefined;
  } catch {
    return undefined;
  }
}

export async function handleSetup(args: string, ctx: ExtensionCommandContext, pi?: ExtensionAPI): Promise<void> {
  const { detectProjectState, hasGlobalSetup } = await import("../../detection.js");
  const { isOnboardingComplete, readOnboardingRecord } = await import("../../onboarding-state.js");

  // Sub-route dispatch — keep redirects but route the canonical work to /gsd
  // onboarding (single source for wizard steps) and /loop24 keys (single source
  // for credentials).
  if (args === "onboarding" || args === "wizard") {
    const { handleOnboarding } = await import("./onboarding.js");
    await handleOnboarding("", ctx);
    return;
  }
  if (args === "llm" || args === "auth") {
    const { handleOnboarding } = await import("./onboarding.js");
    await handleOnboarding("--step llm", ctx);
    return;
  }
  if (args === "search") {
    const { handleOnboarding } = await import("./onboarding.js");
    await handleOnboarding("--step search", ctx);
    return;
  }
  if (args === "remote") {
    const { handleOnboarding } = await import("./onboarding.js");
    await handleOnboarding("--step remote", ctx);
    return;
  }
  if (args === "model") {
    await handleModel("", ctx, pi);
    return;
  }
  if (args === "keys") {
    ctx.ui.notify(`Tip: ${slashCommand("keys")} is the canonical command for API key management.`, "info");
    const { handleKeys } = await import("../../key-manager.js");
    await handleKeys("", ctx);
    return;
  }
  if (args === "prefs") {
    await ensurePreferencesFile(getGlobalGSDPreferencesPath(), ctx, "global");
    await handlePrefsWizard(ctx, "global");
    return;
  }

  // Bare /loop24 setup — render the hub: status + actions
  const globalConfigured = hasGlobalSetup();
  const detection = detectProjectState(projectRoot());
  const onboardingDone = isOnboardingComplete();
  const record = readOnboardingRecord();

  const statusLines: string[] = [`${BRAND} Setup\n`];
  statusLines.push(
    onboardingDone
      ? `  Onboarding:         ✓ complete${record.completedAt ? ` (${record.completedAt.slice(0, 10)})` : ""}`
      : `  Onboarding:         ○ not complete  —  ${slashCommand("onboarding")} to start`,
  );
  statusLines.push(`  Global preferences: ${globalConfigured ? "configured" : "not set"}`);
  statusLines.push(`  Project state:      ${detection.state}`);
  if (detection.projectSignals.primaryLanguage) {
    statusLines.push(`  Detected:           ${detection.projectSignals.primaryLanguage}`);
  }

  ctx.ui.notify(statusLines.join("\n"), "info");
  ctx.ui.notify(
    "Configuration hub:\n" +
    `  ${slashCommand("setup")} llm        — LLM provider & auth\n` +
    `  ${slashCommand("setup")} model      — Default model picker\n` +
    `  ${slashCommand("setup")} search     — Web search provider\n` +
    `  ${slashCommand("setup")} remote     — Remote questions (Discord/Slack/Telegram)\n` +
    `  ${slashCommand("setup")} keys       — API keys (alias for ${slashCommand("keys")})\n` +
    `  ${slashCommand("setup")} prefs      — Global preferences (alias for ${slashCommand("prefs")})\n` +
    `  ${slashCommand("setup")} onboarding — Full wizard (alias for ${slashCommand("onboarding")})\n\n` +
    `Tip: ${slashCommand("onboarding")} --resume to continue an incomplete setup.`,
    "info",
  );
}

function sortModelsForSelection(models: Model<any>[], currentModel: Model<any> | undefined): Model<any>[] {
  return [...models].sort((a, b) => {
    const aCurrent = currentModel && a.provider === currentModel.provider && a.id === currentModel.id;
    const bCurrent = currentModel && b.provider === currentModel.provider && b.id === currentModel.id;
    if (aCurrent && !bCurrent) return -1;
    if (!aCurrent && bCurrent) return 1;
    const providerCmp = a.provider.localeCompare(b.provider);
    if (providerCmp !== 0) return providerCmp;
    return a.id.localeCompare(b.id);
  });
}

function buildProviderModelGroups(
  models: Model<any>[],
  currentModel: Model<any> | undefined,
): Map<string, Model<any>[]> {
  const byProvider = new Map<string, Model<any>[]>();

  for (const model of sortModelsForSelection(models, currentModel)) {
    let group = byProvider.get(model.provider);
    if (!group) {
      group = [];
      byProvider.set(model.provider, group);
    }
    group.push(model);
  }
  return byProvider;
}

async function selectModelByProvider(
  title: string,
  models: Model<any>[],
  ctx: ExtensionCommandContext,
  currentModel: Model<any> | undefined,
): Promise<Model<any> | undefined> {
  const byProvider = buildProviderModelGroups(models, currentModel);
  const providerOptions = Array.from(byProvider.entries()).map(([provider, group]) =>
    `${provider} (${group.length} model${group.length === 1 ? "" : "s"})`,
  );
  providerOptions.push("(cancel)");

  const providerChoice = await ctx.ui.select(`${title} — choose provider:`, providerOptions);
  if (!providerChoice || typeof providerChoice !== "string" || providerChoice === "(cancel)") return undefined;

  const providerName = providerChoice.replace(/ \(\d+ models?\)$/, "");
  const providerModels = byProvider.get(providerName);
  if (!providerModels || providerModels.length === 0) return undefined;

  const optionToModel = new Map<string, Model<any>>();
  const modelOptions = providerModels.map((model) => {
    const isCurrent = currentModel && model.provider === currentModel.provider && model.id === currentModel.id;
    const label = `${isCurrent ? "* " : ""}${model.id}`;
    optionToModel.set(label, model);
    return label;
  });
  modelOptions.push("(cancel)");

  const modelChoice = await ctx.ui.select(`${title} — ${providerName}:`, modelOptions);
  if (!modelChoice || typeof modelChoice !== "string" || modelChoice === "(cancel)") return undefined;
  return optionToModel.get(modelChoice);
}

async function resolveRequestedModel(
  query: string,
  ctx: ExtensionCommandContext,
): Promise<Model<any> | undefined> {
  const { resolveModelId } = await import("../../auto-model-selection.js");
  const models = ctx.modelRegistry.getAvailable();
  const exact = resolveModelId(query, models, ctx.model?.provider);
  if (exact) return exact;

  const lowerQuery = query.toLowerCase();
  const partialMatches = models.filter((model) =>
    model.id.toLowerCase().includes(lowerQuery)
      || `${model.provider}/${model.id}`.toLowerCase().includes(lowerQuery),
  );

  if (partialMatches.length === 1) return partialMatches[0];
  if (partialMatches.length === 0 || !ctx.hasUI) return undefined;
  return selectModelByProvider(`Multiple models match "${query}"`, partialMatches, ctx, ctx.model);
}

async function handleModel(trimmedArgs: string, ctx: ExtensionCommandContext, pi: ExtensionAPI | undefined): Promise<void> {
  const availableModels = ctx.modelRegistry.getAvailable();
  if (availableModels.length === 0) {
    ctx.ui.notify("No available models found. Check provider auth and model discovery.", "warning");
    return;
  }
  if (!pi) {
    ctx.ui.notify("Model switching is unavailable in this context.", "warning");
    return;
  }

  const trimmed = trimmedArgs.trim();
  let targetModel: Model<any> | undefined;

  if (!trimmed) {
    if (!ctx.hasUI) {
      const current = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "(none)";
      ctx.ui.notify(`Current model: ${current}\nUsage: /gsd model <provider/model|model-id>`, "info");
      return;
    }

    targetModel = await selectModelByProvider("Select session model:", availableModels, ctx, ctx.model);
  } else {
    targetModel = await resolveRequestedModel(trimmed, ctx);
  }

  if (!targetModel) {
    ctx.ui.notify(`Model "${trimmed}" not found. Use /gsd model with an exact provider/model or a unique model ID.`, "warning");
    return;
  }

  const ok = await pi.setModel(targetModel);
  if (!ok) {
    ctx.ui.notify(`No API key for ${targetModel.provider}/${targetModel.id}`, "warning");
    return;
  }

  // /loop24 model is an explicit per-session pin for the agent dispatches.
  // This is captured at auto bootstrap so it survives internal session
  // switches during /loop24 auto and /loop24 next runs.
  const sessionId = ctx.sessionManager?.getSessionId?.();
  if (sessionId) {
    setSessionModelOverride(sessionId, {
      provider: targetModel.provider,
      id: targetModel.id,
    });
  }

  ctx.ui.notify(`Model: ${targetModel.provider}/${targetModel.id}`, "info");
}

export async function handleCoreCommand(
  trimmed: string,
  ctx: ExtensionCommandContext,
  pi?: ExtensionAPI,
): Promise<boolean> {
  if (trimmed === "help" || trimmed === "h" || trimmed === "?" || trimmed.startsWith("help ")) {
    showHelp(ctx, trimmed.startsWith("help ") ? trimmed.slice(5).trim() : "");
    return true;
  }
  if (trimmed === "status") {
    await handleVisualize(ctx);
    return true;
  }
  if (trimmed === "visualize") {
    await handleVisualize(ctx);
    return true;
  }
  if (trimmed === "brief" || trimmed.startsWith("brief ")) {
    await handleBrief(trimmed.replace(/^brief\s*/, "").trim(), ctx, pi);
    return true;
  }
  if (trimmed === "widget" || trimmed.startsWith("widget ")) {
    const { cycleWidgetMode, setWidgetMode, getWidgetMode } = await import("../../auto-dashboard.js");
    const arg = trimmed.replace(/^widget\s*/, "").trim();
    if (arg === "full" || arg === "small" || arg === "min" || arg === "off") {
      setWidgetMode(arg);
    } else {
      cycleWidgetMode();
    }
    ctx.ui.notify(`Widget: ${getWidgetMode()}`, "info");
    return true;
  }
  if (trimmed === "model" || trimmed.startsWith("model ")) {
    await handleModel(trimmed.replace(/^model\s*/, "").trim(), ctx, pi);
    return true;
  }
  if (trimmed === "mode" || trimmed.startsWith("mode ")) {
    const modeArgs = trimmed.replace(/^mode\s*/, "").trim();
    const scope = modeArgs === "project" ? "project" : "global";
    const path = scope === "project" ? getProjectGSDPreferencesPath() : getGlobalGSDPreferencesPath();
    await ensurePreferencesFile(path, ctx, scope);
    await handlePrefsMode(ctx, scope);
    return true;
  }
  if (trimmed === "prefs" || trimmed.startsWith("prefs ")) {
    await handlePrefs(trimmed.replace(/^prefs\s*/, "").trim(), ctx);
    return true;
  }
  if (trimmed === "language" || trimmed.startsWith("language ")) {
    await handleLanguage(trimmed.replace(/^language\s*/, "").trim(), ctx);
    return true;
  }
  if (trimmed === "cmux" || trimmed.startsWith("cmux ")) {
    await handleCmux(trimmed.replace(/^cmux\s*/, "").trim(), ctx);
    return true;
  }
  if (trimmed === "show-config") {
    const { ConfigOverlay, formatConfigText } = await import("../../config-overlay.js");
    const result = await ctx.ui.custom<boolean>(
      (tui, theme, _kb, done) => new ConfigOverlay(tui, theme, () => done(true)),
      {
        overlay: true,
        overlayOptions: {
          width: "65%",
          minWidth: 55,
          maxHeight: "85%",
          anchor: "center",
        },
      },
    );
    if (result === undefined) {
      ctx.ui.notify(formatConfigText(), "info");
    }
    return true;
  }
  if (trimmed === "setup" || trimmed.startsWith("setup ")) {
    await handleSetup(trimmed.replace(/^setup\s*/, "").trim(), ctx, pi);
    return true;
  }
  if (trimmed === "onboarding" || trimmed.startsWith("onboarding ")) {
    const { handleOnboarding } = await import("./onboarding.js");
    await handleOnboarding(trimmed.replace(/^onboarding\s*/, "").trim(), ctx);
    return true;
  }
  return false;
}

export function formatTextStatus(state: WorkflowDbState): string {
  const lines: string[] = [`${BRAND} Status\n`];
  lines.push(formatProgressLine(computeProgressScore()));
  lines.push("");
  lines.push(`Phase: ${state.phase}`);

  if (state.activeMilestone) {
    lines.push(`Active milestone: ${state.activeMilestone.id} — ${state.activeMilestone.title}`);
  }
  if (state.activeSlice) {
    lines.push(`Active slice: ${state.activeSlice.id} — ${state.activeSlice.title}`);
  }
  if (state.activeTask) {
    lines.push(`Active task: ${state.activeTask.id} — ${state.activeTask.title}`);
  }
  if (state.progress) {
    const { milestones, slices, tasks } = state.progress;
    const parts: string[] = [`milestones ${milestones.done}/${milestones.total}`];
    if (slices) parts.push(`slices ${slices.done}/${slices.total}`);
    if (tasks) parts.push(`tasks ${tasks.done}/${tasks.total}`);
    lines.push(`Progress: ${parts.join(", ")}`);
  }
  if (state.nextAction) {
    lines.push(`Next: ${state.nextAction}`);
  }
  if (state.blockers.length > 0) {
    lines.push(`Blockers: ${state.blockers.join("; ")}`);
  }
  if (state.registry.length > 0) {
    lines.push("");
    lines.push("Milestones:");
    for (const milestone of state.registry) {
      const icon = milestone.status === "complete"
        ? "✓"
        : milestone.status === "active"
          ? "▶"
          : milestone.status === "parked"
            ? "⏸"
            : "○";
      lines.push(`  ${icon} ${milestone.id}: ${milestone.title} (${milestone.status})`);
    }
  }

  const envResults = runEnvironmentChecks(projectRoot());
  const envIssues = envResults.filter((result) => result.status !== "ok");
  if (envIssues.length > 0) {
    lines.push("");
    lines.push("Environment:");
    for (const issue of envIssues) {
      lines.push(`  ${issue.status === "error" ? "✗" : "⚠"} ${issue.message}`);
    }
  }

  return lines.join("\n");
}
