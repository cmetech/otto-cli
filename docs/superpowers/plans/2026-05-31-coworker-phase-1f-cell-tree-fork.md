# Otto Co-Worker Phase 1f — Cell Tree + `/sp tree` + `/sp fork` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Phase 1 milestone by making `/sp tree` and `/sp fork` work — `cell-tree.ts` projects a tree from cells.jsonl; `CellArchive` splits the leaf pointer from the file-max id; `ScratchpadManager` gains `setLeaf` and `fork`; the extension surface gains `tree` and `fork` verbs.

**Architecture:** Five additive pieces. (1) `cell-tree.ts` is a new pure module in `@otto/coworker-scratchpad` exporting `projectTree`/`findLeaves`/`validateLeafId`/`formatTreeText`. (2) `CellArchive` keeps its existing `nextId` and `#lastId` (file-max), and adds a new `#leafId` (next append's parentId) plus `setLeaf`/`leafId` getter. `append` chains `parentId` from `#leafId` instead of `#lastId`. Linear-case behavior unchanged. (3) `ScratchpadManager` gains `setLeaf(name, id)` (validates against the tree; updates archive + meta), `fork(srcName, dstName)` (auto-evicts src; copies kernel.db + namespace.json + cells.jsonl; writes fresh dst meta inheriting `cell_leaf_id`); `getOrAttach`/`attachUnmanaged` restore the persisted leaf via a new `restoreLeafOnAttach` helper; `writeMeta` pulls `cell_leaf_id` from the live archive (or preserves from prevExtras); `META_SCHEMA_VERSION` bumps 2 → 3. (4) Extension `sp-command.ts` extends `VERBS` with `tree` and `fork`. `helpers.ts` adds `readPersistedLeaf(metaPath)`. (5) Barrel + workspace gates.

**Tech Stack:** TypeScript `module: NodeNext`, ESM, Node 22+. Existing `node:fs` (`copyFileSync`, `mkdirSync`, `readFileSync`, `writeFileSync`, `existsSync`), `node:path` (`join`). `node:test` + `node:assert/strict`. Builds directly on 1d (`CellArchive` + `cells.jsonl`), 1d2 (`snapshotThenDispose`, meta v2 fields), and 1e (`sp-command` extension).

**Spec reference:** `docs/superpowers/specs/2026-05-31-coworker-phase-1f-cell-tree-fork-design.md`.

**Parent spec:** `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §2.4 (`/sp tree`, `/sp fork`), §3.1 (cell-tree = runtime projection; branching = leaf-pointer move).

**Locked decisions (do not re-litigate):**
1. **CLI-style `/sp tree`** — text printer default; `--to <id>` sets leaf. No TUI overlay (deferred to 1g).
2. **`/sp fork` auto-evicts src; dst inherits state + leaf.** Active-cell src skips snapshot (1d2 behavior); fork still proceeds.
3. **Leaf pointer in `meta.json` as `cell_leaf_id?: number | null`.** Schema v2 → v3. Backward-compat: absent field = `null` = "leaf == file-max" (matches 1d behavior).
4. **`CellArchive` splits monotonic id assignment from leaf chaining.** `nextId`/`#lastId` keep their current meanings (id assignment); new `#leafId` is the next append's `parentId`. They diverge only after `setLeaf`.

**Known intentional gaps (deferred to 1g or later):** TUI overlay for `/sp tree`, branch-summary entries on subtree abandon, `meta.kernel_at_cell_id` + divergence banner, `/sp save`, `/sp detach`, `/sp clear-history`, `/sp remove` confirm prompt, recovery-notes banner, `--force-takeover` prompt, `size_bytes` post-write recompute.

---

## Scope

**In scope (1f):**
- `cell-tree.ts` (NEW) + tests in `@otto/coworker-scratchpad`.
- `cell-archive.ts` `#leafId` + `setLeaf` + `leafId` getter.
- `scratchpad-manager.ts` `setLeaf`/`fork`/leaf-restore-on-attach/meta v3.
- Extension `sp-command.ts` `tree` and `fork` verbs.
- Extension `helpers.ts` `readPersistedLeaf`.
- Library barrel `index.ts` re-exports `projectTree`/`formatTreeText` and the tree types.

**Out of scope (deferred):** see spec §2.

---

## Canonical commands

Single-file test (works for both library and extension files):

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test <PATH>.test.ts
```

Build:

```bash
npm run build:coworker-scratchpad    # library
npm run build                        # main TS project (compiles the extension)
```

Gates:

```bash
npm run test:packages
npm run verify:workspace-coverage
```

> **Prerequisite (unchanged from 1e):** the kernel imports `@otto/coworker-utils` at runtime; rebuild it if a test errors with "Cannot find module '@otto/coworker-utils'".

---

## File structure

```
packages/coworker-scratchpad/src/
  cell-tree.ts                ← Create: pure tree projection + format (Task 1)
  cell-tree.test.ts           ← Create: 10 unit tests (Task 1)
  cell-archive.ts             ← Modify: #leafId, setLeaf, leafId getter (Task 2)
  cell-archive.test.ts        ← Modify: 5 new leaf-pointer tests (Task 2)
  scratchpad-manager.ts       ← Modify: setLeaf, fork, leaf restore, meta v3 (Task 3)
  scratchpad-manager.test.ts  ← Modify: 8 new integration tests (Task 3)
  index.ts                    ← Modify: re-export cell-tree (Task 5)

src/resources/extensions/coworker-scratchpad/
  helpers.ts                  ← Modify: readPersistedLeaf (Task 4)
  helpers.test.ts             ← Modify: 2 new tests (Task 4)
  sp-command.ts               ← Modify: tree + fork verbs (Task 4)
  sp-command.test.ts          ← Modify: 6 new dispatch tests (Task 4)
```

Five tasks. Task 1 = pure unit (fastest). Task 2 = small library extension. Task 3 = the integration weight (setLeaf + fork). Task 4 = extension verbs. Task 5 = barrel + gates.

---

## Task 1: `cell-tree.ts` — pure tree projection + formatter

A pure module — no I/O, no kernel. `projectTree` walks a flat list of cells once, indexes children under their parents, identifies the root and any orphans. `findLeaves` returns no-child nodes. `validateLeafId` throws if an id isn't in the tree. `formatTreeText` renders the tree with `├─`/`└─` connectors, code preview truncated to 60 chars, value/error truncated to 40 chars, and a `*` marker on the current leaf.

**Files:**
- Create: `packages/coworker-scratchpad/src/cell-tree.ts`
- Create: `packages/coworker-scratchpad/src/cell-tree.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coworker-scratchpad/src/cell-tree.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CellEntry } from './cell-archive.js';
import { projectTree, findLeaves, validateLeafId, formatTreeText } from './cell-tree.js';

function mkCell(id: number, parentId: number | null, ok = true, value: unknown = id, code = `return ${id};`): CellEntry {
  return ok
    ? { id, parentId, code, ok: true, value, stdout: '', ts: `t${id}` }
    : { id, parentId, code, ok: false, error: { name: 'Error', message: String(value) }, stdout: '', ts: `t${id}` };
}

describe('projectTree', () => {
  it('returns null root and empty maps for an empty cell list', () => {
    const t = projectTree([]);
    assert.equal(t.root, null);
    assert.equal(t.byId.size, 0);
    assert.deepEqual(t.orphans, []);
  });

  it('builds a linear chain into a single-spine tree', () => {
    const cells = [mkCell(1, null), mkCell(2, 1), mkCell(3, 2)];
    const t = projectTree(cells);
    assert.equal(t.root?.cell.id, 1);
    assert.equal(t.root?.children.length, 1);
    assert.equal(t.root?.children[0].cell.id, 2);
    assert.equal(t.root?.children[0].children[0].cell.id, 3);
    assert.equal(t.byId.size, 3);
    assert.deepEqual(t.orphans, []);
  });

  it('builds a branching tree when a parent has two children', () => {
    // 1 → 2 → 3
    //     └→ 4
    const cells = [mkCell(1, null), mkCell(2, 1), mkCell(3, 2), mkCell(4, 2)];
    const t = projectTree(cells);
    assert.equal(t.byId.get(2)!.children.length, 2);
    const ids = t.byId.get(2)!.children.map((c) => c.cell.id).sort();
    assert.deepEqual(ids, [3, 4]);
  });

  it('collects orphans when parentId points to a missing id', () => {
    const cells = [mkCell(1, null), mkCell(5, 99)]; // 99 doesn't exist
    const t = projectTree(cells);
    assert.equal(t.root?.cell.id, 1);
    assert.equal(t.orphans.length, 1);
    assert.equal(t.orphans[0].cell.id, 5);
  });
});

describe('findLeaves', () => {
  it('returns all childless nodes', () => {
    // 1 → 2 → 3
    //     └→ 4
    const cells = [mkCell(1, null), mkCell(2, 1), mkCell(3, 2), mkCell(4, 2)];
    const leaves = findLeaves(projectTree(cells));
    const ids = leaves.map((n) => n.cell.id).sort();
    assert.deepEqual(ids, [3, 4]);
  });
});

describe('validateLeafId', () => {
  it('returns without throwing when id is present', () => {
    const t = projectTree([mkCell(1, null), mkCell(2, 1)]);
    assert.doesNotThrow(() => validateLeafId(t, 2));
  });

  it('throws when id is missing', () => {
    const t = projectTree([mkCell(1, null)]);
    assert.throws(() => validateLeafId(t, 99), /cell id 99 not found/);
  });
});

describe('formatTreeText', () => {
  it('renders ok cells with #id, ok flag, value, and code preview', () => {
    const text = formatTreeText(projectTree([mkCell(1, null, true, 42, 'return 42;')]));
    assert.match(text, /#1/);
    assert.match(text, /\bok\b/);
    assert.match(text, /value=42/);
    assert.match(text, /return 42;/);
  });

  it('renders err cells with error message instead of value', () => {
    const text = formatTreeText(projectTree([mkCell(1, null, false, 'boom', 'throw 1;')]));
    assert.match(text, /\berr\b/);
    assert.match(text, /error=boom/);
    assert.doesNotMatch(text, /value=/);
  });

  it('marks the current leaf with a trailing *', () => {
    const cells = [mkCell(1, null), mkCell(2, 1)];
    const text = formatTreeText(projectTree(cells), 2);
    const lineWith2 = text.split('\n').find((l) => l.includes('#2'))!;
    assert.match(lineWith2, /\*\s*$/);
    const lineWith1 = text.split('\n').find((l) => l.includes('#1'))!;
    assert.doesNotMatch(lineWith1, /\*\s*$/);
  });

  it('truncates code preview to 60 chars', () => {
    const longCode = 'const x = '.padEnd(200, 'A');
    const text = formatTreeText(projectTree([mkCell(1, null, true, null, longCode)]));
    const line = text.split('\n').find((l) => l.includes('#1'))!;
    // The 60-char preview plus ellipsis OR cut at 60; either way the full 200-char source must not appear.
    assert.doesNotMatch(line, /A{100}/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/cell-tree.test.ts`
Expected: FAIL — cannot find module `./cell-tree.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/coworker-scratchpad/src/cell-tree.ts`:

```typescript
import type { CellEntry } from './cell-archive.js';

export interface TreeNode {
  cell: CellEntry;
  children: TreeNode[];
}

export interface CellTree {
  root: TreeNode | null;
  byId: Map<number, TreeNode>;
  orphans: TreeNode[];
}

export function projectTree(cells: CellEntry[]): CellTree {
  const byId = new Map<number, TreeNode>();
  for (const cell of cells) byId.set(cell.id, { cell, children: [] });
  const orphans: TreeNode[] = [];
  const rootCandidates: TreeNode[] = [];
  for (const cell of cells) {
    const node = byId.get(cell.id)!;
    if (cell.parentId === null) {
      rootCandidates.push(node);
      continue;
    }
    const parent = byId.get(cell.parentId);
    if (parent) parent.children.push(node);
    else orphans.push(node);
  }
  let root: TreeNode | null = null;
  if (rootCandidates.length >= 1) {
    root = rootCandidates[0];
    // 1d/1d2 invariant: exactly one root. Defensive: extra roots become orphans.
    for (let i = 1; i < rootCandidates.length; i++) orphans.push(rootCandidates[i]);
  }
  return { root, byId, orphans };
}

export function findLeaves(tree: CellTree): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of tree.byId.values()) {
    if (node.children.length === 0) out.push(node);
  }
  return out;
}

export function validateLeafId(tree: CellTree, id: number): void {
  if (!tree.byId.has(id)) {
    throw new Error(`cell id ${id} not found`);
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function summarizeCell(cell: CellEntry): string {
  const okFlag = cell.ok ? 'ok ' : 'err';
  const detail = cell.ok
    ? `value=${truncate(JSON.stringify(cell.value ?? null), 40)}`
    : `error=${truncate(cell.error?.message ?? '', 40)}`;
  const codePreview = truncate(cell.code.split('\n')[0], 60);
  return `#${cell.id} ${okFlag} ${detail.padEnd(45)} ${codePreview}`;
}

function renderNode(
  node: TreeNode,
  depth: number,
  lastSibling: boolean,
  currentLeaf: number | null | undefined,
  out: string[],
): void {
  const indent = '  '.repeat(depth);
  const connector = lastSibling ? '└─' : '├─';
  const marker = currentLeaf === node.cell.id ? ' *' : '';
  out.push(`${indent}${connector} ${summarizeCell(node.cell)}${marker}`);
  const last = node.children.length - 1;
  node.children.forEach((child, i) => renderNode(child, depth + 1, i === last, currentLeaf, out));
}

export function formatTreeText(tree: CellTree, currentLeaf?: number | null): string {
  const lines: string[] = [];
  if (tree.root) renderNode(tree.root, 0, true, currentLeaf ?? null, lines);
  if (tree.orphans.length > 0) {
    lines.push('# orphans:');
    const last = tree.orphans.length - 1;
    tree.orphans.forEach((o, i) => renderNode(o, 0, i === last, currentLeaf ?? null, lines));
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/cell-tree.test.ts`
Expected: PASS — `# pass 10`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/cell-tree.ts packages/coworker-scratchpad/src/cell-tree.test.ts
git commit -m "feat(coworker-scratchpad): cell-tree — projectTree + findLeaves + validateLeafId + formatTreeText"
```

---

## Task 2: `CellArchive` — `#leafId` + `setLeaf` + `leafId` getter

Add the leaf-pointer field. Keep `nextId` and `#lastId` unchanged (they handle monotonic id assignment). `append` chains `parentId` from the new `#leafId` and updates both `#lastId` and `#leafId` to the new id afterwards.

**Files:**
- Modify: `packages/coworker-scratchpad/src/cell-archive.ts`
- Modify: `packages/coworker-scratchpad/src/cell-archive.test.ts`

- [ ] **Step 1: Write the failing tests**

Append the following block to `packages/coworker-scratchpad/src/cell-archive.test.ts` (inside the existing `describe('CellArchive', …)` block, after the last `it(...)` and before the closing `});`):

```typescript
  it('leafId equals lastId after construct on a linear chain (backward-compat)', () => {
    const a = new CellArchive(dir, () => 0);
    a.append({ code: 'a', ok: true, value: null, stdout: '' });
    a.append({ code: 'b', ok: true, value: null, stdout: '' });
    assert.equal(a.lastId, 2);
    assert.equal(a.leafId, 2);
    // Re-construct over the same file: both seed to file-max.
    const a2 = new CellArchive(dir, () => 0);
    assert.equal(a2.lastId, 2);
    assert.equal(a2.leafId, 2);
  });

  it('setLeaf moves leafId without affecting lastId', () => {
    const a = new CellArchive(dir, () => 0);
    a.append({ code: 'a', ok: true, value: null, stdout: '' }); // id 1
    a.append({ code: 'b', ok: true, value: null, stdout: '' }); // id 2
    a.append({ code: 'c', ok: true, value: null, stdout: '' }); // id 3
    a.setLeaf(1);
    assert.equal(a.lastId, 3);
    assert.equal(a.leafId, 1);
  });

  it('append after setLeaf chains parentId from leaf, not from lastId', () => {
    const a = new CellArchive(dir, () => 0);
    a.append({ code: 'a', ok: true, value: null, stdout: '' }); // id 1, parent null
    a.append({ code: 'b', ok: true, value: null, stdout: '' }); // id 2, parent 1
    a.append({ code: 'c', ok: true, value: null, stdout: '' }); // id 3, parent 2
    a.setLeaf(1);
    const branched = a.append({ code: 'd', ok: true, value: null, stdout: '' }); // id 4, parent 1
    assert.equal(branched.id, 4);
    assert.equal(branched.parentId, 1);
  });

  it('append after setLeaf updates BOTH lastId and leafId to the new id', () => {
    const a = new CellArchive(dir, () => 0);
    a.append({ code: 'a', ok: true, value: null, stdout: '' }); // id 1
    a.append({ code: 'b', ok: true, value: null, stdout: '' }); // id 2
    a.setLeaf(1);
    a.append({ code: 'c', ok: true, value: null, stdout: '' }); // id 3, parent 1
    assert.equal(a.lastId, 3);
    assert.equal(a.leafId, 3);
  });

  it('setLeaf(null) makes the next append a root cell (parentId null)', () => {
    const a = new CellArchive(dir, () => 0);
    a.append({ code: 'a', ok: true, value: null, stdout: '' });
    a.setLeaf(null);
    const next = a.append({ code: 'b', ok: true, value: null, stdout: '' });
    assert.equal(next.parentId, null);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/cell-archive.test.ts`
Expected: FAIL — `archive.leafId` is not a property; `archive.setLeaf` is not a function.

- [ ] **Step 3: Add `#leafId` to the class**

In `packages/coworker-scratchpad/src/cell-archive.ts`:

(a) Add the field next to `#lastId`. Replace:

```typescript
  private readonly path: string;
  private nextId: number;
  #lastId: number | null;
```

with:

```typescript
  private readonly path: string;
  private nextId: number;
  #lastId: number | null;
  #leafId: number | null;
```

(b) Initialise `#leafId` in the constructor to mirror `#lastId`. Replace:

```typescript
  constructor(private readonly dir: string, private readonly now: () => number = Date.now) {
    this.path = join(dir, 'cells.jsonl');
    const { nextId, lastId } = this.scan();
    this.nextId = nextId;
    this.#lastId = lastId;
  }
```

with:

```typescript
  constructor(private readonly dir: string, private readonly now: () => number = Date.now) {
    this.path = join(dir, 'cells.jsonl');
    const { nextId, lastId } = this.scan();
    this.nextId = nextId;
    this.#lastId = lastId;
    this.#leafId = lastId;
  }
```

(c) Add the public getter + `setLeaf` method below the existing `get lastId()`. After the closing `}` of `get lastId()`, add:

```typescript
  get leafId(): number | null {
    return this.#leafId;
  }

  setLeaf(id: number | null): void {
    this.#leafId = id;
  }
```

(d) Change `append` so `parentId` reads from `#leafId` and the post-write also updates `#leafId`. Replace the body of `append`:

```typescript
  append(input: AppendInput): CellEntry {
    this.ensureHeader();
    const id = this.nextId++;
    const entry: CellEntry = {
      id,
      parentId: this.#lastId,
      code: input.code,
      ok: input.ok,
      ...(input.ok ? { value: input.value } : { error: input.error }),
      stdout: input.stdout,
      ts: new Date(this.now()).toISOString(),
    };
    appendFileSync(this.path, JSON.stringify(entry) + '\n');
    this.#lastId = id;
    return entry;
  }
```

with:

```typescript
  append(input: AppendInput): CellEntry {
    this.ensureHeader();
    const id = this.nextId++;
    const entry: CellEntry = {
      id,
      parentId: this.#leafId,
      code: input.code,
      ok: input.ok,
      ...(input.ok ? { value: input.value } : { error: input.error }),
      stdout: input.stdout,
      ts: new Date(this.now()).toISOString(),
    };
    appendFileSync(this.path, JSON.stringify(entry) + '\n');
    this.#lastId = id;
    this.#leafId = id;
    return entry;
  }
```

The only diff from 1d2: `parentId: this.#leafId` (was `#lastId`), and `this.#leafId = id` added after the existing `this.#lastId = id`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/cell-archive.test.ts`
Expected: PASS — `# pass 10`, `# fail 0` (5 existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/cell-archive.ts packages/coworker-scratchpad/src/cell-archive.test.ts
git commit -m "feat(coworker-scratchpad): CellArchive — separate #leafId from #lastId for branching"
```

---

## Task 3: `ScratchpadManager` — `setLeaf` + `fork` + leaf restore + meta v3

This is the heaviest task. Adds `setLeaf` and `fork` public methods, restores `cell_leaf_id` from meta on attach, and bumps `META_SCHEMA_VERSION` to 3 with `cell_leaf_id` preserved/pulled-from-archive in `writeMeta`.

**Files:**
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

- [ ] **Step 1: Add the failing tests**

Append the following block to the END of `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`. Add `copyFileSync` to existing `node:fs` imports only if missing (the test file uses many `node:fs` imports already; verify before duplicating).

```typescript
describe('ScratchpadManager (tree + fork — 1f)', () => {
  let ws: string;
  let rt: string;
  let m: ScratchpadManager;

  const readMeta = (root: string, name: string): any =>
    JSON.parse(readFileSync(join(root, name, 'meta.json'), 'utf8'));

  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), 'spm5-ws-'));
    await mkdir(join(ws, '.otto', 'inputs'), { recursive: true });
    rt = await mkdtemp(join(tmpdir(), 'spm5-root-'));
  });
  afterEach(async () => {
    await m?.disposeAll();
    await rm(ws, { recursive: true, force: true });
    await rm(rt, { recursive: true, force: true });
  });

  it('writeMeta now persists cell_leaf_id and schema_version is 3', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;');
    const meta = readMeta(rt, 'a');
    assert.equal(meta.schema_version, 3);
    assert.equal(meta.cell_leaf_id, 1);
  });

  it('setLeaf rejects an id not present in cells.jsonl', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;');
    await assert.rejects(() => m.setLeaf('a', 99), /cell id 99 not found/);
  });

  it('setLeaf on a warm scratchpad updates archive.leafId AND meta.cell_leaf_id', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;'); // id 1
    await m.runCell('a', 'return 2;'); // id 2
    await m.setLeaf('a', 1);
    // The next runCell should chain from 1, not 2.
    const res = await m.runCell('a', 'return 3;');
    assert.equal(res.value, 3);
    const meta = readMeta(rt, 'a');
    assert.equal(meta.cell_leaf_id, 3); // the new cell becomes the leaf again
    // Read cells.jsonl and confirm the third cell's parentId is 1 (not 2).
    const lines = readFileSync(join(rt, 'a', 'cells.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"id"'));
    const recs = lines.map((l) => JSON.parse(l));
    assert.equal(recs[2].id, 3);
    assert.equal(recs[2].parentId, 1);
  });

  it('setLeaf on a cold scratchpad updates meta directly (next attach restores)', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;');
    await m.runCell('a', 'return 2;');
    await m.disposeAll();
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    // Cold: 'a' is not in entries; setLeaf updates meta only.
    await m.setLeaf('a', 1);
    assert.equal(readMeta(rt, 'a').cell_leaf_id, 1);
    // Attach + new cell branches from 1.
    const res = await m.runCell('a', 'return 99;');
    assert.equal(res.value, 99);
    const lines = readFileSync(join(rt, 'a', 'cells.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"id"'));
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.parentId, 1);
  });

  it('fork copies kernel.db + namespace.json + cells.jsonl and writes fresh meta', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('src', 'const c = await otto.duckdb.connect(); await c.run("CREATE TABLE t(x INT)"); await c.run("INSERT INTO t VALUES (1),(2)");');
    await m.runCell('src', 'globalThis.x = 42;');
    await m.fork('src', 'dst');
    // Both dirs exist.
    assert.equal(existsSync(join(rt, 'dst', 'kernel.db')), true);
    assert.equal(existsSync(join(rt, 'dst', 'cells.jsonl')), true);
    assert.equal(existsSync(join(rt, 'dst', 'meta.json')), true);
    // Dst meta inherits cell_leaf_id from src (currently last cell id = 2).
    const dstMeta = readMeta(rt, 'dst');
    assert.equal(dstMeta.cell_leaf_id, 2);
    assert.equal(dstMeta.name, 'dst');
    assert.deepEqual(dstMeta.recovery_notes, []);
    assert.deepEqual(dstMeta.namespace_skipped, []);
    // Dst is functional: attach and continue.
    const res = await m.runCell('dst', 'const c = await otto.duckdb.connect(); const r = await c.runAndReadAll("SELECT COUNT(*) AS n FROM t"); return Number(r.getRows()[0][0]);');
    assert.equal(res.value, 2);
  });

  it('fork rejects when dst already exists (entries or on disk)', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('src', 'return 1;');
    await m.runCell('dst', 'return 1;'); // creates dst on disk
    await assert.rejects(() => m.fork('src', 'dst'), /scratchpad dst already exists/);
  });

  it('fork rejects when src has no meta on disk', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await assert.rejects(() => m.fork('nope', 'dst'), /scratchpad not found: nope/);
  });

  it('re-attach restores leaf from meta when persisted leaf differs from file-max', async () => {
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    await m.runCell('a', 'return 1;');
    await m.runCell('a', 'return 2;');
    await m.runCell('a', 'return 3;');
    await m.setLeaf('a', 1); // leaf=1, file-max=3
    await m.disposeAll();
    m = new ScratchpadManager({ workspace: ws, root: rt, runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 } });
    const res = await m.runCell('a', 'return 99;'); // should branch from 1
    assert.equal(res.value, 99);
    const lines = readFileSync(join(rt, 'a', 'cells.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"id"'));
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.id, 4);
    assert.equal(last.parentId, 1);
  });
});
```

(Note: this block uses `existsSync`, `readFileSync`, `writeFileSync`, `mkdtemp`, `mkdir`, `rm` — confirm these are already imported at the top of `scratchpad-manager.test.ts`; add any missing ones to the existing import lines.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts`
Expected: FAIL — `m.setLeaf` is not a function; `m.fork` is not a function; meta.schema_version is still 2.

- [ ] **Step 3: Bump `META_SCHEMA_VERSION` + extend extras preservation**

In `packages/coworker-scratchpad/src/scratchpad-manager.ts`:

(a) Change `const META_SCHEMA_VERSION = 2;` to `const META_SCHEMA_VERSION = 3;`.

(b) In `writeMeta`, extend the preserved-extras loop to include `cell_leaf_id`, and pull from the live archive if one exists. Find the existing block in `writeMeta`:

```typescript
        for (const k of ['last_snapshot_cell_id', 'last_snapshot_at', 'namespace_skipped', 'recovery_notes']) {
          if (k in prev) prevExtras[k] = prev[k];
        }
        if (Array.isArray(prevExtras.recovery_notes)) {
          const rn = prevExtras.recovery_notes as unknown[];
          prevExtras.recovery_notes = rn.slice(Math.max(0, rn.length - MAX_RECOVERY_NOTES));
        }
```

Replace with:

```typescript
        for (const k of ['last_snapshot_cell_id', 'last_snapshot_at', 'namespace_skipped', 'recovery_notes', 'cell_leaf_id']) {
          if (k in prev) prevExtras[k] = prev[k];
        }
        if (Array.isArray(prevExtras.recovery_notes)) {
          const rn = prevExtras.recovery_notes as unknown[];
          prevExtras.recovery_notes = rn.slice(Math.max(0, rn.length - MAX_RECOVERY_NOTES));
        }
```

(c) Just before the final `const meta = {...}` construction, add a "pull live leaf" step. Find:

```typescript
    if (this.sessionId && !attached_sessions.includes(this.sessionId)) {
      attached_sessions.push(this.sessionId);
    }
    const meta = {
```

Insert immediately above the `const meta = {` line:

```typescript
    const archive = this.entries.get(name)?.archive;
    if (archive && archive.leafId !== null) {
      prevExtras.cell_leaf_id = archive.leafId;
    }
```

- [ ] **Step 4: Add the `restoreLeafOnAttach` helper + call it in both attach paths**

Still in `scratchpad-manager.ts`:

(a) Add a new private helper method anywhere reasonable (a natural spot is after `ingestRecoveryNotesOnAttach`):

```typescript
  private restoreLeafOnAttach(name: string, entry: Entry): void {
    const path = this.metaPath(name);
    if (!existsSync(path)) return;
    try {
      const cur = JSON.parse(readFileSync(path, 'utf8')) as { cell_leaf_id?: unknown };
      const persisted = cur.cell_leaf_id;
      if (typeof persisted === 'number' && entry.archive.leafId !== persisted) {
        entry.archive.setLeaf(persisted);
      }
    } catch {
      // ignore; leaf falls back to file-max (the constructor's default).
    }
  }
```

(b) In `getOrAttach`, after the `ingestRecoveryNotesOnAttach(name, existing);` line and before `return existing.runtime;`, add:

```typescript
      this.restoreLeafOnAttach(name, existing);
```

(c) In `attachUnmanaged`, after the `this.ingestRecoveryNotesOnAttach(name, entry);` line and before `return runtime;`, add:

```typescript
    this.restoreLeafOnAttach(name, entry);
```

- [ ] **Step 5: Implement `setLeaf`**

Still in `scratchpad-manager.ts`. Add this public method anywhere on the class (a natural spot is after `runCell`):

```typescript
  async setLeaf(name: string, id: number): Promise<void> {
    this.assertNotDisposed();
    // Verify the scratchpad exists on disk (works for both warm and cold).
    if (!this.existsOnDisk(name)) throw new Error(`scratchpad not found: ${name}`);
    // Build a tree from the on-disk cells.jsonl so validation works even when cold.
    const cells: CellEntry[] = [];
    const cellsPath = join(this.dirFor(name), 'cells.jsonl');
    if (existsSync(cellsPath)) {
      for (const line of readFileSync(cellsPath, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as { id?: unknown };
          if (typeof obj.id === 'number') cells.push(obj as CellEntry);
        } catch {
          // header or trailing-corrupt line -> skip
        }
      }
    }
    const tree = projectTree(cells);
    validateLeafId(tree, id);
    // Warm path: update the live archive too.
    const entry = this.entries.get(name);
    if (entry) entry.archive.setLeaf(id);
    // Direct meta update so cold scratchpads persist the leaf.
    const path = this.metaPath(name);
    let cur: Record<string, unknown> = {};
    try { cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { /* fall through */ }
    cur.cell_leaf_id = id;
    cur.schema_version = META_SCHEMA_VERSION;
    writeFileSync(path, JSON.stringify(cur, null, 2));
  }
```

Add the missing imports at the top of the file. Replace:

```typescript
import { CellArchive } from './cell-archive.js';
```

with:

```typescript
import { CellArchive, type CellEntry } from './cell-archive.js';
import { projectTree, validateLeafId } from './cell-tree.js';
```

- [ ] **Step 6: Implement `fork`**

Still in `scratchpad-manager.ts`. Extend the `node:fs` import at the top to include `copyFileSync`. Replace:

```typescript
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
```

with:

```typescript
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
```

Add the public `fork` method. Place it after `setLeaf`:

```typescript
  async fork(srcName: string, dstName: string): Promise<void> {
    this.assertNotDisposed();
    if (this.entries.has(dstName) || this.existsOnDisk(dstName)) {
      throw new Error(`scratchpad ${dstName} already exists`);
    }
    if (!this.existsOnDisk(srcName)) {
      throw new Error(`scratchpad not found: ${srcName}`);
    }
    // Auto-evict src to release the DuckDB kernel.db handle before we copy.
    const srcEntry = this.entries.get(srcName);
    if (srcEntry && srcEntry.runtime) {
      await this.snapshotThenDispose(srcName, srcEntry);
    }
    const srcDir = this.dirFor(srcName);
    const dstDir = this.dirFor(dstName);
    mkdirSync(dstDir, { recursive: true });
    for (const file of ['kernel.db', 'namespace.json', 'cells.jsonl']) {
      if (existsSync(join(srcDir, file))) {
        copyFileSync(join(srcDir, file), join(dstDir, file));
      }
    }
    // Build dst meta inheriting selected fields from src.
    let srcMeta: Record<string, unknown> = {};
    try { srcMeta = JSON.parse(readFileSync(join(srcDir, 'meta.json'), 'utf8')) as Record<string, unknown>; } catch { /* leave empty */ }
    const nowIso = new Date(this.now()).toISOString();
    const dstMeta = {
      name: dstName,
      created_at: nowIso,
      last_used: nowIso,
      attached_sessions: this.sessionId ? [this.sessionId] : [],
      size_bytes: this.dirSize(dstDir),
      schema_version: META_SCHEMA_VERSION,
      cell_leaf_id: typeof srcMeta.cell_leaf_id === 'number' ? srcMeta.cell_leaf_id : null,
      last_snapshot_cell_id: typeof srcMeta.last_snapshot_cell_id === 'number' ? srcMeta.last_snapshot_cell_id : null,
      last_snapshot_at: typeof srcMeta.last_snapshot_at === 'string' ? srcMeta.last_snapshot_at : null,
      namespace_skipped: [],
      recovery_notes: [],
      kernel_db: { present: existsSync(join(dstDir, 'kernel.db')), path: 'kernel.db' },
      namespace: { present: existsSync(join(dstDir, 'namespace.json')), schema_version: 1 },
    };
    writeFileSync(join(dstDir, 'meta.json'), JSON.stringify(dstMeta, null, 2));
    // Claim the new scratchpad for this session by acquiring its lock.
    acquireLock(dstDir, { now: this.now });
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts`
Expected: PASS — every prior test plus the 8 new ones (total ~34). Then run the flake-watch loop to confirm eviction tests still pass under the added I/O:

```bash
for i in 1 2 3 4 5; do node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts || break; done
```

- [ ] **Step 8: Commit**

```bash
git add packages/coworker-scratchpad/src/scratchpad-manager.ts packages/coworker-scratchpad/src/scratchpad-manager.test.ts
git commit -m "feat(coworker-scratchpad): ScratchpadManager — setLeaf + fork + leaf restore + meta v3"
```

---

## Task 4: Extension `sp-command.ts` — `tree` + `fork` verbs; `helpers.ts` — `readPersistedLeaf`

**Files:**
- Modify: `src/resources/extensions/coworker-scratchpad/helpers.ts`
- Modify: `src/resources/extensions/coworker-scratchpad/helpers.test.ts`
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.ts`
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.test.ts`

- [ ] **Step 1: Add the failing tests**

(a) Append to `src/resources/extensions/coworker-scratchpad/helpers.test.ts` inside a new `describe('readPersistedLeaf', …)` block at the end:

```typescript
describe('readPersistedLeaf', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'rpl-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('returns null when meta.json is missing', () => {
    assert.equal(readPersistedLeaf(join(dir, 'meta.json')), null);
  });

  it('returns null when cell_leaf_id is absent or null', async () => {
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ name: 'x' }));
    assert.equal(readPersistedLeaf(join(dir, 'meta.json')), null);
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ name: 'x', cell_leaf_id: null }));
    assert.equal(readPersistedLeaf(join(dir, 'meta.json')), null);
  });

  it('returns the cell_leaf_id when present as a number', async () => {
    await writeFile(join(dir, 'meta.json'), JSON.stringify({ name: 'x', cell_leaf_id: 7 }));
    assert.equal(readPersistedLeaf(join(dir, 'meta.json')), 7);
  });

  it('returns null on corrupt meta', async () => {
    await writeFile(join(dir, 'meta.json'), '{not json');
    assert.equal(readPersistedLeaf(join(dir, 'meta.json')), null);
  });
});
```

Add `writeFile` to the existing `import { … } from 'node:fs/promises'` line if it's not already imported, and add `readPersistedLeaf` to the import from `./helpers.js`.

(b) Append to `src/resources/extensions/coworker-scratchpad/sp-command.test.ts` inside the existing `describe('sp-command dispatch (stubbed manager)', …)` block (right before the closing `});` of that describe):

```typescript
  it('/sp tree prints the formatted tree of the current scratchpad', async () => {
    const { pi, ctx } = wire(['p1']);
    await mkdir(join(root, 'p1'), { recursive: true });
    await writeFile(join(root, 'p1', 'cells.jsonl'), [
      JSON.stringify({ type: 'header', version: 1 }),
      JSON.stringify({ id: 1, parentId: null, code: 'return 1;', ok: true, value: 1, stdout: '', ts: 't1' }),
      JSON.stringify({ id: 2, parentId: 1, code: 'return 2;', ok: true, value: 2, stdout: '', ts: 't2' }),
    ].join('\n') + '\n');
    await writeFile(join(root, 'p1', 'meta.json'), JSON.stringify({ name: 'p1', cell_leaf_id: 2 }));
    await pi.commands.get('sp')!.handler('tree p1', ctx);
    const text = ctx.notifications.map(([_, m]) => m).join('\n');
    assert.match(text, /#1/);
    assert.match(text, /#2/);
    assert.match(text, /\*/); // current-leaf marker
  });

  it('/sp tree --to <id> calls manager.setLeaf', async () => {
    const setLeafCalls: Array<[string, number]> = [];
    const { pi, ctx, mgr } = wire(['p1']);
    (mgr as unknown as { setLeaf: (n: string, i: number) => Promise<void> }).setLeaf = async (n, i) => { setLeafCalls.push([n, i]); };
    await pi.commands.get('sp')!.handler('tree p1 --to 1', ctx);
    assert.deepEqual(setLeafCalls, [['p1', 1]]);
    assert.ok(ctx.notifications.some(([_, m]) => /set leaf of p1 to cell 1/.test(m)));
  });

  it('/sp tree --to with non-numeric id reports a usage error', async () => {
    const { pi, ctx } = wire(['p1']);
    await pi.commands.get('sp')!.handler('tree p1 --to bogus', ctx);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /Usage: \/sp tree/.test(m)));
  });

  it('/sp tree on a scratchpad with no cells notifies "no cells yet"', async () => {
    const { pi, ctx } = wire(['p1']);
    await mkdir(join(root, 'p1'), { recursive: true });
    await pi.commands.get('sp')!.handler('tree p1', ctx);
    assert.ok(ctx.notifications.some(([_, m]) => /no cells yet/.test(m)));
  });

  it('/sp fork <src> <dst> calls manager.fork', async () => {
    const forkCalls: Array<[string, string]> = [];
    const { pi, ctx, mgr } = wire(['p1']);
    (mgr as unknown as { fork: (s: string, d: string) => Promise<void> }).fork = async (s, d) => { forkCalls.push([s, d]); };
    await pi.commands.get('sp')!.handler('fork p1 p2', ctx);
    assert.deepEqual(forkCalls, [['p1', 'p2']]);
    assert.ok(ctx.notifications.some(([_, m]) => /forked p1 → p2/.test(m)));
  });

  it('/sp fork without two args reports a usage error', async () => {
    const { pi, ctx } = wire();
    await pi.commands.get('sp')!.handler('fork onlyone', ctx);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /Usage: \/sp fork/.test(m)));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/helpers.test.ts src/resources/extensions/coworker-scratchpad/sp-command.test.ts
```
Expected: FAIL — `readPersistedLeaf` not exported; `/sp tree` and `/sp fork` verbs unknown.

- [ ] **Step 3: Add `readPersistedLeaf` to `helpers.ts`**

In `src/resources/extensions/coworker-scratchpad/helpers.ts`, append at the end of the file:

```typescript
export function readPersistedLeaf(metaPath: string): number | null {
  if (!existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { cell_leaf_id?: unknown };
    return typeof meta.cell_leaf_id === 'number' ? meta.cell_leaf_id : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Extend `sp-command.ts` with `tree` and `fork` verbs**

In `src/resources/extensions/coworker-scratchpad/sp-command.ts`:

(a) Extend the imports. Find the existing `helpers.js` import and add `readPersistedLeaf`:

```typescript
import { validateName, readCellsJsonl, readPersistedLeaf } from './helpers.js';
```

Add a new import line for the cell-tree functions:

```typescript
import { projectTree, formatTreeText } from '@otto/coworker-scratchpad';
```

(b) Extend the verb union and the `VERBS` array. Find:

```typescript
type SpVerb = 'list' | 'new' | 'attach' | 'reset' | 'view' | 'remove';
const VERBS: SpVerb[] = ['list', 'new', 'attach', 'reset', 'view', 'remove'];
```

Replace with:

```typescript
type SpVerb = 'list' | 'new' | 'attach' | 'reset' | 'view' | 'remove' | 'tree' | 'fork';
const VERBS: SpVerb[] = ['list', 'new', 'attach', 'reset', 'view', 'remove', 'tree', 'fork'];
```

(c) Add the `tree` and `fork` cases. Find the `default` case in the switch (the one that emits `unknown verb`). Insert the two new cases IMMEDIATELY BEFORE the `default:` line:

```typescript
          case 'tree': {
            // Usage: /sp tree [<name>] [--to <id>]
            const flagIdx = parts.indexOf('--to');
            let target: string;
            if (flagIdx === -1) {
              target = name ?? ensureCurrent(deps);
            } else {
              target = flagIdx === 1 ? ensureCurrent(deps) : (parts[1] as string);
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
            // Usage: /sp fork <src> <dst>
            if (parts.length < 3) { ctx.ui.notify('Usage: /sp fork <src> <dst>', 'error'); return; }
            const src = parts[1]!;
            const dst = parts[2]!;
            validateName(src);
            validateName(dst);
            await deps.getManager().fork(src, dst);
            ctx.ui.notify(`forked ${src} → ${dst}`, 'info');
            return;
          }
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/helpers.test.ts src/resources/extensions/coworker-scratchpad/sp-command.test.ts
```
Expected: PASS — every prior test plus the 4 new helper tests and 6 new sp-command tests.

- [ ] **Step 6: Commit**

```bash
git add src/resources/extensions/coworker-scratchpad/helpers.ts src/resources/extensions/coworker-scratchpad/helpers.test.ts src/resources/extensions/coworker-scratchpad/sp-command.ts src/resources/extensions/coworker-scratchpad/sp-command.test.ts
git commit -m "feat(coworker-scratchpad-ext): /sp tree + /sp fork verbs; readPersistedLeaf helper"
```

---

## Task 5: Library barrel + workspace gates

**Files:**
- Modify: `packages/coworker-scratchpad/src/index.ts`

- [ ] **Step 1: Extend the barrel**

In `packages/coworker-scratchpad/src/index.ts`, append at the end of the file:

```typescript
export {
  projectTree,
  findLeaves,
  validateLeafId,
  formatTreeText,
  type TreeNode,
  type CellTree,
} from './cell-tree.js';
```

- [ ] **Step 2: Build the library**

Run: `npm run build:coworker-scratchpad`
Expected: exit 0; emits `dist/cell-tree.*`, re-emits `dist/cell-archive.*`, `dist/scratchpad-manager.*`, `dist/index.*`.

- [ ] **Step 3: Build the main TS project**

Run: `npm run build`
Expected: exit 0. Builds the extension consuming the new library exports.

- [ ] **Step 4: Run the workspace test gate**

Run: `npm run test:packages`
Expected: exit 0. `@otto/coworker-scratchpad` now reports +1 test file (`cell-tree.test.ts`); other counts unchanged.

- [ ] **Step 5: Run the workspace coverage gate**

Run: `npm run verify:workspace-coverage`
Expected: `All 15 linkable packages have test coverage.` Unchanged from 1e.

- [ ] **Step 6: Run the full extension suite to confirm everything is green together**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/coworker-scratchpad/mime-bundle.test.ts \
  src/resources/extensions/coworker-scratchpad/helpers.test.ts \
  src/resources/extensions/coworker-scratchpad/sp-command.test.ts \
  src/resources/extensions/coworker-scratchpad/scratchpad-tool.test.ts \
  src/resources/extensions/coworker-scratchpad/index.test.ts
```
Expected: every test from 1e + the 10 new ones from this phase passes; total 42 (10 + 9 + 15 + 7 + 1).

- [ ] **Step 7: Commit**

```bash
git add packages/coworker-scratchpad/src/index.ts
git commit -m "feat(coworker-scratchpad): export cell-tree from barrel"
```

---

## Self-Review

**1. Spec coverage (§4 of the brainstorm spec):**
- §4.1 `cell-tree.ts` API — Task 1 implements `projectTree`/`findLeaves`/`validateLeafId`/`formatTreeText` with the exact signatures from §4.1. ✓
- §4.2 `CellArchive` leaf-pointer split — Task 2 adds `#leafId`, `setLeaf`, `leafId` getter; `append` chains `parentId` from `#leafId` and post-updates both. Backward-compat preserved (linear case: `#lastId === #leafId`). ✓
- §4.3a `setLeaf` — Task 3 Step 5 implements: validates name, reads cells.jsonl from disk, projects tree, validates id, updates warm archive if present, writes meta directly. Matches the cold/warm split from the spec. ✓
- §4.3b `fork` — Task 3 Step 6 implements all 11 steps in order: validate names, reject collisions, verify src, auto-evict warm src via `snapshotThenDispose`, mkdir dst, copy 3 files, inherit selected meta fields, fresh attached_sessions/recovery_notes/namespace_skipped, write dst meta, acquire dst lock. ✓
- §4.3c Leaf restore on attach — Task 3 Step 4 adds `restoreLeafOnAttach` and calls it from both `getOrAttach` (cold→warm) and `attachUnmanaged` (fresh). ✓
- §4.3d `writeMeta` v3 — Task 3 Step 3 bumps `META_SCHEMA_VERSION`, extends prevExtras preservation to include `cell_leaf_id`, and pulls live `archive.leafId` into `prevExtras.cell_leaf_id` before the meta literal is constructed. ✓
- §4.4 Extension verbs — Task 4 Step 4 adds `tree` and `fork` cases to the switch + extends `VERBS` + extends `SpVerb` union. ✓
- §4.4 `helpers.ts` `readPersistedLeaf` — Task 4 Step 3 implements + tests at Task 4 Step 1. ✓
- §4.5 meta.json schema v3 — Task 3 Step 3 bumps version constant; meta literal is unchanged in shape because `prevExtras` (which now includes `cell_leaf_id`) is spread into it. ✓
- §5 slash command surface — Task 4 Step 4 ships exact text. ✓
- §6 error handling — every row mapped: invalid id (Task 1's validateLeafId + Task 3's setLeaf), missing scratchpad (Task 3 setLeaf step 2; fork step 3), no cells (Task 4 tree verb), dst exists (Task 3 fork step 2), src missing (Task 3 fork step 3), active-cell src (Task 3 fork step 5 uses `snapshotThenDispose` which handles active-cell skip via 1d2 behavior), corrupt meta in helper (Task 4 helper test 4), corrupt meta in archive scan (1d existing). ✓
- §7 file layout — exact match. ✓
- §8 test plan — exact match (10 + 5 + 8 + 4+6 + 0 = 33 new tests). ✓
- §9 risks — all 6 addressed in the implementation: kernel.db copy after snapshotThenDispose (Risk 1), tree freshly built in setLeaf (Risk 2), lock from 1c2 (Risk 3), entries+disk both checked (Risk 4), v2 meta migration via prevExtras (Risk 5), O(n) projection acceptable (Risk 6). ✓

**2. Placeholder scan:** No TBD/TODO/"similar to". Every step has complete code or exact diff instructions. Every run step has a command + expected output. ✓

**3. Type consistency:**
- `CellEntry` defined in `cell-archive.ts` (existing); imported by `cell-tree.ts` (Task 1) and `scratchpad-manager.ts` (Task 3 Step 5 adds the import). ✓
- `projectTree(cells: CellEntry[]): CellTree` and `validateLeafId(tree, id)` (Task 1) used by `scratchpad-manager.ts:setLeaf` (Task 3). Signatures match. ✓
- `formatTreeText(tree, currentLeaf?)` (Task 1) consumed by extension `sp-command.ts` (Task 4 Step 4). The extension imports it from `@otto/coworker-scratchpad` — barrel re-export added in Task 5. ✓
- `readPersistedLeaf(metaPath: string): number | null` (Task 4 Step 3) — extension's private helper. The library has its OWN inline `restoreLeafOnAttach` (Task 3 Step 4) that reads `cell_leaf_id` directly without going through a shared helper — intentional, the two copies are small and the library + extension don't share a code module. ✓
- `archive.leafId` (getter, Task 2) and `archive.setLeaf(id)` (Task 2) used by `scratchpad-manager.ts`'s `setLeaf` (Task 3 Step 5), `restoreLeafOnAttach` (Task 3 Step 4), and `writeMeta`'s live-leaf pull (Task 3 Step 3). All consistent. ✓
- `META_SCHEMA_VERSION = 3` (Task 3 Step 3) — used by `setLeaf` Task 3 Step 5 (sets `cur.schema_version = META_SCHEMA_VERSION`), `fork` Task 3 Step 6 (`schema_version: META_SCHEMA_VERSION`), and `writeMeta` (existing). All point at the same constant. ✓

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-31-coworker-phase-1f-cell-tree-fork.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batched with checkpoints for review.

Which approach?
