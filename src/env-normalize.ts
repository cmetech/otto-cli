// Brand env-var normalization.
//
// OTTO_* is the only supported product env prefix. This module intentionally
// does not mirror legacy prefixes into OTTO_* values; callers must read OTTO_*
// directly.
//
// This module's side effect must run BEFORE any brand var is read. Import it as
// the FIRST import in each process entry point (e.g. src/loader.ts), above
// app-paths/brand, so its module-load side effect precedes their reads.
//
// To add/remove a brand var, edit BRAND_ENV_SUFFIXES below — nothing else.

export const BRAND_ENV_SUFFIXES: readonly string[] = [
  "ALLOWED_COMMAND_PREFIXES",
  "BIN_PATH",
  "BUNDLED_EXTENSION_PATHS",
  "CLAUDE_DEBUG",
  "CLEAR_ON_START",
  "CLI_WORKTREE",
  "CLI_WORKTREE_BASE",
  "CODING_AGENT_DIR",
  "DEBUG",
  "DEBUG_EXTENSIONS",
  "DISABLE_LSPMUX",
  "DISABLE_WORKTREE_WRITE_GUARD",
  "ENABLE_NATIVE_GIT",
  "ENABLE_NATIVE_PARSER",
  "ENABLE_NATIVE_TUI_HIGHLIGHT",
  "ENGINE_BYPASS",
  "FETCH_ALLOWED_URLS",
  "FIRST_RUN_BANNER",
  "GATEWAY_TOKEN",
  "GATEWAY_URL",
  "HEADLESS",
  "HOME",
  "LANGFLOW_DISABLED",
  "LEGACY_TELEMETRY_FILE",
  "MILESTONE_LOCK",
  "PARALLEL_WORKER",
  "PERSIST_WRITE_GATE_STATE",
  "PKG_ROOT",
  "PROJECT_ID",
  "PROJECT_ROOT",
  "PROMPT_ENGINEER_MODEL",
  "PYTHON_BIN",
  "RTK_DISABLED",
  "RTK_DISABLED_ENV",
  "SHOW_TOKEN_COST",
  "SKILL_MANIFEST_STRICT",
  "SKIP_RTK_INSTALL",
  "SKIP_RTK_INSTALL_ENV",
  "SLICE_LOCK",
  "STARTUP_TIMING",
  "STATE_DIR",
  "TOOL_NAMES",
  "UOK_FORCE_LEGACY",
  "UOK_LEGACY_FALLBACK",
  "VERSION",
  "WEB_ALLOWED_ORIGINS",
  "WEB_AUTH_TOKEN",
  "WEB_BRIDGE_TUI",
  "WEB_HOST",
  "WEB_HOST_KIND",
  "WEB_PACKAGE_ROOT",
  "WEB_PORT",
  "WEB_PROJECT_CWD",
  "WEB_PROJECT_SESSIONS_DIR",
  "WORKER_MODEL",
  "WORKFLOW_EXECUTORS_MODULE",
  "WORKFLOW_PATH",
  "WORKFLOW_PROJECT_ROOT",
  "WORKFLOW_WRITE_GATE_MODULE",
  "WORKTREE",
] as const;

/**
 * Normalize brand environment variables.
 *
 * Kept as a side-effect hook for entry points that already import it early.
 * With OTTO as the only active identity there is no alias mirroring to perform.
 */
export function normalizeBrandEnv(env: NodeJS.ProcessEnv = process.env): void {
  void env;
}

// Module-load side effect: normalize as early as possible.
normalizeBrandEnv();
