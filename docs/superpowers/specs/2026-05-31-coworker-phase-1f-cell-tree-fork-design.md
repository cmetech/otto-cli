# Otto Co-Worker Phase 1f — Cell Tree Projection + `/sp tree` + `/sp fork` Design

**Status:** Approved (brainstorm 2026-05-31)
**Date:** 2026-05-31
**Author:** brainstorm session with Corey
**Phase:** 1f — second of the three-way split of the original 1e (1e wire-up complete, 1f tree/fork, 1g polish)
**Branch:** `feat/coworker-phase-0` (continues accumulating until 1g closes Phase 1)
**Parent spec:** `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §2.4 (`/sp tree`, `/sp fork`), §3.1 (cell-tree as runtime projection; branching = leaf-pointer move).
**Prior plan:** `docs/superpowers/plans/2026-05-31-coworker-phase-1e-extension-tool-mime.md` (1e, completed).

---

## 1. Goal

Close the Phase 1 milestone — make `/sp tree` and `/sp fork` work. After 1f:

- A NOC analyst can run `/sp tree` to see the cell history as an indented text tree with the current leaf marked.
- `/sp tree --to <id>` moves the leaf pointer to an earlier cell; the next cell will branch from there.
- `/sp fork <src> <dst>` copies the source scratchpad's persistent state (kernel.db + namespace.json + cells.jsonl) into a new named scratchpad, with the dst inheriting the src's leaf so it starts from the same navigation position.
- All of this is durable: leaf-pointer state survives across Otto restarts via `meta.cell_leaf_id`.

## 2. Scope

**In scope (1f):**
- New `cell-tree.ts` pure module in `@otto/coworker-scratchpad` — `projectTree`, `findLeaves`, `validateLeafId`, `formatTreeText`.
- `CellArchive` learns a `#leafId` distinct from `#lastId`; new `setLeaf(id)` + `leafId` getter; `append` chains `parentId` from `#leafId`.
- `ScratchpadManager` gains `setLeaf(name, id)` and `fork(srcName, dstName)`; `getOrAttach`/`attachUnmanaged` restore `cell_leaf_id` from meta after spawn; `writeMeta` preserves `cell_leaf_id` and pulls live archive's `leafId` into it.
- `meta.json` schema v2 → v3 with one new optional field: `cell_leaf_id?: number | null`.
- Extension `sp-command.ts` gains `tree` and `fork` verbs.
- `helpers.ts` gains `readPersistedLeaf(metaPath)`.

**Out of scope (deferred to 1g or later):**
- TUI overlay for interactive `/sp tree` navigation — 1g.
- Branch-summary entries in cells.jsonl on subtree abandon — 1g (deferred from parent spec §3.1).
- `meta.kernel_at_cell_id` tracking + kernel-state divergence banner on attach — 1g.
- `/sp save` (explicit snapshot trigger) — 1g.
- `/sp detach`, `/sp clear-history`, `/sp remove` confirm prompt for current scratchpad — 1g.
- Recovery-notes banner on attach — 1g.
- `--force-takeover` interactive prompt — 1g.
- `size_bytes` post-write recompute (1d follow-up) — 1g.
- Atomic-rename pattern for namespace.json writes — 1g+ or later.
- Cross-DuckDB-version fork compatibility — out of scope (DuckDB's on-disk format owns this).

## 3. Locked decisions (brainstorm 2026-05-31)

1. **Milestone-minimum CLI-style `/sp tree`.** Default action prints the tree as indented text with the current leaf marked `*`. `/sp tree --to <id>` sets the leaf. No interactive TUI overlay in 1f.
2. **`/sp fork` auto-evicts src; dst inherits state and leaf.** If src is warm, manager calls `snapshotThenDispose(src, …)` (1d2 path) to flush kernel.db + namespace.json. If src has an active cell, eviction skips the snapshot (1d2 `hasActiveCell` short-circuit) and proceeds against the slightly-stale on-disk state, with the existing snapshot-failed recovery note written to src's meta. Dst inherits `cell_leaf_id`, `last_snapshot_cell_id`, `last_snapshot_at` from src's meta; gets fresh `created_at`, `attached_sessions=[currentSession]`, `recovery_notes=[]`, `namespace_skipped=[]`.
3. **Leaf pointer lives in `meta.json`** as `cell_leaf_id?: number | null`. Schema bumps v2 → v3. Preserved across the existing v2 fields. Backward-compat: a v2 meta on disk is loaded as `cell_leaf_id = null`, which is treated as "leaf == file-max" (matches 1d/1d2 behavior).
4. **`CellArchive` splits `#lastId` and `#leafId`.** `#lastId` is "the highest id ever written" (monotonic id assignment). `#leafId` is "the id the next append chains from." They diverge only after `setLeaf(id)` is called. On `append`, the new id is `#lastId + 1`, the `parentId` is `#leafId`, and both update to the new id afterwards. Linear-chain (no `/sp tree` ever) behavior is identical to 1d.

## 4. Architecture

### 4.1 `cell-tree.ts` — pure module

Lives in `packages/coworker-scratchpad/src/cell-tree.ts`. No `node:fs` or kernel coupling.

```ts
import type { CellEntry } from './cell-archive.js';

export interface TreeNode {
  cell: CellEntry;
  children: TreeNode[];
}

export interface CellTree {
  root: TreeNode | null;
  byId: Map<number, TreeNode>;
  orphans: TreeNode[];        // parentId points to a non-existent id (defensive)
}

export function projectTree(cells: CellEntry[]): CellTree;
export function findLeaves(tree: CellTree): TreeNode[];   // cells with no children
export function validateLeafId(tree: CellTree, id: number): void;   // throws if missing
export function formatTreeText(tree: CellTree, currentLeaf?: number | null): string;
```

**`projectTree` algorithm:**
1. Build `byId: Map<number, TreeNode>` — one pass, each cell becomes a `TreeNode { cell, children: [] }`.
2. Walk cells again: each cell with `parentId !== null` is appended to its parent's `children` if the parent is in `byId`; otherwise pushed to `orphans`.
3. Cells with `parentId === null` are root candidates.
4. If exactly one root candidate exists, it becomes `root`. If zero, `root = null`. If multiple, the FIRST in file order becomes `root` and the rest become `orphans` (defensive — 1d/1d2 invariant produces exactly one).

**`formatTreeText` format:**

Each cell renders as:
```
  └─ #5 ok   value=42         const x = polars.DataFrame(...)
  └─ #6 ok   value=true       const c = await otto.duckdb...
  └─ #7 err  Error: boom      throw new Error("boom");
  └─ #11 ok  value="loaded"   globalThis.notes = ...       *
```

- 2-space indent per depth level.
- `└─` for the last child of a parent; `├─` for non-last. (git-log conventions.)
- Cell id with `#` prefix.
- `ok` / `err` flag (3 chars).
- `value=<json>` for ok cells, truncated to 40 chars; `error=<message>` truncated to 40 chars for err cells.
- Code preview: first line, truncated to 60 chars.
- `*` marker on the current leaf id.
- Orphans (if any) render under a `# orphans:` section at the end with the same formatting.

### 4.2 `CellArchive` — leaf separated from lastId

```ts
export class CellArchive {
  #lastId: number | null;       // file-max; monotonic
  #leafId: number | null;       // next append's parentId; mutable via setLeaf

  constructor(dir: string, now?: () => number) {
    // ... existing scan() logic ...
    this.#lastId = scanned.lastId;
    this.#leafId = scanned.lastId;
  }

  get lastId(): number | null { return this.#lastId; }
  get leafId(): number | null { return this.#leafId; }   // NEW
  setLeaf(id: number | null): void { this.#leafId = id; } // NEW; trusts the id

  append(input: AppendInput): CellEntry {
    this.ensureHeader();
    const newId = (this.#lastId ?? 0) + 1;
    const entry: CellEntry = {
      id: newId,
      parentId: this.#leafId,
      // ... rest unchanged ...
    };
    appendFileSync(this.path, JSON.stringify(entry) + '\n');
    this.#lastId = newId;
    this.#leafId = newId;
    return entry;
  }
}
```

**Behavioral guarantees:**
- Linear case (no `setLeaf` ever called): `#lastId === #leafId` after every `append`. Behavior identical to 1d/1d2.
- Branching: after `setLeaf(5)` when `#lastId === 10`, the next `append` writes id 11 with `parentId: 5`. Both `#lastId` and `#leafId` become 11.
- `setLeaf(null)` resets to "no parent" — the next `append` writes a root cell. Only used in defensive edge cases; not exposed via `/sp tree`.
- Re-construct after a session: `scan()` re-seeds both to file-max. The MANAGER (not the archive) is responsible for calling `setLeaf(meta.cell_leaf_id)` after attach to restore the persisted leaf.

### 4.3 `ScratchpadManager` — `setLeaf`, `fork`, leaf restore, writeMeta v3

#### 4.3a `setLeaf(name, id)`

```
1. validateName(name)
2. Read cells.jsonl for `name` from disk (always — works for both warm and cold).
3. Verify the scratchpad dir exists (meta.json present) — throw "scratchpad not found: <name>" if missing.
4. Build tree via projectTree(cellsFromDisk).
5. validateLeafId(tree, id) — throws "cell id <id> not found in <name>" if missing.
6. If entries.get(name)?.archive exists (warm): entry.archive.setLeaf(id).
7. Direct meta update: read meta.json, set cell_leaf_id = id (preserve all other fields),
   bump schema_version to 3 if it was 2, writeFileSync the result.
   (Direct write rather than routing through writeMeta because writeMeta pulls
   cell_leaf_id from the live archive — for cold setLeaf there's no live archive
   yet, and we don't want to construct one just to update meta.)
```

Cold-path semantics: when `setLeaf` is called on a scratchpad that's not in `this.entries`, the meta gets updated directly. The next `getOrAttach(name)` will read `cell_leaf_id` via the existing leaf-restore-on-attach path (§4.3c) and call `entry.archive.setLeaf(id)` to seed the freshly-constructed archive.

Warm-path semantics: both the live archive AND the meta get updated. Subsequent `writeMeta` calls (e.g. on the next runCell) preserve `cell_leaf_id` via the prevExtras loop or pull it from the live archive's `leafId` getter — either path yields the same value.

#### 4.3b `fork(srcName, dstName)`

```
1. validateName(srcName) + validateName(dstName).
2. Reject if dstName exists in entries OR has a meta.json on disk.
3. Verify srcName exists on disk (meta.json present).
4. If srcName is warm (entries[src].runtime != null):
     await snapshotThenDispose(srcName, entries[src])    // 1d2 path
     (no error if snapshot fails — recovery note is written; eviction proceeds)
5. const srcDir = dirFor(srcName), dstDir = dirFor(dstName)
6. mkdirSync(dstDir, { recursive: true })
7. For each of [kernel.db, namespace.json, cells.jsonl]:
     if existsSync(join(srcDir, file)):
       copyFileSync(join(srcDir, file), join(dstDir, file))
8. srcMeta = JSON.parse(readFileSync(join(srcDir, 'meta.json'), 'utf8'))
9. dstMeta = {
     name: dstName,
     created_at: nowIso,
     last_used: nowIso,
     attached_sessions: this.sessionId ? [this.sessionId] : [],
     size_bytes: dirSize(dstDir),
     schema_version: META_SCHEMA_VERSION,   // 3
     cell_leaf_id: srcMeta.cell_leaf_id ?? null,
     last_snapshot_cell_id: srcMeta.last_snapshot_cell_id ?? null,
     last_snapshot_at: srcMeta.last_snapshot_at ?? null,
     namespace_skipped: [],
     recovery_notes: [],
     kernel_db: { present: existsSync(join(dstDir, 'kernel.db')), path: 'kernel.db' },
     namespace: { present: existsSync(join(dstDir, 'namespace.json')), schema_version: 1 },
   }
10. writeFileSync(join(dstDir, 'meta.json'), JSON.stringify(dstMeta, null, 2))
11. acquireLock(dstDir, { now: this.now })
    — claims dst for this session. Dst is NOT auto-attached;
      a subsequent /sp attach <dst> will warm it.
```

Failure handling:
- Step 2 collision → throw "scratchpad <dst> already exists"
- Step 3 missing src → throw "scratchpad not found: <src>"
- Step 7 copy failure → throw the underlying fs error; leave dstDir partially populated for user cleanup via `/sp remove <dst>`
- Step 11 lock acquisition failure (race with another session) → throw `ScratchpadBusyError`; dstDir + copied files remain

#### 4.3c Leaf restore on attach

In both `getOrAttach` (cold→warm) and `attachUnmanaged` (fresh attach), after the existing `ingestRecoveryNotesOnAttach(name, entry)` call:

```ts
const persistedLeaf = readPersistedLeaf(this.metaPath(name));
if (persistedLeaf !== null && entry.archive.leafId !== persistedLeaf) {
  entry.archive.setLeaf(persistedLeaf);
}
```

`readPersistedLeaf` is a tiny private helper that reads `meta.json` and returns `cell_leaf_id` or `null`. It tolerates missing/corrupt meta (returns `null`).

Note: the EXTENSION side also needs `readPersistedLeaf` (for `/sp tree` printing). It lives in the library's helper exports so both sides use the same logic; the EXTENSION's `helpers.ts` re-exports / wraps it (see §4.5).

#### 4.3d `writeMeta` v3

Bump `META_SCHEMA_VERSION` from 2 to 3. Extend the prevExtras preservation loop to include `cell_leaf_id`. Also, when an entry has a live archive, pull `cell_leaf_id` from the archive (so it tracks the current leaf even between explicit `setLeaf` calls):

```ts
const archive = this.entries.get(name)?.archive ?? null;
const liveLeaf = archive?.leafId ?? null;
const cell_leaf_id =
  liveLeaf !== null ? liveLeaf : (prevExtras.cell_leaf_id ?? null);
```

The resulting meta object includes `cell_leaf_id` alongside the other v2 fields.

Migration: a v2 meta on disk (no `cell_leaf_id`) loads with `prevExtras.cell_leaf_id === undefined` → `cell_leaf_id` defaults to `null`. The next `writeMeta` upgrades it to v3 by writing `schema_version: 3` and including the new field.

### 4.4 Extension verbs

`src/resources/extensions/coworker-scratchpad/sp-command.ts` extends `VERBS` with `'tree'` and `'fork'`. The switch gains two new cases (full text in spec §5).

`helpers.ts` gains:

```ts
import { existsSync, readFileSync } from 'node:fs';

export function readPersistedLeaf(metaPath: string): number | null {
  if (!existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { cell_leaf_id?: number | null };
    return typeof meta.cell_leaf_id === 'number' ? meta.cell_leaf_id : null;
  } catch {
    return null;
  }
}
```

(The library has its own `readPersistedLeaf` private helper inside `scratchpad-manager.ts`; the extension's copy is independent — both small, no shared module needed.)

### 4.5 `meta.json` schema v3

```jsonc
{
  // v1 + v2 fields (unchanged)
  "name": "p1-1234",
  "created_at": "...",
  "last_used": "...",
  "attached_sessions": ["sess-1"],
  "size_bytes": 41284091,
  "schema_version": 3,

  // v2 fields (unchanged)
  "last_snapshot_cell_id": 12,
  "last_snapshot_at": "...",
  "namespace_skipped": [],
  "recovery_notes": [],
  "kernel_db": { "present": true, "path": "kernel.db" },
  "namespace": { "present": true, "schema_version": 1 },

  // v3 addition
  "cell_leaf_id": 5    // or null
}
```

Bump `META_SCHEMA_VERSION` from 2 to 3.

## 5. Slash command surface (exact text)

```ts
case 'tree': {
  const flagIdx = parts.indexOf('--to');
  let target: string;
  if (flagIdx === -1) {
    target = name ?? ensureCurrent(deps);
  } else {
    target = (flagIdx === 1 ? ensureCurrent(deps) : (parts[1] as string));
    const toId = Number(parts[flagIdx + 1]);
    if (!Number.isInteger(toId) || toId <= 0) {
      ctx.ui.notify('Usage: /sp tree [<name>] --to <id>', 'error');
      return;
    }
    validateName(target);
    await deps.getManager().setLeaf(target, toId);
    ctx.ui.notify(`set leaf of ${target} to cell ${toId}`, 'info');
    return;
  }
  validateName(target);
  const { cells } = readCellsJsonl(join(deps.rootDir(), target));
  if (cells.length === 0) {
    ctx.ui.notify(`${target}: no cells yet`, 'info');
    return;
  }
  const tree = projectTree(cells);
  const leaf = readPersistedLeaf(join(deps.rootDir(), target, 'meta.json'));
  ctx.ui.notify(`${target} cell tree:\n${formatTreeText(tree, leaf)}`, 'info');
  return;
}

case 'fork': {
  if (parts.length < 3) { ctx.ui.notify('Usage: /sp fork <src> <dst>', 'error'); return; }
  const src = parts[1]!, dst = parts[2]!;
  validateName(src);
  validateName(dst);
  await deps.getManager().fork(src, dst);
  ctx.ui.notify(`forked ${src} → ${dst}`, 'info');
  return;
}
```

Imports added to `sp-command.ts`: `projectTree, formatTreeText` from `@otto/coworker-scratchpad`; `readPersistedLeaf` from `./helpers.js`.

## 6. Error handling

| Scenario | Where | Result |
|---|---|---|
| `/sp tree --to <invalid-id>` | manager.setLeaf | `Error: cell id <id> not found in <name>` → notify error |
| `/sp tree --to <id>` on a scratchpad with no cells | readCellsJsonl returns empty → projectTree returns null root → validateLeafId throws | error notify |
| `/sp tree` on a scratchpad with no cells | early return with "no cells yet" | info notify |
| `/sp fork <src> <dst>` when dst exists | manager.fork step 2 | `Error: scratchpad <dst> already exists` |
| `/sp fork <src> <dst>` when src missing | manager.fork step 3 | `Error: scratchpad not found: <src>` |
| `/sp fork` on warm src with active cell | snapshotThenDispose skips snapshot, eviction proceeds, fork uses on-disk state | `snapshot-failed` recovery note written to src's meta; fork succeeds |
| `/sp fork` lock acquisition fails | manager.fork step 11 | `ScratchpadBusyError` thrown; dstDir + copied files remain (user cleans up) |
| `/sp tree --to` on cold scratchpad | manager.setLeaf writes meta directly | meta updated; next attach restores leaf |
| Meta.json corrupt during readPersistedLeaf | helper catches | returns null; tree printed without `*` marker |
| Meta.json missing during fork | impossible (step 3 verifies) | n/a |

## 7. File layout

```
packages/coworker-scratchpad/src/
  cell-tree.ts                ← NEW: pure tree projection + format
  cell-tree.test.ts           ← NEW: ~10 unit tests
  cell-archive.ts             ← MODIFY: #leafId, setLeaf, leafId getter
  cell-archive.test.ts        ← MODIFY: ~5 new leaf-pointer tests
  scratchpad-manager.ts       ← MODIFY: setLeaf, fork, leaf restore, writeMeta v3
  scratchpad-manager.test.ts  ← MODIFY: ~8 new tests
  index.ts                    ← MODIFY: re-export cell-tree

src/resources/extensions/coworker-scratchpad/
  sp-command.ts               ← MODIFY: tree + fork verbs
  sp-command.test.ts          ← MODIFY: ~6 new dispatch tests
  helpers.ts                  ← MODIFY: readPersistedLeaf
  helpers.test.ts             ← MODIFY: ~2 new tests for the helper
```

## 8. Test plan

Five tasks. Each is TDD-per-task with one commit.

| Task | Subject | Test count delta |
|---|---|---|
| 1 | `cell-tree.ts` — pure module | +10 |
| 2 | `cell-archive.ts` — leaf-pointer split | +5 (existing 5 unchanged) |
| 3 | `scratchpad-manager.ts` — setLeaf + fork + leaf restore + writeMeta v3 | +8 (existing 26 unchanged) |
| 4 | extension `sp-command.ts` + `helpers.ts` — tree + fork verbs + readPersistedLeaf | +6 + 2 = 8 (existing 14 unchanged) |
| 5 | Build + gates (no code) | — |

After 1f: lib tests grow from 109 to ~132; extension tests grow from 32 to ~40.

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Copying kernel.db while DuckDB has it open corrupts the copy | `fork` calls `snapshotThenDispose` BEFORE copy; DuckDB releases its file handle on dispose. Documented + tested. |
| 2 | `setLeaf` on a non-existent id between attach and meta read | `validateLeafId` always runs against a freshly-projected tree (built from the live archive or fresh disk read) — no stale tree cached. |
| 3 | Concurrent setLeaf from two Otto windows (race) | scratchpad-lock (1c2) prevents two warm kernels; setLeaf on a cold scratchpad just writes meta — a race between two cold setLeaf calls means last-write-wins, acceptable since no kernel state is involved. |
| 4 | Forking to a name that exists ONLY in the entries map (locked but not on disk) — i.e. mid-create race | Step 2 check `entries.has(dst) OR existsOnDisk(dst)`. Both covered. |
| 5 | A v2 meta loaded by 1f code with no `cell_leaf_id` | prevExtras preservation defaults absent fields to null; behavior identical to 1d/1d2 (leaf == file-max). |
| 6 | Tree projection on a cells.jsonl with millions of entries | Projection is O(n) over cells; in-memory Map. For 80-cell investigations, trivial. If a future user hits 100k cells, consider lazy/paginated read. Not a 1f concern. |

## 10. Out-of-scope deferred items (handed to 1g)

Listed at the top of §2 under "Out of scope."

---

**Next step:** invoke `superpowers:writing-plans` to expand this spec into a task-by-task plan at `docs/superpowers/plans/2026-05-31-coworker-phase-1f-cell-tree-fork.md`.
