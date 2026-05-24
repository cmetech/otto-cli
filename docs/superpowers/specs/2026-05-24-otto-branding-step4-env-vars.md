# OTTO Branding — Step 4: Env Vars (LOOP24_* → OTTO_*)

**Date:** 2026-05-24
**Status:** Approved — ready for implementation
**Part of:** OTTO branding rollout. Final step (canonical roadmap step 5;
file-sequence step 4). Follows step 3 (config-dir rename).

## Background

~60 `LOOP24_*` environment variables are read across the codebase (full list in
the inventory below). The product brand is now OTTO, so `OTTO_*` should be the
**canonical** env prefix, with `LOOP24_*` (and the older `GSD_*`) accepted as
**fallbacks** so existing shells, CI, and scripts keep working. This matches the
roadmap decision: "OTTO_* canonical + fallbacks."

The codebase already has two partial patterns:
- **Set-sites** dual-write: `process.env.LOOP24_X = process.env.GSD_X = value`
  (e.g. loader.ts sets CODING_AGENT_DIR, PKG_ROOT, VERSION, …).
- **User-input read-sites** dual-read: `process.env.LOOP24_HOME || process.env.GSD_HOME`.

There is **no central shim**. A full per-read-site retrofit (~60 vars across many
files) is high-churn and high-risk.

## Design: early env-normalization shim (low-risk)

Add **one** module, `src/env-normalize.ts`, whose module-load side effect runs
**before** any brand var is read. For each known brand-var suffix it computes the
effective value as the first set of `OTTO_<S>`, `LOOP24_<S>`, `GSD_<S>` (in that
precedence) and writes the value back to **all three** names. Net effect:

- A user who sets only `OTTO_X` → it propagates to `LOOP24_X`/`GSD_X`, so every
  existing `process.env.LOOP24_X` read keeps working unchanged.
- A user who still sets `LOOP24_X` (or `GSD_X`) → unchanged behavior (fallback).
- `OTTO_*` is the documented canonical; `LOOP24_*`/`GSD_*` are fallbacks.

No read-site churn. The existing set-site dual-writes stay (harmless; the shim is
about *user-provided* values at startup).

### Wiring

- `src/env-normalize.ts` must execute first. Import it as the **first** import in
  every process entry point so its side effect precedes brand/app-paths reads:
  `src/loader.ts` (CLI), and any other entry (`headless.ts`, web/rpc entry) that
  can start without going through loader. Static imports run in import order, so
  placing it above `import './app-paths.js'` / `import './brand.js'` guarantees
  precedence.
- Module is zero-dependency (Node builtins only) — safe on the early path.
- Idempotent: running twice is a no-op (values already mirrored).

### Special cases

- **Home override:** `src/app-paths.ts` currently reads
  `LOOP24_HOME || GSD_HOME`. Add `OTTO_HOME` as the highest-precedence option:
  `OTTO_HOME || LOOP24_HOME || GSD_HOME`. (The normalization shim also mirrors
  these, but app-paths reads at its own module load, so make the precedence
  explicit there too.)
- **Agent dir:** pi's `config.ts` reads `ENV_AGENT_DIR =
  ${APP_NAME.toUpperCase()}_CODING_AGENT_DIR` = `LOOP24_CODING_AGENT_DIR`
  (APP_NAME stays "loop24"). loader.ts sets that var explicitly, and the shim
  mirrors `OTTO_CODING_AGENT_DIR` → `LOOP24_CODING_AGENT_DIR`, so a user setting
  `OTTO_CODING_AGENT_DIR` works without touching pi.

## Inventory (≈60 suffixes to mirror)

ALLOWED_COMMAND_PREFIXES, BIN_PATH, BUNDLED_EXTENSION_PATHS, CLAUDE_DEBUG,
CLEAR_ON_START, CLI_WORKTREE, CLI_WORKTREE_BASE, CODING_AGENT_DIR, DEBUG,
DEBUG_EXTENSIONS, DISABLE_LSPMUX, DISABLE_WORKTREE_WRITE_GUARD,
ENABLE_NATIVE_GIT, ENABLE_NATIVE_PARSER, ENABLE_NATIVE_TUI_HIGHLIGHT,
ENGINE_BYPASS, FETCH_ALLOWED_URLS, FIRST_RUN_BANNER, GATEWAY_TOKEN, GATEWAY_URL,
HEADLESS, HOME, LANGFLOW_DISABLED, LEGACY_TELEMETRY_FILE, MILESTONE_LOCK,
PARALLEL_WORKER, PERSIST_WRITE_GATE_STATE, PKG_ROOT, PROJECT_ID, PROJECT_ROOT,
PROMPT_ENGINEER_MODEL, PYTHON_BIN, RTK_DISABLED, RTK_DISABLED_ENV,
SHOW_TOKEN_COST, SKILL_MANIFEST_STRICT, SKIP_RTK_INSTALL, SKIP_RTK_INSTALL_ENV,
SLICE_LOCK, STARTUP_TIMING, STATE_DIR, TOOL_NAMES, UOK_FORCE_LEGACY,
UOK_LEGACY_FALLBACK, VERSION, WEB_ALLOWED_ORIGINS, WEB_AUTH_TOKEN,
WEB_BRIDGE_TUI, WEB_HOST, WEB_HOST_KIND, WEB_PACKAGE_ROOT, WEB_PORT,
WEB_PROJECT_CWD, WEB_PROJECT_SESSIONS_DIR, WORKER_MODEL,
WORKFLOW_EXECUTORS_MODULE, WORKFLOW_PATH, WORKFLOW_PROJECT_ROOT,
WORKFLOW_WRITE_GATE_MODULE, WORKTREE.

(The list is generated from `grep -roh "LOOP24_[A-Z_]*"`; the shim derives the
suffix set from a single array so adding/removing a var is a one-line edit.)

## Exclusions
- `piConfig.name` ("loop24"), `APP_NAME`, npm scope `@loop24/*`, package
  `@ericsson/loop24` — unchanged.
- `LANGFLOW_*`, `ANTHROPIC_API_KEY`, `PI_*` and other non-brand env vars — not
  touched.
- Existing set-site dual-writes — left as-is (the shim complements them).

## Acceptance criteria
- `npm run build` exits 0.
- With `OTTO_DEBUG=1` set (and `LOOP24_DEBUG` unset), code reading
  `process.env.LOOP24_DEBUG` sees `"1"` (shim mirrored it).
- With `LOOP24_DEBUG=1` set (and `OTTO_*` unset), behavior unchanged (fallback).
- `OTTO_HOME=/tmp/x` resolves the config dir under `/tmp/x` (app-paths honors it).
- New unit test for `env-normalize`: OTTO precedence, LOOP24 fallback, GSD
  fallback, idempotency, and "don't clobber an already-set higher-precedence var."
- Targeted config/brand/env test subset green (the tui-header-lifecycle TUI test
  hangs in this environment — pre-existing, unrelated; verify with a bounded run).
- No `git add -A`; `docs/branding/` untouched.

## Commit
- `feat(otto-step4): OTTO_* canonical env vars with LOOP24_*/GSD_* fallback shim`
