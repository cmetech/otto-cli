# Otto Co-Worker Phase 1g — Session Affinity + Scratchpad Ops Polish Design

**Status:** Approved (brainstorm 2026-06-01)
**Date:** 2026-06-01
**Author:** brainstorm session with Corey
**Phase:** 1g — first of the three-way split of the original "1g polish" backlog (1g session affinity + scratchpad ops, 1g2 on-attach UX, 1g3 library correctness)
**Branch:** `feat/coworker-phase-0` (continues accumulating until 1g3 closes Phase 1)
**Parent spec:** `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §2.4 (`/sp save`, `/sp detach`, `/sp remove`, `/sp clear-history`), §3.1 (attached_sessions semantics), §5 (TUI banner UX).
**Prior plan:** `docs/superpowers/plans/2026-05-31-coworker-phase-1f-cell-tree-fork.md` (1f, completed).

---

## 1. Goal

Finish the deferred session-affinity + scratchpad-ops polish in the `/sp` surface so a NOC analyst gets coherent end-to-end behavior across attach/detach/save/clear-history cycles, AND so attachment survives `/resume` rather than dissolving at session_shutdown.

After 1g:

- `/sp save` is an explicit, no-dispose checkpoint that flushes namespace.json and updates the snapshot pointer in meta.
- `/sp detach` cleanly leaves a scratchpad without disposing the kernel — the pool's LRU/idle eviction owns cleanup.
- `/sp clear-history` truncates the cell journal with a confirm prompt and an active-cell gate; kernel.db + namespace.json are preserved.
- `/sp remove` confirms before removing the current scratchpad (the 1e plan missed this from spec §5); `--yes` skips.
- `currentName` persists in a per-session sidecar so `/resume` restores the user's attached scratchpad. Restore is affinity-only (no kernel pre-warm).

## 2. Scope

**In scope (1g):**
- `CellArchive.reset()` — truncates the file to schema header and resets `#lastId` + `#leafId`.
- `ScratchpadManager.save(name)`, `.clearHistory(name)`, `.detach(name, sessionId)` — three new manager methods on the existing persistence funnel.
- New extension module `session-sidecar.ts` with `readSessionSidecar`, `writeSessionSidecar` (atomic rename), `deleteSessionSidecar`, `sessionSidecarPath`.
- Extension verbs: `/sp save`, `/sp detach`, `/sp clear-history`. `/sp remove` gains a confirm-on-current branch and a `--yes` flag.
- Sidecar wiring: `/sp attach` and `/sp new` write the sidecar; `/sp detach` and `/sp remove`-of-current delete it; `session_start` reads it and restores `currentName`.
- No schema bump. meta.json stays at v3 (the 1f bump).

**Out of scope (deferred to 1g2 / 1g3 / later):**
- Recovery-notes banner on attach — 1g2.
- `--force-takeover` interactive prompt + reason capture — 1g2.
- Kernel-state divergence banner (`meta.kernel_at_cell_id`) — 1g2.
- `fork`'s `rawChild.once('exit')` 5–10s timeout + SIGKILL fallback — 1g3.
- `size_bytes` post-write recompute (and exclusion of lock.json/meta.json) — 1g3.
- Atomic-rename for namespace.json — 1g3. (1g previews the pattern via the session sidecar.)
- `_sessions/` GC sweep (mtime > 30 days) — Phase 2+.
- TUI overlay for `/sp tree`, branch-summary cells, scratchpad-tool install/dump/reset/remove, vegalite/PNG renderers, artifact:// output spill, sql.js fallback — Phase 2+.

## 3. Locked decisions (brainstorm 2026-06-01)

1. **3-way decomposition.** The 11-item polish backlog splits into 1g (items 1, 2, 3, 4, 11 — session affinity + scratchpad ops), 1g2 (items 5, 6, 7 — on-attach UX), 1g3 (items 8, 9, 10 — library hardening). Each ships independently on `feat/coworker-phase-0`.
2. **`/sp save` is snapshot-only, no dispose, no mid-runCell meta updates.** `last_snapshot_cell_id` strictly means "namespace was serialized at cell N." `runCell` does NOT touch this field. Active-cell gate produces a `snapshot-failed: active cell` recovery note plus an error notify. Cold scratchpad produces an error notify ("not warm — nothing to save"), not a silent no-op.
3. **`/sp clear-history` confirms + gates on active cell + resets pointers.** Confirms via `ctx.ui.confirm`. Refuses with active cell. Truncates `cells.jsonl` to schema-header line. Resets archive `#lastId` + `#leafId` to `null`. Writes meta with `cell_leaf_id`, `last_snapshot_cell_id`, `last_snapshot_at` all `null` (cell-id space restarted; old pointers would dangle). Preserves kernel.db + namespace.json — in-VM globals survive.
4. **`/sp detach` is current-only, no kernel dispose.** No argument. Operates on `currentName`. Removes `this.sessionId` from `meta.attached_sessions[]` (first occurrence; tolerates duplicates from any future race). Writes meta. Deletes the session sidecar. Clears `currentName`. The runtime is NOT touched — pool LRU/idle eviction handles kernel cleanup organically.
5. **`/sp remove` confirms when target == `currentName`, skippable via `--yes`.** `--force` is reserved for 1c2's takeover semantic on `/sp attach`. Non-current remove is unchanged from 1e (no prompt).
6. **Per-session `currentName` persistence via sidecar at `<root>/_sessions/<sessionId>.json`.** Atomic-rename writes. Written on `/sp attach` + `/sp new`. Deleted on `/sp detach` and `/sp remove`-of-current. Read on `session_start`. Survives `session_shutdown` so `/resume` restores. Restore is affinity-only — kernel is NOT pre-warmed on startup; the next `/sp exec` warms via the normal `getOrAttach` path.
7. **Atomic rename pattern preview.** Sidecar writes use `writeFileSync(path.tmp)` → `renameSync(path.tmp, path)`. This is a deliberate preview of the broader 1g3 atomic-rename work for `namespace.json`.
8. **No schema bump.** All persisted state lives outside meta.json. The sidecar carries its own `schema_version: 1`.

## 4. Architecture

### 4.1 `CellArchive.reset()` — file truncation + pointer reset

Add a single method to `packages/coworker-scratchpad/src/cell-archive.ts`:

```ts
import { writeFileSync } from 'node:fs';

export class CellArchive {
  // ... existing ...

  reset(): void {
    // Re-emit just the schema header line; identical to ensureHeader on a fresh file.
    writeFileSync(this.path, JSON.stringify(this.header()) + '\n');
    this.#lastId = null;
    this.#leafId = null;
  }
}
```

`header()` is the existing private that builds `{ kind: 'cells.jsonl', schema_version: SCHEMA_VERSION, created_at: ... }`. `reset` overwrites — does NOT append. Subsequent `append` calls work normally (next id is 1, parentId is `null`).

### 4.2 `ScratchpadManager` — three new methods

All three live in `packages/coworker-scratchpad/src/scratchpad-manager.ts` alongside the existing `getOrAttach`/`runCell`/`snapshotThenDispose`/`remove`. They share the same `validateName` + `metaPath` helpers.

#### 4.2a `save(name): Promise<void>`

```
1. validateName(name)
2. entry = this.entries.get(name)
3. if !entry || !entry.runtime:
     throw new Error(`scratchpad ${name} is not warm — nothing to save`)
4. if entry.runtime.hasActiveCell:
     this.appendRecoveryNote(name, {
       kind: 'snapshot-failed',
       reason: 'active cell',
       at: this.now().toISOString(),
     })
     throw new Error('cannot save while a cell is running')
5. await entry.runtime.snapshot()        // 1d2 path; kernel writes namespace.json
6. const lastId = entry.archive.lastId
   this.writeMeta(name, {
     last_snapshot_cell_id: lastId,
     last_snapshot_at: this.now().toISOString(),
   })
   // writeMeta merges these with the prevExtras preservation loop;
   // schema_version stays 3.
```

`writeMeta` is extended to accept an optional partial-overrides argument so save can set both fields atomically without a read-modify-write race. If that overload doesn't already exist, add it as part of this task — it's a small parameter addition.

#### 4.2b `clearHistory(name): Promise<void>`

```
1. validateName(name)
2. entry = this.entries.get(name)
3. if entry?.runtime?.hasActiveCell:
     throw new Error('cannot clear history while a cell is running')
4. if entry?.archive:
     entry.archive.reset()              // truncate + reset pointers in-memory
   else:
     // cold — touch disk directly
     const archive = new CellArchive(this.dirFor(name), this.now)
     archive.reset()                    // writes header + leaves both ids null
5. this.writeMeta(name, {
     cell_leaf_id: null,
     last_snapshot_cell_id: null,
     last_snapshot_at: null,
   })
```

The cold-path constructs a temporary `CellArchive` solely to reuse the truncation logic. It's not added to `this.entries`. After `reset()`, the next `getOrAttach(name)` constructs a fresh archive that scans the (now header-only) file and sees `lastId = null`, `leafId = null`. Identical state.

#### 4.2c `detach(name, sessionId): Promise<void>`

```
1. validateName(name)
2. read meta.json from disk
3. const arr = meta.attached_sessions ?? []
   const idx = arr.indexOf(sessionId)
   const next = idx < 0
     ? arr
     : [...arr.slice(0, idx), ...arr.slice(idx + 1)]
4. this.writeMeta(name, { attached_sessions: next })
   // runtime untouched. No archive interaction.
```

Tolerates "not in the list" silently — the user-visible action (clearing `currentName` + sidecar) still proceeds. The extension handles `currentName === null` separately by erroring before calling detach.

### 4.3 Extension `session-sidecar.ts` — new module

Lives at `src/resources/extensions/coworker-scratchpad/session-sidecar.ts`. Four exports.

```ts
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface SessionSidecar {
  schema_version: 1;
  session_id: string;
  current_name: string;
  attached_at: string;
}

export function sessionSidecarPath(rootDir: string, sessionId: string): string {
  return join(rootDir, '_sessions', `${sessionId}.json`);
}

export function readSessionSidecar(path: string): SessionSidecar | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SessionSidecar>;
    if (
      parsed.schema_version === 1 &&
      typeof parsed.session_id === 'string' &&
      typeof parsed.current_name === 'string' &&
      typeof parsed.attached_at === 'string'
    ) {
      return parsed as SessionSidecar;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSessionSidecar(path: string, payload: SessionSidecar): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, path);
}

export function deleteSessionSidecar(path: string): void {
  rmSync(path, { force: true });
}
```

Pure helpers. No coupling to `ScratchpadManager`. The `_sessions/` directory is created lazily on first write.

### 4.4 Extension `sp-command.ts` — three new verbs + remove confirm

Add `'save'`, `'detach'`, `'clear-history'` to `VERBS`. Extend the switch with three new cases. Modify the existing `'remove'` case.

```ts
case 'save': {
  const target = (parts[1] as string | undefined) ?? deps.getCurrentName();
  if (!target) {
    ctx.ui.notify('Usage: /sp save [<name>] (no current scratchpad)', 'error');
    return;
  }
  validateName(target);
  try {
    await deps.getManager().save(target);
    // archive.lastId is read inside save; just confirm to the user.
    ctx.ui.notify(`saved ${target}`, 'info');
  } catch (e) {
    ctx.ui.notify((e as Error).message, 'error');
  }
  return;
}

case 'detach': {
  const target = deps.getCurrentName();
  if (!target) {
    ctx.ui.notify('not attached to any scratchpad', 'error');
    return;
  }
  try {
    await deps.getManager().detach(target, deps.getSessionId());
    deleteSessionSidecar(sessionSidecarPath(deps.rootDir(), deps.getSessionId()));
    deps.setCurrentName(null);
    ctx.ui.notify(`detached from ${target}`, 'info');
  } catch (e) {
    ctx.ui.notify((e as Error).message, 'error');
  }
  return;
}

case 'clear-history': {
  const target = (parts[1] as string | undefined) ?? deps.getCurrentName();
  if (!target) {
    ctx.ui.notify('Usage: /sp clear-history [<name>] (no current scratchpad)', 'error');
    return;
  }
  validateName(target);
  const confirmed = await ctx.ui.confirm(
    'Clear cell history?',
    `Clear cell history for ${target}? kernel.db + namespace.json are preserved.`,
  );
  if (!confirmed) {
    ctx.ui.notify('cancelled', 'info');
    return;
  }
  try {
    await deps.getManager().clearHistory(target);
    ctx.ui.notify(`cleared cell history for ${target}`, 'info');
  } catch (e) {
    ctx.ui.notify((e as Error).message, 'error');
  }
  return;
}

case 'remove': {
  if (parts.length < 2) {
    ctx.ui.notify('Usage: /sp remove <name> [--yes]', 'error');
    return;
  }
  const name = parts[1] as string;
  const force = parts.includes('--yes');
  validateName(name);
  if (name === deps.getCurrentName() && !force) {
    const confirmed = await ctx.ui.confirm(
      'Remove current scratchpad?',
      `${name} is your current scratchpad. Remove it? This deletes kernel.db, namespace.json, and the cell journal.`,
    );
    if (!confirmed) {
      ctx.ui.notify('cancelled', 'info');
      return;
    }
  }
  try {
    await deps.getManager().remove(name);
    if (name === deps.getCurrentName()) {
      deleteSessionSidecar(sessionSidecarPath(deps.rootDir(), deps.getSessionId()));
      deps.setCurrentName(null);
    }
    ctx.ui.notify(`removed ${name}`, 'info');
  } catch (e) {
    ctx.ui.notify((e as Error).message, 'error');
  }
  return;
}
```

**Deps surface (`SpCommandDeps`):** the existing `getManager`, `getCurrentName`, `setCurrentName`, `rootDir` gain one peer: `getSessionId(): string`. `index.ts` already tracks `sessionId` in a closure — passing the accessor through is one new field.

**Argument completion:** add `'save'`, `'detach'`, `'clear-history'` to the verb-list array. No new name-completion for `detach` (no argument). `save` and `clear-history` complete on existing scratchpad names like `attach`/`view`/`remove`.

### 4.5 Extension `index.ts` — session restore + sidecar writes on attach/new

Three changes:

1. `session_start` becomes async-restore-aware:

```ts
pi.on('session_start', async (_event, ctx) => {
  workspaceCwd = ctx.cwd;
  sessionId = deriveSessionId(ctx);

  const sidecarPath = sessionSidecarPath(root, sessionId);
  const sidecar = readSessionSidecar(sidecarPath);
  if (!sidecar) return;

  const target = sidecar.current_name;
  const targetMeta = join(root, target, 'meta.json');
  if (!existsSync(targetMeta)) {
    deleteSessionSidecar(sidecarPath);
    ctx.ui.notify(`previous scratchpad '${target}' is gone; not restored`, 'info');
    return;
  }
  currentName = target;
  ctx.ui.notify(`attached to ${target} (restored)`, 'info');
});
```

2. The deps object passed to `registerSpCommand` and `registerScratchpadTool` gains a `getSessionId()` accessor returning `sessionId ?? 'default'`.

3. `/sp attach` and `/sp new` handlers (inside `sp-command.ts`'s existing 1e cases) gain one new line each after the existing `deps.setCurrentName(name)` call:

```ts
writeSessionSidecar(
  sessionSidecarPath(deps.rootDir(), deps.getSessionId()),
  { schema_version: 1, session_id: deps.getSessionId(), current_name: name, attached_at: new Date().toISOString() },
);
```

The wiring lives in `sp-command.ts`, NOT `index.ts` — `index.ts` only owns session lifecycle.

### 4.6 Sidecar payload schema (v1)

```jsonc
{
  "schema_version": 1,
  "session_id": "session-1748734200",
  "current_name": "p1-1234",
  "attached_at": "2026-06-01T10:30:00.000Z"
}
```

Validated structurally on read (§4.3). Unknown extra fields are tolerated (forward compat). Missing required fields → `readSessionSidecar` returns `null` (treated as "no prior attachment").

## 5. Slash command surface (summary)

| Verb | Args | Confirms? | Active-cell gate? | Side effects |
|---|---|---|---|---|
| `/sp save` | `[<name>]` (defaults to current) | no | yes (error) | runtime.snapshot + meta write |
| `/sp detach` | — | no | no | meta write + sidecar delete + currentName=null |
| `/sp clear-history` | `[<name>]` (defaults to current) | yes | yes (error) | cells.jsonl truncate + archive reset + meta write |
| `/sp remove` | `<name> [--yes]` | yes if name==current | no | manager.remove + (if current) sidecar delete + currentName=null |
| `/sp attach` (existing) | `<name>` | n/a | n/a | + sidecar write |
| `/sp new` (existing) | `[<name>]` | n/a | n/a | + sidecar write |

## 6. Error handling

| Scenario | Where | Result |
|---|---|---|
| `/sp save` on cold scratchpad | manager.save step 3 | error notify "scratchpad <name> is not warm — nothing to save" |
| `/sp save` while active cell running | manager.save step 4 | recovery note appended + error notify |
| `/sp save` with no current and no arg | sp-command save case | usage error |
| `/sp detach` with no current | sp-command detach case | error notify "not attached to any scratchpad" |
| `/sp detach` when sessionId not in attached_sessions | manager.detach silently | proceeds; sidecar still deleted; currentName still cleared |
| `/sp clear-history` while active cell | manager.clearHistory step 3 | error notify |
| `/sp clear-history` declined at prompt | sp-command clear-history case | info notify "cancelled" |
| `/sp remove` of current declined at prompt | sp-command remove case | info notify "cancelled"; nothing removed |
| `/sp remove` of current with `--yes` | sp-command remove case | skip prompt; remove + sidecar cleanup |
| Sidecar JSON corrupt during restore | readSessionSidecar try/catch | returns null; session starts unattached; sidecar untouched (next write replaces) |
| Restore points to a deleted scratchpad | session_start restore | sidecar deleted; info notify; unattached |
| Sidecar write fails mid-rename | writeSessionSidecar | renameSync throws; caller catches; user-visible error notify; old sidecar (if any) intact (atomic-rename invariant) |
| Two sessions concurrent `/sp clear-history` of same name | last-write-wins | acceptable; both write identical state |

## 7. File layout

```
packages/coworker-scratchpad/src/
  cell-archive.ts                ← MODIFY: add reset()
  cell-archive.test.ts           ← MODIFY: +2 tests (reset on populated + reset on empty)
  scratchpad-manager.ts          ← MODIFY: save() + clearHistory() + detach() + writeMeta partial-overrides
  scratchpad-manager.test.ts     ← MODIFY: +6 tests (2 per new method)

src/resources/extensions/coworker-scratchpad/
  session-sidecar.ts             ← NEW: read/write/delete + path helper
  session-sidecar.test.ts        ← NEW: ~5 tests
  sp-command.ts                  ← MODIFY: save + detach + clear-history verbs;
                                            remove confirm-on-current + --yes;
                                            attach/new sidecar writes;
                                            getSessionId() in deps
  sp-command.test.ts             ← MODIFY: +8 tests
  index.ts                       ← MODIFY: session_start restore;
                                            getSessionId() accessor wired into deps
  index.test.ts                  ← MODIFY: +3 tests (restore/missing/no-sidecar)
  helpers.ts                     ← unchanged
```

## 8. Test plan

Five tasks. Each is TDD-per-task with one commit.

| Task | Subject | Test count delta |
|---|---|---|
| 1 | `CellArchive.reset()` + `ScratchpadManager.clearHistory()` | lib +4 (2 archive + 2 mgr) |
| 2 | `ScratchpadManager.save()` + `.detach()` | lib +4 (2 each) |
| 3 | `session-sidecar.ts` — atomic write + read + delete + path | ext +5 |
| 4 | Extension wiring — sp-command save/detach/clear-history + remove confirm + sidecar writes on attach/new | ext +8 |
| 5 | Extension restore — index.ts session_start sidecar restore + build + gates | ext +3 |

**Post-1g totals:** library 132 → ~140 tests; extension 40 → ~56 tests.

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Two sessions hit `/sp clear-history <same-name>` concurrently | scratchpad-lock doesn't cover cold-mode writes. Last-write-wins on truncate is acceptable; both operations write identical state. |
| 2 | Sidecar restore wins a race with `/sp attach` in the new session | `session_start` awaits `restoreCurrentName` synchronously; `/sp attach` can't fire until the handler returns. Not a real race. |
| 3 | Sidecar persisted, but scratchpad was force-takeover-attached by another session | Restore is affinity-only; doesn't acquire a lock. The next `/sp exec` triggers normal `getOrAttach` which goes through the lock path and emits `ScratchpadBusyError` if needed. |
| 4 | `_sessions/` filling up over months | Acknowledged + deferred to Phase 2+. Tiny files (~150 bytes). GC sweep is a future phase. |
| 5 | `/sp save` invoked while DuckDB is still flushing WAL | `runtime.snapshot()` already serializes through the NDJSON kernel loop; the kernel doesn't ACK snapshot until the cell's effects are visible. Existing 1d2 invariant. |
| 6 | A v2 meta on disk that 1g code loads | All `writeMeta` paths since 1f write `cell_leaf_id`. 1g doesn't bump schema. Still v3. |
| 7 | `_sessions/` name collides with a scratchpad named `_sessions` | `validateName` requires `[a-zA-Z0-9-]+` (no leading underscore). Collision impossible. |
| 8 | Sidecar write succeeds but session crashes before user types `/sp exec` | Sidecar restore on next session works correctly; affinity is the only restored state. No half-state to recover. |
| 9 | `scratchpad-manager.ts` line count grows past 500 | Acknowledged; tagged in memory for post-Phase-1 split refactor. Not addressed in 1g. |

## 10. Out-of-scope deferred items

- **1g2:** recovery-notes banner on attach; `--force-takeover` interactive prompt + reason capture; kernel-state divergence banner (`meta.kernel_at_cell_id`).
- **1g3:** fork's `rawChild.once('exit')` timeout + SIGKILL fallback; `size_bytes` post-write recompute (exclude lock.json/meta.json); broader atomic-rename for namespace.json.
- **Phase 2+:** TUI overlay for `/sp tree` interactive navigation; branch-summary entries in cells.jsonl on subtree abandon; scratchpad-tool actions reset/remove/dump/install; vegalite/PNG renderers; `artifact://` output spill; sql.js fallback engine; `_sessions/` GC sweep.

---

**Next step:** invoke `superpowers:writing-plans` to expand this spec into a task-by-task plan at `docs/superpowers/plans/2026-06-01-coworker-phase-1g-session-affinity.md`.
