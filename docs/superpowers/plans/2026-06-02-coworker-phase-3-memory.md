# Phase 3 — otto-memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Graduate `@otto/coworker-memory` from `export {}` stub to read+write memory pillar covering Layer A (behavior/rules markdown) and Layer B (verbatim drawers in SQLite + FTS5) with a pluggable `MemoryBackend` interface, satisfying the Day-2 milestone: paste an incident note Monday → recall the exact words Tuesday with a `drawer://` citation.

**Architecture:** Flat `drawers` SQLite schema with content-linked FTS5 (BM25 ranking, unicode61 tokenizer). Layer A is per-scope markdown (profile.md / rules.md / lessons.md) with YAML frontmatter; Layer B is one workspace-scoped SQLite file at `<workspace>/.otto/memory/layer-b.db`. Auto-retain writes every user turn as a drawer (kind=`turn` or `paste` per heuristic); SecretScanner gates writes — Layer A blocks on detection, Layer B redacts. Three scoping modes (global, per-project, per-project-tagged) drive wing derivation. Cross-pillar: scratchpad's FileCollector calls `MemoryRecorder.recordFileLoad` so cell loads land as `kind:'file_load'` drawers; scratchpad exposes `currentScratchpadName(sessionId)` so memory uses it as the default Room.

**Tech Stack:** TypeScript (Node ESM), `better-sqlite3` (NEW native dependency, FTS5 support compiled in), `js-yaml` for Layer A frontmatter (already present in monorepo as `yaml`), `node:test` + `node:assert/strict` for tests, `uuid` (already a dep) for drawer IDs.

**Branch:** `feat/coworker-phase-3-memory` (already created from main after Phase 2 merge).

**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-3-memory-design.md`.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `packages/coworker-memory/src/types.ts` | `Wing`, `Room`, `DrawerKind`, `Drawer`, `RecallQuery`, `RecallResult`, `BackendStatus`, `LayerAKind`, `LayerAEntry`. |
| `packages/coworker-memory/src/errors.ts` | `MemoryNotInitialized`, `BackendUnavailable`, `DrawerKindRejected`, `LayerAWriteBlocked`, `RecallQueryMalformed`, `MemoryEntryMalformed`. |
| `packages/coworker-memory/src/memory-backend.ts` | `MemoryBackend` interface. |
| `packages/coworker-memory/src/workspace-id.ts` | `resolveWorkspaceId(workspaceDir)`: read/create `workspace.json`. |
| `packages/coworker-memory/src/scope-resolver.ts` | `resolveScope({mode, workspaceId})`: pure fn → write wing + read wings. |
| `packages/coworker-memory/src/paste-detector.ts` | `detectPaste(text, opts?)`: heuristic. |
| `packages/coworker-memory/src/layer-a-store.ts` | `LayerAStore`: read/write profile.md / rules.md / lessons.md per scope dir with frontmatter, atomic write, append-only lessons. |
| `packages/coworker-memory/src/local-sqlite-backend.ts` | `LocalSqliteBackend`: open db, run migrations, retain/recall/listWings/listRooms/status/clear, SQLITE_BUSY retry, FTS5 escape. |
| `packages/coworker-memory/src/memory-recorder.ts` | `MemoryRecorder`: recordTurn/recordPaste/recordFileLoad with SecretScanner gate. |
| `packages/coworker-memory/src/persona-seed.ts` | `applyPersonaSeed()`: one-shot copy of persona memory-seed/ files. |
| `packages/coworker-memory/src/recall-formatter.ts` | `formatRecall(results)`: markdown block with snippet marks. |
| `packages/coworker-memory/src/context-injection.ts` | `buildLayerAContext({scope, workspaceWing, tokenLimit})`: produces system-prompt markdown. |
| `packages/coworker-memory/src/migrations/001-init.sql` | Initial Layer B schema (drawers, indexes, FTS5 virtual table, triggers). |
| `packages/coworker-memory/src/index.ts` | Public barrel. |
| `packages/coworker-memory/src/*.test.ts` | One per module. |
| `packages/coworker-memory/tests/memory-integration.test.ts` | End-to-end Day-2 integration test (separate dir). |
| `src/resources/extensions/coworker-memory/extension-manifest.json` | Manifest: commands=[memory], hooks=[session_start, session_shutdown]. |
| `src/resources/extensions/coworker-memory/memory-singleton.ts` | `createMemoryBundle(opts)`: constructs scope resolver, layer-a store, backend, recorder. |
| `src/resources/extensions/coworker-memory/memorize-tool.ts` | LLM tool wiring. |
| `src/resources/extensions/coworker-memory/recall-tool.ts` | LLM tool wiring. |
| `src/resources/extensions/coworker-memory/memory-command.ts` | `/memory note|wing|room|status|clear|seed`. |
| `src/resources/extensions/coworker-memory/session-hooks.ts` | session_start (Layer A inject + persona seed) + session_shutdown (WAL checkpoint). |
| `src/resources/extensions/coworker-memory/index.ts` | Extension entry. |
| `docs/superpowers/notes/2026-06-XX-phase-3-memory-smoke.md` | Manual smoke checklist (filled by Task 21). |
| `docs/superpowers/notes/2026-06-XX-coworker-phase-3-human-tests.md` | Human test plan (Task 21). |

### Modified files

| Path | Change |
|---|---|
| `packages/coworker-memory/package.json` | Add deps: `@otto/coworker-utils`, `@otto/coworker-persona` (if needed for type access), `better-sqlite3`, `yaml`, `uuid`. |
| `src/resources/extensions/coworker-scratchpad/sp-command.ts` | Export `currentScratchpadName(sessionId): string \| null` accessor for memory's room derivation. |
| `src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts` | On FileCollector load success, call `memoryRecorder.recordFileLoad(...)`. Requires recorder dep wired at extension activation. |
| `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` | Mark Phase 3 complete; note Layer C / ACC / Cerebellum / Consolidator stay Phase 5. |

---

## Tasks

### Task 1: Memory types + error taxonomy

**Files:**
- Create: `packages/coworker-memory/src/types.ts`
- Create: `packages/coworker-memory/src/errors.ts`
- Create: `packages/coworker-memory/src/errors.test.ts`
- Modify: `packages/coworker-memory/package.json`

- [ ] **Step 1: Update package.json**

```json
{
  "name": "@otto/coworker-memory",
  "version": "0.0.1",
  "description": "Otto co-worker package: coworker-memory",
  "type": "module",
  "otto": { "linkable": true, "scope": "@otto", "name": "coworker-memory" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "dependencies": {
    "@otto/coworker-utils": "*",
    "better-sqlite3": "^11.7.0",
    "uuid": "^11.0.0",
    "yaml": "^2.8.2"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "build:publish": "tsc -p tsconfig.publish.json"
  },
  "files": ["dist"]
}
```

Run `npm install` from repo root to wire workspace deps. If `better-sqlite3` requires native compile, it will compile during install — check the output and report if it fails.

- [ ] **Step 2: Write types.ts**

```typescript
// packages/coworker-memory/src/types.ts
export type Wing = string;
export type Room = string;

export const DRAWER_KINDS = ['turn', 'paste', 'file_load', 'ticket', 'email', 'rca', 'note'] as const;
export type DrawerKind = typeof DRAWER_KINDS[number];

export const LAYER_A_KINDS = ['profile', 'rule', 'lesson'] as const;
export type LayerAKind = typeof LAYER_A_KINDS[number];

export type ScopeMode = 'global' | 'per-project' | 'per-project-tagged';

export interface Drawer {
  id: string;
  wing: Wing;
  room: Room;
  kind: DrawerKind;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  parent_id?: string;
  redacted: boolean;
}

export interface RecallQuery {
  query: string;
  wing?: Wing | Wing[];
  room?: Room;
  kind?: DrawerKind | DrawerKind[];
  days_back?: number;
  max_results?: number;
}

export interface RecallResult {
  drawer: Drawer;
  score: number;
  snippet: string;
}

export interface BackendStatus {
  ready: boolean;
  workspace_wing: Wing;
  drawer_count: number;
  layer_b_db_path: string;
  schema_version: number;
}

export interface LayerAEntry {
  kind: LayerAKind;
  text: string;
  source: 'user' | 'persona-seed';
  ts: string;
}

export interface WorkspaceIdRecord {
  _schema: 1;
  id: string;
  created_at: string;
  memory_seed_applied: boolean;
  memory_seed_persona: string | null;
}
```

- [ ] **Step 3: Write errors.test.ts (node:test)**

```typescript
// packages/coworker-memory/src/errors.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryNotInitialized, BackendUnavailable, DrawerKindRejected,
  LayerAWriteBlocked, RecallQueryMalformed, MemoryEntryMalformed,
} from './errors.js';

describe('memory errors', () => {
  it('MemoryNotInitialized carries reason', () => {
    const e = new MemoryNotInitialized('workspace.json corrupted');
    assert.equal(e.name, 'MemoryNotInitialized');
    assert.equal(e.reason, 'workspace.json corrupted');
    assert.ok(e.message.includes('workspace.json corrupted'));
  });
  it('BackendUnavailable carries reason', () => {
    const e = new BackendUnavailable('SQLITE_BUSY after retries');
    assert.equal(e.name, 'BackendUnavailable');
    assert.equal(e.reason, 'SQLITE_BUSY after retries');
  });
  it('DrawerKindRejected carries kind', () => {
    const e = new DrawerKindRejected('mystery');
    assert.equal(e.name, 'DrawerKindRejected');
    assert.equal(e.kind, 'mystery');
    assert.ok(e.message.includes('mystery'));
  });
  it('LayerAWriteBlocked carries secret_kind', () => {
    const e = new LayerAWriteBlocked('anthropic_api_key');
    assert.equal(e.name, 'LayerAWriteBlocked');
    assert.equal(e.secretKind, 'anthropic_api_key');
    assert.ok(e.message.includes('anthropic_api_key'));
    assert.ok(e.message.includes('/connect'));
  });
  it('RecallQueryMalformed carries reason', () => {
    const e = new RecallQueryMalformed('empty query');
    assert.equal(e.name, 'RecallQueryMalformed');
    assert.equal(e.reason, 'empty query');
  });
  it('MemoryEntryMalformed carries path', () => {
    const e = new MemoryEntryMalformed('/tmp/profile.md', 'bad frontmatter');
    assert.equal(e.name, 'MemoryEntryMalformed');
    assert.equal(e.path, '/tmp/profile.md');
    assert.equal(e.reason, 'bad frontmatter');
  });
});
```

- [ ] **Step 4: Write errors.ts**

```typescript
// packages/coworker-memory/src/errors.ts
export class MemoryNotInitialized extends Error {
  constructor(public readonly reason: string) {
    super(`Memory not initialized: ${reason}. /memory status to inspect.`);
    this.name = 'MemoryNotInitialized';
  }
}

export class BackendUnavailable extends Error {
  constructor(public readonly reason: string) {
    super(`Memory backend unavailable: ${reason}.`);
    this.name = 'BackendUnavailable';
  }
}

export class DrawerKindRejected extends Error {
  constructor(public readonly kind: string) {
    super(`Drawer kind '${kind}' is not in v1 vocabulary. Allowed: turn, paste, file_load, ticket, email, rca, note.`);
    this.name = 'DrawerKindRejected';
  }
}

export class LayerAWriteBlocked extends Error {
  constructor(public readonly secretKind: string) {
    super(`Refused to store: contains secret-shaped value (kind: ${secretKind}). Remove the secret and retry. Vault entries should land in /connect, not memorize.`);
    this.name = 'LayerAWriteBlocked';
  }
}

export class RecallQueryMalformed extends Error {
  constructor(public readonly reason: string) {
    super(`Bad recall query: ${reason}.`);
    this.name = 'RecallQueryMalformed';
  }
}

export class MemoryEntryMalformed extends Error {
  constructor(public readonly path: string, public readonly reason: string) {
    super(`Layer A file ${path} is malformed: ${reason}. Move it aside and re-create.`);
    this.name = 'MemoryEntryMalformed';
  }
}
```

- [ ] **Step 5: Run; verify pass**

```
cd packages/coworker-memory && npm run build && cd ../..
npm run test:compile
node --test dist-test/packages/coworker-memory/src/errors.test.js
```

Expected: 6/6 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/coworker-memory/package.json packages/coworker-memory/src/types.ts packages/coworker-memory/src/errors.ts packages/coworker-memory/src/errors.test.ts
git commit -m "feat(coworker-3): memory types + error taxonomy + deps (Phase 3 Task 1)"
```

---

### Task 2: `MemoryBackend` interface

**Files:**
- Create: `packages/coworker-memory/src/memory-backend.ts`

- [ ] **Step 1: Write the interface (no test file — interface only)**

```typescript
// packages/coworker-memory/src/memory-backend.ts
import type { Drawer, RecallQuery, RecallResult, BackendStatus, Wing, Room } from './types.js';

export interface MemoryBackend {
  recall(query: RecallQuery): Promise<RecallResult[]>;
  retain(input: Omit<Drawer, 'id' | 'created_at'>): Promise<Drawer>;
  listRooms(wing?: Wing): Promise<Room[]>;
  listWings(): Promise<Wing[]>;
  status(): Promise<BackendStatus>;
  clear(args: { wing?: Wing; confirm: true }): Promise<{ deleted: number }>;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/coworker-memory/src/memory-backend.ts
git commit -m "feat(coworker-3): MemoryBackend interface (Phase 3 Task 2)"
```

---

### Task 3: `WorkspaceId` — workspace.json read/create with path-hash fallback

**Files:**
- Create: `packages/coworker-memory/src/workspace-id.ts`
- Create: `packages/coworker-memory/src/workspace-id.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-memory/src/workspace-id.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkspaceId } from './workspace-id.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'wsid-')); }

describe('resolveWorkspaceId', () => {
  it('creates workspace.json on first call with basename + 6-hex slug', async () => {
    const root = tmp();
    const ws = join(root, 'acme-noc');
    mkdirSync(ws, { recursive: true });
    const rec = await resolveWorkspaceId(ws);
    assert.match(rec.id, /^acme-noc-[0-9a-f]{6}$/);
    assert.equal(rec.memory_seed_applied, false);
    assert.equal(rec.memory_seed_persona, null);
    assert.ok(existsSync(join(ws, '.otto', 'memory', 'workspace.json')));
  });
  it('returns existing id on second call (idempotent)', async () => {
    const root = tmp();
    const ws = join(root, 'acme-noc');
    mkdirSync(ws, { recursive: true });
    const a = await resolveWorkspaceId(ws);
    const b = await resolveWorkspaceId(ws);
    assert.equal(a.id, b.id);
    assert.equal(a.created_at, b.created_at);
  });
  it('falls back to path-hash when workspace.json is corrupted', async () => {
    const root = tmp();
    const ws = join(root, 'broken');
    mkdirSync(join(ws, '.otto', 'memory'), { recursive: true });
    writeFileSync(join(ws, '.otto', 'memory', 'workspace.json'), 'not json');
    const rec = await resolveWorkspaceId(ws);
    assert.match(rec.id, /^broken-[0-9a-f]{6}$/);
    assert.ok(existsSync(join(ws, '.otto', 'memory', 'workspace.json.broken-')) ||
              readFileSync(join(ws, '.otto', 'memory', 'workspace.json'), 'utf8').includes('"_schema"'));
  });
  it('uses workspace fallback when basename is empty', async () => {
    // synthesize via an explicit path with weird basename
    const root = tmp();
    const ws = root; // root-of-tmp has a basename like 'wsid-xxxxxx', fine
    const rec = await resolveWorkspaceId(ws);
    assert.ok(rec.id.length > 0);
  });
});
```

- [ ] **Step 2: Run; FAIL**

```
npm run test:compile && node --test dist-test/packages/coworker-memory/src/workspace-id.test.js
```

Expected: module missing.

- [ ] **Step 3: Implement `workspace-id.ts`**

```typescript
// packages/coworker-memory/src/workspace-id.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { WorkspaceIdRecord } from './types.js';

function pathHash6(absolutePath: string): string {
  return createHash('sha256').update(absolutePath).digest('hex').slice(0, 6);
}

function deriveSlug(workspaceDir: string): string {
  let base = basename(workspaceDir).replace(/[^a-z0-9-]/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  if (!base) base = 'workspace';
  return `${base}-${pathHash6(workspaceDir)}`;
}

export async function resolveWorkspaceId(workspaceDir: string): Promise<WorkspaceIdRecord> {
  const memDir = join(workspaceDir, '.otto', 'memory');
  const path = join(memDir, 'workspace.json');
  mkdirSync(memDir, { recursive: true, mode: 0o700 });

  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as WorkspaceIdRecord;
      if (data && data._schema === 1 && typeof data.id === 'string' && data.id.length > 0) {
        return data;
      }
    } catch { /* fall through to recreate */ }
    // Move broken aside.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try { renameSync(path, `${path}.broken-${stamp}`); } catch { /* best effort */ }
  }

  const fresh: WorkspaceIdRecord = {
    _schema: 1,
    id: deriveSlug(workspaceDir),
    created_at: new Date().toISOString(),
    memory_seed_applied: false,
    memory_seed_persona: null,
  };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  return fresh;
}

export async function writeWorkspaceId(workspaceDir: string, rec: WorkspaceIdRecord): Promise<void> {
  const memDir = join(workspaceDir, '.otto', 'memory');
  mkdirSync(memDir, { recursive: true, mode: 0o700 });
  const path = join(memDir, 'workspace.json');
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}
```

- [ ] **Step 4: Run; pass**

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-memory/src/workspace-id.ts packages/coworker-memory/src/workspace-id.test.ts
git commit -m "feat(coworker-3): workspace-id with path-hash fallback (Phase 3 Task 3)"
```

---

### Task 4: `ScopeResolver` — wing(s) for write + read

**Files:**
- Create: `packages/coworker-memory/src/scope-resolver.ts`
- Create: `packages/coworker-memory/src/scope-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-memory/src/scope-resolver.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveScope } from './scope-resolver.js';

describe('resolveScope', () => {
  const wing = 'acme-noc-7f3a9c';
  it('global → write global, read [global]', () => {
    const r = resolveScope({ mode: 'global', workspaceId: wing });
    assert.equal(r.writeWing, 'global');
    assert.deepEqual(r.readWings, ['global']);
  });
  it('per-project → write workspace, read [workspace]', () => {
    const r = resolveScope({ mode: 'per-project', workspaceId: wing });
    assert.equal(r.writeWing, wing);
    assert.deepEqual(r.readWings, [wing]);
  });
  it('per-project-tagged → write workspace, read [workspace, global]', () => {
    const r = resolveScope({ mode: 'per-project-tagged', workspaceId: wing });
    assert.equal(r.writeWing, wing);
    assert.deepEqual(r.readWings, [wing, 'global']);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement `scope-resolver.ts`**

```typescript
// packages/coworker-memory/src/scope-resolver.ts
import type { ScopeMode, Wing } from './types.js';

export interface ResolvedScope {
  writeWing: Wing;
  readWings: Wing[];
}

export function resolveScope(args: { mode: ScopeMode; workspaceId: Wing }): ResolvedScope {
  switch (args.mode) {
    case 'global':
      return { writeWing: 'global', readWings: ['global'] };
    case 'per-project':
      return { writeWing: args.workspaceId, readWings: [args.workspaceId] };
    case 'per-project-tagged':
      return { writeWing: args.workspaceId, readWings: [args.workspaceId, 'global'] };
  }
}
```

- [ ] **Step 4: Run; pass**

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-memory/src/scope-resolver.ts packages/coworker-memory/src/scope-resolver.test.ts
git commit -m "feat(coworker-3): scope-resolver pure fn (Phase 3 Task 4)"
```

---

### Task 5: `PasteDetector` — heuristic

**Files:**
- Create: `packages/coworker-memory/src/paste-detector.ts`
- Create: `packages/coworker-memory/src/paste-detector.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-memory/src/paste-detector.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectPaste } from './paste-detector.js';

describe('detectPaste', () => {
  it('returns turn for short single-line', () => {
    assert.equal(detectPaste('what servers had alerts last night?'), 'turn');
  });
  it('returns paste when length >= 500', () => {
    assert.equal(detectPaste('x'.repeat(500)), 'paste');
  });
  it('returns paste on triple-backtick fence', () => {
    assert.equal(detectPaste('look at this:\n```ts\nconst x = 1;\n```'), 'paste');
  });
  it('returns paste on > 10 newlines', () => {
    assert.equal(detectPaste('a\n'.repeat(11)), 'paste');
  });
  it('respects custom thresholds', () => {
    assert.equal(detectPaste('x'.repeat(100), { lengthThreshold: 50 }), 'paste');
    assert.equal(detectPaste('a\n'.repeat(5), { newlineThreshold: 3 }), 'paste');
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```typescript
// packages/coworker-memory/src/paste-detector.ts
export interface PasteDetectorOptions {
  lengthThreshold?: number;     // default 500
  newlineThreshold?: number;    // default 10
}

const DEFAULT_LENGTH = 500;
const DEFAULT_NEWLINES = 10;

export function detectPaste(text: string, opts: PasteDetectorOptions = {}): 'turn' | 'paste' {
  const lengthThreshold = opts.lengthThreshold ?? DEFAULT_LENGTH;
  const newlineThreshold = opts.newlineThreshold ?? DEFAULT_NEWLINES;
  if (/```/.test(text)) return 'paste';
  if (text.length >= lengthThreshold) return 'paste';
  const newlines = (text.match(/\n/g) ?? []).length;
  if (newlines > newlineThreshold) return 'paste';
  return 'turn';
}
```

- [ ] **Step 4: Run; pass**

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-memory/src/paste-detector.ts packages/coworker-memory/src/paste-detector.test.ts
git commit -m "feat(coworker-3): paste detector heuristic (Phase 3 Task 5)"
```

---

### Task 6: `LayerAStore` — Layer A markdown read/write with SecretScanner block

**Files:**
- Create: `packages/coworker-memory/src/layer-a-store.ts`
- Create: `packages/coworker-memory/src/layer-a-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-memory/src/layer-a-store.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import { LayerAStore } from './layer-a-store.js';
import { LayerAWriteBlocked } from './errors.js';

function ctx() {
  const root = mkdtempSync(join(tmpdir(), 'la-'));
  return {
    root,
    audit: new AuditLog({ path: join(root, 'audit.jsonl') }),
    scanner: new SecretScanner(),
    dir: join(root, 'memory'),
  };
}

describe('LayerAStore', () => {
  it('append lesson creates lessons.md with frontmatter and bullet', async () => {
    const c = ctx();
    const store = new LayerAStore({ scopeDir: c.dir, scope: 'workspace', audit: c.audit, scanner: c.scanner });
    await store.append({ kind: 'lesson', text: 'MTTR target is 30 minutes for P1', source: 'user', ts: '2026-06-02T10:00:00Z' });
    const md = readFileSync(join(c.dir, 'lessons.md'), 'utf8');
    assert.match(md, /^---\nschema_version: 1\n/);
    assert.match(md, /- \(2026-06-02T10:00:00Z\) MTTR target is 30 minutes for P1/);
  });
  it('append profile uses timestamped section', async () => {
    const c = ctx();
    const store = new LayerAStore({ scopeDir: c.dir, scope: 'workspace', audit: c.audit, scanner: c.scanner });
    await store.append({ kind: 'profile', text: 'Prefers polars over pandas.', source: 'user', ts: '2026-06-02T10:00:00Z' });
    const md = readFileSync(join(c.dir, 'profile.md'), 'utf8');
    assert.match(md, /## 2026-06-02T10:00:00Z\nPrefers polars over pandas\./);
  });
  it('throws LayerAWriteBlocked when text contains a secret pattern', async () => {
    const c = ctx();
    const store = new LayerAStore({ scopeDir: c.dir, scope: 'workspace', audit: c.audit, scanner: c.scanner });
    await assert.rejects(
      () => store.append({ kind: 'rule', text: 'use AKIAABCDEFGHIJKLMNOP', source: 'user', ts: '2026-06-02T10:00:00Z' }),
      LayerAWriteBlocked,
    );
    assert.equal(existsSync(join(c.dir, 'rules.md')), false);
  });
  it('read returns parsed content with frontmatter stripped', async () => {
    const c = ctx();
    const store = new LayerAStore({ scopeDir: c.dir, scope: 'workspace', audit: c.audit, scanner: c.scanner });
    await store.append({ kind: 'rule', text: 'Always include MTTR in RCA.', source: 'user', ts: '2026-06-02T10:00:00Z' });
    const body = await store.read('rule');
    assert.match(body, /Always include MTTR in RCA\./);
    assert.equal(body.startsWith('---'), false);
  });
  it('read returns empty string when file missing', async () => {
    const c = ctx();
    const store = new LayerAStore({ scopeDir: c.dir, scope: 'workspace', audit: c.audit, scanner: c.scanner });
    assert.equal(await store.read('lesson'), '');
  });
  it('emits write-layer-a audit on success', async () => {
    const c = ctx();
    const store = new LayerAStore({ scopeDir: c.dir, scope: 'workspace', audit: c.audit, scanner: c.scanner });
    await store.append({ kind: 'lesson', text: 'short lesson', source: 'user', ts: '2026-06-02T10:00:00Z' });
    const rows: { action: string }[] = [];
    for await (const r of c.audit.read({ producer: 'memory', action: 'write-layer-a' })) rows.push(r as never);
    assert.equal(rows.length, 1);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement `layer-a-store.ts`**

```typescript
// packages/coworker-memory/src/layer-a-store.ts
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import type { LayerAEntry, LayerAKind } from './types.js';
import { LayerAWriteBlocked, MemoryEntryMalformed } from './errors.js';

const FILE_FOR: Record<LayerAKind, string> = {
  profile: 'profile.md',
  rule: 'rules.md',
  lesson: 'lessons.md',
};

const TITLE_FOR: Record<LayerAKind, string> = {
  profile: 'Profile',
  rule: 'Rules',
  lesson: 'Lessons',
};

export interface LayerAStoreOptions {
  scopeDir: string;             // absolute path to scope's memory dir
  scope: 'global' | 'workspace';
  audit: AuditLog;
  scanner: SecretScanner;
}

export class LayerAStore {
  constructor(private readonly opts: LayerAStoreOptions) {}

  async append(entry: LayerAEntry): Promise<void> {
    const hits = this.opts.scanner.scan(entry.text);
    if (hits.length > 0) {
      this.opts.audit.append({
        _schema: 1, ts: new Date().toISOString(), producer: 'memory', action: 'block', severity: 'warn',
        detail: { scope: this.opts.scope, kind: entry.kind, reason: 'secret', secret_kind: hits[0]!.kind },
      });
      throw new LayerAWriteBlocked(hits[0]!.kind);
    }
    mkdirSync(this.opts.scopeDir, { recursive: true, mode: 0o700 });
    const path = join(this.opts.scopeDir, FILE_FOR[entry.kind]);
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const { body } = existing ? this.split(existing, path) : { body: '' };
    const addition = entry.kind === 'lesson'
      ? `- (${entry.ts}) ${entry.text}\n`
      : `## ${entry.ts}\n${entry.text}\n\n`;
    const newBody = (body && !body.endsWith('\n') ? body + '\n' : body) + addition;
    const newFile = this.composeFile(entry.kind, newBody, entry.ts);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, newFile, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    this.opts.audit.append({
      _schema: 1, ts: new Date().toISOString(), producer: 'memory', action: 'write-layer-a',
      detail: { scope: this.opts.scope, kind: entry.kind, source: entry.source, byte_count: entry.text.length },
    });
  }

  async read(kind: LayerAKind): Promise<string> {
    const path = join(this.opts.scopeDir, FILE_FOR[kind]);
    if (!existsSync(path)) return '';
    const raw = readFileSync(path, 'utf8');
    const { body } = this.split(raw, path);
    return body.trim();
  }

  private split(raw: string, path: string): { frontmatter: Record<string, unknown>; body: string } {
    if (!raw.startsWith('---')) {
      return { frontmatter: {}, body: raw };
    }
    const end = raw.indexOf('\n---\n', 4);
    if (end < 0) throw new MemoryEntryMalformed(path, 'unterminated frontmatter');
    try {
      const fm = parseYaml(raw.slice(4, end)) as Record<string, unknown>;
      const body = raw.slice(end + 5);
      return { frontmatter: fm ?? {}, body };
    } catch (err) {
      throw new MemoryEntryMalformed(path, `frontmatter parse: ${(err as Error).message}`);
    }
  }

  private composeFile(kind: LayerAKind, body: string, ts: string): string {
    const fm = { schema_version: 1, last_modified_at: ts, source: 'user' as const };
    const fmStr = stringifyYaml(fm).trimEnd();
    const header = `---\n${fmStr}\n---\n\n# ${TITLE_FOR[kind]}\n\n`;
    return header + body.replace(new RegExp(`^# ${TITLE_FOR[kind]}\\n\\n?`), '');
  }
}
```

- [ ] **Step 4: Run; pass**

Expected: 6/6 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-memory/src/layer-a-store.ts packages/coworker-memory/src/layer-a-store.test.ts
git commit -m "feat(coworker-3): LayerAStore markdown + frontmatter + SecretScanner block (Phase 3 Task 6)"
```

---

### Task 7: `LocalSqliteBackend` — schema bootstrap + retain + recall + listings + SQLITE_BUSY retry

**Files:**
- Create: `packages/coworker-memory/src/migrations/001-init.sql`
- Create: `packages/coworker-memory/src/local-sqlite-backend.ts`
- Create: `packages/coworker-memory/src/local-sqlite-backend.test.ts`

- [ ] **Step 1: Write migration**

```sql
-- packages/coworker-memory/src/migrations/001-init.sql
PRAGMA journal_mode = WAL;
PRAGMA user_version = 1;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS drawers (
  id TEXT PRIMARY KEY,
  wing TEXT NOT NULL,
  room TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('turn','paste','file_load','ticket','email','rca','note')),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  parent_id TEXT REFERENCES drawers(id) ON DELETE SET NULL,
  redacted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drawers_wing_room ON drawers (wing, room);
CREATE INDEX IF NOT EXISTS idx_drawers_kind ON drawers (kind);
CREATE INDEX IF NOT EXISTS idx_drawers_created_at ON drawers (created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS drawers_fts USING fts5 (
  content,
  content='drawers',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS drawers_ai AFTER INSERT ON drawers BEGIN
  INSERT INTO drawers_fts (rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS drawers_ad AFTER DELETE ON drawers BEGIN
  INSERT INTO drawers_fts (drawers_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS drawers_au AFTER UPDATE ON drawers BEGIN
  INSERT INTO drawers_fts (drawers_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO drawers_fts (rowid, content) VALUES (new.rowid, new.content);
END;
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/coworker-memory/src/local-sqlite-backend.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalSqliteBackend } from './local-sqlite-backend.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'lb-')); }

describe('LocalSqliteBackend', () => {
  it('bootstraps schema and is ready', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    const st = await be.status();
    assert.equal(st.ready, true);
    assert.equal(st.drawer_count, 0);
    assert.equal(st.schema_version, 1);
    await be.close();
  });
  it('retain + recall round-trip; result includes snippet with <mark>', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    await be.retain({ wing: 'global', room: 'inbox', kind: 'paste',
      content: 'customer said the load balancer started returning 503s around 14:00 UTC',
      metadata: {}, redacted: false });
    const results = await be.recall({ query: 'load balancer' });
    assert.equal(results.length, 1);
    assert.equal(results[0]!.drawer.kind, 'paste');
    assert.match(results[0]!.snippet, /<mark>load<\/mark>/);
    assert.ok(results[0]!.score > 0);
    await be.close();
  });
  it('filters by wing, room, kind, days_back', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    await be.retain({ wing: 'a', room: 'r1', kind: 'turn', content: 'red apples', metadata: {}, redacted: false });
    await be.retain({ wing: 'b', room: 'r2', kind: 'paste', content: 'red apples', metadata: {}, redacted: false });
    const filteredWing = await be.recall({ query: 'apples', wing: 'a' });
    assert.equal(filteredWing.length, 1);
    assert.equal(filteredWing[0]!.drawer.wing, 'a');
    const filteredKind = await be.recall({ query: 'apples', kind: 'paste' });
    assert.equal(filteredKind.length, 1);
    assert.equal(filteredKind[0]!.drawer.kind, 'paste');
    await be.close();
  });
  it('escapes FTS5 special characters in query', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    await be.retain({ wing: 'g', room: 'r', kind: 'note', content: 'CIDR is 10.0.0.0/24', metadata: {}, redacted: false });
    const r = await be.recall({ query: '10.0.0.0/24 "AND" *' });   // would otherwise blow up
    assert.equal(r.length, 1);
    await be.close();
  });
  it('listWings + listRooms reflect inserted data', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    await be.retain({ wing: 'w1', room: 'r1', kind: 'turn', content: 'a', metadata: {}, redacted: false });
    await be.retain({ wing: 'w2', room: 'r2', kind: 'turn', content: 'b', metadata: {}, redacted: false });
    assert.deepEqual((await be.listWings()).sort(), ['w1', 'w2']);
    assert.deepEqual(await be.listRooms('w1'), ['r1']);
    await be.close();
  });
  it('clear({wing}) deletes only that wing\'s drawers', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    await be.retain({ wing: 'w1', room: 'r1', kind: 'turn', content: 'a', metadata: {}, redacted: false });
    await be.retain({ wing: 'w2', room: 'r2', kind: 'turn', content: 'b', metadata: {}, redacted: false });
    const out = await be.clear({ wing: 'w1', confirm: true });
    assert.equal(out.deleted, 1);
    assert.deepEqual(await be.listWings(), ['w2']);
    await be.close();
  });
  it('retain preserves redacted flag', async () => {
    const dir = tmp();
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    const d = await be.retain({ wing: 'g', room: 'r', kind: 'paste', content: 'x [REDACTED:aws_access_key_id] y', metadata: {}, redacted: true });
    assert.equal(d.redacted, true);
    const r = await be.recall({ query: 'REDACTED' });
    assert.equal(r[0]!.drawer.redacted, true);
    await be.close();
  });
});
```

- [ ] **Step 3: Run; FAIL**

- [ ] **Step 4: Implement `local-sqlite-backend.ts`**

```typescript
// packages/coworker-memory/src/local-sqlite-backend.ts
import Database, { type Database as DB } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { v4 as uuid } from 'uuid';
import type { MemoryBackend } from './memory-backend.js';
import type { Drawer, RecallQuery, RecallResult, BackendStatus, Wing, Room } from './types.js';
import { RecallQueryMalformed, BackendUnavailable } from './errors.js';

export interface LocalSqliteBackendOptions {
  dbPath: string;
  now?: () => string;
  busyTimeoutMs?: number;
}

function migrationDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'migrations');
}

function escapeFts5(q: string): string {
  // Wrap each word containing special chars in double quotes; doubled internal quotes.
  // Empty query → throw upstream.
  const tokens = q.match(/\S+/g) ?? [];
  return tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

export class LocalSqliteBackend implements MemoryBackend {
  private db: DB | null = null;
  private readonly path: string;
  private readonly now: () => string;
  private readonly busyTimeoutMs: number;

  constructor(opts: LocalSqliteBackendOptions) {
    this.path = opts.dbPath;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.busyTimeoutMs = opts.busyTimeoutMs ?? 2000;
  }

  async open(): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      this.db = new Database(this.path);
      this.db.pragma(`busy_timeout = ${this.busyTimeoutMs}`);
      const initSql = readFileSync(join(migrationDir(), '001-init.sql'), 'utf8');
      this.db.exec(initSql);
    } catch (err) {
      throw new BackendUnavailable(`open failed: ${(err as Error).message}`);
    }
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private requireDb(): DB {
    if (!this.db) throw new BackendUnavailable('not opened');
    return this.db;
  }

  async retain(input: Omit<Drawer, 'id' | 'created_at'>): Promise<Drawer> {
    const db = this.requireDb();
    const id = uuid();
    const created_at = this.now();
    const stmt = db.prepare(`
      INSERT INTO drawers (id, wing, room, kind, content, metadata_json, parent_id, redacted, created_at)
      VALUES (@id, @wing, @room, @kind, @content, @metadata_json, @parent_id, @redacted, @created_at)
    `);
    stmt.run({
      id, wing: input.wing, room: input.room, kind: input.kind, content: input.content,
      metadata_json: JSON.stringify(input.metadata ?? {}),
      parent_id: input.parent_id ?? null,
      redacted: input.redacted ? 1 : 0,
      created_at,
    });
    return { id, created_at, ...input };
  }

  async recall(query: RecallQuery): Promise<RecallResult[]> {
    if (!query.query || !query.query.trim()) throw new RecallQueryMalformed('empty query');
    const db = this.requireDb();
    const matchExpr = escapeFts5(query.query.trim());
    const conditions: string[] = ['drawers_fts MATCH ?'];
    const params: unknown[] = [matchExpr];

    if (query.wing) {
      if (Array.isArray(query.wing)) {
        conditions.push(`d.wing IN (${query.wing.map(() => '?').join(',')})`);
        params.push(...query.wing);
      } else {
        conditions.push('d.wing = ?');
        params.push(query.wing);
      }
    }
    if (query.room) { conditions.push('d.room = ?'); params.push(query.room); }
    if (query.kind) {
      const kinds = Array.isArray(query.kind) ? query.kind : [query.kind];
      conditions.push(`d.kind IN (${kinds.map(() => '?').join(',')})`);
      params.push(...kinds);
    }
    if (query.days_back && query.days_back > 0) {
      const cutoff = new Date(Date.now() - query.days_back * 86400_000).toISOString();
      conditions.push('d.created_at >= ?');
      params.push(cutoff);
    }
    const limit = Math.min(Math.max(query.max_results ?? 8, 1), 64);
    params.push(limit);

    const sql = `
      SELECT d.id, d.wing, d.room, d.kind, d.content, d.metadata_json, d.parent_id, d.redacted, d.created_at,
             bm25(drawers_fts) AS rank,
             snippet(drawers_fts, 0, '<mark>', '</mark>', '...', 16) AS snippet
      FROM drawers_fts
      JOIN drawers d ON d.rowid = drawers_fts.rowid
      WHERE ${conditions.join(' AND ')}
      ORDER BY rank
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(...params) as Array<{
      id: string; wing: string; room: string; kind: Drawer['kind']; content: string;
      metadata_json: string; parent_id: string | null; redacted: number; created_at: string;
      rank: number; snippet: string;
    }>;
    return rows.map(r => ({
      drawer: {
        id: r.id, wing: r.wing, room: r.room, kind: r.kind, content: r.content,
        metadata: JSON.parse(r.metadata_json) as Record<string, unknown>,
        parent_id: r.parent_id ?? undefined, redacted: r.redacted === 1,
        created_at: r.created_at,
      },
      score: -r.rank, // BM25 lower=better in sqlite; invert for descending
      snippet: r.snippet,
    }));
  }

  async listRooms(wing?: Wing): Promise<Room[]> {
    const db = this.requireDb();
    const sql = wing
      ? `SELECT DISTINCT room FROM drawers WHERE wing = ? ORDER BY room`
      : `SELECT DISTINCT room FROM drawers ORDER BY room`;
    const rows = wing ? db.prepare(sql).all(wing) : db.prepare(sql).all();
    return (rows as Array<{ room: string }>).map(r => r.room);
  }

  async listWings(): Promise<Wing[]> {
    const db = this.requireDb();
    const rows = db.prepare(`SELECT DISTINCT wing FROM drawers ORDER BY wing`).all() as Array<{ wing: string }>;
    return rows.map(r => r.wing);
  }

  async status(): Promise<BackendStatus> {
    const db = this.requireDb();
    const { c } = db.prepare(`SELECT COUNT(*) AS c FROM drawers`).get() as { c: number };
    const { user_version } = db.prepare(`PRAGMA user_version`).get() as { user_version: number };
    return {
      ready: true,
      workspace_wing: '',  // caller (memory-singleton) overlays this from scope info
      drawer_count: c,
      layer_b_db_path: this.path,
      schema_version: user_version,
    };
  }

  async clear(args: { wing?: Wing; confirm: true }): Promise<{ deleted: number }> {
    if (args.confirm !== true) throw new RecallQueryMalformed('confirm must be true');
    const db = this.requireDb();
    const stmt = args.wing
      ? db.prepare(`DELETE FROM drawers WHERE wing = ?`)
      : db.prepare(`DELETE FROM drawers`);
    const result = args.wing ? stmt.run(args.wing) : stmt.run();
    return { deleted: result.changes };
  }
}
```

- [ ] **Step 5: Configure migration copy to dist (test and prod)**

In `packages/coworker-memory/package.json`, update build scripts to copy `migrations/*.sql`:

```json
"build": "tsc -p tsconfig.json && node -e \"const fs=require('fs');const path=require('path');const src='src/migrations';const dst='dist/migrations';fs.mkdirSync(dst,{recursive:true});for(const f of fs.readdirSync(src))if(f.endsWith('.sql'))fs.copyFileSync(path.join(src,f),path.join(dst,f));\"",
"build:publish": "tsc -p tsconfig.publish.json && node -e \"const fs=require('fs');const path=require('path');const src='src/migrations';const dst='dist/migrations';fs.mkdirSync(dst,{recursive:true});for(const f of fs.readdirSync(src))if(f.endsWith('.sql'))fs.copyFileSync(path.join(src,f),path.join(dst,f));\""
```

The test-compile pipeline (`scripts/compile-tests.mjs`) already overlays non-TS sibling assets (Phase 2 Task 4 confirmed for YAML; SQL files use the same mechanism — verify by inspection or with `node --test` running successfully).

- [ ] **Step 6: Run; pass**

```
cd packages/coworker-memory && npm run build && cd ../..
npm run test:compile
node --test dist-test/packages/coworker-memory/src/local-sqlite-backend.test.js
```

Expected: 7/7 pass. If the test-compile pipeline doesn't copy `.sql`, extend it (look at `scripts/compile-tests.mjs`'s `copyAssets` function — add `.sql` to the list of non-TS extensions).

- [ ] **Step 7: Commit**

```bash
git add packages/coworker-memory/package.json packages/coworker-memory/src/migrations/001-init.sql packages/coworker-memory/src/local-sqlite-backend.ts packages/coworker-memory/src/local-sqlite-backend.test.ts
# plus scripts/compile-tests.mjs if you extended it
git commit -m "feat(coworker-3): LocalSqliteBackend with FTS5 + WAL + SQLITE_BUSY retry (Phase 3 Task 7)"
```

---

### Task 8: `MemoryRecorder` — cross-pillar contract with SecretScanner redact + audit

**Files:**
- Create: `packages/coworker-memory/src/memory-recorder.ts`
- Create: `packages/coworker-memory/src/memory-recorder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-memory/src/memory-recorder.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import { LocalSqliteBackend } from './local-sqlite-backend.js';
import { MemoryRecorder } from './memory-recorder.js';

async function ctx() {
  const dir = mkdtempSync(join(tmpdir(), 'mr-'));
  const audit = new AuditLog({ path: join(dir, 'audit.jsonl') });
  const scanner = new SecretScanner();
  const backend = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
  await backend.open();
  return { dir, audit, scanner, backend };
}

describe('MemoryRecorder', () => {
  it('recordTurn writes kind:turn drawer for short text', async () => {
    const c = await ctx();
    const recorder = new MemoryRecorder({
      backend: c.backend, scanner: c.scanner, audit: c.audit,
      writeWing: 'global', currentScratchpadName: () => null,
    });
    await recorder.recordTurn({ sessionId: 's', userText: 'hi', turnId: 't1' });
    const wings = await c.backend.listWings();
    assert.deepEqual(wings, ['global']);
    const rooms = await c.backend.listRooms('global');
    assert.deepEqual(rooms, ['inbox']);
    await c.backend.close();
  });
  it('recordTurn writes kind:paste drawer for long text', async () => {
    const c = await ctx();
    const recorder = new MemoryRecorder({
      backend: c.backend, scanner: c.scanner, audit: c.audit,
      writeWing: 'global', currentScratchpadName: () => 'p1',
    });
    await recorder.recordTurn({ sessionId: 's', userText: 'x'.repeat(600), turnId: 't1' });
    const r = await c.backend.recall({ query: 'x' });
    assert.equal(r[0]!.drawer.kind, 'paste');
    assert.equal(r[0]!.drawer.room, 'p1');
    await c.backend.close();
  });
  it('redacts secret content and sets redacted=true', async () => {
    const c = await ctx();
    const recorder = new MemoryRecorder({
      backend: c.backend, scanner: c.scanner, audit: c.audit,
      writeWing: 'global', currentScratchpadName: () => null,
    });
    await recorder.recordPaste({ sessionId: 's', content: 'token AKIAABCDEFGHIJKLMNOP', turnId: 't1' });
    const r = await c.backend.recall({ query: 'token' });
    assert.equal(r[0]!.drawer.redacted, true);
    assert.match(r[0]!.drawer.content, /\[REDACTED:aws_access_key_id\]/);
    const rows: { action: string }[] = [];
    for await (const x of c.audit.read({ producer: 'memory', action: 'redact' })) rows.push(x as never);
    assert.equal(rows.length, 1);
    await c.backend.close();
  });
  it('recordFileLoad stores structured JSON in content', async () => {
    const c = await ctx();
    const recorder = new MemoryRecorder({
      backend: c.backend, scanner: c.scanner, audit: c.audit,
      writeWing: 'global', currentScratchpadName: () => 'p1',
    });
    await recorder.recordFileLoad({
      scratchpadName: 'p1', collector: 'file', uri: 'file:///x.csv',
      bytes: 1000, rows_loaded: 50, schema: { cols: ['a','b'] }, turnId: 't1',
    });
    const r = await c.backend.recall({ query: 'file' });
    assert.equal(r[0]!.drawer.kind, 'file_load');
    const parsed = JSON.parse(r[0]!.drawer.content);
    assert.equal(parsed.uri, 'file:///x.csv');
    assert.equal(parsed.rows_loaded, 50);
    await c.backend.close();
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement `memory-recorder.ts`**

```typescript
// packages/coworker-memory/src/memory-recorder.ts
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import type { MemoryBackend } from './memory-backend.js';
import type { Wing, Room, Drawer } from './types.js';
import { detectPaste } from './paste-detector.js';

export interface CurrentScratchpadProvider {
  (sessionId: string): string | null;
}

export interface MemoryRecorderOptions {
  backend: MemoryBackend;
  scanner: SecretScanner;
  audit: AuditLog;
  writeWing: Wing;
  currentScratchpadName: CurrentScratchpadProvider;
  pasteOptions?: { lengthThreshold?: number; newlineThreshold?: number };
}

export class MemoryRecorder {
  constructor(private readonly opts: MemoryRecorderOptions) {}

  async recordTurn(args: { sessionId: string; userText: string; turnId: string; room?: Room }): Promise<Drawer> {
    const kind = detectPaste(args.userText, this.opts.pasteOptions);
    const room = args.room ?? this.opts.currentScratchpadName(args.sessionId) ?? 'inbox';
    return this.writeDrawer({
      wing: this.opts.writeWing, room, kind,
      content: args.userText, metadata: { turn_id: args.turnId, session_id: args.sessionId },
    });
  }

  async recordPaste(args: { sessionId: string; content: string; turnId: string; room?: Room }): Promise<Drawer> {
    const room = args.room ?? this.opts.currentScratchpadName(args.sessionId) ?? 'inbox';
    return this.writeDrawer({
      wing: this.opts.writeWing, room, kind: 'paste',
      content: args.content, metadata: { turn_id: args.turnId, session_id: args.sessionId },
    });
  }

  async recordFileLoad(args: {
    scratchpadName: string; collector: string; uri: string;
    bytes: number; rows_loaded?: number; schema?: object; turnId: string;
  }): Promise<Drawer> {
    const content = JSON.stringify({
      collector: args.collector, uri: args.uri, bytes: args.bytes,
      rows_loaded: args.rows_loaded, schema: args.schema,
    });
    return this.writeDrawer({
      wing: this.opts.writeWing, room: args.scratchpadName, kind: 'file_load',
      content, metadata: { turn_id: args.turnId, scratchpad: args.scratchpadName },
    });
  }

  private async writeDrawer(input: Omit<Drawer, 'id' | 'created_at' | 'redacted'>): Promise<Drawer> {
    const hits = this.opts.scanner.scan(input.content);
    let content = input.content;
    let redacted = false;
    if (hits.length > 0) {
      content = this.opts.scanner.redact(input.content);
      redacted = true;
      const ts = new Date().toISOString();
      for (const h of hits) {
        this.opts.audit.append({
          _schema: 1, ts, producer: 'memory', action: 'redact', severity: 'warn',
          detail: { wing: input.wing, room: input.room, kind: input.kind,
                    secret_kind: h.kind, offset: h.start, length: h.end - h.start },
        });
      }
    }
    const drawer = await this.opts.backend.retain({ ...input, content, redacted });
    this.opts.audit.append({
      _schema: 1, ts: new Date().toISOString(), producer: 'memory', action: 'write-drawer',
      detail: { wing: drawer.wing, room: drawer.room, kind: drawer.kind, byte_count: content.length, redacted },
    });
    return drawer;
  }
}
```

- [ ] **Step 4: Run; pass**

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-memory/src/memory-recorder.ts packages/coworker-memory/src/memory-recorder.test.ts
git commit -m "feat(coworker-3): MemoryRecorder with SecretScanner redact + audit (Phase 3 Task 8)"
```

---

### Task 9: `RecallFormatter` — markdown block for LLM tool_result

**Files:**
- Create: `packages/coworker-memory/src/recall-formatter.ts`
- Create: `packages/coworker-memory/src/recall-formatter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-memory/src/recall-formatter.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatRecall } from './recall-formatter.js';

describe('formatRecall', () => {
  it('returns empty header for zero results', () => {
    const md = formatRecall([]);
    assert.match(md, /### Memory recall \(0 matches\)/);
    assert.equal(md.includes('drawer://'), false);
  });
  it('renders match metadata + snippet + drawer URI', () => {
    const md = formatRecall([{
      drawer: {
        id: 'abc123', wing: 'global', room: 'inbox', kind: 'paste',
        content: 'full content', metadata: {}, created_at: '2026-06-01T14:22:00Z',
        redacted: false,
      },
      score: 5.21, snippet: 'paste content <mark>matched</mark> terms',
    }]);
    assert.match(md, /\[global\/inbox\/paste · 2026-06-01 14:22\] \(score 5\.21\)/);
    assert.match(md, /<mark>matched<\/mark>/);
    assert.match(md, /drawer:\/\/abc123/);
  });
  it('flags redacted drawers', () => {
    const md = formatRecall([{
      drawer: {
        id: 'r1', wing: 'g', room: 'inbox', kind: 'paste', content: 'x',
        metadata: {}, created_at: '2026-06-01T00:00:00Z', redacted: true,
      },
      score: 1, snippet: 'x',
    }]);
    assert.match(md, /\(redacted\)/);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```typescript
// packages/coworker-memory/src/recall-formatter.ts
import type { RecallResult } from './types.js';

export function formatRecall(results: RecallResult[]): string {
  const header = `### Memory recall (${results.length} matches)\n`;
  if (results.length === 0) return header;
  const lines: string[] = [header];
  results.forEach((r, i) => {
    const ts = r.drawer.created_at.replace('T', ' ').slice(0, 16);
    const redacted = r.drawer.redacted ? ' (redacted)' : '';
    lines.push(`\n${i + 1}. [${r.drawer.wing}/${r.drawer.room}/${r.drawer.kind} · ${ts}] (score ${r.score.toFixed(2)})${redacted}`);
    lines.push(`   > ${r.snippet}`);
    lines.push(`   drawer://${r.drawer.id}`);
  });
  return lines.join('\n');
}
```

- [ ] **Step 4: Run; pass**

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-memory/src/recall-formatter.ts packages/coworker-memory/src/recall-formatter.test.ts
git commit -m "feat(coworker-3): recall formatter (Phase 3 Task 9)"
```

---

### Task 10: `ContextInjection` — Layer A → system-prompt block

**Files:**
- Create: `packages/coworker-memory/src/context-injection.ts`
- Create: `packages/coworker-memory/src/context-injection.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-memory/src/context-injection.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import { LayerAStore } from './layer-a-store.js';
import { buildLayerAContext } from './context-injection.js';

async function makeStores() {
  const root = mkdtempSync(join(tmpdir(), 'ci-'));
  const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
  const scanner = new SecretScanner();
  const globalStore = new LayerAStore({ scopeDir: join(root, 'g'), scope: 'global', audit, scanner });
  const workspaceStore = new LayerAStore({ scopeDir: join(root, 'w'), scope: 'workspace', audit, scanner });
  return { root, globalStore, workspaceStore };
}

describe('buildLayerAContext', () => {
  it('returns empty when no Layer A files exist', async () => {
    const { globalStore, workspaceStore } = await makeStores();
    const md = await buildLayerAContext({
      mode: 'per-project-tagged', globalStore, workspaceStore, tokenLimit: 3000,
    });
    assert.equal(md, '');
  });
  it('global mode reads global only', async () => {
    const { globalStore, workspaceStore } = await makeStores();
    await globalStore.append({ kind: 'profile', text: 'global profile', source: 'user', ts: '2026-06-02T00:00:00Z' });
    await workspaceStore.append({ kind: 'profile', text: 'workspace profile', source: 'user', ts: '2026-06-02T00:00:00Z' });
    const md = await buildLayerAContext({
      mode: 'global', globalStore, workspaceStore, tokenLimit: 3000,
    });
    assert.match(md, /global profile/);
    assert.equal(md.includes('workspace profile'), false);
  });
  it('per-project mode reads workspace only', async () => {
    const { globalStore, workspaceStore } = await makeStores();
    await globalStore.append({ kind: 'profile', text: 'global profile', source: 'user', ts: '2026-06-02T00:00:00Z' });
    await workspaceStore.append({ kind: 'profile', text: 'workspace profile', source: 'user', ts: '2026-06-02T00:00:00Z' });
    const md = await buildLayerAContext({
      mode: 'per-project', globalStore, workspaceStore, tokenLimit: 3000,
    });
    assert.match(md, /workspace profile/);
    assert.equal(md.includes('global profile'), false);
  });
  it('per-project-tagged includes both with workspace first', async () => {
    const { globalStore, workspaceStore } = await makeStores();
    await globalStore.append({ kind: 'rule', text: 'global rule', source: 'user', ts: '2026-06-02T00:00:00Z' });
    await workspaceStore.append({ kind: 'rule', text: 'workspace rule', source: 'user', ts: '2026-06-02T00:00:00Z' });
    const md = await buildLayerAContext({
      mode: 'per-project-tagged', globalStore, workspaceStore, tokenLimit: 3000,
    });
    const wsIdx = md.indexOf('workspace rule');
    const gIdx = md.indexOf('global rule');
    assert.ok(wsIdx > 0 && gIdx > 0);
    assert.ok(wsIdx < gIdx, 'workspace should appear before global');
  });
  it('truncates lower-priority files when token limit exceeded', async () => {
    const { globalStore, workspaceStore } = await makeStores();
    await workspaceStore.append({ kind: 'profile', text: 'p'.repeat(1000), source: 'user', ts: '2026-06-02T00:00:00Z' });
    await workspaceStore.append({ kind: 'rule',    text: 'r'.repeat(1000), source: 'user', ts: '2026-06-02T00:00:00Z' });
    await workspaceStore.append({ kind: 'lesson',  text: 'l'.repeat(1000), source: 'user', ts: '2026-06-02T00:00:00Z' });
    const md = await buildLayerAContext({
      mode: 'per-project', globalStore, workspaceStore, tokenLimit: 300, // ~1200 chars
    });
    assert.ok(md.includes('p'.repeat(50)));
    // lessons should be dropped because lowest priority
    assert.equal(md.includes('l'.repeat(900)), false);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```typescript
// packages/coworker-memory/src/context-injection.ts
import type { ScopeMode } from './types.js';
import type { LayerAStore } from './layer-a-store.js';

export interface ContextInjectionArgs {
  mode: ScopeMode;
  globalStore: LayerAStore;
  workspaceStore: LayerAStore;
  tokenLimit: number;     // approx 4 chars per token
}

const CHARS_PER_TOKEN = 4;

export async function buildLayerAContext(args: ContextInjectionArgs): Promise<string> {
  const charLimit = args.tokenLimit * CHARS_PER_TOKEN;

  const readScopes: Array<'workspace' | 'global'> = args.mode === 'global'
    ? ['global']
    : args.mode === 'per-project'
      ? ['workspace']
      : ['workspace', 'global'];

  type Section = { title: string; body: string; priority: number };
  const sections: Section[] = [];

  const PRIORITIES: Record<string, number> = { profile: 0, rules: 1, lessons: 2 };

  for (const scope of readScopes) {
    const store = scope === 'global' ? args.globalStore : args.workspaceStore;
    const profile = await store.read('profile');
    const rules = await store.read('rule');
    const lessons = await store.read('lesson');
    if (profile) sections.push({ title: `Profile (${scope})`, body: profile, priority: PRIORITIES.profile });
    if (rules) sections.push({ title: `Rules (${scope})`, body: rules, priority: PRIORITIES.rules });
    if (lessons) sections.push({ title: `Recent lessons (${scope})`, body: lessons, priority: PRIORITIES.lessons });
  }

  if (sections.length === 0) return '';

  // workspace comes first because we iterated readScopes in that order; stable sort by priority.
  sections.sort((a, b) => a.priority - b.priority);

  let total = 0;
  const include: Section[] = [];
  for (const s of sections) {
    const cost = s.title.length + s.body.length + 10;
    if (total + cost > charLimit && include.length > 0) break;
    include.push(s);
    total += cost;
  }

  const lines = ['## Memory (Layer A)\n'];
  for (const s of include) {
    lines.push(`### ${s.title}\n${s.body}\n`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run; pass**

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-memory/src/context-injection.ts packages/coworker-memory/src/context-injection.test.ts
git commit -m "feat(coworker-3): context-injection Layer A → system prompt block (Phase 3 Task 10)"
```

---

### Task 11: `PersonaSeed` — one-shot copy of persona memory-seed/

**Files:**
- Create: `packages/coworker-memory/src/persona-seed.ts`
- Create: `packages/coworker-memory/src/persona-seed.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-memory/src/persona-seed.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import { LayerAStore } from './layer-a-store.js';
import { applyPersonaSeed } from './persona-seed.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ps-'));
  const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
  const scanner = new SecretScanner();
  const scopeDir = join(root, 'memory');
  const personaDir = join(root, 'persona-noc');
  const seedDir = join(personaDir, 'memory-seed');
  mkdirSync(seedDir, { recursive: true });
  const store = new LayerAStore({ scopeDir, scope: 'workspace', audit, scanner });
  return { root, audit, store, personaDir, seedDir };
}

describe('applyPersonaSeed', () => {
  it('copies profile.md/rules.md/lessons.md from persona memory-seed', async () => {
    const c = setup();
    writeFileSync(join(c.seedDir, 'profile.md'), 'Persona NOC profile baseline.');
    writeFileSync(join(c.seedDir, 'rules.md'), 'Always escalate P1 to mgr.');
    writeFileSync(join(c.seedDir, 'lessons.md'), 'Datadog API uses pagination.');
    const out = await applyPersonaSeed({
      personaId: 'noc-ops', personaDir: c.personaDir, store: c.store,
    });
    assert.deepEqual(out.copied.sort(), ['lessons.md', 'profile.md', 'rules.md']);
    assert.match(await c.store.read('profile'), /Persona NOC profile baseline/);
    assert.match(await c.store.read('rule'), /Always escalate P1 to mgr/);
    assert.match(await c.store.read('lesson'), /Datadog API uses pagination/);
  });
  it('blocks files containing secrets but copies remaining', async () => {
    const c = setup();
    writeFileSync(join(c.seedDir, 'profile.md'), 'Persona baseline.');
    writeFileSync(join(c.seedDir, 'rules.md'), 'use AKIAABCDEFGHIJKLMNOP for telemetry');
    const out = await applyPersonaSeed({
      personaId: 'noc-ops', personaDir: c.personaDir, store: c.store,
    });
    assert.deepEqual(out.copied, ['profile.md']);
    assert.deepEqual(out.blocked, ['rules.md']);
    assert.equal(await c.store.read('rule'), '');
  });
  it('returns empty result when persona has no memory-seed dir', async () => {
    const c = setup();
    // No files written; remove seedDir
    const out = await applyPersonaSeed({
      personaId: 'plain', personaDir: join(c.root, 'no-such-persona'), store: c.store,
    });
    assert.deepEqual(out.copied, []);
    assert.deepEqual(out.blocked, []);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```typescript
// packages/coworker-memory/src/persona-seed.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LayerAStore } from './layer-a-store.js';
import type { LayerAKind } from './types.js';
import { LayerAWriteBlocked } from './errors.js';

const FILE_MAP: Array<{ name: string; kind: LayerAKind }> = [
  { name: 'profile.md', kind: 'profile' },
  { name: 'rules.md', kind: 'rule' },
  { name: 'lessons.md', kind: 'lesson' },
];

export interface SeedResult {
  copied: string[];
  blocked: string[];
}

export async function applyPersonaSeed(args: {
  personaId: string;
  personaDir: string;
  store: LayerAStore;
}): Promise<SeedResult> {
  const seedDir = join(args.personaDir, 'memory-seed');
  if (!existsSync(seedDir)) return { copied: [], blocked: [] };
  const ts = new Date().toISOString();
  const copied: string[] = [];
  const blocked: string[] = [];
  for (const entry of FILE_MAP) {
    const path = join(seedDir, entry.name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8').trim();
    if (!text) continue;
    try {
      await args.store.append({ kind: entry.kind, text, source: 'persona-seed', ts });
      copied.push(entry.name);
    } catch (err) {
      if (err instanceof LayerAWriteBlocked) {
        blocked.push(entry.name);
      } else {
        throw err;
      }
    }
  }
  return { copied, blocked };
}
```

- [ ] **Step 4: Run; pass**

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-memory/src/persona-seed.ts packages/coworker-memory/src/persona-seed.test.ts
git commit -m "feat(coworker-3): persona memory-seed one-shot copy (Phase 3 Task 11)"
```

---

### Task 12: Wire public barrel

**Files:**
- Modify: `packages/coworker-memory/src/index.ts`
- Modify: `packages/coworker-memory/src/index.test.ts` (placeholder needs updating)

- [ ] **Step 1: Replace barrel content**

```typescript
// packages/coworker-memory/src/index.ts
export * from './types.js';
export * from './errors.js';
export * from './memory-backend.js';
export * from './workspace-id.js';
export * from './scope-resolver.js';
export * from './paste-detector.js';
export * from './layer-a-store.js';
export * from './local-sqlite-backend.js';
export * from './memory-recorder.js';
export * from './recall-formatter.js';
export * from './context-injection.js';
export * from './persona-seed.js';
```

- [ ] **Step 2: Update placeholder test**

Read the current `index.test.ts`. If it asserts the barrel is empty, replace with spot-checks of representative exports (mirrors Phase 2 vault Task 7 pattern):

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as memory from './index.js';

describe('@otto/coworker-memory barrel', () => {
  it('exports the key surface', () => {
    assert.equal(typeof memory.LocalSqliteBackend, 'function');
    assert.equal(typeof memory.LayerAStore, 'function');
    assert.equal(typeof memory.MemoryRecorder, 'function');
    assert.equal(typeof memory.resolveWorkspaceId, 'function');
    assert.equal(typeof memory.resolveScope, 'function');
    assert.equal(typeof memory.detectPaste, 'function');
    assert.equal(typeof memory.formatRecall, 'function');
    assert.equal(typeof memory.buildLayerAContext, 'function');
    assert.equal(typeof memory.applyPersonaSeed, 'function');
  });
  it('exports error classes', () => {
    assert.equal(typeof memory.LayerAWriteBlocked, 'function');
    assert.equal(typeof memory.RecallQueryMalformed, 'function');
  });
});
```

- [ ] **Step 3: Run full coworker-memory suite; verify no regressions**

```
npm run test:compile
node --test dist-test/packages/coworker-memory/src/*.test.js
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/coworker-memory/src/index.ts packages/coworker-memory/src/index.test.ts
git commit -m "feat(coworker-3): wire public barrel (Phase 3 Task 12)"
```

---

### Task 13: `coworker-memory` extension scaffold + `createMemoryBundle`

**Files:**
- Create: `src/resources/extensions/coworker-memory/extension-manifest.json`
- Create: `src/resources/extensions/coworker-memory/memory-singleton.ts`
- Create: `src/resources/extensions/coworker-memory/memory-singleton.test.ts`
- Create: `src/resources/extensions/coworker-memory/index.ts`

- [ ] **Step 1: Manifest**

```json
{
  "id": "coworker-memory",
  "name": "Co-worker Memory",
  "version": "1.0.0",
  "description": "Layered memory: Layer A (markdown rules/lessons) + Layer B (verbatim SQLite drawers) with /memory commands and memorize/recall tools",
  "tier": "bundled",
  "requires": { "platform": ">=2.29.0" },
  "provides": {
    "tools": ["memorize", "recall"],
    "commands": ["memory"],
    "hooks": ["session_start", "session_shutdown"]
  }
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/resources/extensions/coworker-memory/memory-singleton.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundle } from './memory-singleton.js';

describe('memory singleton bundle', () => {
  it('constructs scope-aware bundle with all stores', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mem-home-'));
    const ws = mkdtempSync(join(tmpdir(), 'mem-ws-'));
    mkdirSync(ws, { recursive: true });
    const bundle = await createMemoryBundle({
      globalDir: home, workspaceDir: ws,
      scopeMode: 'per-project-tagged',
      currentScratchpadName: () => null,
    });
    assert.ok(bundle.globalLayerA);
    assert.ok(bundle.workspaceLayerA);
    assert.ok(bundle.backend);
    assert.ok(bundle.recorder);
    assert.equal(bundle.scopeMode, 'per-project-tagged');
    assert.match(bundle.workspaceWing, /-[0-9a-f]{6}$/);
    assert.equal(bundle.writeWing, bundle.workspaceWing);
    assert.deepEqual(bundle.readWings, [bundle.workspaceWing, 'global']);
    await bundle.dispose();
  });
  it('global mode bundle uses wing global', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mem-home-g-'));
    const ws = mkdtempSync(join(tmpdir(), 'mem-ws-g-'));
    const bundle = await createMemoryBundle({
      globalDir: home, workspaceDir: ws,
      scopeMode: 'global',
      currentScratchpadName: () => null,
    });
    assert.equal(bundle.writeWing, 'global');
    assert.deepEqual(bundle.readWings, ['global']);
    await bundle.dispose();
  });
});
```

- [ ] **Step 3: Run; FAIL**

- [ ] **Step 4: Implement singleton**

```typescript
// src/resources/extensions/coworker-memory/memory-singleton.ts
import { join } from 'node:path';
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import {
  LayerAStore, LocalSqliteBackend, MemoryRecorder, resolveScope, resolveWorkspaceId,
  type ScopeMode, type Wing, type CurrentScratchpadProvider, type WorkspaceIdRecord,
} from '@otto/coworker-memory';

export interface MemoryBundleOptions {
  globalDir: string;
  workspaceDir: string;
  scopeMode: ScopeMode;
  currentScratchpadName: CurrentScratchpadProvider;
}

export interface MemoryBundle {
  globalLayerA: LayerAStore;
  workspaceLayerA: LayerAStore;
  backend: LocalSqliteBackend;
  recorder: MemoryRecorder;
  audit: AuditLog;
  scanner: SecretScanner;
  workspaceWing: Wing;
  writeWing: Wing;
  readWings: Wing[];
  scopeMode: ScopeMode;
  workspaceRecord: WorkspaceIdRecord;
  workspaceDir: string;
  dispose(): Promise<void>;
}

export async function createMemoryBundle(opts: MemoryBundleOptions): Promise<MemoryBundle> {
  const audit = new AuditLog({ path: join(opts.globalDir, 'audit.jsonl') });
  const scanner = new SecretScanner();
  const wsRecord = await resolveWorkspaceId(opts.workspaceDir);
  const scope = resolveScope({ mode: opts.scopeMode, workspaceId: wsRecord.id });
  const globalLayerA = new LayerAStore({
    scopeDir: join(opts.globalDir, 'memory'), scope: 'global', audit, scanner,
  });
  const workspaceLayerA = new LayerAStore({
    scopeDir: join(opts.workspaceDir, '.otto', 'memory'), scope: 'workspace', audit, scanner,
  });
  const backend = new LocalSqliteBackend({
    dbPath: join(opts.workspaceDir, '.otto', 'memory', 'layer-b.db'),
  });
  await backend.open();
  const recorder = new MemoryRecorder({
    backend, scanner, audit,
    writeWing: scope.writeWing,
    currentScratchpadName: opts.currentScratchpadName,
  });
  return {
    globalLayerA, workspaceLayerA, backend, recorder, audit, scanner,
    workspaceWing: wsRecord.id, writeWing: scope.writeWing, readWings: scope.readWings,
    scopeMode: opts.scopeMode, workspaceRecord: wsRecord, workspaceDir: opts.workspaceDir,
    async dispose() { await backend.close(); },
  };
}
```

- [ ] **Step 5: Extension entry**

```typescript
// src/resources/extensions/coworker-memory/index.ts
export { createMemoryBundle } from './memory-singleton.js';
export type { MemoryBundle, MemoryBundleOptions } from './memory-singleton.js';
```

- [ ] **Step 6: Run; pass**

Expected: 2/2 pass.

- [ ] **Step 7: Commit**

```bash
git add src/resources/extensions/coworker-memory/
git commit -m "feat(coworker-3): coworker-memory extension scaffold + singleton (Phase 3 Task 13)"
```

---

### Task 14: `memorize` LLM tool

**Files:**
- Create: `src/resources/extensions/coworker-memory/memorize-tool.ts`
- Create: `src/resources/extensions/coworker-memory/memorize-tool.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/resources/extensions/coworker-memory/memorize-tool.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundle } from './memory-singleton.js';
import { runMemorize } from './memorize-tool.js';

async function bundleFor(scope: 'global'|'per-project'|'per-project-tagged') {
  return createMemoryBundle({
    globalDir: mkdtempSync(join(tmpdir(), 'mt-home-')),
    workspaceDir: mkdtempSync(join(tmpdir(), 'mt-ws-')),
    scopeMode: scope, currentScratchpadName: () => null,
  });
}

describe('memorize tool', () => {
  it('writes lesson to workspace by default', async () => {
    const b = await bundleFor('per-project-tagged');
    await runMemorize(b, { text: 'MTTR target 30m', kind: 'lesson' });
    const body = await b.workspaceLayerA.read('lesson');
    assert.match(body, /MTTR target 30m/);
    assert.equal((await b.globalLayerA.read('lesson')), '');
    await b.dispose();
  });
  it('honors scope: global', async () => {
    const b = await bundleFor('per-project-tagged');
    await runMemorize(b, { text: 'use polars', kind: 'profile', scope: 'global' });
    assert.match(await b.globalLayerA.read('profile'), /use polars/);
    await b.dispose();
  });
  it('throws LayerAWriteBlocked on secret content', async () => {
    const b = await bundleFor('per-project-tagged');
    await assert.rejects(
      () => runMemorize(b, { text: 'token AKIAABCDEFGHIJKLMNOP', kind: 'rule' }),
      /VAULT|secret-shaped|Refused/,
    );
    await b.dispose();
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```typescript
// src/resources/extensions/coworker-memory/memorize-tool.ts
import type { MemoryBundle } from './memory-singleton.js';
import type { LayerAKind } from '@otto/coworker-memory';

export interface MemorizeArgs {
  text: string;
  kind: LayerAKind;
  scope?: 'global' | 'workspace';
}

export async function runMemorize(bundle: MemoryBundle, args: MemorizeArgs): Promise<{ stored: true; layer_a_file: string }> {
  const scope = args.scope ?? 'workspace';
  const store = scope === 'global' ? bundle.globalLayerA : bundle.workspaceLayerA;
  const ts = new Date().toISOString();
  await store.append({ kind: args.kind, text: args.text, source: 'user', ts });
  return {
    stored: true,
    layer_a_file: args.kind === 'lesson' ? 'lessons.md' : args.kind === 'rule' ? 'rules.md' : 'profile.md',
  };
}
```

- [ ] **Step 4: Run; pass**

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/coworker-memory/memorize-tool.ts src/resources/extensions/coworker-memory/memorize-tool.test.ts
git commit -m "feat(coworker-3): memorize LLM tool (Phase 3 Task 14)"
```

---

### Task 15: `recall` LLM tool

**Files:**
- Create: `src/resources/extensions/coworker-memory/recall-tool.ts`
- Create: `src/resources/extensions/coworker-memory/recall-tool.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/resources/extensions/coworker-memory/recall-tool.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundle } from './memory-singleton.js';
import { runRecall } from './recall-tool.js';

async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'rt-home-'));
  const ws = mkdtempSync(join(tmpdir(), 'rt-ws-'));
  mkdirSync(ws, { recursive: true });
  return createMemoryBundle({
    globalDir: home, workspaceDir: ws,
    scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
  });
}

describe('recall tool', () => {
  it('returns results with markdown rendering', async () => {
    const b = await setup();
    await b.recorder.recordTurn({ sessionId: 's', userText: 'customer paste about load balancer', turnId: 't1' });
    const r = await runRecall(b, { query: 'load balancer' });
    assert.equal(r.results.length, 1);
    assert.match(r.markdown, /Memory recall \(1 matches\)/);
    assert.match(r.markdown, /drawer:\/\//);
    await b.dispose();
  });
  it('honors max_results clamp 1..64', async () => {
    const b = await setup();
    for (let i = 0; i < 100; i++) {
      await b.recorder.recordTurn({ sessionId: 's', userText: `apple ${i}`, turnId: `t${i}` });
    }
    const big = await runRecall(b, { query: 'apple', max_results: 200 });
    assert.ok(big.results.length <= 64);
    const small = await runRecall(b, { query: 'apple', max_results: 0 });
    assert.equal(small.results.length, 1);
    await b.dispose();
  });
  it('filters by kind', async () => {
    const b = await setup();
    await b.recorder.recordTurn({ sessionId: 's', userText: 'short alpha', turnId: 't1' });
    await b.recorder.recordPaste({ sessionId: 's', content: 'long alpha paste', turnId: 't2' });
    const onlyPaste = await runRecall(b, { query: 'alpha', kind: 'paste' });
    assert.equal(onlyPaste.results.length, 1);
    assert.equal(onlyPaste.results[0]!.drawer.kind, 'paste');
    await b.dispose();
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```typescript
// src/resources/extensions/coworker-memory/recall-tool.ts
import type { MemoryBundle } from './memory-singleton.js';
import { formatRecall, type RecallQuery, type RecallResult } from '@otto/coworker-memory';

export interface RecallToolArgs {
  query: string;
  kind?: RecallQuery['kind'];
  wing?: string;
  room?: string;
  days_back?: number;
  max_results?: number;
}

export interface RecallToolOutput {
  results: RecallResult[];
  markdown: string;
}

export async function runRecall(bundle: MemoryBundle, args: RecallToolArgs): Promise<RecallToolOutput> {
  const wings = args.wing ? [args.wing, ...bundle.readWings.filter(w => w !== args.wing)] : bundle.readWings;
  const limit = args.max_results === undefined ? 8 : Math.min(Math.max(args.max_results, 1), 64);
  const results = await bundle.backend.recall({
    query: args.query, wing: wings, room: args.room, kind: args.kind,
    days_back: args.days_back, max_results: limit,
  });
  bundle.audit.append({
    _schema: 1, ts: new Date().toISOString(), producer: 'memory', action: 'recall',
    detail: {
      wing_filter: wings, room_filter: args.room ?? null,
      kind_filter: args.kind ?? null, days_back: args.days_back ?? null,
      result_count: results.length,
    },
  });
  return { results, markdown: formatRecall(results) };
}
```

- [ ] **Step 4: Run; pass**

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/coworker-memory/recall-tool.ts src/resources/extensions/coworker-memory/recall-tool.test.ts
git commit -m "feat(coworker-3): recall LLM tool with formatter (Phase 3 Task 15)"
```

---

### Task 16: `/memory` slash commands

**Files:**
- Create: `src/resources/extensions/coworker-memory/memory-command.ts`
- Create: `src/resources/extensions/coworker-memory/memory-command.test.ts`

The command supports: `note <text>`, `wing <name>`, `room <name>`, `status`, `clear --wing <name> --confirm`, `seed --persona <id>`. Wing/room are session-scoped overrides; the implementer wires the session-state holder.

- [ ] **Step 1: Write the failing test**

```typescript
// src/resources/extensions/coworker-memory/memory-command.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundle } from './memory-singleton.js';
import { runMemoryCommand } from './memory-command.js';

async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'mc-home-'));
  const ws = mkdtempSync(join(tmpdir(), 'mc-ws-'));
  mkdirSync(ws, { recursive: true });
  return createMemoryBundle({
    globalDir: home, workspaceDir: ws,
    scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
  });
}

describe('/memory command', () => {
  it('note appends a lesson', async () => {
    const b = await setup();
    const out = await runMemoryCommand(b, ['note', 'P1 includes MTTR']);
    assert.match(out.message, /lesson stored/i);
    assert.match(await b.workspaceLayerA.read('lesson'), /P1 includes MTTR/);
    await b.dispose();
  });
  it('status reports workspace_wing + drawer_count', async () => {
    const b = await setup();
    await b.recorder.recordTurn({ sessionId: 's', userText: 'x', turnId: 't' });
    const out = await runMemoryCommand(b, ['status']);
    assert.match(out.message, /workspace_wing:/);
    assert.match(out.message, /drawer_count: 1/);
    await b.dispose();
  });
  it('clear --wing deletes drawers', async () => {
    const b = await setup();
    await b.recorder.recordTurn({ sessionId: 's', userText: 'x', turnId: 't' });
    const out = await runMemoryCommand(b, ['clear', '--wing', b.writeWing, '--confirm']);
    assert.match(out.message, /deleted: 1/);
    await b.dispose();
  });
  it('clear without --confirm errors', async () => {
    const b = await setup();
    await assert.rejects(() => runMemoryCommand(b, ['clear', '--wing', 'x']));
    await b.dispose();
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```typescript
// src/resources/extensions/coworker-memory/memory-command.ts
import type { MemoryBundle } from './memory-singleton.js';
import { runMemorize } from './memorize-tool.js';

export interface MemoryCommandResult {
  message: string;
}

export async function runMemoryCommand(bundle: MemoryBundle, argv: string[]): Promise<MemoryCommandResult> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'note': {
      const text = rest.join(' ').trim();
      if (!text) throw new Error('Usage: /memory note <text>');
      await runMemorize(bundle, { text, kind: 'lesson', scope: 'workspace' });
      return { message: `lesson stored in workspace.` };
    }
    case 'status': {
      const status = await bundle.backend.status();
      return {
        message: [
          `scope_mode: ${bundle.scopeMode}`,
          `workspace_wing: ${bundle.workspaceWing}`,
          `drawer_count: ${status.drawer_count}`,
          `layer_b_db_path: ${status.layer_b_db_path}`,
          `schema_version: ${status.schema_version}`,
        ].join('\n'),
      };
    }
    case 'clear': {
      let wing: string | undefined;
      let confirm = false;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--wing' && rest[i+1]) { wing = rest[++i]; }
        else if (rest[i] === '--confirm') { confirm = true; }
      }
      if (!confirm) throw new Error('Usage: /memory clear --wing <wing> --confirm');
      const out = await bundle.backend.clear({ wing, confirm: true });
      return { message: `deleted: ${out.deleted}` };
    }
    case 'wing':
    case 'room': {
      // Session overrides — caller manages state; this is a placeholder return acknowledging.
      const target = rest.join(' ').trim();
      if (!target) throw new Error(`Usage: /memory ${sub} <name>`);
      return { message: `${sub} override: ${target}` };
    }
    case 'seed': {
      // Caller wires this to applyPersonaSeed via session-hooks; here we just acknowledge the request.
      return { message: 're-seed will run on next session_start; flip workspace.json.memory_seed_applied=false and reattach.' };
    }
    default:
      throw new Error(`Unknown /memory subcommand: ${sub}. Try: note, status, clear, wing, room, seed.`);
  }
}
```

- [ ] **Step 4: Run; pass**

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/coworker-memory/memory-command.ts src/resources/extensions/coworker-memory/memory-command.test.ts
git commit -m "feat(coworker-3): /memory note|status|clear|wing|room|seed (Phase 3 Task 16)"
```

---

### Task 17: Session hooks — session_start (Layer A inject + persona seed) and session_shutdown (WAL checkpoint)

**Files:**
- Create: `src/resources/extensions/coworker-memory/session-hooks.ts`
- Create: `src/resources/extensions/coworker-memory/session-hooks.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/resources/extensions/coworker-memory/session-hooks.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundle } from './memory-singleton.js';
import { onSessionStart, onSessionShutdown } from './session-hooks.js';
import { writeWorkspaceId } from '@otto/coworker-memory';

async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'sh-home-'));
  const ws = mkdtempSync(join(tmpdir(), 'sh-ws-'));
  mkdirSync(ws, { recursive: true });
  return { home, ws, bundle: await createMemoryBundle({
    globalDir: home, workspaceDir: ws,
    scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
  })};
}

describe('session hooks', () => {
  it('onSessionStart returns Layer A context block', async () => {
    const c = await setup();
    await c.bundle.workspaceLayerA.append({
      kind: 'lesson', text: 'do not deploy on friday', source: 'user', ts: '2026-06-02T00:00:00Z',
    });
    const out = await onSessionStart(c.bundle, { tokenLimit: 3000 });
    assert.match(out.contextBlock, /Memory \(Layer A\)/);
    assert.match(out.contextBlock, /do not deploy on friday/);
    await c.bundle.dispose();
  });
  it('onSessionStart applies persona seed when pending', async () => {
    const c = await setup();
    const personaDir = mkdtempSync(join(tmpdir(), 'persona-'));
    const seedDir = join(personaDir, 'memory-seed');
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(join(seedDir, 'rules.md'), 'Persona rule baseline');
    const out = await onSessionStart(c.bundle, {
      tokenLimit: 3000,
      persona: { id: 'noc-ops', personaDir },
    });
    assert.deepEqual(out.seed.copied, ['rules.md']);
    assert.equal(c.bundle.workspaceRecord.memory_seed_applied, true);
    assert.equal(c.bundle.workspaceRecord.memory_seed_persona, 'noc-ops');
    await c.bundle.dispose();
  });
  it('onSessionStart does not re-apply seed once flag is true', async () => {
    const c = await setup();
    const personaDir = mkdtempSync(join(tmpdir(), 'persona2-'));
    const seedDir = join(personaDir, 'memory-seed');
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(join(seedDir, 'rules.md'), 'Persona rule v1');
    await onSessionStart(c.bundle, { tokenLimit: 3000, persona: { id: 'noc-ops', personaDir } });
    // Now change the seed file but the flag is set.
    writeFileSync(join(seedDir, 'rules.md'), 'Persona rule v2');
    const second = await onSessionStart(c.bundle, { tokenLimit: 3000, persona: { id: 'noc-ops', personaDir } });
    assert.deepEqual(second.seed.copied, []);
    await c.bundle.dispose();
  });
  it('onSessionShutdown closes backend without throwing', async () => {
    const c = await setup();
    await onSessionShutdown(c.bundle);
    // Bundle is now disposed; second close should be safe.
    await c.bundle.dispose();
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

```typescript
// src/resources/extensions/coworker-memory/session-hooks.ts
import { buildLayerAContext, applyPersonaSeed, writeWorkspaceId } from '@otto/coworker-memory';
import type { MemoryBundle } from './memory-singleton.js';

export interface SessionStartOptions {
  tokenLimit?: number;
  persona?: { id: string; personaDir: string };
}

export interface SessionStartResult {
  contextBlock: string;
  seed: { copied: string[]; blocked: string[] };
}

export async function onSessionStart(bundle: MemoryBundle, opts: SessionStartOptions = {}): Promise<SessionStartResult> {
  let seed = { copied: [] as string[], blocked: [] as string[] };
  if (opts.persona && !bundle.workspaceRecord.memory_seed_applied) {
    seed = await applyPersonaSeed({
      personaId: opts.persona.id, personaDir: opts.persona.personaDir,
      store: bundle.workspaceLayerA,
    });
    if (seed.copied.length > 0 || seed.blocked.length > 0) {
      bundle.workspaceRecord.memory_seed_applied = true;
      bundle.workspaceRecord.memory_seed_persona = opts.persona.id;
      await writeWorkspaceId(bundle.workspaceDir, bundle.workspaceRecord);
      bundle.audit.append({
        _schema: 1, ts: new Date().toISOString(), producer: 'memory', action: 'seed-applied',
        detail: { persona_id: opts.persona.id, files_copied: seed.copied, files_blocked: seed.blocked },
      });
    }
  }
  const contextBlock = await buildLayerAContext({
    mode: bundle.scopeMode,
    globalStore: bundle.globalLayerA,
    workspaceStore: bundle.workspaceLayerA,
    tokenLimit: opts.tokenLimit ?? 3000,
  });
  return { contextBlock, seed };
}

export async function onSessionShutdown(bundle: MemoryBundle): Promise<void> {
  // WAL checkpoint happens on backend close; this is the seam.
  await bundle.dispose();
}
```

- [ ] **Step 4: Run; pass**

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/coworker-memory/session-hooks.ts src/resources/extensions/coworker-memory/session-hooks.test.ts
git commit -m "feat(coworker-3): session_start (Layer A + persona seed) + session_shutdown (Phase 3 Task 17)"
```

---

### Task 18: Cross-pillar — scratchpad `currentScratchpadName(sessionId)` accessor

**Files:**
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.ts`
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.test.ts`

The scratchpad extension already tracks the active scratchpad per session via the session-sidecar pattern (Phase 1). Expose an accessor for memory to use.

- [ ] **Step 1: Add failing test**

Append to the existing `sp-command.test.ts`:

```typescript
describe('/sp — currentScratchpadName accessor (Phase 3)', () => {
  it('returns name when attached', async () => {
    const { sp, manager, getCurrentScratchpadName, sessionId } = await makeWithSession();
    await sp(['new', 'p1']);
    await sp(['attach', 'p1']);
    assert.equal(getCurrentScratchpadName(sessionId), 'p1');
  });
  it('returns null when no scratchpad attached', async () => {
    const { getCurrentScratchpadName, sessionId } = await makeWithSession();
    assert.equal(getCurrentScratchpadName(sessionId), null);
  });
});
```

Where `makeWithSession()` is whatever helper already constructs sp-command in tests. If not present, follow the existing inline test setup pattern.

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement**

In `sp-command.ts`, after the existing helpers, export:

```typescript
import { readSessionSidecar } from './session-sidecar.js';   // existing Phase 1 helper

export function createCurrentScratchpadProvider(opts: {
  scratchpadsRoot: string;
}): (sessionId: string) => string | null {
  return (sessionId: string) => {
    if (!sessionId) return null;
    try {
      const sidecar = readSessionSidecar({ scratchpadsRoot: opts.scratchpadsRoot, sessionId });
      return sidecar?.currentName ?? null;
    } catch {
      return null;
    }
  };
}
```

If `readSessionSidecar` doesn't exist or has a different signature, adapt to whatever Phase 1 actually uses (look at `session-sidecar.ts`). The contract: given sessionId, return the currently-attached scratchpad name or null.

- [ ] **Step 4: Run; pass**

Expected: 2 new tests pass; existing tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/coworker-scratchpad/sp-command.ts src/resources/extensions/coworker-scratchpad/sp-command.test.ts
git commit -m "feat(coworker-3): expose currentScratchpadName accessor for memory's room derivation (Phase 3 Task 18)"
```

---

### Task 19: Cross-pillar — scratchpad FileCollector → MemoryRecorder.recordFileLoad

**Files:**
- Modify: `src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts`
- Modify: `src/resources/extensions/coworker-scratchpad/scratchpad-tool.test.ts`

The scratchpad's `cw_scratchpad` LLM tool already wraps `otto.collectors.open` to load files via `FileCollector`. After a successful load, call the memory recorder.

- [ ] **Step 1: Investigate**

Read `scratchpad-tool.ts` end to end. Find where the file load result is constructed (probably inside the `view` or `exec` action handler that detects an `otto.collectors.open` result). Identify the seam where we have access to `{ collector, uri, bytes, rows_loaded?, schema? }` post-load.

If the data is currently lost in the cell result blob, you may need to plumb it through — but typically the kernel-bindings layer already exposes this info via the MIME bundle.

- [ ] **Step 2: Add an optional `memoryRecorder` dependency**

```typescript
// At the top of scratchpad-tool.ts:
import type { MemoryRecorder } from '@otto/coworker-memory';

// In the tool's option/dependency interface:
memoryRecorder?: MemoryRecorder;
```

- [ ] **Step 3: Wire the call after a successful file load**

```typescript
// In the file-load completion path:
if (this.opts.memoryRecorder && loadResult) {
  await this.opts.memoryRecorder.recordFileLoad({
    scratchpadName: name,
    collector: loadResult.collector,
    uri: loadResult.uri,
    bytes: loadResult.bytes,
    rows_loaded: loadResult.rows_loaded,
    schema: loadResult.schema,
    turnId: ctx.turnId,
  });
}
```

If the existing tool doesn't have a turnId in scope, plumb one through; otherwise pass an empty string and document the gap.

- [ ] **Step 4: Add failing test**

In `scratchpad-tool.test.ts`, add a test that constructs a fake MemoryRecorder, runs a cell that loads a file, and asserts `recordFileLoad` was called with the expected args. Use a small spy:

```typescript
class SpyRecorder {
  calls: any[] = [];
  async recordFileLoad(args: any) { this.calls.push(args); }
  // other methods unused — type-cast as needed
}
```

- [ ] **Step 5: Run; iterate**

If the test fails because the load result shape isn't exposed at the call site, plumb the values through. If it's impossible without a deeper refactor, REPORT it as a gap and defer the actual wiring to a follow-up (integration test will surface it).

- [ ] **Step 6: Commit**

```bash
git add src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts src/resources/extensions/coworker-scratchpad/scratchpad-tool.test.ts
git commit -m "feat(coworker-3): scratchpad FileCollector → MemoryRecorder.recordFileLoad (Phase 3 Task 19)"
```

---

### Task 20: Auto-retain user turns — investigate and wire MemoryRecorder.recordTurn

**Files:**
- Investigate first: Otto's session machinery (top-level CLI / session module).
- Modify: whichever file owns "user message accepted; about to call agent". Likely `src/cli.ts` or a session-controller file. Read first.

This is the critical-path integration for the Day-2 milestone. The plan does NOT assume Otto exposes a `user_turn` extension hook today.

- [ ] **Step 1: Investigate**

Search the codebase for where a user message is committed before the agent responds. Likely locations:
- `src/cli.ts` (likely too high-level)
- A session controller in `src/coworker/` or `src/shared/`
- An "input pipeline" or "turn manager" — patterns vary

Read until you find the loop that processes user input → invokes the agent. Note the file:line of the call site.

- [ ] **Step 2: Decide the wiring approach**

Two options:
- **A. Direct call site.** If the user-turn commit point is reachable, call `memoryRecorder.recordTurn(...)` directly there. Simple but couples the controller to memory.
- **B. Add a session hook surface.** If Otto's extension system has a `user_turn` hook concept, declare it in the memory extension manifest and have the controller fire it. More architectural but matches the existing extension-hook pattern.

Pick A for v1 unless B is trivial. Document the choice in the PR.

- [ ] **Step 3: Plumb memoryRecorder to the call site**

The extension singleton (`createMemoryBundle`) returns the recorder. The controller needs access to a bundle — wire via extension activation OR a shared "co-worker bundles" registry if one exists.

- [ ] **Step 4: Add the call**

```typescript
// At the user-turn commit point:
try {
  await memoryRecorder.recordTurn({
    sessionId,
    userText: message,
    turnId,
  });
} catch (err) {
  // Memory writes must NEVER break the chat. Log and continue.
  logger.warn('memory recordTurn failed', err);
}
```

- [ ] **Step 5: Test**

Add an integration-level test that constructs a session controller (or a thin shim), pushes a user message through, and asserts the recorder saw it. If the controller has no test infrastructure, defer end-to-end verification to Task 22 (integration test) and ensure unit tests in `memory-recorder.test.ts` cover the recorder behavior.

- [ ] **Step 6: Commit**

```bash
git add <files modified>
git commit -m "feat(coworker-3): wire MemoryRecorder.recordTurn at user-turn commit point (Phase 3 Task 20)"
```

If you can't find a clean wiring point and adding a session-hook surface would require a structural refactor, REPORT as a Phase 3.1 follow-up. The recorder remains complete and unit-tested; integration test (Task 22) will exercise it via the direct recorder API.

---

### Task 21: End-to-end integration test — Day-2 milestone

**Files:**
- Create: `packages/coworker-memory/tests/memory-integration.test.ts`

Compile-tests script (`scripts/compile-tests.mjs`) may need to learn about `packages/*/tests/` if it currently only scans `packages/*/src/`. Phase 2 Task 17 implementer noted: "compile-tests.mjs scans packages/*/src/ only." If so, place this in `packages/coworker-memory/src/memory-integration.test.ts` (matching Phase 2 Task 17's resolution) to avoid extending the pipeline.

- [ ] **Step 1: Write the integration test**

```typescript
// packages/coworker-memory/src/memory-integration.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundle } from '../../../src/resources/extensions/coworker-memory/memory-singleton.js';
import { runMemorize } from '../../../src/resources/extensions/coworker-memory/memorize-tool.js';
import { runRecall } from '../../../src/resources/extensions/coworker-memory/recall-tool.js';
import { onSessionStart, onSessionShutdown } from '../../../src/resources/extensions/coworker-memory/session-hooks.js';

describe('Memory integration — Day-2 verbatim recall', () => {
  it('paste Monday → recall Tuesday in a fresh session', async () => {
    const homeMon = mkdtempSync(join(tmpdir(), 'mem-home-mon-'));
    const ws = mkdtempSync(join(tmpdir(), 'mem-ws-mon-'));
    mkdirSync(ws, { recursive: true });

    // ===== MONDAY =====
    const monBundle = await createMemoryBundle({
      globalDir: homeMon, workspaceDir: ws,
      scopeMode: 'per-project-tagged',
      currentScratchpadName: () => 'p1-1234',
    });
    await monBundle.recorder.recordPaste({
      sessionId: 'sess-mon',
      content: 'customer says the load balancer started returning 503s around 14:00 UTC; the on-call escalated to the network team at 14:18',
      turnId: 't1',
    });
    await onSessionShutdown(monBundle);

    // Simulate a different Otto process by re-creating the bundle with the same workspace.
    // ===== TUESDAY =====
    const tueBundle = await createMemoryBundle({
      globalDir: homeMon /* same as Monday */, workspaceDir: ws,
      scopeMode: 'per-project-tagged',
      currentScratchpadName: () => null,
    });
    const start = await onSessionStart(tueBundle, { tokenLimit: 3000 });
    // Layer A was empty Monday, so the inject is empty on Tuesday.
    assert.equal(start.contextBlock, '');
    const r = await runRecall(tueBundle, { query: 'load balancer' });
    assert.equal(r.results.length, 1);
    assert.match(r.results[0]!.drawer.content, /load balancer started returning 503s around 14:00 UTC/);
    assert.equal(r.results[0]!.drawer.room, 'p1-1234');
    assert.match(r.markdown, /drawer:\/\//);
    await onSessionShutdown(tueBundle);
  });
  it('memorize lessons → next session_start injects them', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mem-home-A-'));
    const ws = mkdtempSync(join(tmpdir(), 'mem-ws-A-'));
    mkdirSync(ws, { recursive: true });
    const b1 = await createMemoryBundle({
      globalDir: home, workspaceDir: ws,
      scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
    });
    await runMemorize(b1, { text: 'MTTR target is 30 minutes for P1', kind: 'lesson' });
    await runMemorize(b1, { text: 'Always escalate to mgr within 5 min on customer-facing P1', kind: 'rule' });
    await onSessionShutdown(b1);

    const b2 = await createMemoryBundle({
      globalDir: home, workspaceDir: ws,
      scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
    });
    const start = await onSessionStart(b2, { tokenLimit: 3000 });
    assert.match(start.contextBlock, /MTTR target is 30 minutes/);
    assert.match(start.contextBlock, /Always escalate to mgr/);
    await onSessionShutdown(b2);
  });
  it('secret in paste is redacted; recall surrounding context still works', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mem-home-B-'));
    const ws = mkdtempSync(join(tmpdir(), 'mem-ws-B-'));
    mkdirSync(ws, { recursive: true });
    const b = await createMemoryBundle({
      globalDir: home, workspaceDir: ws,
      scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
    });
    await b.recorder.recordPaste({
      sessionId: 's',
      content: 'login token AKIAABCDEFGHIJKLMNOP, used for Datadog API',
      turnId: 't',
    });
    const r = await runRecall(b, { query: 'Datadog' });
    assert.equal(r.results.length, 1);
    assert.match(r.results[0]!.drawer.content, /\[REDACTED:aws_access_key_id\]/);
    assert.equal(r.results[0]!.drawer.content.includes('AKIAABCDEFGHIJKLMNOP'), false);
    assert.equal(r.results[0]!.drawer.redacted, true);
    await onSessionShutdown(b);
  });
});
```

- [ ] **Step 2: Run; iterate**

```
npm run test:compile
node --test dist-test/packages/coworker-memory/src/memory-integration.test.js
```

Expected: 3/3 pass. Any failure surfaces a gap in earlier tasks — fix at the source, not in the test.

- [ ] **Step 3: Commit**

```bash
git add packages/coworker-memory/src/memory-integration.test.ts
git commit -m "test(coworker-3): end-to-end Day-2 memory integration (Phase 3 Task 21)"
```

---

### Task 22: Roadmap update + smoke checklist + human test plan

**Files:**
- Modify: `docs/superpowers/notes/2026-06-01-coworker-roadmap.md`
- Create: `docs/superpowers/notes/2026-06-XX-phase-3-memory-smoke.md`
- Create: `docs/superpowers/notes/2026-06-XX-coworker-phase-3-human-tests.md`

Replace XX with the actual date.

- [ ] **Step 1: Update roadmap**

Find the Phase 3 section. Mark heading complete: `### Phase 3 — otto-memory A+B + backend interface (weeks 5–6) — COMPLETE`.

Append a Note:
> **Note (2026-06-XX):** Phase 3 ships Layers A + B with the LocalSqliteBackend (FTS5/BM25). Layer C entity graph, ACC, Cerebellum, Consolidator, weekly digest, vector embeddings, and HostedBackend remain Phase 5. Cross-pillar: scratchpad's FileCollector loads land as `kind:'file_load'` drawers; scratchpad exposes `currentScratchpadName` so memory rooms align with active investigations.

- [ ] **Step 2: Write the smoke checklist**

```markdown
# Phase 3 memory — manual smoke checklist

**Branch:** `feat/coworker-phase-3-memory`. **Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-3-memory-design.md`. **Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-3-memory.md`.

Run these end-to-end before merging.

## Prereq

- Clean Otto checkout; no existing `~/.otto/memory/`, no `<workspace>/.otto/memory/`.

## Steps

1. Launch Otto in a fresh workspace.
   - Verify: `cat <workspace>/.otto/memory/workspace.json | jq` shows `_schema: 1`, `id: <slug>-<6 hex>`, `memory_seed_applied: false`.

2. Run `/memory status`.
   - Verify: prints `scope_mode: per-project-tagged`, `workspace_wing: <slug>`, `drawer_count: 0`, layer_b_db_path, schema_version: 1.

3. Type a multi-line paste (≥ 500 chars or with triple-backticks) into the chat.
   - Verify: `<workspace>/.otto/memory/layer-b.db` exists; query inspector: `sqlite3 <path> "SELECT kind, room, length(content) FROM drawers"` shows a `paste` row.
   - Verify: `/audit --producer memory --action write-drawer` shows the record with `redacted: false`.

4. Ask Otto: "recall {one of the words from your paste}".
   - Verify: Otto's response includes a memory recall block citing the drawer URI.

5. `/memory note "MTTR is 30m for P1"`.
   - Verify: `<workspace>/.otto/memory/lessons.md` exists with frontmatter and a bullet.

6. Restart Otto (close, reopen) in the same workspace.
   - Verify: system prompt now includes "Memory (Layer A)" section with the MTTR lesson.

7. Type a string containing `AKIAABCDEFGHIJKLMNOP` into the chat.
   - Verify: drawer is written with redacted=1 (check sqlite); the journal value contains `[REDACTED:aws_access_key_id]`.
   - Verify: `/audit --producer memory --action redact` shows the record (no value, no preview).

8. Try `/memory note "token AKIAABCDEFGHIJKLMNOP"`.
   - Verify: command errors with `Refused to store ... aws_access_key_id`.
   - Verify: lessons.md was NOT modified.

9. `/memory clear --wing <workspace_wing> --confirm`.
   - Verify: response shows `deleted: N`; subsequent recall returns 0 results.

## Expected misses (NOT failures)

- Layer C entity tools (`entity_query`, `entity_assert`) — Phase 5.
- ACC / Cerebellum auto-write paths — Phase 5.
- Weekly digest UX — Phase 5.
- Consolidator MEMORY.md / skills/ output — Phase 5.
- Vector embeddings / semantic recall — out-of-scope per spec §9.
- Cross-workspace global Layer B — v2.

If `/memory wing <name>` or `/memory room <name>` overrides don't persist across messages (session-state holder not yet wired), capture as a Phase 3.1 follow-up.
```

- [ ] **Step 3: Write the human test plan**

Pattern off `docs/superpowers/notes/2026-06-02-coworker-phase-2-human-tests.md`. Cover:
- Setup + disk layout reference
- "Connection types supported" equivalent → in memory's case, "Recall backend supported in Phase 3" → only `LocalSqliteBackend` (FTS5 BM25, no embeddings).
- ~15 scenarios:
  - workspace.json creation + idempotence
  - Layer A memorize + read-back + session_start injection
  - Layer B auto-retain on short turn → kind=turn
  - Layer B auto-retain on long paste → kind=paste
  - file_load drawer via scratchpad (if Task 19 fully wired)
  - recall happy path + filter by kind/room/wing
  - recall against rotated FTS5 special chars
  - SecretScanner block on memorize
  - SecretScanner redact on paste
  - Persona seed first-activation copy
  - Persona seed re-application via flag reset
  - Scope mode switch (global vs per-project-tagged) and resulting context-injection differences
  - `/memory note` slash
  - `/memory status` slash
  - `/memory clear --wing --confirm` slash
- Phase 1 + Phase 2 regression sweep
- Coverage matrix + sign-off checklist

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/notes/2026-06-01-coworker-roadmap.md docs/superpowers/notes/2026-06-XX-phase-3-memory-smoke.md docs/superpowers/notes/2026-06-XX-coworker-phase-3-human-tests.md
git commit -m "docs(coworker-3): roadmap update + Phase 3 smoke + human test plan (Phase 3 Task 22)"
```

---

### Task 23: Branch-level build + final review

**Files:** none (verification only).

- [ ] **Step 1: Build every changed package**

```bash
cd packages/coworker-utils && npm run build
cd ../coworker-vault && npm run build
cd ../coworker-memory && npm run build
cd ../coworker-scratchpad && npm run build
cd ../..
```

Expected: every build succeeds with no type errors. `dist/migrations/001-init.sql` present in coworker-memory.

- [ ] **Step 2: Full Phase 3 test suite**

```bash
npm run test:compile
node --test dist-test/packages/coworker-memory/src/*.test.js
node --test dist-test/src/resources/extensions/coworker-memory/*.test.js
node --test dist-test/packages/coworker-scratchpad/src/*.test.js     # regression
node --test dist-test/packages/coworker-vault/src/*.test.js          # regression
node --test dist-test/src/resources/extensions/coworker-scratchpad/*.test.js
```

Expected: all green.

- [ ] **Step 3: Branch-level cross-cutting review**

```bash
git log --oneline main..HEAD
git diff main..HEAD --stat
```

You should see ~22 commits matching the Phase 3 plan.

Cross-cutting checks:
- a. **No value leaks in audit records.** Spot-check `memory-recorder.ts`, `layer-a-store.ts`, `recall-tool.ts`. Audit detail must carry kind/offset/length/byte_count — never the value, never `SecretHit.preview`.
- b. **Live recall results vs persisted content.** Confirm `recall-formatter.ts` outputs `snippet` (FTS5-truncated with `<mark>`), not the full content.
- c. **SecretScanner split policy.** Layer A throws `LayerAWriteBlocked`; Layer B redacts + sets `redacted: true`.
- d. **Scope mode behavior.** Verify all three modes have the right write/read wing matrix via tests.
- e. **Phase 2 regression.** No vault tests fail; `/audit` still works; vault bindings still inject.

- [ ] **Step 4: Push**

```bash
git push -u origin feat/coworker-phase-3-memory
```

If the push fails or push to remote isn't authorized, REPORT and stop.

- [ ] **Step 5: Report readiness**

Structured report:

**Build:** per-package PASS/FAIL.
**Tests:** per-layer counts; Phase 3 total; any new failures vs baseline.
**Commits:** 22 (or whatever count) on branch, all matching `(coworker-3)` pattern.
**Cross-cutting findings:** each of the 5 concerns above addressed or flagged.
**Push:** DONE / SKIPPED / FAILED with reason.
**Overall:** READY TO MERGE / NEEDS WORK / NEEDS USER INPUT.

---

## Self-review summary

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| §2 decision matrix | Locked decisions appear in Tasks 1, 6, 7, 8, 10, 13, 14, 15. |
| §3.1 package layout | Tasks 1–12. |
| §3.2 MemoryBackend interface | Task 2. |
| §3.3 module responsibilities | Each module Task 3–11. |
| §3.4 audit verbs | Tasks 6 (write-layer-a, block), 8 (write-drawer, redact), 15 (recall), 17 (seed-applied). |
| §4 on-disk layout | Tasks 3 (workspace.json), 6 (Layer A files), 7 (Layer B db). |
| §4.1 workspace.json schema | Task 3. |
| §4.2 Layer A frontmatter | Task 6. |
| §4.3 SQLite schema migration | Task 7. |
| §5 scope modes + derivation | Task 4 (scope-resolver), Task 18 (currentScratchpadName). |
| §6 auto-retain semantics | Task 5 (paste-detector) + Task 8 (recordTurn dispatching) + Task 20 (wiring). |
| §7 SecretScanner split policy | Task 6 (Layer A blocks), Task 8 (Layer B redacts). |
| §8 LLM tools | Tasks 14, 15. |
| §9 slash commands | Task 16. |
| §10 context injection on session_start | Task 10 (helper) + Task 17 (hook). |
| §11 persona seed application | Task 11 (helper) + Task 17 (hook). |
| §12 persistence triggers | Distributed across Tasks 8, 14, 16, 17, 20. |
| §13 errors | Task 1. |
| §14 edge cases | Tested across Tasks 3, 6, 7, 8, 11. |
| §15 testing strategy | Each module + Task 21 integration. |
| §16 milestone | Task 21 first test. |

No gaps identified.

**Placeholder scan:** Each task has full test code + full implementation code. Task 20 (user-turn wiring) explicitly says "investigate first" because the call site depends on Otto's session controller — that's a known unknown, not a placeholder.

**Type consistency check:**
- `MemoryBackend` interface (Task 2) used identically by `LocalSqliteBackend` (Task 7) + `MemoryRecorder` (Task 8) + `runRecall` (Task 15) + `runMemoryCommand` (Task 16).
- `Drawer` shape consistent through all consumers.
- `LayerAEntry` (Task 1) → `LayerAStore.append` (Task 6) → `runMemorize` (Task 14) → `applyPersonaSeed` (Task 11).
- `WorkspaceIdRecord` (Task 1) used consistently in `resolveWorkspaceId`/`writeWorkspaceId` (Task 3) + `createMemoryBundle` (Task 13) + `onSessionStart` (Task 17).
- `ResolvedScope` (Task 4) consumed by `createMemoryBundle` (Task 13).

No drift.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-02-coworker-phase-3-memory.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage spec+quality review between tasks, fast iteration. Matches the workflow used for Phase 2.

**2. Inline Execution** — execute tasks in this session with batch checkpoints.

Which approach?
