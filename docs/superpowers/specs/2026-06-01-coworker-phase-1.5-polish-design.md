# Otto Co-Worker Phase 1.5 — Polish Wave Design

**Status:** Approved (brainstorm 2026-06-01)
**Date:** 2026-06-01
**Author:** Phase 1 human-testing synthesis
**Phase:** 1.5 — bundled polish wave closing all open Phase 1 known-issues before Phase 2 (otto-vault) starts
**Branch:** new `feat/coworker-phase-1.5-polish` (branched from main after Phase 1 merge)
**Parent spec:** `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §3 (pool semantics), §4 (3-day RCA scenario), §5 (slash-command verbs)
**Prior plans:** `docs/superpowers/plans/2026-06-01-coworker-phase-1g-session-affinity.md`, `…-1g2-on-attach-ux.md`, `…-1g3-library-hardening.md`
**Source backlog:** `docs/superpowers/notes/2026-06-01-coworker-phase-1-known-issues.md` (Issues 1, 2, 4, 5, 6) + GH issues #66, #67

---

## 1. Goal

Close the seven open Phase 1 polish items that surfaced during human testing, in a single focused wave, before Phase 2 starts. The headline item is **#6** — the spec's canonical day-2 RCA scenario ("type `otto`, pick up yesterday's scratchpad") is unreachable in production today and must work after 1.5 ships.

After 1.5:

- Typing `otto` in a workspace where a scratchpad was previously attached **auto-restores** that scratchpad via a workspace-level pointer (the per-sessionId sidecar restore path stays for `--resume`).
- `_sessions/` files are named with a `sidecar` token and are GC'd on init (orphan-by-missing-scratchpad and old-foreign-session sweeps).
- `/sp attach <typo>` errors with a helpful suggestion instead of silently spawning a phantom scratchpad.
- `/sp list` shows live entries' idle age; `/sp evict <name>` releases a warm kernel without deleting the scratchpad.
- `meta.json` on fresh `/sp new` reflects post-spawn disk state (no more stale `size_bytes: 0` + `kernel_db.present: false`).
- `otto.duckdb.registerDf(name, df)` exists; polars→DuckDB is a 2-cell operation, not an 8-cell exploration.

## 2. Scope

**In scope (1.5):**
- **Task A — Workspace-level scratchpad restore (Issue #6).** New `_workspaces/<hash>.json` pointer alongside the existing per-session sidecar; new restore order at session_start; new notification copy.
- **Task B — Sidecar naming + stale-sidecar GC (GH #66, #67).** Filename gains a `sidecar` token; init runs a sweep over `_sessions/` deleting orphans (missing scratchpad OR foreign session + mtime > 14d).
- **Task C — `/sp attach` existence guard (Issue #5).** Slash command verifies on-disk existence before delegating to `manager.getOrAttach`; LLM tool path unchanged.
- **Task D — Pool visibility + `/sp evict` (Issue #4).** `/sp list` formatter shows idle age; new `/sp evict <name>` verb and `manager.evict(name)` method that snapshots+disposes without deleting.
- **Task E — `meta.json` initial-write ordering (Issue #2).** Re-order `attachUnmanaged` so initial `writeMeta` reflects post-spawn disk state (or add a second `writeMeta` after `spawnRuntime` succeeds — see §4.5 for choice).
- **Task F — `otto.duckdb.registerDf` helper (Issue #1).** New helper in `kernel-bindings.ts` that accepts polars DataFrame / Arrow Table / array-of-records / plain object and routes to the appropriate DuckDB load path. Updated `cw_scratchpad` promptGuidelines bullet pointing to the helper.

**Out of scope (deferred):**
- **Issue #3** (LLM "ask if unsure" reliability) — accepted as inherent LLM behavior; revisit in Phase 6 (NOC persona polish).
- **Otto-core `SessionManager` change** to preserve sessionId across `--resume` (Option B in Issue #6) — coworker-side workspace pointer covers the canonical UX without an Otto-core change. Investigation deferred.
- **`--continue` / `-c` shortcut** for "resume most recent in workspace" (Option D in Issue #6) — workspace pointer makes this unnecessary for the headline use case; nice-to-have for power users, file separately if wanted.
- **Atomic-rename for `_workspaces/<hash>.json`** beyond what `writeMetaAtomic` (from 1g3) already provides — same pattern reused; not a new mechanism.
- **Cross-machine workspace pointer disambiguation** (cloud-sync collisions) — Issue #6 raises this as a tradeoff; accepted risk for 1.5, revisit if it bites.
- **Phase 2+:** otto-vault, otto-memory, branch-summary cells, TUI overlay, vegalite/PNG renderers, artifact:// spill.

## 3. Locked decisions (brainstorm 2026-06-01)

1. **Workspace pointer key = `sha256(workspaceRoot).slice(0, 16)`, where `workspaceRoot` = git toplevel if available, else `process.cwd()` at session start.** Git-root keying means launching `otto` from any subdirectory of a repo restores the same scratchpad — matches how developers think about "this project." Detection uses `git rev-parse --show-toplevel` (synchronous, < 50ms); if it fails (not a git repo, git not installed), fall back to cwd. Cross-machine cloud-sync collisions are an accepted tradeoff (see out-of-scope).
2. **Workspace pointer location = `~/.otto/scratchpads/_workspaces/<hash>.json`.** Sibling to `_sessions/`. Schema: `{ schema_version: 1, workspace_hash: string, workspace_root: string, last_session_id: string, last_current_name: string, last_attached_at: ISO8601 }`. `workspace_root` is informational (debugging) only.
3. **Workspace pointer write triggers = every `/sp attach` and every `/sp new`.** Same trigger points as the existing session sidecar (single-line addition next to each existing write). Detach does NOT clear it (the workspace pointer is "last known good", not "currently attached"). Cell-run does NOT update it (staleness is days, not minutes).
4. **Workspace pointer staleness threshold = 7 days.** Pointer older than 7d → ignored at session_start (treated as no pointer). Threshold is a module constant `WORKSPACE_POINTER_STALE_MS = 7 * 24 * 60 * 60 * 1000`. Configurable later if needed.
5. **Restore precedence at session_start (sidecar wins with fallback):** (a) per-session sidecar match → attempt restore. If the referenced scratchpad still exists → restore + notify `attached to <name> (restored)` (existing 1g behavior). If the referenced scratchpad is GONE → continue to (b) (existing `previous scratchpad gone` notification is suppressed in favor of the fallback notification). (b) workspace pointer match (within staleness window AND `<current_name>/meta.json` exists) → restore + notify `attached to <name> (from workspace, last used <relative>)`. (c) else no restore. The "sidecar wins" rule honors explicit `--resume`; the fallback prevents an explicit resume from a session whose scratchpad was deleted from producing zero restoration.
6. **Sidecar filename format = `sidecar_<attached_at>_<sessionId>.json`.** Token in PREFIX (not suffix) for `ls` visual scan + `sidecar_*` glob. Old-format files become orphans, swept by Task B's GC on the next init.
7. **Stale sidecar GC runs ONCE per session at init**, never on demand. Single cheap pass; no command surface.
8. **Stale sidecar criteria (delete if ALL true):** (a) `session_id !== currentSessionId`; (b) filename starts with `sidecar_` (don't touch unknown files); (c) EITHER `<current_name>/meta.json` is missing OR `mtime > 7 days ago`. Bounded constant: `SIDECAR_GC_STALE_DAYS = 7` (matches workspace pointer threshold — one mental model: "a week of memory across the whole system").
9. **`/sp attach` existence guard scopes to the slash command only.** Library `manager.getOrAttach` stays permissive; LLM tool path (`cw_scratchpad` action=exec) is unchanged.
10. **`/sp evict <name>` refuses if entry has an active cell, UNLESS `--force` is passed.** Default: error `cannot evict <name>: cell is running (use --force to interrupt)`. With `--force`: send SIGTERM to the cell (existing cell-cancellation path in `child-process-runtime.ts`), wait up to 5s for the cell to ack cancellation (`CELL_CANCEL_TIMEOUT_MS = 5000`), then proceed with `snapshotThenDispose`. If the cell doesn't ack within 5s, escalate to SIGKILL on the runtime and skip the snapshot (the kernel may be wedged). Output for `--force` success: `interrupted active cell and evicted <name>`.
11. **`/sp list` idle-age format (coarse):**
    - `active` when `(now - lastUsedAt) < 30s` OR entry has active cell
    - `idle Xm` when `30s ≤ age < 1h` (e.g. `idle 4m`, `idle 59m`; floor minutes)
    - `idle Xh` when `1h ≤ age < 24h` (e.g. `idle 2h`, `idle 23h`)
    - `idle Xd` when `age ≥ 24h` (e.g. `idle 1d`, `idle 7d`)
    Cold entries show no age column.
12. **Issue #2 fix = approach B (second `writeMeta` after `spawnRuntime`).** Two writes instead of restructuring `attachUnmanaged`. Cheap (meta is small), no risk of breaking the existing lock-acquire-before-meta ordering. The first write keeps the lock side-effect; the second write reflects post-spawn disk state.
13. **`registerDf` API shape:** `otto.duckdb.registerDf(name, input, opts?)`. Default path (no `opts`): duck-typed input detection (polars DataFrame / Arrow Table / array of records) + first-10-rows schema inference (null-walk to avoid leading-null poisoning). Override path: `opts.schema` accepts either `Record<string, string>` (column-name → SQL type, e.g. `{ revenue: 'DOUBLE' }`) or `Array<[string, string]>` (preserves order). When `opts.schema` is present, inference is skipped entirely. Inference-failure errors include a usage hint pointing at the override.
14. **`cw_scratchpad` promptGuidelines update** is one bullet, slightly extended for the opts hint: `For polars→DuckDB: prefer 'otto.duckdb.registerDf(name, df)' over manual API discovery. If inference picks the wrong column type, pass '{ schema: { col: ''TYPE'' } }' as the third argument. Falls back to polars' own SQL ('df.sql(...)') for one-off aggregations.`
15. **No schema bump for any existing on-disk format.** `meta.json` v3 unchanged. New formats (`_workspaces/<hash>.json`, renamed sidecar) start at `schema_version: 1`.

## 4. Architecture

### 4.1 Workspace pointer (Task A)

Two new modules:

**`src/resources/extensions/coworker-scratchpad/workspace-root.ts`** — detects the workspace root:

```ts
import { execSync } from 'node:child_process';

export function detectWorkspaceRoot(cwd: string): string {
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 500,
    }).trim();
    if (out) return out;
  } catch { /* not a git repo, git not installed, or timeout — fall through */ }
  return cwd;
}
```

Synchronous + bounded by a 500ms timeout. stderr suppressed so non-git directories don't spam the console. Called once per session at init.

**`src/resources/extensions/coworker-scratchpad/workspace-pointer.ts`** — read/write/freshness:

```ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface WorkspacePointer {
  schema_version: 1;
  workspace_hash: string;
  workspace_root: string;
  last_session_id: string;
  last_current_name: string;
  last_attached_at: string;
}

export const WORKSPACE_POINTER_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export function workspaceHash(workspaceRoot: string): string {
  return createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16);
}

export function workspacePointerPath(rootDir: string, hash: string): string {
  return join(rootDir, '_workspaces', `${hash}.json`);
}

export function readWorkspacePointer(path: string): WorkspacePointer | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<WorkspacePointer>;
    if (
      parsed.schema_version === 1 &&
      typeof parsed.workspace_hash === 'string' &&
      typeof parsed.workspace_root === 'string' &&
      typeof parsed.last_session_id === 'string' &&
      typeof parsed.last_current_name === 'string' &&
      typeof parsed.last_attached_at === 'string'
    ) {
      return parsed as WorkspacePointer;
    }
    return null;
  } catch { return null; }
}

export function writeWorkspacePointer(path: string, payload: WorkspacePointer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, path);
}

export function isPointerFresh(pointer: WorkspacePointer, now: number): boolean {
  const attachedAt = Date.parse(pointer.last_attached_at);
  if (Number.isNaN(attachedAt)) return false;
  return (now - attachedAt) < WORKSPACE_POINTER_STALE_MS;
}
```

**Write call sites (sp-command.ts):** add a `writeWorkspacePointer(...)` call alongside the existing `writeSessionSidecar(...)` in:
- `case 'attach':` (line ~188 post-1g)
- `case 'new':` (line ~136 post-1g)

The workspace root is resolved once at extension init (cached on `deps`); the write sites read it from there rather than re-shelling out per write.

**Read at session_start (index.ts):** extend the existing restore block (line ~51) with explicit sidecar-with-fallback semantics. Pseudocode:

```ts
const sidecarPath = sessionSidecarPath(root, sessionId);
const sidecar = readSessionSidecar(sidecarPath);
const workspaceRoot = detectWorkspaceRoot(process.cwd());
const hash = workspaceHash(workspaceRoot);
const pointerPath = workspacePointerPath(root, hash);

// (a) Sidecar restore — primary path
if (sidecar) {
  const targetMeta = join(root, sidecar.current_name, 'meta.json');
  if (existsSync(targetMeta)) {
    currentName = sidecar.current_name;
    ctx.ui.notify(`attached to ${sidecar.current_name} (restored)`, 'info');
    return;
  }
  // Sidecar's scratchpad is gone — DON'T notify yet; fall through to (b)
  deleteSessionSidecar(sidecarPath); // clean up the now-broken pointer
}

// (b) Workspace pointer fallback
const pointer = readWorkspacePointer(pointerPath);
if (pointer && isPointerFresh(pointer, Date.now())) {
  const targetMeta = join(root, pointer.last_current_name, 'meta.json');
  if (existsSync(targetMeta)) {
    currentName = pointer.last_current_name;
    const relAge = formatRelativeAge(Date.now() - Date.parse(pointer.last_attached_at));
    ctx.ui.notify(`attached to ${pointer.last_current_name} (from workspace, last used ${relAge})`, 'info');
    return;
  }
}

// (c) No restore — silent (matches existing fresh-launch behavior)
```

`formatRelativeAge` is shared with the `/sp list` idle-age formatter (Task D); colocate in a new `src/resources/extensions/coworker-scratchpad/format-age.ts`.

### 4.2 Sidecar naming + GC (Task B)

**Naming change (session-sidecar.ts:11):**

```ts
export function sessionSidecarPath(rootDir: string, sessionId: string): string {
  const attachedAt = new Date().toISOString().replace(/[:.]/g, '-');
  return join(rootDir, '_sessions', `sidecar_${attachedAt}_${sessionId}.json`);
}
```

Wait — `sessionSidecarPath` is currently called from both write AND delete sites, so the filename must be deterministic from inputs. Current implementation embeds the timestamp at write time, not in the path helper. Verify before locking — if the timestamp is currently in the filename via the path helper (not the writer), this changes the API. Implementer should grep callers first.

**GC function (new):**

```ts
// session-sidecar.ts
export const SIDECAR_GC_STALE_DAYS = 7;

export function sweepStaleSidecars(rootDir: string, currentSessionId: string, now: number): number {
  const dir = join(rootDir, '_sessions');
  if (!existsSync(dir)) return 0;
  let deleted = 0;
  for (const f of readdirSync(dir)) {
    if (!f.startsWith('sidecar_')) continue; // safety: only touch known-format files
    const path = join(dir, f);
    try {
      const sc = readSessionSidecar(path);
      if (!sc) continue;
      if (sc.session_id === currentSessionId) continue;
      const scratchpadMeta = join(rootDir, sc.current_name, 'meta.json');
      const scratchpadGone = !existsSync(scratchpadMeta);
      const mtime = statSync(path).mtimeMs;
      const tooOld = (now - mtime) > (SIDECAR_GC_STALE_DAYS * 24 * 60 * 60 * 1000);
      if (scratchpadGone || tooOld) {
        rmSync(path, { force: true });
        deleted++;
      }
    } catch { /* per-file isolation; bad file doesn't abort sweep */ }
  }
  return deleted;
}
```

**Call site (index.ts):** add `sweepStaleSidecars(root, sessionId, Date.now())` immediately after the existing sidecar restore block. Silent on 0 deletions; no notify (matches the rest of the init path).

### 4.3 `/sp attach` existence guard (Task C)

Modify `case 'attach':` in `sp-command.ts` (line ~145). Insert existence check after `validateName(name)` and before the force-takeover prompt:

```ts
const metaPath = join(deps.rootDir(), name, 'meta.json');
if (!existsSync(metaPath)) {
  ctx.ui.notify(
    `scratchpad not found: ${name}. Use /sp new ${name} to create it.`,
    'error',
  );
  return;
}
```

Library `manager.getOrAttach` is unchanged (LLM tool path stays permissive).

### 4.4 `/sp list` idle-age + `/sp evict` (Task D)

**`/sp list` formatter (sp-command.ts case 'list', line ~111):**

The existing formatter prints `[symbol] [warmth] [name] [(current)]`. Extend it to add an idle-age column for live entries (coarse format per §3.11):

```
○ cold  t01-triggers
● live  t04-tree            idle 4m
● live  t05-fork-copy       active  (current)
```

The manager's `list()` already returns `lastUsedAt` per `ScratchpadInfo` (verify). The formatter consults `entries.get(name)?.hasActiveCell` for `active` vs `idle Xm/Xh/Xd` distinction. Implementation calls `formatRelativeAge(now - lastUsedAt)` from the new `format-age.ts` module.

**`formatRelativeAge(ageMs: number): string`** in `format-age.ts`:

```ts
export function formatRelativeAge(ageMs: number): string {
  if (ageMs < 30_000) return 'active';
  if (ageMs < 60 * 60_000) return `idle ${Math.floor(ageMs / 60_000)}m`;
  if (ageMs < 24 * 60 * 60_000) return `idle ${Math.floor(ageMs / (60 * 60_000))}h`;
  return `idle ${Math.floor(ageMs / (24 * 60 * 60_000))}d`;
}
```

Same helper produces both `/sp list` output and the workspace-restore notification's relative timestamp.

**`manager.evict(name, opts?)` method (scratchpad-manager.ts):**

```ts
const CELL_CANCEL_TIMEOUT_MS = 5000;

async evict(name: string, opts: { force?: boolean } = {}): Promise<{ interrupted: boolean }> {
  this.assertNotDisposed();
  const entry = this.entries.get(name);
  if (!entry || !entry.runtime) {
    throw new Error(`scratchpad ${name} is not warm (already cold)`);
  }
  let interrupted = false;
  if (entry.runtime.hasActiveCell) {
    if (!opts.force) {
      throw new Error(`cannot evict ${name}: cell is running (use --force to interrupt)`);
    }
    interrupted = true;
    try {
      // Send SIGTERM via the existing cell-cancellation path
      entry.runtime.cancelActiveCell(); // existing 1c2 method (verify name)
      await raceWithTimeout(
        entry.runtime.waitForIdle(), // existing 1c2 method (verify name)
        CELL_CANCEL_TIMEOUT_MS,
        'cell-cancellation-after-SIGTERM',
      );
      await this.snapshotThenDispose(name, entry);
    } catch {
      // Cell didn't ack within 5s — kernel may be wedged. SIGKILL and skip snapshot.
      entry.runtime.kill('SIGKILL');
      this.entries.delete(name);
      // dir/lock/meta/cells.jsonl untouched; next attach gets a cold-restart
    }
    return { interrupted };
  }
  await this.snapshotThenDispose(name, entry);
  return { interrupted: false };
}
```

The `raceWithTimeout` helper from 1g3 is reused. `cancelActiveCell` / `waitForIdle` method names assume existing 1c2 surface — implementer must verify and adjust.

**`case 'evict':` in sp-command.ts:**

```ts
case 'evict': {
  if (!name) { ctx.ui.notify('Usage: /sp evict <name> [--force]', 'error'); return; }
  const force = parts.includes('--force');
  validateName(name);
  try {
    const { interrupted } = await deps.getManager().evict(name, { force });
    const msg = interrupted
      ? `interrupted active cell and evicted ${name}`
      : `evicted ${name} (still on disk; /sp attach ${name} to re-warm)`;
    ctx.ui.notify(msg, 'info');
  } catch (e) {
    ctx.ui.notify((e as Error).message, 'error');
  }
  return;
}
```

### 4.5 `meta.json` initial-write ordering (Task E)

Per locked decision §3.12 — **approach B**: keep the existing `writeMeta` in `attachUnmanaged` for the lock side-effect, add a SECOND `writeMeta` call after `spawnRuntime` succeeds.

Today (`scratchpad-manager.ts`, `attachUnmanaged` body, approximate):

```ts
this.writeMeta(name);       // initial — kernel.db not yet on disk
const runtime = await this.spawnRuntime(name);
// ... wire up, return
```

After 1.5:

```ts
this.writeMeta(name);       // initial — preserves lock side-effect
const runtime = await this.spawnRuntime(name);
this.writeMeta(name);       // refresh — kernel.db is now on disk
// ... wire up, return
```

`writeMeta` is idempotent and cheap (meta.json is < 1KB). The second write uses the 1g3-shipped `writeMetaAtomic`, so it's also crash-safe.

### 4.6 `otto.duckdb.registerDf` helper (Task F)

New helper in `packages/coworker-scratchpad/src/kernel-bindings.ts`:

```ts
export type DuckDBColumnType = string; // SQL type literal: 'VARCHAR', 'DOUBLE', 'BIGINT', 'TIMESTAMP', etc.
export interface RegisterDfOptions {
  schema?: Record<string, DuckDBColumnType> | Array<[string, DuckDBColumnType]>;
}

otto.duckdb.registerDf = async function(
  name: string,
  input: unknown,
  opts: RegisterDfOptions = {},
): Promise<void> {
  const conn = await otto.duckdb.connect();
  const records = coerceToRecords(input); // throws TypeError on unsupported types
  const schema = opts.schema ?? inferSchema(records); // 10-row null-walk inference
  await registerViaAppender(conn, name, records, schema);
};
```

**`coerceToRecords(input)`** — duck-typed dispatch:
- `isPolarsDataFrame(input)` (has `toRecords`, `width`, `height`) → `input.toRecords()`.
- `isArrowTable(input)` (has `numRows`, `schema`) → `input.toArray()`.
- `Array.isArray(input)` → cast to records as-is.
- Else: `throw new TypeError('registerDf: input must be a polars DataFrame, Arrow Table, or array of records')`.

**`inferSchema(records)`** — first-10-rows null-walk:
- Walk up to 10 records; for each column, the inferred type is the first non-null value's type.
- Mapping: `string → VARCHAR`, `number → DOUBLE` (Integer subtype detection deferred), `bigint → BIGINT`, `boolean → BOOLEAN`, `Date → TIMESTAMP`, `null/undefined throughout` → VARCHAR (safest default, never errors at appender).
- Returns `Record<string, DuckDBColumnType>` matching the first record's keys (preserves insertion order, which V8 honors for string keys).

**`registerViaAppender(conn, name, records, schema)`** — module-private:
1. Normalize `schema` to `Array<[string, DuckDBColumnType]>` (preserves column order if user passed array form).
2. `CREATE TABLE <name> (<col TYPE, ...>)`.
3. Open appender, append each row (in column order), close.
4. On appender failure at row N column C, throw:
   ```
   registerDf inferred schema {revenue: DOUBLE, ...} but row 47 contains
   a value 'N/A' for column 'revenue' which isn't a DOUBLE. Pass an explicit
   schema via the third argument: registerDf(name, df, { schema: { revenue: 'VARCHAR' } })
   ```
   When the schema came from `opts.schema` (not inference), the error message omits the "inferred" framing and just reports the row/column/value mismatch.

**promptGuidelines update (cw_scratchpad tool definition, in `src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts`):** append one bullet to the existing list:

> For polars→DuckDB: prefer `otto.duckdb.registerDf(name, df)` over manual API discovery. If inference picks the wrong column type, pass `{ schema: { col: 'TYPE' } }` as the third argument. Falls back to polars' own SQL (`df.sql(...)`) for one-off aggregations.

## 5. File layout

```
packages/coworker-scratchpad/src/
  scratchpad-manager.ts          ← MODIFY: evict(name, opts) method incl. --force
                                            cell-cancellation path (Task D);
                                            CELL_CANCEL_TIMEOUT_MS constant
  scratchpad-manager.test.ts     ← MODIFY: +5 tests (evict happy / refuses-active /
                                            force-interrupts / force-timeout-SIGKILL /
                                            keeps-disk)
  kernel-bindings.ts             ← MODIFY: registerDf helper + coerceToRecords +
                                            inferSchema + registerViaAppender +
                                            RegisterDfOptions type (Task F)
  kernel-bindings.test.ts        ← MODIFY: +5 tests (polars roundtrip / array
                                            roundtrip / bad input throws / opts.schema
                                            override / null-walk inference)

src/resources/extensions/coworker-scratchpad/
  workspace-root.ts              ← NEW: detectWorkspaceRoot (git toplevel + cwd
                                          fallback) (Task A)
  workspace-root.test.ts         ← NEW: +3 tests (git repo / non-git dir / git absent)
  workspace-pointer.ts           ← NEW: hash/path/read/write/freshness (Task A)
  workspace-pointer.test.ts      ← NEW: +4 tests
  session-sidecar.ts             ← MODIFY: filename `sidecar_` prefix +
                                            sweepStaleSidecars + SIDECAR_GC_STALE_DAYS=7
                                            (Task B)
  session-sidecar.test.ts        ← MODIFY: +3 tests for sweep semantics
  format-age.ts                  ← NEW: formatRelativeAge shared by Tasks A + D
  format-age.test.ts             ← NEW: +4 tests (boundary cases — coarse format)
  sp-command.ts                  ← MODIFY: attach existence guard (Task C);
                                            list idle-age formatter +
                                            evict verb with --force flag (Task D);
                                            workspace-pointer writes on attach/new (Task A)
  sp-command.test.ts             ← MODIFY: +7 tests (attach-missing / evict-happy /
                                            evict-active-refused / evict-force-success /
                                            list shows idle / workspace pointer written
                                            on attach / on new)
  index.ts                       ← MODIFY: workspace-pointer restore branch with
                                            sidecar-fallback semantics + sweep call
                                            (Tasks A + B); broken-sidecar cleanup
  index.test.ts (or new init.test.ts) ← +4 tests for restore precedence
                                            (sidecar-wins, fallback-on-missing,
                                            pointer-only, no-restore) + sweep call

src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts
                                 ← MODIFY: promptGuidelines bullet for registerDf
                                            (incl. opts.schema mention) (Task F)
```

No extension manifest changes. No spec-level surface changes beyond §11.4 "1.5 polish" addendum in the parent spec.

## 6. Test plan

Six tasks. TDD per task, one commit each.

| Task | Subject | Test count delta | Est. effort |
|---|---|---|---|
| A | Workspace pointer + git-root detect + restore precedence (Issue #6) | +11 ext (workspace-root +3, workspace-pointer +4, index restore +4) | ~1.25 days |
| B | Sidecar naming + GC (#66, #67) | +3 ext | ~0.5 day |
| C | `/sp attach` existence guard (Issue #5) | +2 ext | ~0.25 day |
| D | Pool visibility + `/sp evict` + --force (Issue #4) | +5 lib, +7 ext (format-age +4, sp-command +3) | ~2 days |
| E | `meta.json` write ordering (Issue #2) | +1 lib | ~0.25 day |
| F | `otto.duckdb.registerDf` helper + opts.schema (Issue #1) | +5 lib | ~1.75 days |
| (gates) | Build + full suite (verification-only) | — | ~0.5 day |

**Total estimate:** ~6.5 engineer-days. Slight overrun on the known-issues doc's "~6 days" estimate (line 484), driven by `--force` (Task D) and `opts.schema` (Task F) — both ride on the rationale that the cell-cancellation plumbing and schema override are high-leverage additions for relatively small marginal cost.

Post-1.5 totals: ext +23 tests (A:11, B:3, C:2, D:7), lib +11 tests (D:5, E:1, F:5). Approximate; exact counts depend on table-driven coverage in `formatRelativeAge` and `inferSchema`.

## 7. Test design notes

### Task A tests

**workspace-root.test.ts (+3):**
1. **Git repo detection** — in a directory inside a git repo, `detectWorkspaceRoot(cwd)` returns the git toplevel.
2. **Non-git directory** — in a tmpdir with no `.git`, returns the cwd unchanged.
3. **Git absent / timeout** — when `git rev-parse` fails or times out (mock execSync), returns cwd. No stderr leak.

**workspace-pointer.test.ts (+4):**
1. **Write + round-trip read** — `writeWorkspacePointer` followed by `readWorkspacePointer` returns equivalent shape.
2. **`isPointerFresh` boundary** — pointer at exactly 7d boundary is fresh; at 7d + 1ms is stale.
3. **Read returns null for corrupt JSON / missing fields** — defends against partial writes.
4. **`workspaceHash` is deterministic + 16-char hex** — same input → same hash; different inputs → different hashes.

**index.test.ts (Tasks A + B restore precedence, +4):**
1. **Sidecar-wins path** — sidecar exists, references extant scratchpad → restore via sidecar; pointer NOT consulted (assert via spy or by writing a pointer to a different scratchpad and verifying sidecar's wins).
2. **Sidecar-fallback path** — sidecar exists but references deleted scratchpad; pointer exists and is fresh → fallback to pointer, sidecar deleted, notification matches `attached to <name> (from workspace, last used <relative>)`.
3. **Pointer-only path** — no sidecar, fresh pointer, scratchpad exists → restore via pointer.
4. **No-restore path** — no sidecar, no pointer (or pointer is stale, or scratchpad gone) → silent fresh launch.

### Task B tests

1. **Sweep deletes orphan with missing scratchpad** — sidecar references `t-gone`, scratchpad dir doesn't exist → file deleted.
2. **Sweep deletes old foreign-session sidecar** — sidecar with different `session_id` and mtime > 14d → deleted.
3. **Sweep skips current session's sidecar regardless of age** — even if backdated, the current session's file is never deleted.
4. **(implicit)** sweep skips files not matching `sidecar_` prefix — already covered by the early `continue`; add only if grep reveals any test bringing in non-sidecar fixtures.

### Task C tests

1. **`/sp attach <missing>` errors** — no dir created, no kernel spawned, helpful message includes `Use /sp new <name>`.
2. **`/sp attach <existing>` still works** — `/sp new foo` then `/sp attach foo` succeeds (regression guard).

### Task D tests

**Library (scratchpad-manager.test.ts, +5):**
1. **`evict(name)` snapshots + disposes** — warm entry, no active cell → after evict, runtime is gone, kernel.db still on disk, dir/lock/meta/cells.jsonl intact.
2. **`evict(name)` refuses when active cell is running** — throws with `cannot evict … cell is running (use --force to interrupt)`.
3. **`evict(name)` on cold entry throws** — `not warm (already cold)`.
4. **`evict(name, { force: true })` interrupts active cell + snapshots** — stub a runtime with `hasActiveCell: true` whose `cancelActiveCell()` causes `waitForIdle` to resolve within timeout → returns `{ interrupted: true }`, snapshot fires, runtime disposed.
5. **`evict(name, { force: true })` SIGKILLs on cancellation timeout** — stub a runtime where `waitForIdle` never resolves → after 5s, SIGKILL fires, `entries.delete(name)` called, NO snapshot attempted, dir untouched.

**Extension format-age (format-age.test.ts, +4):**
1. **`formatRelativeAge` boundaries (coarse format)** — 0ms → `active`, 29_999ms → `active`, 30_000ms → `idle 0m`, 59_999ms → `idle 0m`, 60_000ms → `idle 1m`.
2. **Minute band** — 30 * 60_000 → `idle 30m`, 59 * 60_000 → `idle 59m`.
3. **Hour band** — 60 * 60_000 → `idle 1h`, 23 * 60 * 60_000 → `idle 23h`.
4. **Day band** — 24 * 60 * 60_000 → `idle 1d`, 7 * 24 * 60 * 60_000 → `idle 7d`.

**Extension sp-command (sp-command.test.ts for Task D, +3):**
1. **`/sp list` shows `active` for recently-attached entry** + `idle Xm` for an entry whose `lastUsedAt` is mocked to 4 min ago.
2. **`/sp evict <name>` happy path** — verify notification `evicted <name> (still on disk; /sp attach <name> to re-warm)` + flip to `○ cold` on next list.
3. **`/sp evict <name> --force` happy path** — with stubbed active cell, verify notification `interrupted active cell and evicted <name>`.

### Task E tests

1. **Meta after `/sp new` reflects post-spawn state** — after `/sp new tNN`, immediately read `meta.json`; `kernel_db.present === true`, `size_bytes > 0`. Existing meta tests should continue to pass.

### Task F tests

1. **polars DataFrame roundtrip** — load CSV → polars → `registerDf('sales', df)` → `runAndReadAll('SELECT SUM(revenue) FROM sales')` returns expected sum. End-to-end via the kernel.
2. **Array-of-records roundtrip** — pass `[{a: 1}, {a: 2}]` → register → query.
3. **Bad input throws** — `registerDf('x', 42)` → `TypeError` with the listed accepted types.
4. **`opts.schema` override** — pass records `[{units: 1}, {units: 2}]` with `{ schema: { units: 'BIGINT' } }` → table created with BIGINT (verify via DuckDB `DESCRIBE`), no inference runs.
5. **Null-walk inference** — records where the first 8 rows have `revenue: null` and row 9 has `revenue: 1200` → inferred schema picks DOUBLE for `revenue`, not VARCHAR. Records with ALL nulls for a column → infers VARCHAR (safe default).

Scenario 3 of `2026-06-01-coworker-phase-1-human-tests.md` should reduce from 8 cells to 2 after this lands; re-run it as part of human-test re-validation post-1.5.

## 8. Error handling

| Scenario | Where | Result |
|---|---|---|
| Workspace pointer file corrupt | `readWorkspacePointer` | Returns null; init treats as no pointer; user sees no restore (silent) |
| Workspace pointer write fails (disk full) | `writeWorkspacePointer` rename | Caller's try/catch; .tmp may leak; next attach overwrites. Attach itself does NOT fail. |
| Sweep encounters unreadable file | per-file try/catch | Skipped; sweep continues |
| `/sp evict` while another process holds the lock | shouldn't happen (manager owns the entry) | If it does: `snapshotThenDispose` raises; user sees the underlying error |
| `/sp evict --force` and cell doesn't ack SIGTERM within 5s | scratchpad-manager.evict | SIGKILL on runtime, `entries.delete(name)`, NO snapshot. Caller still gets `{ interrupted: true }`; on-disk state preserved (next attach is cold-restart from journal). |
| `registerDf` with empty array | `inferSchema` | Throws `cannot infer schema from empty input`; user passes at least one row OR `opts.schema`. |
| `registerDf` with mixed-type column | appender fails on row N | Throws with row index + column name + (when inferred) usage hint for `opts.schema` override. |
| `registerDf` table name collision | `CREATE TABLE` fails | DuckDB's standard `Table already exists` error propagates. No `opts.replace` in 1.5. |
| `detectWorkspaceRoot` git rev-parse exceeds 500ms | execSync timeout | Falls through to cwd; no stderr leak; no user-visible delay beyond the 500ms cap. |
| `detectWorkspaceRoot` git binary missing | execSync ENOENT | Same as above — falls through to cwd. |

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Workspace pointer collides across cloud-synced machines | Accepted (out-of-scope); workspace hash is path-based, not machine-based. If users hit it, file follow-up. |
| 2 | Workspace pointer race when two sessions in same workspace attach simultaneously | `writeMetaAtomic`-style write (tmp + rename) makes the last writer win cleanly. Pointer's `last_session_id` resolves "which session wrote me last." Both sessions' subsequent reads see a consistent file. |
| 3 | Sidecar naming change breaks anyone reading filenames directly | Survey shows only `sessionSidecarPath` consumes the format. External scripts that grep `_sessions/` will need to adapt — documented in 1.5 release notes. |
| 4 | `/sp evict` while a cell is queued (not running) | `hasActiveCell` already discriminates running from queued. Document behavior in evict docstring. |
| 5 | `registerDf` schema inference produces wrong type for polars columns with nulls in row 0 | Walk first 10 rows for type inference, not just row 0. Documented limitation: > 10 rows of leading nulls degrades to VARCHAR. |
| 6 | Issue #2 second `writeMeta` adds a perceptible latency to `/sp new` | meta.json is < 1KB; second write costs sub-millisecond. No user-visible change. |
| 7 | Workspace-pointer restore notification annoys users who attach explicitly | Notification only fires on the fallback path (no sidecar). If user types `/sp attach <other>` after restore, no second notification. |
| 8 | `formatRelativeAge` boundary inconsistencies (29s vs 30s edge) | Tests pin every boundary; constants in the formatter, not magic literals. |

## 10. Out-of-scope deferred items

- **Issue #3 — LLM "ask if unsure" reliability.** Inherent LLM behavior; revisit in Phase 6 (NOC persona polish).
- **Otto-core `SessionManager` change** to preserve sessionId across `--resume`. Workspace pointer covers the canonical UX; sessionId-preservation is a separate, larger investigation.
- **`/sp continue` / `-c` shortcut.** Workspace pointer makes the explicit `--resume` flow non-mandatory for the headline workflow; nice-to-have for power users.
- **Cross-machine workspace pointer disambiguation.** Cloud-sync collisions are an accepted risk; revisit if it bites a user.
- **Configurable thresholds.** `WORKSPACE_POINTER_STALE_MS`, `SIDECAR_GC_STALE_DAYS`, and `CELL_CANCEL_TIMEOUT_MS` are module constants; promote to settings if a real workload needs tuning.
- **`registerDf(opts.replace)`** — table-name collision still throws DuckDB's standard error; users drop the table explicitly with `c.run('DROP TABLE IF EXISTS x')` before re-registering.
- **`registerDf` integer-subtype inference** — all numbers default to DOUBLE; users wanting INTEGER/BIGINT pass `opts.schema` explicitly.
- **Phase 2+ items unchanged:** otto-vault, otto-memory, branch-summary cells, TUI overlay, vegalite/PNG renderers, artifact:// spill, sql.js fallback.

---

## 11. Next step

Invoke `superpowers:writing-plans` to expand this spec into a task-by-task plan at `docs/superpowers/plans/2026-06-01-coworker-phase-1.5-polish.md`. Implementation follows the existing per-task /clear + atomic-commit pattern from 1g/1g2/1g3.

After 1.5 merges:
1. Re-run all 16 Phase 1 human-test scenarios; expect scenario 3 (polars→DuckDB) to drop from 8 cells to 2; expect scenario 9 (day-2 attach) to succeed without `--resume`; expect scenario 16 (cleanup) to leave only the current session's sidecar.
2. Close GH issues #66, #67 + (filed-or-doc-only) Issues 1, 2, 4, 5, 6 from `2026-06-01-coworker-phase-1-known-issues.md`.
3. Green-light Phase 2 (otto-vault) kickoff.
