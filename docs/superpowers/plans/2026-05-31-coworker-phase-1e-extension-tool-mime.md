# Otto Co-Worker Phase 1e — Extension + `/sp` + `scratchpad` Tool + MIME Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `@otto/coworker-scratchpad` (the library from 1a–1d2) into Otto's TUI and LLM surfaces so the analyst can run cells via `/sp` slash commands and the LLM can run cells via the `scratchpad` tool, with MIME-bundle responses.

**Architecture:** Six additive pieces in a new extension at `src/resources/extensions/coworker-scratchpad/`. Two pure modules (`mime-bundle.ts`, `helpers.ts`) are unit-testable in isolation. Two factory modules (`sp-command.ts`, `scratchpad-tool.ts`) take a `deps` object so tests can pass a stub manager. One wire-up file (`index.ts` + `extension-manifest.json`) constructs the real ScratchpadManager in a `session_start` handler, disposes in `session_shutdown`, and registers the slash/tool surface eagerly at the top of the default export (matches `analyst`/`bg-shell` pattern). One live-kernel smoke test proves end-to-end. Extension is auto-discovered by `src/extension-discovery.ts` — no separate loader-registration step.

**Tech Stack:** TypeScript `module: NodeNext`, ESM, Node 22+. Otto extension framework: `@otto/pi-coding-agent` (`ExtensionAPI`, `ExtensionContext`, `pi.registerCommand`, `pi.registerTool`, `pi.on("session_start"/"session_shutdown")`). LLM tool schema: `@sinclair/typebox` + `StringEnum` from `@otto/pi-ai`. Library under test: `@otto/coworker-scratchpad` (`ScratchpadManager`, `CellEntry`, `CELLS_SCHEMA_VERSION`). `node:test` + `node:assert/strict`.

**Spec reference:** `docs/superpowers/specs/2026-05-31-coworker-phase-1e-extension-tool-mime-design.md`.

**Parent spec:** `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §2.4 (`/sp` surface), §5.1 (LLM tool), §5.1a (MIME bundle), §3.1 (default scratchpad).

**Locked decisions (do not re-litigate):**
1. **Manager lifecycle = lazy on first use, dispose on `session_shutdown`.** The spec said "construct on first /sp use." In practice we use a closure-based `getManager()` accessor that null-checks before constructing — equivalent to the spec, idiomatic to Otto.
2. **MIME bundle = auto-derived 3 slots** (`text/plain` for non-empty stdout; `application/json` for non-undefined/null value; `text/markdown` for string values that look markdown-shaped).
3. **Current scratchpad = in-memory pointer.** `/sp attach` and `/sp new` set it. Default auto-create on first nameless use. LLM tool `name` is optional and defaults to current; explicit name does NOT change current.
4. **`scratchpad view` defaults to tail-5** structured per-cell summary. Optional `tail` (max 20) and `from_id`. TUI shows full content.

**Structural corrections from the spec (the spec was written before reading the real `ExtensionAPI`):**
- Entry point is `export default function (pi: ExtensionAPI)` — NOT `export function register(pi)`.
- Teardown event is `pi.on("session_shutdown", ...)` — there is no `pi.onExit`.
- State lives in closures inside the default export (matches `analyst`), not in a separate `state.ts`. Pure utilities (name validation, cells.jsonl reader) live in `helpers.ts`.
- Extension is auto-discovered by `src/extension-discovery.ts` — no separate registration task.

**Known intentional gaps (deferred to 1f or 1g):** see spec §8.

---

## Scope

**In scope (1e):**
- New extension dir at `src/resources/extensions/coworker-scratchpad/` with manifest + 5 source files + 4 test files.
- Six `/sp` verbs: `list`, `new`, `attach`, `reset`, `view`, `remove`.
- `scratchpad` tool with two actions: `exec`, `view`.
- Auto-derived MIME bundle helper.
- Lazy ScratchpadManager singleton + in-memory currentName.

**Out of scope (deferred to 1f / 1g):** all items in spec §8.

---

## Canonical commands

Single-file test (works for any TS test file in the extension):

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/<FILE>.test.ts
```

Build:

```bash
npm run build:coworker-scratchpad    # build the library — already done in 1d2
npm run build                        # build the main TS project
```

Gates:

```bash
npm run test:packages
npm run verify:workspace-coverage
```

> **Prerequisite:** the kernel imports `@otto/coworker-utils` and `@otto/coworker-scratchpad` at runtime. If a test errors with "Cannot find module", run `npm run build:coworker-utils` and `npm run build:coworker-scratchpad` first.

---

## File structure

```
src/resources/extensions/coworker-scratchpad/
  extension-manifest.json     ← Create: id, hooks, tools, commands (Task 5)
  mime-bundle.ts              ← Create: pure 3-slot derivation (Task 1)
  mime-bundle.test.ts         ← Create: 8 unit tests (Task 1)
  helpers.ts                  ← Create: name regex + readCellsJsonl (Task 2)
  helpers.test.ts             ← Create: name + read tests (Task 2)
  sp-command.ts               ← Create: /sp factory (Task 3)
  sp-command.test.ts          ← Create: dispatch tests w/ stub mgr (Task 3)
  scratchpad-tool.ts          ← Create: scratchpad tool factory (Task 4)
  scratchpad-tool.test.ts     ← Create: action tests w/ stub mgr (Task 4)
  index.ts                    ← Create: default export, register all (Task 5)
  index.test.ts               ← Create: live-kernel smoke test (Task 5)
```

Eleven files. Six tasks (one commit each). Tasks 1, 2 are pure-unit and fastest. Tasks 3, 4 wire dispatch with stubs. Task 5 is the integration with one real kernel spawn. Task 6 is verification only (no code changes).

---

## Task 1: `mime-bundle.ts` — pure 3-slot derivation

Convert `(value, stdout)` into a `{ "text/plain"?, "application/json"?, "text/markdown"? }` bundle. Pure, no I/O, fastest TDD win.

**Files:**
- Create: `src/resources/extensions/coworker-scratchpad/mime-bundle.ts`
- Create: `src/resources/extensions/coworker-scratchpad/mime-bundle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/resources/extensions/coworker-scratchpad/mime-bundle.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveMimeBundle } from './mime-bundle.js';

describe('deriveMimeBundle', () => {
  it('returns an empty bundle when value is undefined and stdout is empty', () => {
    assert.deepEqual(deriveMimeBundle(undefined, ''), {});
  });

  it('returns only text/plain when stdout is non-empty and value is undefined', () => {
    const b = deriveMimeBundle(undefined, 'hello\nworld');
    assert.deepEqual(b, { 'text/plain': 'hello\nworld' });
  });

  it('returns only application/json when value is a number and stdout is empty', () => {
    assert.deepEqual(deriveMimeBundle(42, ''), { 'application/json': 42 });
  });

  it('drops application/json when value is null', () => {
    assert.deepEqual(deriveMimeBundle(null, 'log'), { 'text/plain': 'log' });
  });

  it('returns text/plain AND application/json when both present', () => {
    assert.deepEqual(deriveMimeBundle({ rows: 3 }, 'loaded'), {
      'text/plain': 'loaded',
      'application/json': { rows: 3 },
    });
  });

  it('adds text/markdown when value is a string starting with # (heading)', () => {
    const b = deriveMimeBundle('# Title\n\nbody', '');
    assert.equal(b['application/json'], '# Title\n\nbody');
    assert.equal(b['text/markdown'], '# Title\n\nbody');
  });

  it('adds text/markdown when value is a string starting with | (table)', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |';
    const b = deriveMimeBundle(md, '');
    assert.equal(b['text/markdown'], md);
  });

  it('adds text/markdown when value contains a GFM table separator row mid-string', () => {
    const md = 'preamble\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
    const b = deriveMimeBundle(md, '');
    assert.equal(b['text/markdown'], md);
  });

  it('does NOT add text/markdown for plain prose strings', () => {
    const b = deriveMimeBundle('just a sentence', '');
    assert.equal(b['application/json'], 'just a sentence');
    assert.equal(b['text/markdown'], undefined);
  });

  it('keeps the value in application/json when also tagged markdown', () => {
    // A future LLM consumer that always reads application/json must not lose data
    // just because the string looked markdown-shaped.
    const b = deriveMimeBundle('# h', '');
    assert.equal(b['application/json'], '# h');
    assert.equal(b['text/markdown'], '# h');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/mime-bundle.test.ts`
Expected: FAIL — cannot find module `./mime-bundle.js`.

- [ ] **Step 3: Write the implementation**

Create `src/resources/extensions/coworker-scratchpad/mime-bundle.ts`:

```typescript
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
  // GFM table separator row: a line that is just |---|---|...
  if (/\n\s*\|[-:|\s]+\|\s*\n/.test(s)) return true;
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/mime-bundle.test.ts`
Expected: PASS — `# pass 10`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/coworker-scratchpad/mime-bundle.ts src/resources/extensions/coworker-scratchpad/mime-bundle.test.ts
git commit -m "feat(coworker-scratchpad-ext): mime-bundle — auto-derive text/plain + application/json + text/markdown"
```

---

## Task 2: `helpers.ts` — name validation + cells.jsonl reader

Two pure utilities the slash and tool surfaces both use. `validateName` enforces the scratchpad name regex; `readCellsJsonl` reads a cells.jsonl file with the same trailing-corrupt-line tolerance `CellArchive.scan` uses in 1d.

**Files:**
- Create: `src/resources/extensions/coworker-scratchpad/helpers.ts`
- Create: `src/resources/extensions/coworker-scratchpad/helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/resources/extensions/coworker-scratchpad/helpers.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCRATCHPAD_NAME_REGEX, validateName, readCellsJsonl } from './helpers.js';

describe('SCRATCHPAD_NAME_REGEX + validateName', () => {
  it('accepts simple letter-led names', () => {
    for (const ok of ['default', 'p1', 'p1-1234', 'investigation_q4', 'A', 'rca-server-01']) {
      assert.equal(SCRATCHPAD_NAME_REGEX.test(ok), true, `should accept: ${ok}`);
      assert.doesNotThrow(() => validateName(ok));
    }
  });

  it('rejects digit-led, separator-led, empty, too-long, and traversal characters', () => {
    for (const bad of ['', '1abc', '-foo', '_foo', 'foo.bar', 'foo/bar', '..', 'a/b', 'a'.repeat(65)]) {
      assert.equal(SCRATCHPAD_NAME_REGEX.test(bad), false, `should reject: ${JSON.stringify(bad)}`);
      assert.throws(() => validateName(bad), /invalid scratchpad name/);
    }
  });
});

describe('readCellsJsonl', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cells-r-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty result when cells.jsonl does not exist', () => {
    const r = readCellsJsonl(dir);
    assert.deepEqual(r, { cells: [], total_cells: 0 });
  });

  it('reads schema-header + entries; ignores trailing corrupt line', async () => {
    const lines = [
      JSON.stringify({ type: 'header', version: 1 }),
      JSON.stringify({ id: 1, parentId: null, code: 'return 1;', ok: true, value: 1, stdout: '', ts: '2026-05-31T00:00:00.000Z' }),
      JSON.stringify({ id: 2, parentId: 1, code: 'return 2;', ok: true, value: 2, stdout: '', ts: '2026-05-31T00:00:01.000Z' }),
      '{ not-json',
    ];
    await writeFile(join(dir, 'cells.jsonl'), lines.join('\n') + '\n');
    const r = readCellsJsonl(dir);
    assert.equal(r.total_cells, 2);
    assert.equal(r.cells[0].id, 1);
    assert.equal(r.cells[1].id, 2);
    assert.equal(r.cells[1].parentId, 1);
  });

  it('returns cells in chronological order (file order)', async () => {
    const lines = [
      JSON.stringify({ type: 'header', version: 1 }),
      JSON.stringify({ id: 1, parentId: null, code: 'a', ok: true, value: 'a', stdout: '', ts: 't1' }),
      JSON.stringify({ id: 2, parentId: 1, code: 'b', ok: true, value: 'b', stdout: '', ts: 't2' }),
      JSON.stringify({ id: 3, parentId: 2, code: 'c', ok: false, error: { name: 'E', message: 'm' }, stdout: '', ts: 't3' }),
    ];
    await writeFile(join(dir, 'cells.jsonl'), lines.join('\n') + '\n');
    const r = readCellsJsonl(dir);
    assert.equal(r.cells.length, 3);
    assert.equal(r.cells[2].ok, false);
    assert.equal(r.cells[2].error?.message, 'm');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/helpers.test.ts`
Expected: FAIL — cannot find module `./helpers.js`.

- [ ] **Step 3: Write the implementation**

Create `src/resources/extensions/coworker-scratchpad/helpers.ts`:

```typescript
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CellEntry } from '@otto/coworker-scratchpad';

export const SCRATCHPAD_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export function validateName(name: string): void {
  if (!SCRATCHPAD_NAME_REGEX.test(name)) {
    throw new Error(`invalid scratchpad name: ${JSON.stringify(name)} (must match ${SCRATCHPAD_NAME_REGEX})`);
  }
}

export interface CellsJsonlRead {
  cells: CellEntry[];
  total_cells: number;
}

export function readCellsJsonl(dir: string): CellsJsonlRead {
  const path = join(dir, 'cells.jsonl');
  if (!existsSync(path)) return { cells: [], total_cells: 0 };
  const cells: CellEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as { id?: unknown };
      if (typeof obj.id === 'number') cells.push(obj as CellEntry);
    } catch {
      // header line or trailing corrupt line -> skip (same tolerance as CellArchive.scan)
    }
  }
  return { cells, total_cells: cells.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/helpers.test.ts`
Expected: PASS — `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/coworker-scratchpad/helpers.ts src/resources/extensions/coworker-scratchpad/helpers.test.ts
git commit -m "feat(coworker-scratchpad-ext): helpers — name validation + cells.jsonl reader"
```

---

## Task 3: `sp-command.ts` — `/sp` factory

The slash dispatcher. Factory function `registerSpCommand(pi, deps)` takes `deps = { getManager, getCurrentName, setCurrentName }`. Tests pass a stub manager + spies on get/set current.

**Files:**
- Create: `src/resources/extensions/coworker-scratchpad/sp-command.ts`
- Create: `src/resources/extensions/coworker-scratchpad/sp-command.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/resources/extensions/coworker-scratchpad/sp-command.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSpCommand, type SpDeps } from './sp-command.js';

interface StubMgr {
  list(): Array<{ name: string; live: boolean; lastUsedAt: number }>;
  create(name: string): Promise<unknown>;
  getOrAttach(name: string): Promise<unknown>;
  remove(name: string): Promise<void>;
  rootDir(): string;
  calls: Array<[string, ...unknown[]]>;
}

function makeStub(root: string, existing: string[] = []): StubMgr {
  const calls: StubMgr['calls'] = [];
  return {
    calls,
    rootDir: () => root,
    list() { calls.push(['list']); return existing.map((n) => ({ name: n, live: false, lastUsedAt: 0 })); },
    async create(name) { calls.push(['create', name]); if (existing.includes(name)) throw new Error(`scratchpad ${name} already exists`); existing.push(name); return null; },
    async getOrAttach(name) { calls.push(['getOrAttach', name]); if (!existing.includes(name)) existing.push(name); return null; },
    async remove(name) { calls.push(['remove', name]); const i = existing.indexOf(name); if (i >= 0) existing.splice(i, 1); },
  };
}

interface FakeCtx {
  notifications: Array<[string, string]>;
  hasUI: boolean;
  cwd: string;
  ui: { notify: (msg: string, level: string) => void };
}
function makeCtx(): FakeCtx {
  const notifications: FakeCtx['notifications'] = [];
  return { notifications, hasUI: false, cwd: process.cwd(), ui: { notify: (m, l) => notifications.push([l, m]) } };
}

interface FakePi {
  commands: Map<string, { description: string; handler: (args: string, ctx: FakeCtx) => Promise<void>; getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }> }>;
  registerCommand(name: string, opts: { description: string; handler: (args: string, ctx: FakeCtx) => Promise<void>; getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }> }): void;
}
function makePi(): FakePi {
  const commands = new Map();
  return { commands, registerCommand(name, opts) { commands.set(name, opts); } };
}

let root: string;

describe('sp-command dispatch (stubbed manager)', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sp-root-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function wire(existing: string[] = []): { pi: FakePi; ctx: FakeCtx; mgr: StubMgr; current: { name: string | null } } {
    const pi = makePi();
    const ctx = makeCtx();
    const mgr = makeStub(root, existing);
    const current = { name: null as string | null };
    const deps: SpDeps = {
      getManager: () => mgr as unknown as SpDeps['getManager'] extends () => infer T ? T : never,
      getCurrentName: () => current.name,
      setCurrentName: (n) => { current.name = n; },
      rootDir: () => root,
    } as SpDeps;
    registerSpCommand(pi as unknown as Parameters<typeof registerSpCommand>[0], deps);
    return { pi, ctx, mgr, current };
  }

  it('/sp with no verb dispatches to list', async () => {
    const { pi, ctx, mgr } = wire(['default']);
    await pi.commands.get('sp')!.handler('', ctx);
    assert.equal(mgr.calls[0][0], 'list');
    assert.ok(ctx.notifications.some(([_l, m]) => m.includes('default')));
  });

  it('/sp new <name> creates and sets currentName', async () => {
    const { pi, ctx, mgr, current } = wire();
    await pi.commands.get('sp')!.handler('new p1', ctx);
    assert.deepEqual(mgr.calls, [['create', 'p1']]);
    assert.equal(current.name, 'p1');
  });

  it('/sp new with invalid name errors before touching manager', async () => {
    const { pi, ctx, mgr, current } = wire();
    await pi.commands.get('sp')!.handler('new 1bad', ctx);
    assert.deepEqual(mgr.calls, []);
    assert.equal(current.name, null);
    assert.ok(ctx.notifications.some(([l, m]) => l === 'error' && /invalid scratchpad name/.test(m)));
  });

  it('/sp attach <name> warms and sets currentName', async () => {
    const { pi, ctx, mgr, current } = wire(['p1']);
    await pi.commands.get('sp')!.handler('attach p1', ctx);
    assert.deepEqual(mgr.calls, [['getOrAttach', 'p1']]);
    assert.equal(current.name, 'p1');
  });

  it('/sp reset <name> calls remove then create; preserves currentName when matched', async () => {
    const { pi, ctx, mgr, current } = wire(['p1']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('reset p1', ctx);
    assert.deepEqual(mgr.calls, [['remove', 'p1'], ['create', 'p1']]);
    assert.equal(current.name, 'p1');
  });

  it('/sp view <name> reads cells.jsonl and emits a summary', async () => {
    const { pi, ctx } = wire(['p1']);
    await mkdir(join(root, 'p1'), { recursive: true });
    await writeFile(join(root, 'p1', 'cells.jsonl'), [
      JSON.stringify({ type: 'header', version: 1 }),
      JSON.stringify({ id: 1, parentId: null, code: 'return 1;', ok: true, value: 1, stdout: '', ts: 't1' }),
    ].join('\n') + '\n');
    await pi.commands.get('sp')!.handler('view p1', ctx);
    assert.ok(ctx.notifications.some(([_l, m]) => m.includes('cell 1') || m.includes('return 1;')));
  });

  it('/sp remove <name> deletes and clears currentName if matched', async () => {
    const { pi, ctx, mgr, current } = wire(['p1']);
    current.name = 'p1';
    await pi.commands.get('sp')!.handler('remove p1', ctx);
    assert.deepEqual(mgr.calls, [['remove', 'p1']]);
    assert.equal(current.name, null);
  });

  it('/sp view (no name, no current) auto-attaches to default', async () => {
    const { pi, ctx, mgr, current } = wire();
    await pi.commands.get('sp')!.handler('view', ctx);
    // ensureCurrent returned 'default'; view tries to read cells.jsonl which is missing -> empty result
    assert.equal(current.name, 'default');
    assert.ok(ctx.notifications.some(([_l, m]) => /no cells yet/i.test(m) || /total_cells.*0/.test(m)));
  });

  it('getArgumentCompletions returns existing scratchpad names for verb-2nd-arg', async () => {
    const { pi } = wire();
    await mkdir(join(root, 'investigation-1'), { recursive: true });
    await writeFile(join(root, 'investigation-1', 'meta.json'), JSON.stringify({ name: 'investigation-1' }));
    await mkdir(join(root, 'p1-1234'), { recursive: true });
    await writeFile(join(root, 'p1-1234', 'meta.json'), JSON.stringify({ name: 'p1-1234' }));
    const completions = pi.commands.get('sp')!.getArgumentCompletions!('attach ');
    const values = completions.map((c) => c.value).sort();
    assert.deepEqual(values, ['attach investigation-1', 'attach p1-1234']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/sp-command.test.ts`
Expected: FAIL — cannot find module `./sp-command.js`.

- [ ] **Step 3: Write the implementation**

Create `src/resources/extensions/coworker-scratchpad/sp-command.ts`:

```typescript
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@otto/pi-coding-agent';
import type { ScratchpadManager } from '@otto/coworker-scratchpad';
import { validateName, readCellsJsonl } from './helpers.js';

export interface SpDeps {
  getManager: () => ScratchpadManager;
  getCurrentName: () => string | null;
  setCurrentName: (name: string | null) => void;
  rootDir: () => string;
}

type SpVerb = 'list' | 'new' | 'attach' | 'reset' | 'view' | 'remove';
const VERBS: SpVerb[] = ['list', 'new', 'attach', 'reset', 'view', 'remove'];

function ensureCurrent(deps: SpDeps): string {
  let current = deps.getCurrentName();
  if (!current) {
    current = 'default';
    deps.setCurrentName(current);
  }
  return current;
}

function listExistingScratchpads(root: string): string[] {
  if (!existsSync(root)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    try {
      if (statSync(dir).isDirectory() && existsSync(join(dir, 'meta.json'))) names.push(entry);
    } catch {
      // entry vanished -> skip
    }
  }
  return names.sort();
}

function formatCellSummary(rec: { id: number; ok: boolean; code: string; value?: unknown; error?: { message: string } }): string {
  const head = rec.ok ? `cell ${rec.id} [ok]` : `cell ${rec.id} [err]`;
  const value = rec.ok ? ` value=${JSON.stringify(rec.value)}` : ` error=${rec.error?.message ?? ''}`;
  return `${head} ${rec.code.split('\n')[0].slice(0, 80)} ${value}`;
}

interface UiCtx {
  hasUI: boolean;
  ui: { notify: (msg: string, level: 'info' | 'error' | 'warning') => void };
}

export function registerSpCommand(pi: ExtensionAPI, deps: SpDeps): void {
  pi.registerCommand('sp', {
    description: 'Manage scratchpads: /sp [list|new|attach|reset|view|remove] [name]',
    getArgumentCompletions: (prefix: string) => {
      const parts = prefix.trim().split(/\s+/);
      if (parts.length <= 1) {
        return VERBS.filter((v) => v.startsWith(parts[0] ?? '')).map((v) => ({ value: v, label: v }));
      }
      const verb = parts[0];
      if (verb === 'attach' || verb === 'reset' || verb === 'view' || verb === 'remove') {
        const namePrefix = parts[1] ?? '';
        return listExistingScratchpads(deps.rootDir())
          .filter((n) => n.startsWith(namePrefix))
          .map((n) => ({ value: `${verb} ${n}`, label: n }));
      }
      return [];
    },
    handler: async (args: string, ctx: UiCtx) => {
      const trimmed = args.trim();
      const parts = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
      const verb = (parts[0] as SpVerb | undefined) ?? 'list';
      const name = parts[1];

      try {
        switch (verb) {
          case 'list': {
            const mgr = deps.getManager();
            const live = mgr.list();
            const liveByName = new Map(live.map((e) => [e.name, e]));
            const onDisk = listExistingScratchpads(deps.rootDir());
            const all = Array.from(new Set([...liveByName.keys(), ...onDisk])).sort();
            const cur = deps.getCurrentName();
            if (all.length === 0) {
              ctx.ui.notify('No scratchpads yet. Use /sp new <name> to create one.', 'info');
              return;
            }
            const lines = all.map((n) => {
              const l = liveByName.get(n);
              const state = l?.live ? '● live' : '○ cold';
              const marker = n === cur ? ' (current)' : '';
              return `  ${state}  ${n}${marker}`;
            });
            ctx.ui.notify(['scratchpads:', ...lines].join('\n'), 'info');
            return;
          }
          case 'new': {
            if (!name) { ctx.ui.notify('Usage: /sp new <name>', 'error'); return; }
            validateName(name);
            await deps.getManager().create(name);
            deps.setCurrentName(name);
            ctx.ui.notify(`created scratchpad: ${name} (now current)`, 'info');
            return;
          }
          case 'attach': {
            if (!name) { ctx.ui.notify('Usage: /sp attach <name>', 'error'); return; }
            validateName(name);
            await deps.getManager().getOrAttach(name);
            deps.setCurrentName(name);
            ctx.ui.notify(`attached to scratchpad: ${name}`, 'info');
            return;
          }
          case 'reset': {
            const target = name ?? ensureCurrent(deps);
            validateName(target);
            const mgr = deps.getManager();
            await mgr.remove(target);
            await mgr.create(target);
            // currentName preserved if it was the reset target; otherwise unchanged
            ctx.ui.notify(`reset scratchpad: ${target}`, 'info');
            return;
          }
          case 'view': {
            const target = name ?? ensureCurrent(deps);
            validateName(target);
            const { cells, total_cells } = readCellsJsonl(join(deps.rootDir(), target));
            if (total_cells === 0) {
              ctx.ui.notify(`${target}: no cells yet`, 'info');
              return;
            }
            const tail = cells.slice(-10);
            const lines = tail.map((c) => formatCellSummary(c));
            ctx.ui.notify([`${target} (${total_cells} cells, last 10):`, ...lines].join('\n'), 'info');
            return;
          }
          case 'remove': {
            if (!name) { ctx.ui.notify('Usage: /sp remove <name>', 'error'); return; }
            validateName(name);
            await deps.getManager().remove(name);
            if (deps.getCurrentName() === name) deps.setCurrentName(null);
            ctx.ui.notify(`removed scratchpad: ${name}`, 'info');
            return;
          }
          default: {
            ctx.ui.notify(`unknown verb: ${verb}. Try one of: ${VERBS.join(', ')}`, 'error');
          }
        }
      } catch (err) {
        ctx.ui.notify((err as Error).message, 'error');
      }
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/sp-command.test.ts`
Expected: PASS — `# pass 9`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/coworker-scratchpad/sp-command.ts src/resources/extensions/coworker-scratchpad/sp-command.test.ts
git commit -m "feat(coworker-scratchpad-ext): /sp slash command (list|new|attach|reset|view|remove)"
```

---

## Task 4: `scratchpad-tool.ts` — LLM tool factory

The `scratchpad` LLM tool with two actions (`exec`, `view`). Factory takes the same `deps` as Task 3.

**Files:**
- Create: `src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts`
- Create: `src/resources/extensions/coworker-scratchpad/scratchpad-tool.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/resources/extensions/coworker-scratchpad/scratchpad-tool.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerScratchpadTool } from './scratchpad-tool.js';

interface StubMgr {
  runCell(name: string, code: string): Promise<{ value: unknown; stdout: string }>;
  calls: Array<['runCell', string, string]>;
  nextResult: { value: unknown; stdout: string } | { throw: Error };
}
function makeStub(): StubMgr {
  const calls: StubMgr['calls'] = [];
  return {
    calls,
    nextResult: { value: undefined, stdout: '' },
    async runCell(name, code) {
      calls.push(['runCell', name, code]);
      if ('throw' in this.nextResult) throw this.nextResult.throw;
      return this.nextResult;
    },
  };
}

interface FakePi {
  tools: Map<string, { name: string; handler: (params: unknown, ctx: unknown) => Promise<unknown> }>;
  registerTool(opts: { name: string; handler: (params: unknown, ctx: unknown) => Promise<unknown>; [k: string]: unknown }): void;
}
function makePi(): FakePi {
  const tools = new Map();
  return { tools, registerTool(opts) { tools.set(opts.name, opts); } };
}

let root: string;

describe('scratchpad-tool dispatch (stubbed manager)', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'stool-root-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function wire(currentName: string | null = null): { pi: FakePi; mgr: StubMgr; current: { name: string | null } } {
    const pi = makePi();
    const mgr = makeStub();
    const current = { name: currentName };
    registerScratchpadTool(pi as unknown as Parameters<typeof registerScratchpadTool>[0], {
      getManager: () => mgr as unknown as Parameters<typeof registerScratchpadTool>[1]['getManager'] extends () => infer T ? T : never,
      getCurrentName: () => current.name,
      setCurrentName: (n) => { current.name = n; },
      rootDir: () => root,
    } as Parameters<typeof registerScratchpadTool>[1]);
    return { pi, mgr, current };
  }

  it('exec without name uses currentName (or auto-default)', async () => {
    const { pi, mgr, current } = wire(null);
    mgr.nextResult = { value: 42, stdout: '' };
    const res = await pi.tools.get('scratchpad')!.handler({ action: 'exec', code: 'return 42;' }, {}) as { ok: boolean; mime: Record<string, unknown> };
    assert.equal(current.name, 'default');
    assert.deepEqual(mgr.calls, [['runCell', 'default', 'return 42;']]);
    assert.equal(res.ok, true);
    assert.equal(res.mime['application/json'], 42);
  });

  it('exec with explicit name does NOT change currentName', async () => {
    const { pi, mgr, current } = wire('p1');
    mgr.nextResult = { value: 'ok', stdout: '' };
    await pi.tools.get('scratchpad')!.handler({ action: 'exec', name: 'side', code: 'return "ok";' }, {});
    assert.deepEqual(mgr.calls, [['runCell', 'side', 'return "ok";']]);
    assert.equal(current.name, 'p1');
  });

  it('exec returns ok:false when manager throws', async () => {
    const { pi, mgr } = wire('p1');
    mgr.nextResult = { throw: Object.assign(new Error('boom'), { name: 'BoomError' }) } as any;
    const res = await pi.tools.get('scratchpad')!.handler({ action: 'exec', code: 'throw new Error("boom");' }, {}) as { ok: boolean; error: { name: string; message: string } };
    assert.equal(res.ok, false);
    assert.equal(res.error.name, 'BoomError');
    assert.match(res.error.message, /boom/);
  });

  it('view returns tail-5 by default and the right total_cells', async () => {
    const { pi } = wire('p1');
    await mkdir(join(root, 'p1'), { recursive: true });
    const lines = [JSON.stringify({ type: 'header', version: 1 })];
    for (let i = 1; i <= 8; i++) {
      lines.push(JSON.stringify({ id: i, parentId: i === 1 ? null : i - 1, code: `return ${i};`, ok: true, value: i, stdout: '', ts: `t${i}` }));
    }
    await writeFile(join(root, 'p1', 'cells.jsonl'), lines.join('\n') + '\n');
    const res = await pi.tools.get('scratchpad')!.handler({ action: 'view' }, {}) as { cells: Array<{ id: number }>; total_cells: number };
    assert.equal(res.total_cells, 8);
    assert.equal(res.cells.length, 5);
    assert.deepEqual(res.cells.map((c) => c.id), [4, 5, 6, 7, 8]);
  });

  it('view caps tail at 20', async () => {
    const { pi } = wire('p1');
    await mkdir(join(root, 'p1'), { recursive: true });
    const lines = [JSON.stringify({ type: 'header', version: 1 })];
    for (let i = 1; i <= 30; i++) {
      lines.push(JSON.stringify({ id: i, parentId: i === 1 ? null : i - 1, code: 'x', ok: true, value: i, stdout: '', ts: 't' }));
    }
    await writeFile(join(root, 'p1', 'cells.jsonl'), lines.join('\n') + '\n');
    const res = await pi.tools.get('scratchpad')!.handler({ action: 'view', tail: 100 }, {}) as { cells: unknown[] };
    assert.equal(res.cells.length, 20);
  });

  it('view with from_id returns cells with id >= from_id', async () => {
    const { pi } = wire('p1');
    await mkdir(join(root, 'p1'), { recursive: true });
    const lines = [JSON.stringify({ type: 'header', version: 1 })];
    for (let i = 1; i <= 10; i++) {
      lines.push(JSON.stringify({ id: i, parentId: i === 1 ? null : i - 1, code: 'x', ok: true, value: i, stdout: '', ts: 't' }));
    }
    await writeFile(join(root, 'p1', 'cells.jsonl'), lines.join('\n') + '\n');
    const res = await pi.tools.get('scratchpad')!.handler({ action: 'view', from_id: 7 }, {}) as { cells: Array<{ id: number }> };
    assert.deepEqual(res.cells.map((c) => c.id), [7, 8, 9, 10]);
  });

  it('view truncates value strings to 200 chars and stdout to 500 chars', async () => {
    const { pi } = wire('p1');
    await mkdir(join(root, 'p1'), { recursive: true });
    const longValue = 'x'.repeat(500);
    const longStdout = 'y'.repeat(1000);
    const lines = [
      JSON.stringify({ type: 'header', version: 1 }),
      JSON.stringify({ id: 1, parentId: null, code: 'long', ok: true, value: longValue, stdout: longStdout, ts: 't' }),
    ];
    await writeFile(join(root, 'p1', 'cells.jsonl'), lines.join('\n') + '\n');
    const res = await pi.tools.get('scratchpad')!.handler({ action: 'view' }, {}) as { cells: Array<{ value: string; stdout: string }> };
    assert.equal(res.cells[0].value.length, 200);
    assert.equal(res.cells[0].stdout.length, 500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/scratchpad-tool.test.ts`
Expected: FAIL — cannot find module `./scratchpad-tool.js`.

- [ ] **Step 3: Write the implementation**

Create `src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts`:

```typescript
import { join } from 'node:path';
import { StringEnum } from '@otto/pi-ai';
import type { ExtensionAPI } from '@otto/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import type { ScratchpadManager, CellEntry } from '@otto/coworker-scratchpad';
import { validateName, readCellsJsonl } from './helpers.js';
import { deriveMimeBundle, type MimeBundle } from './mime-bundle.js';

export interface ScratchpadToolDeps {
  getManager: () => ScratchpadManager;
  getCurrentName: () => string | null;
  setCurrentName: (name: string | null) => void;
  rootDir: () => string;
}

const VIEW_DEFAULT_TAIL = 5;
const VIEW_MAX_TAIL = 20;
const VALUE_TRUNCATE = 200;
const STDOUT_TRUNCATE = 500;

interface ExecResultOk {
  ok: true;
  cell_id: number;
  total_cells: number;
  mime: MimeBundle;
}
interface ExecResultErr {
  ok: false;
  cell_id: number;
  total_cells: number;
  error: { name: string; message: string };
}
type ExecResult = ExecResultOk | ExecResultErr;

interface ViewCell {
  id: number;
  parentId: number | null;
  ts: string;
  code: string;
  ok: boolean;
  value?: unknown;
  error?: { name: string; message: string };
  stdout: string;
}
interface ViewResult {
  name: string;
  cells: ViewCell[];
  total_cells: number;
}

function ensureCurrent(deps: ScratchpadToolDeps): string {
  let current = deps.getCurrentName();
  if (!current) {
    current = 'default';
    deps.setCurrentName(current);
  }
  return current;
}

function resolveName(deps: ScratchpadToolDeps, explicit?: string): string {
  if (explicit) {
    validateName(explicit);
    return explicit;
  }
  return ensureCurrent(deps);
}

function truncateValue(value: unknown): unknown {
  if (typeof value === 'string' && value.length > VALUE_TRUNCATE) {
    return value.slice(0, VALUE_TRUNCATE);
  }
  return value;
}

function projectViewCell(c: CellEntry): ViewCell {
  return {
    id: c.id,
    parentId: c.parentId,
    ts: c.ts,
    code: c.code,
    ok: c.ok,
    value: c.ok ? truncateValue(c.value) : undefined,
    error: c.ok ? undefined : c.error,
    stdout: (c.stdout ?? '').slice(0, STDOUT_TRUNCATE),
  };
}

export function registerScratchpadTool(pi: ExtensionAPI, deps: ScratchpadToolDeps): void {
  pi.registerTool({
    name: 'scratchpad',
    label: 'Scratchpad',
    description:
      'Run TypeScript cells in a persistent kernel scoped to a named scratchpad. State persists across cells via globalThis.* and across Otto sessions via on-disk kernel.db + namespace.json. ' +
      'Pre-bound libs in every cell: polars, DuckDB, ExcelJS, dateFns, lodash, zod, axios. otto.collectors.{list,open} enumerates and loads data sources. ' +
      'Actions: exec (run a cell), view (return the last N cells).',
    promptGuidelines: [
      'Use action="exec" to run TypeScript code in the current scratchpad. State persists across calls.',
      'The cell body is wrapped in (async () => { ... })(). let/const/var are local to the cell. To persist, assign to globalThis.foo = ...',
      'For DuckDB tables that survive across Otto sessions, use `await otto.duckdb.connect()`. For ephemeral in-memory, use `DuckDB.DuckDBInstance.create(":memory:")`.',
      'Pre-bound libs available in every cell: polars, DuckDB, ExcelJS, dateFns, lodash, zod, axios. No imports needed.',
      'Use otto.collectors.list() to discover data sources and otto.collectors.open(uri) to load one.',
      'The `name` parameter defaults to the currently attached scratchpad. Omit it unless you want to operate on a different one (this does NOT switch the user attachment).',
      'A returned string that looks markdown-shaped will appear in the response as text/markdown automatically. Return a markdown table or heading to render it.',
      'Use action="view" to see the last 5 cells (default). Pass tail=20 or from_id to see more.',
      'A failed cell IS recorded; the next view call will show it. Use this to recover.',
      'Default cell timeout is 120s. Long operations should call progress("status") periodically to reset the inactivity timer.',
    ],
    parameters: Type.Object({
      action: StringEnum(['exec', 'view'] as const),
      name: Type.Optional(Type.String({ description: "Scratchpad name; defaults to the current session attachment, auto-creating 'default' if none." })),
      code: Type.Optional(Type.String({ description: "TypeScript cell code (action='exec' only)." })),
      tail: Type.Optional(Type.Number({ description: `How many trailing cells to return (action='view' only). Default ${VIEW_DEFAULT_TAIL}, max ${VIEW_MAX_TAIL}.` })),
      from_id: Type.Optional(Type.Number({ description: "If set, view returns cells with id >= from_id (overrides tail)." })),
    }),
    handler: async (params: { action: 'exec' | 'view'; name?: string; code?: string; tail?: number; from_id?: number }): Promise<ExecResult | ViewResult> => {
      const name = resolveName(deps, params.name);

      if (params.action === 'exec') {
        if (!params.code) {
          throw new Error('code is required for action="exec"');
        }
        const mgr = deps.getManager();
        try {
          const { value, stdout } = await mgr.runCell(name, params.code);
          const { total_cells } = readCellsJsonl(join(deps.rootDir(), name));
          return { ok: true, cell_id: total_cells, total_cells, mime: deriveMimeBundle(value, stdout) };
        } catch (err) {
          const e = err as Error;
          const { total_cells } = readCellsJsonl(join(deps.rootDir(), name));
          return { ok: false, cell_id: total_cells, total_cells, error: { name: e.name, message: e.message } };
        }
      }

      // view
      const { cells, total_cells } = readCellsJsonl(join(deps.rootDir(), name));
      let selected: CellEntry[];
      if (typeof params.from_id === 'number') {
        selected = cells.filter((c) => c.id >= params.from_id!);
      } else {
        const tail = Math.min(params.tail ?? VIEW_DEFAULT_TAIL, VIEW_MAX_TAIL);
        selected = cells.slice(-tail);
      }
      return { name, cells: selected.map(projectViewCell), total_cells };
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/scratchpad-tool.test.ts`
Expected: PASS — `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts src/resources/extensions/coworker-scratchpad/scratchpad-tool.test.ts
git commit -m "feat(coworker-scratchpad-ext): scratchpad LLM tool (exec, view) with MIME bundle response"
```

---

## Task 5: `index.ts` + `extension-manifest.json` + live-kernel smoke test

Wire everything together. The extension default-exports `(pi: ExtensionAPI) => void` that captures session-derived state in closures and registers the slash + tool surface. One integration test spawns a real kernel and asserts the end-to-end shape.

**Files:**
- Create: `src/resources/extensions/coworker-scratchpad/extension-manifest.json`
- Create: `src/resources/extensions/coworker-scratchpad/index.ts`
- Create: `src/resources/extensions/coworker-scratchpad/index.test.ts`

- [ ] **Step 1: Create the manifest**

Create `src/resources/extensions/coworker-scratchpad/extension-manifest.json`:

```json
{
  "id": "coworker-scratchpad",
  "name": "Co-worker Scratchpad",
  "version": "1.0.0",
  "description": "Persistent TypeScript scratchpad kernel: /sp slash commands and scratchpad tool with MIME bundle responses",
  "tier": "bundled",
  "requires": { "platform": ">=2.29.0" },
  "provides": {
    "tools": ["scratchpad"],
    "commands": ["sp"],
    "hooks": ["session_start", "session_shutdown"]
  }
}
```

- [ ] **Step 2: Write the failing integration test**

Create `src/resources/extensions/coworker-scratchpad/index.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import coworkerScratchpadExtension from './index.js';

// Minimal pi.ExtensionAPI stub — captures registrations and lets us fire session_start/session_shutdown.
interface StubPi {
  commands: Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void> }>;
  tools: Map<string, { name: string; handler: (params: any, ctx: any) => Promise<any> }>;
  hooks: Map<string, Array<(event: any, ctx: any) => Promise<void>>>;
  registerCommand(name: string, opts: any): void;
  registerTool(opts: any): void;
  on(event: string, fn: (event: any, ctx: any) => Promise<void>): void;
  fire(event: string, payload: any, ctx: any): Promise<void>;
}
function makePi(): StubPi {
  const commands = new Map();
  const tools = new Map();
  const hooks = new Map();
  return {
    commands, tools, hooks,
    registerCommand(name, opts) { commands.set(name, opts); },
    registerTool(opts) { tools.set(opts.name, opts); },
    on(event, fn) { if (!hooks.has(event)) hooks.set(event, []); hooks.get(event)!.push(fn); },
    async fire(event, payload, ctx) {
      for (const fn of hooks.get(event) ?? []) await fn(payload, ctx);
    },
  };
}

describe('coworker-scratchpad extension (live kernel)', () => {
  let workspace: string;
  let scratchpadRoot: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'spext-ws-'));
    await mkdir(join(workspace, '.otto', 'inputs'), { recursive: true });
    scratchpadRoot = await mkdtemp(join(tmpdir(), 'spext-root-'));
    process.env.OTTO_SCRATCHPAD_ROOT = scratchpadRoot; // see index.ts: honors this env var for tests
  });
  afterEach(async () => {
    delete process.env.OTTO_SCRATCHPAD_ROOT;
    await rm(workspace, { recursive: true, force: true });
    await rm(scratchpadRoot, { recursive: true, force: true });
  });

  it('registers /sp and scratchpad after session_start; survives exec + dispose', async () => {
    const pi = makePi();
    coworkerScratchpadExtension(pi as any);

    // session_start fires after registration; the index.ts handler captures ctx for the manager.
    await pi.fire('session_start', {}, {
      cwd: workspace,
      sessionManager: { getSessionFile: () => undefined },
      hasUI: false,
      ui: { notify: () => {} },
    });

    assert.ok(pi.commands.has('sp'), 'sp slash command registered');
    assert.ok(pi.tools.has('scratchpad'), 'scratchpad tool registered');

    // Run a cell via the scratchpad tool.
    const exec = await pi.tools.get('scratchpad')!.handler(
      { action: 'exec', code: 'globalThis.x = 42; return globalThis.x;' },
      {},
    );
    assert.equal(exec.ok, true);
    assert.equal(exec.cell_id, 1);
    assert.deepEqual(exec.mime, { 'application/json': 42 });
    assert.ok(existsSync(join(scratchpadRoot, 'default', 'kernel.db')), 'kernel.db created');
    assert.ok(existsSync(join(scratchpadRoot, 'default', 'cells.jsonl')), 'cells.jsonl created');

    // View shows the cell.
    const view = await pi.tools.get('scratchpad')!.handler({ action: 'view' }, {});
    assert.equal(view.total_cells, 1);
    assert.equal(view.cells[0].id, 1);
    assert.equal(view.cells[0].ok, true);
    assert.equal(view.cells[0].value, 42);

    // session_shutdown disposes the manager (kernel exits cleanly).
    await pi.fire('session_shutdown', {}, {});
    // After shutdown a re-exec would re-spawn; we don't assert that here (covered by manager tests).
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/index.test.ts`
Expected: FAIL — cannot find module `./index.js`.

- [ ] **Step 4: Write the implementation**

Create `src/resources/extensions/coworker-scratchpad/index.ts`:

```typescript
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@otto/pi-coding-agent';
import { ScratchpadManager } from '@otto/coworker-scratchpad';
import { registerSpCommand } from './sp-command.js';
import { registerScratchpadTool } from './scratchpad-tool.js';

interface SessionCtx extends ExtensionContext {
  cwd: string;
  sessionManager?: { getSessionFile?: () => string | undefined };
}

function deriveScratchpadRoot(): string {
  // Test override; production uses the standard user-global location per spec §3.3.
  return process.env.OTTO_SCRATCHPAD_ROOT ?? join(homedir(), '.otto', 'scratchpads');
}

function deriveSessionId(ctx: SessionCtx): string {
  const file = ctx.sessionManager?.getSessionFile?.();
  if (!file) return 'default';
  // The session file is something like /.../session-<id>.jsonl. Strip the extension; if none, use the basename as-is.
  const base = basename(file);
  return base.endsWith('.jsonl') ? base.slice(0, -6) : base;
}

export default function coworkerScratchpadExtension(pi: ExtensionAPI): void {
  let manager: ScratchpadManager | null = null;
  let workspaceCwd: string | null = null;
  let sessionId: string | null = null;
  let currentName: string | null = null;
  const root = deriveScratchpadRoot();

  const getManager = (): ScratchpadManager => {
    if (!manager) {
      if (!workspaceCwd) throw new Error('scratchpad: manager requested before session_start');
      manager = new ScratchpadManager({
        workspace: workspaceCwd,
        root,
        sessionId: sessionId ?? 'default',
      });
    }
    return manager;
  };
  const getCurrentName = (): string | null => currentName;
  const setCurrentName = (n: string | null): void => { currentName = n; };
  const rootDir = (): string => root;

  // Register surface up-front (closures capture the lazy accessors).
  registerSpCommand(pi, { getManager, getCurrentName, setCurrentName, rootDir });
  registerScratchpadTool(pi, { getManager, getCurrentName, setCurrentName, rootDir });

  pi.on('session_start', async (_event, ctx) => {
    const sessionCtx = ctx as SessionCtx;
    workspaceCwd = sessionCtx.cwd;
    sessionId = deriveSessionId(sessionCtx);
  });

  pi.on('session_shutdown', async () => {
    if (manager) {
      await manager.disposeAll();
      manager = null;
    }
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/index.test.ts`
Expected: PASS — `# pass 1`, `# fail 0`. First run is slow while the DuckDB native addon loads.

- [ ] **Step 6: Commit**

```bash
git add src/resources/extensions/coworker-scratchpad/extension-manifest.json src/resources/extensions/coworker-scratchpad/index.ts src/resources/extensions/coworker-scratchpad/index.test.ts
git commit -m "feat(coworker-scratchpad-ext): wire extension default export + session_start/shutdown + live-kernel smoke test"
```

---

## Task 6: Build + gate verification

The extension is auto-discovered by `src/extension-discovery.ts` because it has a valid `extension-manifest.json` with `tier: "bundled"` in `src/resources/extensions/`. No loader-registration step. This task just runs the gates.

**Files:** none modified in this task.

- [ ] **Step 1: Build the TS project**

Run: `npm run build`
Expected: exit 0. The new extension files compile to `dist/resources/extensions/coworker-scratchpad/*.js`.

- [ ] **Step 2: Run the workspace package gate**

Run: `npm run test:packages`
Expected: exit 0; `@otto/coworker-scratchpad` package tests are unaffected (Task 5 didn't touch the package, only the extension consumes it).

- [ ] **Step 3: Run the workspace coverage gate**

Run: `npm run verify:workspace-coverage`
Expected: `All 15 linkable packages have test coverage.` Unchanged from 1d2.

- [ ] **Step 4: Run the four new extension test files together**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/coworker-scratchpad/mime-bundle.test.ts \
  src/resources/extensions/coworker-scratchpad/helpers.test.ts \
  src/resources/extensions/coworker-scratchpad/sp-command.test.ts \
  src/resources/extensions/coworker-scratchpad/scratchpad-tool.test.ts \
  src/resources/extensions/coworker-scratchpad/index.test.ts
```
Expected: every test from Tasks 1–5 passes; total is 32 (10 mime + 5 helpers + 9 sp-command + 7 scratchpad-tool + 1 index), 0 failures.

- [ ] **Step 5: Sanity-check the extension is discovered**

Run: `grep -l "coworker-scratchpad" dist/resources/extensions/coworker-scratchpad/*.json 2>/dev/null && grep -l "coworker-scratchpad" src/resources/extensions/coworker-scratchpad/extension-manifest.json`
Expected: both the source manifest and (after build) the dist manifest exist. This is the same shape that makes `bg-shell` and `analyst` discoverable.

- [ ] **Step 6: No new commit needed** — this task is verification only. If something failed, debug and add a fix-up commit; otherwise the previous task's commit closes the phase.

---

## Self-Review

**1. Spec coverage (§4 of the brainstorm spec):**
- §4.1 file layout — slightly reshaped (state.ts merged into closures in index.ts; helpers.ts split out for pure utils) but every responsibility is covered. ✓
- §4.2 dependency-injection seam — `SpDeps` / `ScratchpadToolDeps` in Tasks 3 + 4; tests use stub managers. ✓
- §4.3 singleton + currentName state — closures in `index.ts` (Task 5) hold `manager`, `currentName`, `workspaceCwd`, `sessionId`. ✓
- §4.4 index.ts shape — Task 5 Step 4 spells it out; uses `session_start` for ctx capture and `session_shutdown` for dispose (not `pi.onExit` — the spec was slightly wrong about the API name; corrected in the plan header). ✓
- §4.5 MIME bundle module — Task 1 ships the exact module the spec describes. ✓
- §4.6 `/sp` command surface — Task 3 implements all six verbs with the exact behaviors from the table; argument completion reads from `<root>/*/meta.json`. ✓
- §4.7 `scratchpad` tool surface — Task 4 implements `exec` + `view` with the exact parameter shape and response shapes; validates name; truncates value to 200 and stdout to 500. ✓
- §4.8 prompt guidelines — Task 4 Step 3 includes all 10 bullets from the spec. ✓
- §5 error handling — every spec row is covered: invalid name → `validateName` throws → handler catches; missing cells.jsonl → `readCellsJsonl` returns empty; cell throws → `ok:false` with `cell_id` from `readCellsJsonl(total_cells)`; first call with no current → `ensureCurrent` returns `'default'`. ✓
- §6 integration risk — all six items are addressed: pi API confirmed against `bg-shell` and `analyst`; teardown uses `session_shutdown` (no `onExit`); extension auto-discovered via `tier: "bundled"`; DuckDB cold load accepted via default 120s timeout; readdir per keystroke acceptable; markdown false-positives bounded because `application/json` is always present. ✓
- §7 test plan — six tasks, TDD per task, one commit each. ✓
- §8 deferred items — all listed at the top of this plan under "Known intentional gaps". ✓

**2. Placeholder scan:** No "TBD"/"TODO"/"similar to Task N"/"add error handling". Every step's code block is complete; every run step has an exact command + expected output. ✓

**3. Type consistency:**
- `SpDeps` (Task 3) and `ScratchpadToolDeps` (Task 4) share the same four fields: `getManager`, `getCurrentName`, `setCurrentName`, `rootDir`. Same shape, intentionally; `index.ts` (Task 5) constructs one deps object and passes to both. ✓
- `MimeBundle` (Task 1) is imported by Task 4 via `import { deriveMimeBundle, type MimeBundle } from './mime-bundle.js'`. ✓
- `CellEntry` is imported from `@otto/coworker-scratchpad` (1d's `cell-archive.ts` exports it via the barrel; verified). ✓
- `validateName` and `readCellsJsonl` defined in Task 2 are consumed by both Task 3 (`sp-command.ts`) and Task 4 (`scratchpad-tool.ts`). ✓
- `ExtensionContext`, `ExtensionAPI` imported from `@otto/pi-coding-agent` everywhere; `Type` from `@sinclair/typebox`; `StringEnum` from `@otto/pi-ai`. Matches the bg-shell pattern. ✓

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-31-coworker-phase-1e-extension-tool-mime.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batched with checkpoints for review.

Which approach?
