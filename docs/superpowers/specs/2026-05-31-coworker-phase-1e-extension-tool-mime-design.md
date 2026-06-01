# Otto Co-Worker Phase 1e — Extension Scaffold + `/sp` Commands + `scratchpad` Tool + MIME Bundle Design

**Status:** Approved (brainstorm 2026-05-31)
**Date:** 2026-05-31
**Author:** brainstorm session with Corey
**Phase:** 1e — first of the three-way split of the original 1e (1e wire-up, 1f tree/fork, 1g polish)
**Branch:** `feat/coworker-phase-0` (continues accumulating until 1g closes Phase 1)
**Parent spec:** `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §2.4 (`/sp` slash commands), §5.1 (LLM `scratchpad` tool), §5.1a (MIME bundle), §3.1 (`/new` attaches `default`).
**Prior plan:** `docs/superpowers/plans/2026-05-31-coworker-phase-1d2-kernel-persistence.md` (1d2, completed)

---

## 1. Goal

Wire `@otto/coworker-scratchpad` (the library shipped in 1a–1d2) into Otto's TUI and LLM tool surfaces so an analyst can run cells through `/sp` slash commands and so the LLM can run cells through the `scratchpad` tool. After 1e, the NOC analyst can:

- Type `/sp new p1-1234` → fresh scratchpad created and attached.
- Type `/sp view` → see the cell history (overlay).
- Have the LLM call `scratchpad exec` with TypeScript code → result returns as a MIME bundle (`text/plain` for stdout, `application/json` for return value, `text/markdown` when the return value looks markdown-shaped).
- Type `/sp list` → see every scratchpad on disk plus current attachment marker.

1e does NOT close the Phase 1 milestone — that requires `/sp tree` and `/sp fork`, which are 1f's responsibility. 1e is the surfacing layer.

## 2. Scope

**In scope (1e):**
- New extension at `src/resources/extensions/coworker-scratchpad/` following the `bg-shell` / `analyst` pattern.
- Six `/sp` slash verbs: `list`, `new`, `attach`, `reset`, `view`, `remove`. `/sp` alone defaults to `list`.
- `scratchpad` LLM tool with two actions: `exec`, `view`.
- Auto-derived 3-slot MIME bundle (`text/plain` + `application/json` + `text/markdown` via a simple heuristic).
- Lazy-constructed `ScratchpadManager` singleton; in-memory `currentName` pointer; tool defaults to current.
- Argument completion for verb-second-arg from on-disk scratchpad dirs (so cold scratchpads complete too).
- Tests: unit (mocked manager) + one live-kernel integration smoke test.

**Out of scope (deferred):**
- `/sp tree`, `/sp fork`, cell-tree projection → **1f**.
- `/sp detach` (and the corresponding `attached_sessions[]` removal), `/sp save`, `/sp clear-history` → **1g**.
- Recovery-notes banner on attach → **1g**.
- `--force-takeover` interactive prompt for `/sp attach` → **1g**.
- `size_bytes` post-write recompute (1d follow-up) → **1g**.
- Scratchpad tool actions `reset`, `remove`, `dump`, `install` → 1g+ (and `install` is real sandboxed-npm, may never land in 1.x).
- Per-session persistence of `currentName` so `/resume` restores it → **1g**.
- Vegalite + PNG MIME slots (spec §5.1a's "contract v1; renderer v2") → Phase 2+.
- `application/x-otto-status` streaming events during long cells → **1g**.
- `artifact://<id>` output spill for cells with large stdout (depends on `otto-artifacts`, Phase 4) → Phase 4+.
- HTML→markdown conversion (spec §5.1a footnote) → deferred until a real use case.

## 3. Locked decisions (brainstorm 2026-05-31)

1. **Manager lifecycle = lazy on first use, dispose on extension teardown.** Extension exports `register(pi)` that constructs no manager up front; a `getManager()` accessor lazy-creates the singleton on first `/sp` invocation OR first `scratchpad` tool call (whichever comes first). `pi.onExit(() => manager?.disposeAll())` wires graceful teardown. Cold sessions that never touch the scratchpad pay nothing.
2. **MIME bundle = auto-derived 3 slots.** `text/plain` if stdout is non-empty; `application/json` if value is not undefined/null; `text/markdown` if value is a string AND looks like markdown (leading `#`/`|` OR contains a GFM table separator `\n\s*\|[-:|\s]+\|\s*\n`). No cell-side opt-in needed in 1e. Spec §5.1a's precedence (markdown > plain > html) governs the LLM-side render choice.
3. **Current scratchpad = in-memory pointer + LLM tool defaults to it.** Extension holds `currentName: string | null`. `/sp attach <name>` and `/sp new <name>` set it. `/sp <verb>` with no name uses it; on first such use with no current attachment, the extension auto-creates `default` per spec §3.1. The `scratchpad` tool's `name` parameter is OPTIONAL: omit → use current (auto-creating `default` if needed); explicit → use that name (does NOT change current attachment). 1g adds per-session persistence; 1e is in-memory-only.
4. **`scratchpad view` defaults to tail-5 structured per-cell summary.** Tool's `view` action returns the last 5 cells with `{ id, parentId, ts, code, ok, value (truncated to 200 chars if string), error, stdout (truncated to 500 chars) }`. Optional `tail?: number` (max 20) and `from_id?: number`. The TUI `/sp view` uses the same archive read but renders unconstrained (full content, paginated overlay).

## 4. Architecture

A single new extension at `src/resources/extensions/coworker-scratchpad/`, mirroring `bg-shell` / `analyst`. The extension is largely "thin glue" over `@otto/coworker-scratchpad`.

### 4.1 File layout

```
src/resources/extensions/coworker-scratchpad/
  extension-manifest.json   ← name, version, contributes commands+tools
  index.ts                  ← register(pi); lazy getManager(); pi.onExit
  state.ts                  ← singleton holder + currentName + lockCurrent
                              + name regex + readCellsJsonl helper
  sp-command.ts             ← /sp registration (list|new|attach|reset|view|remove)
  sp-command.test.ts        ← unit tests for the dispatch logic (no live kernel)
  scratchpad-tool.ts        ← scratchpad LLM tool (exec, view)
  scratchpad-tool.test.ts   ← tool dispatch tests
  mime-bundle.ts            ← pure derivation function
  mime-bundle.test.ts       ← 8 cases covering the derivation rule
  types.ts                  ← ExtensionState shape, SpVerb union
  index.test.ts             ← integration: register + manager wiring (one live kernel)
```

Nine source files, four test files. `index.test.ts` is the only test that spawns a real kernel; others use a stub manager.

### 4.2 Dependency-injection seam

`sp-command.ts` and `scratchpad-tool.ts` each export a `register*(pi, deps)` function where `deps` is `{ getManager: () => ScratchpadManager, state: ExtensionState }`. Tests pass a stub `getManager` returning a manager mock; production wiring (in `index.ts`) passes the real lazy accessor. This keeps unit tests fast (no DuckDB load) and reserves live-kernel exercise for `index.test.ts`.

### 4.3 Singleton + currentName state

`state.ts`:

```ts
export interface ExtensionState {
  manager: ScratchpadManager | null;
  currentName: string | null;
}

export function makeState(): ExtensionState {
  return { manager: null, currentName: null };
}

export const SCRATCHPAD_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export function validateName(name: string): void {
  if (!SCRATCHPAD_NAME_REGEX.test(name)) {
    throw new Error(`invalid scratchpad name: ${name} (must match ${SCRATCHPAD_NAME_REGEX})`);
  }
}

export function ensureCurrentName(state: ExtensionState): string {
  // Pure: returns the name to operate on. The caller (slash handler or tool
  // handler) is responsible for actually attaching via manager.getOrAttach.
  // First-touch fallback: 'default' per spec §3.1.
  if (!state.currentName) state.currentName = 'default';
  return state.currentName;
}

export interface CellsJsonlRead {
  cells: CellEntry[];
  total_cells: number;
}

export function readCellsJsonl(dir: string): CellsJsonlRead {
  // tolerates missing file and trailing-corrupt line (1d behavior)
  // returns { cells: [], total_cells: 0 } when the file does not exist
}
```

The `ensureCurrentName` helper resolves the first-call boundary: if a slash command runs without an explicit name and no current is set, the extension auto-creates `default` and points `currentName` at it. Subsequent verbs without `<name>` use `'default'`.

### 4.4 `index.ts` shape

```ts
import type { ExtensionAPI } from "@otto/pi-coding-agent";
import { ScratchpadManager } from "@otto/coworker-scratchpad";
import { makeState } from "./state.js";
import { registerSpCommand } from "./sp-command.js";
import { registerScratchpadTool } from "./scratchpad-tool.js";

export function register(pi: ExtensionAPI): void {
  const state = makeState();
  const getManager = (): ScratchpadManager => {
    if (!state.manager) {
      state.manager = new ScratchpadManager({
        workspace: pi.workspace.root,
        sessionId: pi.sessionId,
      });
    }
    return state.manager;
  };

  pi.onExit(async () => {
    if (state.manager) await state.manager.disposeAll();
  });

  registerSpCommand(pi, { getManager, state });
  registerScratchpadTool(pi, { getManager, state });
}
```

If `pi.onExit` does not exist in the actual ExtensionAPI (verified at plan time by reading bg-shell's exit handling), the fallback is `process.on('beforeExit', ...)` with a note that the disposal may race process exit on hard kills.

### 4.5 MIME bundle module

```ts
// mime-bundle.ts
export interface MimeBundle {
  'text/plain'?: string;
  'application/json'?: unknown;
  'text/markdown'?: string;
}

export function deriveMimeBundle(value: unknown, stdout: string): MimeBundle {
  const bundle: MimeBundle = {};
  if (stdout.length > 0) bundle['text/plain'] = stdout;
  if (value !== undefined && value !== null) bundle['application/json'] = value;
  if (typeof value === 'string' && looksLikeMarkdown(value)) {
    bundle['text/markdown'] = value;
  }
  return bundle;
}

function looksLikeMarkdown(s: string): boolean {
  const trimmed = s.trimStart();
  if (trimmed.startsWith('#') || trimmed.startsWith('|')) return true;
  if (/\n\s*\|[-:|\s]+\|\s*\n/.test(s)) return true; // GFM table separator row
  return false;
}
```

Pure, ~30 lines, no I/O, no kernel dependency.

### 4.6 `/sp` command surface

| Verb | Args | Behavior | Manager methods |
|---|---|---|---|
| `list` (default if no verb) | — | Show all scratchpads with live/cold + last_used + current marker | `manager.list()` + `readdirSync(root)` for cold ones |
| `new` | `<name>` | Validate name; create; set `currentName = name` | `manager.create(name)` |
| `attach` | `<name>` | Validate name; warm; set `currentName = name` | `manager.getOrAttach(name)` |
| `reset` | `[<name>]` | Wipe and recreate. Preserves `currentName` if it was the target. | `manager.remove(name)` + `manager.create(name)` |
| `view` | `[<name>] [tail=N]` | Overlay TUI panel showing cells.jsonl, full content, scrollable | `readCellsJsonl(dirFor(name))` |
| `remove` | `<name>` | Delete dir; clear `currentName` if matched. Confirms via `ctx.ui.confirm` if `currentName === name`. | `manager.remove(name)` |

Argument completion for `attach`/`reset`/`view`/`remove` reads `<root>/*/meta.json` via `readdirSync(root)` so cold scratchpads complete too. Cached per command invocation; not cached across invocations in 1e (acceptable at <100 scratchpads).

### 4.7 `scratchpad` tool surface

```ts
parameters: Type.Object({
  action: StringEnum(['exec', 'view'] as const),
  name: Type.Optional(Type.String({ description: "Scratchpad name; defaults to the current session attachment, auto-creating 'default' if none." })),
  code: Type.Optional(Type.String({ description: "TypeScript cell code (action='exec' only)." })),
  tail: Type.Optional(Type.Number({ description: "How many trailing cells to return (action='view' only). Default 5, max 20." })),
  from_id: Type.Optional(Type.Number({ description: "If set, view returns cells with id >= from_id (overrides tail)." })),
}),
```

**`exec` response** (success):

```ts
{
  ok: true,
  cell_id: number,
  total_cells: number,
  mime: MimeBundle,
}
```

**`exec` response** (failure — cell threw):

```ts
{
  ok: false,
  cell_id: number,        // the failed cell IS appended to cells.jsonl (1d behavior)
  total_cells: number,
  error: { name: string, message: string },
}
```

**`view` response:**

```ts
{
  name: string,
  cells: Array<{
    id: number,
    parentId: number | null,
    ts: string,
    code: string,                          // not truncated; cell code is short anyway
    ok: boolean,
    value?: unknown,                       // strings truncated to 200 chars
    error?: { name: string, message: string },
    stdout: string,                        // truncated to 500 chars
  }>,
  total_cells: number,
}
```

**Concurrency model:** trust the host to serialize tool calls within a session. No application-level mutex. If two parallel `exec` calls land, the kernel processes them serially via NDJSON and both responses come back — works either way; not exercised by tests.

### 4.8 Prompt guidelines (`promptGuidelines` array)

Following the `bg-shell` pattern, ~10 bullets:

- Use `scratchpad exec` for ad-hoc TS analysis: CSV loading, DuckDB SQL, polars DataFrames, ExcelJS workbook construction. State persists across cells via `globalThis.*`.
- The cell body is wrapped in `(async () => { … })()` — `let`/`const`/`var` are local to the cell; persist by assigning to `globalThis.foo = …`.
- For DuckDB tables that survive across Otto sessions, use `await otto.duckdb.connect()`. For ephemeral in-memory analysis, use `DuckDB.DuckDBInstance.create(':memory:')`.
- Pre-bound libs available in every cell: `polars`, `DuckDB`, `ExcelJS`, `dateFns`, `lodash`, `zod`, `axios`. No imports needed.
- `otto.collectors.list()` enumerates available data sources; `otto.collectors.open(uri)` loads one.
- `name` defaults to the user's currently attached scratchpad — omit it unless you want to operate on a different one.
- A returned string that looks markdown-shaped is rendered as markdown automatically; just `return` a markdown table or heading.
- `scratchpad view` returns the last 5 cells; pass `tail: 20` or `from_id` for more.
- A failed cell is still recorded; the next cell can `view` to see what just broke.
- Cell timeout is 120s by default; use `progress("…")` from inside the cell to reset the inactivity timer for long operations.

## 5. Error handling & edge cases

| Scenario | Handler | User-visible result |
|---|---|---|
| `/sp new <name>` when `<name>` already exists | `manager.create()` throws | Error notify with the manager's message |
| `/sp attach <name>` when no meta.json on disk | `manager.getOrAttach()` creates it via `attachUnmanaged` (1c2 behavior) | Auto-create + attach; matches 1c2 |
| `/sp <verb>` with invalid name | `validateName` throws before reaching the manager | Error notify with the regex |
| `/sp` with no verb | dispatch to `list` | Same as `/sp list` |
| `scratchpad exec` with `name` unset and no `currentName` | `ensureCurrentName` auto-creates `default` | Cell runs in `default`, currentName becomes `'default'` |
| `scratchpad exec` cell throws | tool returns `{ok:false, cell_id, error}` | LLM sees structured error; failed cell IS in cells.jsonl |
| `scratchpad view` on a brand-new scratchpad with no cells | `readCellsJsonl` returns `{cells:[], total_cells:0}` | Tool returns `{cells:[], total_cells:0}` |
| `scratchpad view` with `from_id` past `total_cells` | filter yields `[]` | Tool returns `{cells:[], total_cells}` (still ok) |
| `/sp remove` on `currentName` | confirm via `ctx.ui.confirm`; on yes, clear `currentName` | If denied, no-op |
| Kernel.db open failure on first `exec` | `manager.runCell` → `runtime.start()` rejects with `startup_error/duckdb_open` (1d2) | Tool returns `{ok:false, cell_id:0, error}` |

## 6. Integration risk

| # | Risk | Mitigation |
|---|---|---|
| 1 | `pi.registerCommand` / `pi.registerTool` API shape — assumed from `bg-shell`; subtle field differences may exist | Implementer reads `bg-shell/bg-shell-command.ts` + `bg-shell-tool.ts` end-to-end before writing the corresponding `coworker-scratchpad/*.ts`. Plan calls out the comparison explicitly. |
| 2 | `pi.onExit` hook may not exist | Fallback to `process.on('beforeExit', …)` with a note that disposal may race on hard kills. Plan instructs the implementer to grep `bg-shell` for its teardown pattern before assuming the API. |
| 3 | Extension loader registration — where does Otto find this new extension? | Plan instructs implementer to grep the extension-loader directory for how `bg-shell` enters the load order; replicate the same shape. |
| 4 | DuckDB cold load on first `exec` is slow (>1s) | Accept the latency — default `cellTimeoutMs: 120_000` covers it. Plan notes Risk #1 from §10 of the parent spec. |
| 5 | Argument completion does `readdirSync` on every keystroke | Acceptable at <100 scratchpads; flag for cache work in 1g if it shows up in profiling. |
| 6 | Markdown heuristic false-positives (e.g., a normal English sentence that happens to start with `#`) | Accept the false-positive rate — the response still has `application/json` with the same string. LLM can pick its preferred slot. |

## 7. Test plan

Six tasks. Each task is TDD-per-task with one commit.

| Task | Subject | Type |
|---|---|---|
| 1 | `mime-bundle.ts` + 8-case unit test | Pure unit |
| 2 | `state.ts` (validateName, ensureCurrentName, readCellsJsonl) | Pure unit |
| 3 | `sp-command.ts` + dispatch tests against a stub manager | Unit (no kernel) |
| 4 | `scratchpad-tool.ts` + dispatch tests against a stub manager | Unit (no kernel) |
| 5 | `index.ts` + live-kernel integration smoke test | Integration (one spawn) |
| 6 | Extension manifest + extension-loader registration + gates | Wire-up |

The live-kernel test in Task 5 follows the same harness 1a–1d2 used. It builds the fake `pi`, calls `register(pi)`, drives a `/sp new test` and a `scratchpad exec`, asserts the MIME bundle shape, then asserts `pi.onExit` dispatches `manager.disposeAll`.

## 8. Out-of-scope deferred items (handed to 1f or 1g)

- `/sp tree` and `/sp fork` — 1f (cell-tree projection).
- `/sp detach` (and `attached_sessions[]` cleanup) — 1g.
- `/sp save` (explicit snapshot trigger) — 1g.
- `/sp clear-history` (truncate cells.jsonl) — 1g.
- Recovery-notes banner on attach — 1g.
- `--force-takeover` interactive prompt — 1g.
- Per-session `currentName` persistence (`/resume` continuity) — 1g.
- `size_bytes` post-write recompute (1d follow-up) — 1g.
- Tool actions `reset`, `remove`, `dump`, `install` — 1g+ (`install` may never land in 1.x).
- Vegalite / PNG MIME slots — Phase 2+ (spec §5.1a calls renderer v2).
- HTML→markdown — Phase 2+.
- `application/x-otto-status` streaming events — 1g.
- `artifact://<id>` output spill (depends on Phase 4) — Phase 4.

---

**Next step:** invoke `superpowers:writing-plans` to expand this spec into a task-by-task plan at `docs/superpowers/plans/2026-05-31-coworker-phase-1e-extension-tool-mime.md`.
