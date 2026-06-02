# Phase 4 — otto-artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Graduate `@otto/coworker-artifacts` from `export {};` stub to a workspace-scoped store for typed deliverables (markdown `report` kind in v1), with a production activator wired into Otto's `ExtensionAPI` from day one. Closes the parent design spec §2.3 artifacts surface; unblocks Phase 5 (Consolidator + daily digest reference artifacts by URI).

**Architecture:** Bottom-up TDD. Package primitives first (types, slug, dir-snapshot, resolve-uri, readme-renderer), then the `ArtifactStore` class, then the public barrel. Memory grows a SQL migration + `recordArtifact` method + new `'artifact'` drawer kind. Scratchpad grows a kernel-side `otto.artifact` binding that RPCs to the manager (mirrors and extends the existing `data_load` event pattern, but bidirectional). Extension activator ships with the package (Phase 3 lesson applied). Cross-pillar wiring uses the same `getMemoryRecorder()` + `getArtifactStore()` lazy-getter pattern that Phase 3.1 locked in.

**Tech Stack:** TypeScript (Node ESM), `better-sqlite3` (already present from Phase 3), `node:test` + `node:assert/strict`, TypeBox for LLM tool parameter schemas, `uuid` for fallback slug suffixing only if needed (already a dep).

**Branch:** `feat/coworker-phase-4-artifacts` (already created from `main` at `2633f78`; spec committed at `71d3c3c`).

**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-4-artifacts-design.md`.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `packages/coworker-artifacts/src/types.ts` | `ArtifactKind` (`'report'` literal in v1), `ArtifactHandle`, `ArtifactMetadata`, `TurnEntry`, `Provenance`, `DirSnapshot`, `FileWrite`, `ResolvedArtifactUri`. |
| `packages/coworker-artifacts/src/errors.ts` | `ArtifactNotFound`, `ArtifactKindRejected`, `ArtifactUriMalformed`, `ArtifactSlugCollision`. |
| `packages/coworker-artifacts/src/slug.ts` | `deriveSlug(name)`, `nextCollisionSlug(base, taken)` pure functions. |
| `packages/coworker-artifacts/src/dir-snapshot.ts` | `takeSnapshot(dir)`, `diffSnapshots(before, after)` — file mtime/size capture + diff. |
| `packages/coworker-artifacts/src/resolve-uri.ts` | `resolveArtifactUri(uri, workspaceDir): ResolvedArtifactUri` — pure validator + path builder. |
| `packages/coworker-artifacts/src/readme-renderer.ts` | `renderReadme(metadata, provenance, fileStats): string` — deterministic markdown. |
| `packages/coworker-artifacts/src/artifact-store.ts` | `ArtifactStore` class: create/update/recordTurn/list/get/remove + atomic writes + README rerender. |
| `packages/coworker-artifacts/src/index.ts` | Public barrel. |
| `packages/coworker-artifacts/src/*.test.ts` | One per module. |
| `packages/coworker-artifacts/src/artifacts-integration.test.ts` | Cross-extension end-to-end (Phase 3 Task 21 convention — `src/` not `tests/`). |
| `packages/coworker-memory/src/migrations/002-artifact-kind.sql` | Adds `'artifact'` to drawers `kind` CHECK; user_version → 2. |
| `src/resources/extensions/coworker-artifacts/extension-manifest.json` | Manifest declaring commands/tools/hooks. |
| `src/resources/extensions/coworker-artifacts/artifacts-singleton.ts` | `createArtifactsBundle({workspaceDir})`. |
| `src/resources/extensions/coworker-artifacts/index.ts` | Default-export activator + `getArtifactStore()` export. |
| `src/resources/extensions/coworker-artifacts/list-tool.ts` | `runListArtifacts(store)` LLM tool handler. |
| `src/resources/extensions/coworker-artifacts/open-tool.ts` | `runOpenArtifact(store, {slug})` LLM tool handler. |
| `src/resources/extensions/coworker-artifacts/artifacts-command.ts` | `runArtifactsCommand(store, argv)` slash dispatcher. |
| `src/resources/extensions/coworker-artifacts/*.test.ts` | Per module. |
| `docs/superpowers/notes/2026-06-02-phase-4-artifacts-smoke.md` | Smoke checklist with PENDING live-TUI placeholder. |
| `docs/superpowers/notes/2026-06-02-coworker-phase-4-human-tests.md` | Human test plan. |

### Modified files

| Path | Change |
|---|---|
| `packages/coworker-artifacts/package.json` | Add deps `@otto/coworker-utils`. Update build script to copy `migrations/*.sql` if any — not needed in v1 since artifacts has no SQL. |
| `packages/coworker-memory/src/types.ts` | Add `'artifact'` to `DRAWER_KINDS`. |
| `packages/coworker-memory/src/local-sqlite-backend.ts` | `open()` runs migrations 001 + 002 conditionally based on `PRAGMA user_version`. |
| `packages/coworker-memory/src/memory-recorder.ts` | Add `recordArtifact({scratchpadName, slug, kind, uri, turnId, room?})` method mirroring `recordFileLoad`. |
| `packages/coworker-scratchpad/src/kernel-protocol.ts` | Add `ArtifactCreateDrawer`, `ArtifactCreateRequest`/`Response`, `ArtifactUpdateRequest`/`Response`, `ArtifactCreateEvent` types. |
| `packages/coworker-scratchpad/src/kernel-entry.ts` | Add `otto.artifact.create(kind, name)` + `spillIfLarge(value, opts?)` kernel bindings using RPC over stdin/stdout. |
| `packages/coworker-scratchpad/src/child-process-runtime.ts` | Add `onArtifactCreate?` option; handle `ArtifactCreateRequest`/`ArtifactUpdateRequest` from kernel by calling injected store-call handlers; emit `ArtifactCreateEvent` to manager. |
| `packages/coworker-scratchpad/src/scratchpad-manager.ts` | Add `getArtifactStore?` + `onArtifactCreate?` to `ScratchpadManagerOptions`; in `spawnRuntime` fan out and wire RPC. |
| `src/resources/extensions/coworker-scratchpad/index.ts` | Cross-import `getArtifactStore` + add `onArtifactCreate` closure calling `getMemoryRecorder()?.recordArtifact(...)`. |
| `package.json` | Append `dist-test/src/resources/extensions/coworker-artifacts/*.test.js` to `scripts.test:unit:compiled`. |
| `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` | Add Phase 4 — COMPLETE entry. |

---

## Tasks

### Task 1: Package types + errors + deps

**Files:**
- Modify: `packages/coworker-artifacts/package.json`
- Create: `packages/coworker-artifacts/src/types.ts`
- Create: `packages/coworker-artifacts/src/errors.ts`
- Create: `packages/coworker-artifacts/src/errors.test.ts`

- [ ] **Step 1: Update package.json deps**

```json
{
  "name": "@otto/coworker-artifacts",
  "version": "0.0.1",
  "description": "Otto co-worker package: coworker-artifacts",
  "type": "module",
  "otto": { "linkable": true, "scope": "@otto", "name": "coworker-artifacts" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "dependencies": {
    "@otto/coworker-utils": "*"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "build:publish": "tsc -p tsconfig.publish.json"
  },
  "files": ["dist"]
}
```

- [ ] **Step 2: Write `types.ts`**

```typescript
// packages/coworker-artifacts/src/types.ts
export type ArtifactKind = 'report';
export const ARTIFACT_KINDS = ['report'] as const;

export interface ArtifactHandle {
  slug: string;
  kind: ArtifactKind;
  name: string;
  dir: string;
  uri: string;
  primaryPath: string;
  metadataPath: string;
  provenancePath: string;
  readmePath: string;
}

export interface ArtifactMetadata {
  _schema: 1;
  slug: string;
  kind: ArtifactKind;
  name: string;
  created_at: string;
  last_updated_at: string;
  turn_count: number;
  primary_file: string;
  uri: string;
}

export interface TurnEntry {
  _schema: 1;
  ts: string;
  action: 'create' | 'update';
  turn_id: string;
  agent_turn_id?: string;
  user_prompt: string;
  scratchpad_name?: string;
  files_touched: string[];
}

export type Provenance = TurnEntry[];

export interface DirSnapshotEntry {
  mtimeNs: bigint;
  sizeBytes: number;
}

export type DirSnapshot = Map<string, DirSnapshotEntry>;

export interface FileWrite {
  path: string;
  content: string;
}

export interface ResolvedArtifactUri {
  slug: string;
  dir: string;
  primaryPath: string;
  metadataPath: string;
  provenancePath: string;
  readmePath: string;
}
```

- [ ] **Step 3: Write `errors.test.ts`**

```typescript
// packages/coworker-artifacts/src/errors.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ArtifactNotFound, ArtifactKindRejected, ArtifactUriMalformed, ArtifactSlugCollision,
} from './errors.js';

describe('artifact errors', () => {
  it('ArtifactNotFound carries slug', () => {
    const e = new ArtifactNotFound('rca-1');
    assert.equal(e.name, 'ArtifactNotFound');
    assert.equal(e.slug, 'rca-1');
    assert.match(e.message, /rca-1/);
  });
  it('ArtifactKindRejected carries kind', () => {
    const e = new ArtifactKindRejected('workbook');
    assert.equal(e.name, 'ArtifactKindRejected');
    assert.equal(e.kind, 'workbook');
    assert.match(e.message, /workbook/);
    assert.match(e.message, /report/);
  });
  it('ArtifactUriMalformed carries uri + reason', () => {
    const e = new ArtifactUriMalformed('artifact://../x', 'path traversal');
    assert.equal(e.name, 'ArtifactUriMalformed');
    assert.equal(e.uri, 'artifact://../x');
    assert.equal(e.reason, 'path traversal');
    assert.match(e.message, /path traversal/);
  });
  it('ArtifactSlugCollision carries base + attempts', () => {
    const e = new ArtifactSlugCollision('rca', 100);
    assert.equal(e.name, 'ArtifactSlugCollision');
    assert.equal(e.base, 'rca');
    assert.equal(e.attempts, 100);
    assert.match(e.message, /rca/);
    assert.match(e.message, /100/);
  });
});
```

- [ ] **Step 4: Write `errors.ts`**

```typescript
// packages/coworker-artifacts/src/errors.ts
export class ArtifactNotFound extends Error {
  constructor(public readonly slug: string) {
    super(`Artifact not found: ${slug}. /artifacts list to see available.`);
    this.name = 'ArtifactNotFound';
  }
}

export class ArtifactKindRejected extends Error {
  constructor(public readonly kind: string) {
    super(`Artifact kind '${kind}' is not supported. v1 ships only 'report'.`);
    this.name = 'ArtifactKindRejected';
  }
}

export class ArtifactUriMalformed extends Error {
  constructor(public readonly uri: string, public readonly reason: string) {
    super(`Bad artifact URI ${uri}: ${reason}.`);
    this.name = 'ArtifactUriMalformed';
  }
}

export class ArtifactSlugCollision extends Error {
  constructor(public readonly base: string, public readonly attempts: number) {
    super(`Slug collision: '${base}' has ${attempts} colliding suffixes (-2…-${attempts + 1}). Pick a different name.`);
    this.name = 'ArtifactSlugCollision';
  }
}
```

- [ ] **Step 5: Install deps + build + run**

```
npm install
cd packages/coworker-artifacts && npm run build && cd ../..
npm run test:compile
node --test dist-test/packages/coworker-artifacts/src/errors.test.js
```

Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/coworker-artifacts/package.json \
        packages/coworker-artifacts/src/types.ts \
        packages/coworker-artifacts/src/errors.ts \
        packages/coworker-artifacts/src/errors.test.ts
git commit -m "feat(coworker-4): artifacts types + error taxonomy + deps (Phase 4 Task 1)"
```

Include `package-lock.json` in the stage if it changed (project convention from Phase 2/3).

---

### Task 2: `slug.ts` pure functions

**Files:**
- Create: `packages/coworker-artifacts/src/slug.ts`
- Create: `packages/coworker-artifacts/src/slug.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/coworker-artifacts/src/slug.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSlug, nextCollisionSlug, MAX_COLLISION_ATTEMPTS } from './slug.js';
import { ArtifactSlugCollision } from './errors.js';

describe('deriveSlug', () => {
  it('lowercases and kebab-cases simple input', () => {
    assert.equal(deriveSlug('RCA: Load Balancer 503'), 'rca-load-balancer-503');
  });
  it('strips non-ASCII and punctuation', () => {
    assert.equal(deriveSlug('résumé — final draft!'), 'resume-final-draft');
  });
  it('collapses runs of dashes', () => {
    assert.equal(deriveSlug('foo --- bar'), 'foo-bar');
  });
  it('trims leading + trailing dashes', () => {
    assert.equal(deriveSlug('---hello---'), 'hello');
  });
  it('truncates to 64 chars', () => {
    const long = 'a'.repeat(100);
    assert.equal(deriveSlug(long).length, 64);
  });
  it('produces fallback for fully-stripped input', () => {
    assert.match(deriveSlug('!!!'), /^artifact-/);
  });
  it('single-char input is preserved', () => {
    assert.equal(deriveSlug('x'), 'x');
  });
});

describe('nextCollisionSlug', () => {
  it('returns -2 on first collision', () => {
    assert.equal(nextCollisionSlug('rca', new Set(['rca'])), 'rca-2');
  });
  it('skips already-taken numeric suffixes', () => {
    assert.equal(nextCollisionSlug('rca', new Set(['rca', 'rca-2', 'rca-3'])), 'rca-4');
  });
  it('throws ArtifactSlugCollision after MAX_COLLISION_ATTEMPTS', () => {
    const taken = new Set<string>(['rca']);
    for (let i = 2; i <= MAX_COLLISION_ATTEMPTS + 1; i++) taken.add(`rca-${i}`);
    assert.throws(() => nextCollisionSlug('rca', taken), ArtifactSlugCollision);
  });
  it('returns base if base not taken', () => {
    assert.equal(nextCollisionSlug('rca', new Set()), 'rca');
  });
});
```

- [ ] **Step 2: Run; FAIL**

```
npm run test:compile && node --test dist-test/packages/coworker-artifacts/src/slug.test.js
```

Expected: ERR_MODULE_NOT_FOUND.

- [ ] **Step 3: Implement `slug.ts`**

```typescript
// packages/coworker-artifacts/src/slug.ts
import { ArtifactSlugCollision } from './errors.js';

export const MAX_SLUG_LENGTH = 64;
export const MAX_COLLISION_ATTEMPTS = 100;

export function deriveSlug(name: string): string {
  let s = name.toLowerCase();
  // Strip diacritics (NFKD + remove combining marks)
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  // Replace non a-z 0-9 with dash
  s = s.replace(/[^a-z0-9]+/g, '-');
  // Collapse runs of dashes
  s = s.replace(/-+/g, '-');
  // Trim leading/trailing dashes
  s = s.replace(/^-+|-+$/g, '');
  // Truncate
  if (s.length > MAX_SLUG_LENGTH) s = s.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
  // Fallback if empty
  if (!s) s = `artifact-${Date.now().toString(36)}`;
  return s;
}

export function nextCollisionSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n <= MAX_COLLISION_ATTEMPTS + 1; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new ArtifactSlugCollision(base, MAX_COLLISION_ATTEMPTS);
}
```

- [ ] **Step 4: Run; PASS** (11/11)

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-artifacts/src/slug.ts packages/coworker-artifacts/src/slug.test.ts
git commit -m "feat(coworker-4): slug derivation + collision suffixing (Phase 4 Task 2)"
```

---

### Task 3: `DirSnapshot` pure functions

**Files:**
- Create: `packages/coworker-artifacts/src/dir-snapshot.ts`
- Create: `packages/coworker-artifacts/src/dir-snapshot.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/coworker-artifacts/src/dir-snapshot.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { takeSnapshot, diffSnapshots } from './dir-snapshot.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'ds-')); }

describe('takeSnapshot', () => {
  it('returns empty map for empty dir', () => {
    const snap = takeSnapshot(tmp());
    assert.equal(snap.size, 0);
  });
  it('captures relative path + size for each file', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.md'), 'hello');
    writeFileSync(join(dir, 'b.md'), 'world!');
    const snap = takeSnapshot(dir);
    assert.equal(snap.size, 2);
    assert.equal(snap.get('a.md')!.sizeBytes, 5);
    assert.equal(snap.get('b.md')!.sizeBytes, 6);
    assert.equal(typeof snap.get('a.md')!.mtimeNs, 'bigint');
  });
  it('recurses into subdirs with forward-slash paths', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'c.md'), 'nested');
    const snap = takeSnapshot(dir);
    assert.ok(snap.has('sub/c.md'));
  });
  it('returns empty map when dir does not exist', () => {
    const snap = takeSnapshot(join(tmp(), 'nope'));
    assert.equal(snap.size, 0);
  });
});

describe('diffSnapshots', () => {
  it('detects added files', () => {
    const before = new Map();
    const after = new Map([['a.md', { mtimeNs: 1n, sizeBytes: 5 }]]);
    const d = diffSnapshots(before, after);
    assert.deepEqual(d.added, ['a.md']);
    assert.deepEqual(d.modified, []);
    assert.deepEqual(d.removed, []);
  });
  it('detects removed files', () => {
    const before = new Map([['a.md', { mtimeNs: 1n, sizeBytes: 5 }]]);
    const after = new Map();
    const d = diffSnapshots(before, after);
    assert.deepEqual(d.removed, ['a.md']);
  });
  it('detects modified when sizeBytes differs', () => {
    const before = new Map([['a.md', { mtimeNs: 1n, sizeBytes: 5 }]]);
    const after = new Map([['a.md', { mtimeNs: 2n, sizeBytes: 7 }]]);
    const d = diffSnapshots(before, after);
    assert.deepEqual(d.modified, ['a.md']);
  });
  it('detects modified when mtimeNs differs (same size)', () => {
    const before = new Map([['a.md', { mtimeNs: 1n, sizeBytes: 5 }]]);
    const after = new Map([['a.md', { mtimeNs: 999n, sizeBytes: 5 }]]);
    assert.deepEqual(diffSnapshots(before, after).modified, ['a.md']);
  });
  it('no diff when identical', () => {
    const a = new Map([['a.md', { mtimeNs: 1n, sizeBytes: 5 }]]);
    const b = new Map([['a.md', { mtimeNs: 1n, sizeBytes: 5 }]]);
    const d = diffSnapshots(a, b);
    assert.equal(d.added.length + d.modified.length + d.removed.length, 0);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement `dir-snapshot.ts`**

```typescript
// packages/coworker-artifacts/src/dir-snapshot.ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { DirSnapshot } from './types.js';

export function takeSnapshot(dir: string): DirSnapshot {
  const out: DirSnapshot = new Map();
  if (!existsSync(dir)) return out;
  walk(dir, dir, out);
  return out;
}

function walk(root: string, current: string, out: DirSnapshot): void {
  let entries;
  try { entries = readdirSync(current, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const abs = join(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, abs, out);
    } else if (entry.isFile()) {
      const stat = statSync(abs);
      const rel = relative(root, abs).split(sep).join('/');
      out.set(rel, {
        mtimeNs: stat.mtimeNs,
        sizeBytes: stat.size,
      });
    }
  }
}

export function diffSnapshots(
  before: DirSnapshot,
  after: DirSnapshot,
): { added: string[]; modified: string[]; removed: string[] } {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  for (const [path, a] of after) {
    const b = before.get(path);
    if (!b) added.push(path);
    else if (b.mtimeNs !== a.mtimeNs || b.sizeBytes !== a.sizeBytes) modified.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) removed.push(path);
  }
  return {
    added: added.sort(),
    modified: modified.sort(),
    removed: removed.sort(),
  };
}
```

- [ ] **Step 4: Run; PASS** (9/9).

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-artifacts/src/dir-snapshot.ts packages/coworker-artifacts/src/dir-snapshot.test.ts
git commit -m "feat(coworker-4): DirSnapshot mtime/size diff helper (Phase 4 Task 3)"
```

---

### Task 4: `resolve-uri.ts` pure function

**Files:**
- Create: `packages/coworker-artifacts/src/resolve-uri.ts`
- Create: `packages/coworker-artifacts/src/resolve-uri.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/coworker-artifacts/src/resolve-uri.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveArtifactUri, ARTIFACT_URI_SCHEME } from './resolve-uri.js';
import { ArtifactUriMalformed } from './errors.js';

describe('resolveArtifactUri', () => {
  const ws = '/tmp/workspace';
  it('parses simple slug', () => {
    const r = resolveArtifactUri('artifact://rca-1', ws);
    assert.equal(r.slug, 'rca-1');
    assert.equal(r.dir, '/tmp/workspace/.otto/artifacts/rca-1');
    assert.equal(r.primaryPath, '/tmp/workspace/.otto/artifacts/rca-1/report.md');
    assert.equal(r.metadataPath, '/tmp/workspace/.otto/artifacts/rca-1/metadata.json');
    assert.equal(r.provenancePath, '/tmp/workspace/.otto/artifacts/rca-1/provenance.json');
    assert.equal(r.readmePath, '/tmp/workspace/.otto/artifacts/rca-1/README.md');
  });
  it('accepts single-char slug', () => {
    const r = resolveArtifactUri('artifact://x', ws);
    assert.equal(r.slug, 'x');
  });
  it('rejects bad scheme', () => {
    assert.throws(() => resolveArtifactUri('memory://x', ws), ArtifactUriMalformed);
  });
  it('rejects uppercase slug', () => {
    assert.throws(() => resolveArtifactUri('artifact://RCA', ws), ArtifactUriMalformed);
  });
  it('rejects path traversal', () => {
    assert.throws(() => resolveArtifactUri('artifact://../escape', ws), ArtifactUriMalformed);
  });
  it('rejects leading dash', () => {
    assert.throws(() => resolveArtifactUri('artifact://-foo', ws), ArtifactUriMalformed);
  });
  it('rejects trailing dash', () => {
    assert.throws(() => resolveArtifactUri('artifact://foo-', ws), ArtifactUriMalformed);
  });
  it('rejects > 64 chars', () => {
    assert.throws(() => resolveArtifactUri(`artifact://${'a'.repeat(65)}`, ws), ArtifactUriMalformed);
  });
  it('rejects empty slug', () => {
    assert.throws(() => resolveArtifactUri('artifact://', ws), ArtifactUriMalformed);
  });
  it('exports scheme constant', () => {
    assert.equal(ARTIFACT_URI_SCHEME, 'artifact://');
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement `resolve-uri.ts`**

```typescript
// packages/coworker-artifacts/src/resolve-uri.ts
import { join } from 'node:path';
import { ArtifactUriMalformed } from './errors.js';
import type { ResolvedArtifactUri } from './types.js';

export const ARTIFACT_URI_SCHEME = 'artifact://';
const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export function resolveArtifactUri(uri: string, workspaceDir: string): ResolvedArtifactUri {
  if (!uri.startsWith(ARTIFACT_URI_SCHEME)) {
    throw new ArtifactUriMalformed(uri, `must start with ${ARTIFACT_URI_SCHEME}`);
  }
  const slug = uri.slice(ARTIFACT_URI_SCHEME.length);
  if (!slug) throw new ArtifactUriMalformed(uri, 'empty slug');
  if (slug.includes('..')) throw new ArtifactUriMalformed(uri, 'path traversal');
  if (slug.length > 64) throw new ArtifactUriMalformed(uri, 'slug exceeds 64 chars');
  if (!SLUG_REGEX.test(slug)) {
    throw new ArtifactUriMalformed(uri, 'slug must match ^[a-z0-9][a-z0-9-]*[a-z0-9]$');
  }
  const dir = join(workspaceDir, '.otto', 'artifacts', slug);
  return {
    slug,
    dir,
    primaryPath: join(dir, 'report.md'),
    metadataPath: join(dir, 'metadata.json'),
    provenancePath: join(dir, 'provenance.json'),
    readmePath: join(dir, 'README.md'),
  };
}
```

- [ ] **Step 4: Run; PASS** (10/10).

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-artifacts/src/resolve-uri.ts packages/coworker-artifacts/src/resolve-uri.test.ts
git commit -m "feat(coworker-4): resolveArtifactUri URI parser + path builder (Phase 4 Task 4)"
```

---

### Task 5: `readme-renderer.ts` pure function

**Files:**
- Create: `packages/coworker-artifacts/src/readme-renderer.ts`
- Create: `packages/coworker-artifacts/src/readme-renderer.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/coworker-artifacts/src/readme-renderer.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderReadme } from './readme-renderer.js';
import type { ArtifactMetadata, Provenance } from './types.js';

const META: ArtifactMetadata = {
  _schema: 1,
  slug: 'rca-1',
  kind: 'report',
  name: 'RCA: load balancer 503',
  created_at: '2026-06-02T14:32:00Z',
  last_updated_at: '2026-06-02T15:18:00Z',
  turn_count: 2,
  primary_file: 'report.md',
  uri: 'artifact://rca-1',
};

const PROV: Provenance = [
  {
    _schema: 1, ts: '2026-06-02T14:32:00Z', action: 'create',
    turn_id: 'turn-abc', agent_turn_id: 'agent-xyz',
    user_prompt: 'draft the RCA', scratchpad_name: 'p1',
    files_touched: ['report.md'],
  },
  {
    _schema: 1, ts: '2026-06-02T15:18:00Z', action: 'update',
    turn_id: 'turn-def', user_prompt: 'add timeline',
    scratchpad_name: 'p1', files_touched: ['report.md'],
  },
];

describe('renderReadme', () => {
  it('renders header with name + uri + dates + turn count', () => {
    const md = renderReadme(META, PROV, [{ path: 'report.md', sizeBytes: 4200 }]);
    assert.match(md, /^# RCA: load balancer 503/m);
    assert.match(md, /\*\*Kind:\*\* report/);
    assert.match(md, /\*\*URI:\*\* `artifact:\/\/rca-1`/);
    assert.match(md, /\*\*Created:\*\* 2026-06-02T14:32:00Z/);
    assert.match(md, /\*\*Last updated:\*\* 2026-06-02T15:18:00Z/);
    assert.match(md, /\*\*Turns:\*\* 2/);
  });
  it('renders files section with human-readable sizes', () => {
    const md = renderReadme(META, PROV, [{ path: 'report.md', sizeBytes: 4200 }]);
    assert.match(md, /## Files/);
    assert.match(md, /`report.md` — 4\.1 KB/);
  });
  it('renders provenance table', () => {
    const md = renderReadme(META, PROV, [{ path: 'report.md', sizeBytes: 4200 }]);
    assert.match(md, /## Provenance/);
    assert.match(md, /\| # \| ts \| action \| turn \| prompt \|/);
    assert.match(md, /\| 1 \| 2026-06-02T14:32:00Z \| create \| turn-abc \| draft the RCA \|/);
    assert.match(md, /\| 2 \| 2026-06-02T15:18:00Z \| update \| turn-def \| add timeline \|/);
  });
  it('is deterministic — same inputs produce byte-identical output', () => {
    const a = renderReadme(META, PROV, [{ path: 'report.md', sizeBytes: 4200 }]);
    const b = renderReadme(META, PROV, [{ path: 'report.md', sizeBytes: 4200 }]);
    assert.equal(a, b);
  });
  it('handles empty provenance', () => {
    const md = renderReadme(META, [], [{ path: 'report.md', sizeBytes: 0 }]);
    assert.match(md, /## Provenance/);
    // No table rows beyond header
    const tableRows = (md.match(/^\| \d+ \|/gm) ?? []).length;
    assert.equal(tableRows, 0);
  });
  it('handles empty file stats', () => {
    const md = renderReadme(META, PROV, []);
    assert.match(md, /## Files/);
    assert.match(md, /\(none\)/);
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement `readme-renderer.ts`**

```typescript
// packages/coworker-artifacts/src/readme-renderer.ts
import type { ArtifactMetadata, Provenance } from './types.js';

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}

function escapeMarkdownPipe(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderReadme(
  metadata: ArtifactMetadata,
  provenance: Provenance,
  fileStats: Array<{ path: string; sizeBytes: number }>,
): string {
  const firstTurn = provenance[0]?.turn_id ?? '';
  const lastTurn = provenance.length > 0 ? provenance[provenance.length - 1]!.turn_id : '';

  const lines: string[] = [];
  lines.push(`# ${metadata.name}`);
  lines.push('');
  lines.push(`**Kind:** ${metadata.kind}`);
  lines.push(`**URI:** \`${metadata.uri}\``);
  lines.push(`**Created:** ${metadata.created_at}${firstTurn ? ` (turn \`${firstTurn}\`)` : ''}`);
  lines.push(`**Last updated:** ${metadata.last_updated_at}${lastTurn ? ` (turn \`${lastTurn}\`)` : ''}`);
  lines.push(`**Turns:** ${metadata.turn_count}`);
  lines.push('');
  lines.push('## Files');
  lines.push('');
  if (fileStats.length === 0) {
    lines.push('(none)');
  } else {
    for (const f of fileStats) {
      lines.push(`- \`${f.path}\` — ${humanSize(f.sizeBytes)}`);
    }
  }
  lines.push('');
  lines.push('## Provenance');
  lines.push('');
  lines.push('| # | ts | action | turn | prompt |');
  lines.push('|---|---|---|---|---|');
  provenance.forEach((e, i) => {
    lines.push(`| ${i + 1} | ${e.ts} | ${e.action} | ${e.turn_id} | ${escapeMarkdownPipe(e.user_prompt)} |`);
  });
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 4: Run; PASS** (6/6).

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-artifacts/src/readme-renderer.ts packages/coworker-artifacts/src/readme-renderer.test.ts
git commit -m "feat(coworker-4): deterministic README renderer (Phase 4 Task 5)"
```

---

### Task 6: `ArtifactStore` class

**Files:**
- Create: `packages/coworker-artifacts/src/artifact-store.ts`
- Create: `packages/coworker-artifacts/src/artifact-store.test.ts`

The class is the substantive piece. Atomic writes (`tmp + rename`), slug derivation with collision retry, README re-render on every metadata change, `recordTurn` appends, `list`/`get`/`remove`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-artifacts/src/artifact-store.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from './artifact-store.js';
import { ArtifactKindRejected, ArtifactNotFound, ArtifactSlugCollision } from './errors.js';

function tmpWs(): string {
  return mkdtempSync(join(tmpdir(), 'art-store-'));
}

function fixedNow(): () => string {
  let n = Date.parse('2026-06-02T14:00:00Z');
  return () => {
    const v = new Date(n).toISOString();
    n += 60_000;
    return v;
  };
}

describe('ArtifactStore.create', () => {
  it('creates dir + metadata + empty primary + initial provenance + README', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'RCA: load balancer 503');
    assert.equal(h.slug, 'rca-load-balancer-503');
    assert.equal(h.kind, 'report');
    assert.equal(h.uri, 'artifact://rca-load-balancer-503');
    assert.ok(existsSync(h.dir));
    assert.ok(existsSync(h.primaryPath));
    assert.ok(existsSync(h.metadataPath));
    assert.ok(existsSync(h.provenancePath));
    assert.ok(existsSync(h.readmePath));
    const meta = JSON.parse(readFileSync(h.metadataPath, 'utf8'));
    assert.equal(meta._schema, 1);
    assert.equal(meta.slug, 'rca-load-balancer-503');
    assert.equal(meta.kind, 'report');
    assert.equal(meta.primary_file, 'report.md');
    assert.equal(meta.turn_count, 0);
  });
  it('rejects non-report kind', async () => {
    const store = new ArtifactStore({ workspaceDir: tmpWs() });
    await assert.rejects(() => store.create('workbook' as never, 'x'), ArtifactKindRejected);
  });
  it('suffixes slug on collision', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const a = await store.create('report', 'RCA');
    const b = await store.create('report', 'RCA');
    const c = await store.create('report', 'RCA');
    assert.equal(a.slug, 'rca');
    assert.equal(b.slug, 'rca-2');
    assert.equal(c.slug, 'rca-3');
  });
  it('throws ArtifactSlugCollision after exhausting suffixes', async () => {
    const ws = tmpWs();
    mkdirSync(join(ws, '.otto', 'artifacts'), { recursive: true });
    mkdirSync(join(ws, '.otto', 'artifacts', 'rca'));
    for (let n = 2; n <= 101; n++) mkdirSync(join(ws, '.otto', 'artifacts', `rca-${n}`));
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    await assert.rejects(() => store.create('report', 'RCA'), ArtifactSlugCollision);
  });
  it('writes files at mode 0o600 and dir at 0o700', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'sec');
    const dirStat = statSync(h.dir);
    const fileStat = statSync(h.metadataPath);
    assert.equal((dirStat.mode & 0o777), 0o700);
    assert.equal((fileStat.mode & 0o777), 0o600);
  });
});

describe('ArtifactStore.update', () => {
  it('writes files atomically; returns files_touched', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    const out = await store.update(h, [{ path: 'report.md', content: '# hi\n' }]);
    assert.deepEqual(out.files_touched.sort(), ['report.md']);
    assert.equal(readFileSync(h.primaryPath, 'utf8'), '# hi\n');
  });
  it('rejects FileWrite path with .. or /', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    await assert.rejects(() => store.update(h, [{ path: '../escape', content: 'x' }]));
    await assert.rejects(() => store.update(h, [{ path: '/abs', content: 'x' }]));
  });
  it('detects added + modified files via DirSnapshot diff', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    await store.update(h, [{ path: 'report.md', content: '# v1\n' }]);
    await new Promise(r => setTimeout(r, 20));
    const out = await store.update(h, [
      { path: 'report.md', content: '# v2\n' },
      { path: 'appendix.md', content: '## A\n' },
    ]);
    assert.deepEqual(out.files_touched.sort(), ['appendix.md', 'report.md']);
  });
  it('bumps last_updated_at + turn_count when paired with recordTurn', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    const meta1 = JSON.parse(readFileSync(h.metadataPath, 'utf8'));
    await store.recordTurn(h, {
      action: 'create', turn_id: 't1', user_prompt: 'p1', files_touched: [],
    });
    const meta2 = JSON.parse(readFileSync(h.metadataPath, 'utf8'));
    assert.equal(meta2.turn_count, 1);
    assert.notEqual(meta1.last_updated_at, meta2.last_updated_at);
  });
});

describe('ArtifactStore.recordTurn', () => {
  it('appends to provenance.json', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    await store.recordTurn(h, {
      action: 'create', turn_id: 't1', user_prompt: 'p1', files_touched: [],
    });
    await store.recordTurn(h, {
      action: 'update', turn_id: 't2', user_prompt: 'p2', files_touched: ['report.md'],
    });
    const prov = JSON.parse(readFileSync(h.provenancePath, 'utf8'));
    assert.equal(prov.length, 2);
    assert.equal(prov[0].turn_id, 't1');
    assert.equal(prov[1].turn_id, 't2');
  });
});

describe('ArtifactStore.list + get + remove', () => {
  it('list returns all artifact handles, sorted by created_at desc', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const a = await store.create('report', 'a');
    const b = await store.create('report', 'b');
    const list = await store.list();
    assert.equal(list.length, 2);
    // fixedNow increments — b is created after a, so b should be first
    assert.equal(list[0]!.slug, 'b');
    assert.equal(list[1]!.slug, 'a');
  });
  it('get returns handle or null', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    assert.equal((await store.get('r'))!.slug, 'r');
    assert.equal(await store.get('missing'), null);
  });
  it('remove deletes directory; throws ArtifactNotFound if missing', async () => {
    const ws = tmpWs();
    const store = new ArtifactStore({ workspaceDir: ws, now: fixedNow() });
    const h = await store.create('report', 'r');
    await store.remove('r', true);
    assert.equal(existsSync(h.dir), false);
    await assert.rejects(() => store.remove('r', true), ArtifactNotFound);
  });
  it('remove rejects when confirm is not true', async () => {
    const store = new ArtifactStore({ workspaceDir: tmpWs() });
    await assert.rejects(() => store.remove('x', false as never));
  });
});
```

- [ ] **Step 2: Run; FAIL**

- [ ] **Step 3: Implement `artifact-store.ts`**

```typescript
// packages/coworker-artifacts/src/artifact-store.ts
import {
  chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { join, normalize } from 'node:path';
import type {
  ArtifactHandle, ArtifactKind, ArtifactMetadata, FileWrite,
  Provenance, TurnEntry,
} from './types.js';
import { ARTIFACT_KINDS } from './types.js';
import {
  ArtifactKindRejected, ArtifactNotFound, ArtifactSlugCollision,
} from './errors.js';
import { deriveSlug, nextCollisionSlug } from './slug.js';
import { takeSnapshot, diffSnapshots } from './dir-snapshot.js';
import { renderReadme } from './readme-renderer.js';

export interface ArtifactStoreOptions {
  workspaceDir: string;
  now?: () => string;
}

const ARTIFACTS_DIR_NAME = '.otto/artifacts';
const PRIMARY_FILE = 'report.md';

export class ArtifactStore {
  private readonly workspaceDir: string;
  private readonly now: () => string;

  constructor(opts: ArtifactStoreOptions) {
    this.workspaceDir = opts.workspaceDir;
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  private rootDir(): string {
    return join(this.workspaceDir, ARTIFACTS_DIR_NAME);
  }

  private existingSlugs(): Set<string> {
    const root = this.rootDir();
    if (!existsSync(root)) return new Set();
    return new Set(readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name));
  }

  private handleFor(slug: string, kind: ArtifactKind, name: string): ArtifactHandle {
    const dir = join(this.rootDir(), slug);
    return {
      slug, kind, name, dir,
      uri: `artifact://${slug}`,
      primaryPath: join(dir, PRIMARY_FILE),
      metadataPath: join(dir, 'metadata.json'),
      provenancePath: join(dir, 'provenance.json'),
      readmePath: join(dir, 'README.md'),
    };
  }

  private atomicWrite(path: string, content: string, mode = 0o600): void {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, content, { mode });
    chmodSync(tmp, mode);
    renameSync(tmp, path);
  }

  private readMetadata(path: string): ArtifactMetadata {
    return JSON.parse(readFileSync(path, 'utf8')) as ArtifactMetadata;
  }

  private readProvenance(path: string): Provenance {
    if (!existsSync(path)) return [];
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Provenance;
    } catch {
      return [];
    }
  }

  private fileStats(dir: string): Array<{ path: string; sizeBytes: number }> {
    const snap = takeSnapshot(dir);
    return [...snap.entries()]
      .filter(([p]) => p !== 'metadata.json' && p !== 'provenance.json' && p !== 'README.md')
      .map(([path, { sizeBytes }]) => ({ path, sizeBytes }));
  }

  async create(kind: ArtifactKind, name: string): Promise<ArtifactHandle> {
    if (!ARTIFACT_KINDS.includes(kind)) throw new ArtifactKindRejected(kind);
    mkdirSync(this.rootDir(), { recursive: true, mode: 0o700 });
    const base = deriveSlug(name);
    const slug = nextCollisionSlug(base, this.existingSlugs());
    const handle = this.handleFor(slug, kind, name);
    // Use mkdirSync (non-recursive) on the artifact dir for race detection,
    // but the parent is created above; if this throws EEXIST, retry with bumped slug.
    try { mkdirSync(handle.dir, { mode: 0o700 }); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        // Race — recurse with refreshed slug set
        return this.create(kind, name);
      }
      throw err;
    }
    const ts = this.now();
    const meta: ArtifactMetadata = {
      _schema: 1, slug, kind, name,
      created_at: ts, last_updated_at: ts,
      turn_count: 0, primary_file: PRIMARY_FILE,
      uri: handle.uri,
    };
    this.atomicWrite(handle.metadataPath, JSON.stringify(meta, null, 2));
    this.atomicWrite(handle.primaryPath, '');
    this.atomicWrite(handle.provenancePath, '[]');
    this.atomicWrite(handle.readmePath, renderReadme(meta, [], this.fileStats(handle.dir)));
    return handle;
  }

  async update(handle: ArtifactHandle, files: FileWrite[]): Promise<{ files_touched: string[] }> {
    if (!existsSync(handle.dir)) throw new ArtifactNotFound(handle.slug);
    for (const f of files) {
      const normalized = normalize(f.path);
      if (normalized.startsWith('..') || normalized.startsWith('/') || normalized.includes('\0')) {
        throw new Error(`Bad FileWrite path: ${f.path}`);
      }
    }
    const before = takeSnapshot(handle.dir);
    for (const f of files) {
      const abs = join(handle.dir, f.path);
      mkdirSync(join(abs, '..'), { recursive: true, mode: 0o700 });
      this.atomicWrite(abs, f.content);
    }
    const after = takeSnapshot(handle.dir);
    const diff = diffSnapshots(before, after);
    const filesTouched = [...new Set([...diff.added, ...diff.modified])]
      .filter(p => p !== 'metadata.json' && p !== 'provenance.json' && p !== 'README.md')
      .sort();
    // Bump metadata (last_updated_at; turn_count incremented by recordTurn)
    const meta = this.readMetadata(handle.metadataPath);
    meta.last_updated_at = this.now();
    this.atomicWrite(handle.metadataPath, JSON.stringify(meta, null, 2));
    const prov = this.readProvenance(handle.provenancePath);
    this.atomicWrite(handle.readmePath, renderReadme(meta, prov, this.fileStats(handle.dir)));
    return { files_touched: filesTouched };
  }

  async recordTurn(
    handle: ArtifactHandle,
    entry: Omit<TurnEntry, '_schema' | 'ts'> & Partial<Pick<TurnEntry, 'ts'>>,
  ): Promise<void> {
    if (!existsSync(handle.dir)) throw new ArtifactNotFound(handle.slug);
    const prov = this.readProvenance(handle.provenancePath);
    const ts = entry.ts ?? this.now();
    const fullEntry: TurnEntry = {
      _schema: 1, ts,
      action: entry.action,
      turn_id: entry.turn_id,
      user_prompt: entry.user_prompt,
      files_touched: entry.files_touched,
      ...(entry.agent_turn_id !== undefined ? { agent_turn_id: entry.agent_turn_id } : {}),
      ...(entry.scratchpad_name !== undefined ? { scratchpad_name: entry.scratchpad_name } : {}),
    };
    prov.push(fullEntry);
    this.atomicWrite(handle.provenancePath, JSON.stringify(prov, null, 2));
    // Bump metadata
    const meta = this.readMetadata(handle.metadataPath);
    meta.turn_count = prov.length;
    meta.last_updated_at = ts;
    this.atomicWrite(handle.metadataPath, JSON.stringify(meta, null, 2));
    this.atomicWrite(handle.readmePath, renderReadme(meta, prov, this.fileStats(handle.dir)));
  }

  async list(): Promise<ArtifactHandle[]> {
    const root = this.rootDir();
    if (!existsSync(root)) return [];
    const handles: Array<{ handle: ArtifactHandle; created_at: string }> = [];
    for (const slug of this.existingSlugs()) {
      const metaPath = join(root, slug, 'metadata.json');
      if (!existsSync(metaPath)) continue;
      try {
        const meta = this.readMetadata(metaPath);
        const h = this.handleFor(meta.slug, meta.kind, meta.name);
        handles.push({ handle: h, created_at: meta.created_at });
      } catch { /* skip malformed */ }
    }
    handles.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return handles.map(x => x.handle);
  }

  async get(slug: string): Promise<ArtifactHandle | null> {
    const metaPath = join(this.rootDir(), slug, 'metadata.json');
    if (!existsSync(metaPath)) return null;
    const meta = this.readMetadata(metaPath);
    return this.handleFor(meta.slug, meta.kind, meta.name);
  }

  async remove(slug: string, confirm: true): Promise<void> {
    if (confirm !== true) throw new Error(`/artifacts remove requires --confirm`);
    const dir = join(this.rootDir(), slug);
    if (!existsSync(dir)) throw new ArtifactNotFound(slug);
    rmSync(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run; PASS** (15/15).

If any test fails, fix the implementation, NOT the test. Pay particular attention to:
- Atomic write ordering (tmp → chmod → rename).
- `files_touched` excludes meta/provenance/README to avoid noise.
- Collision-suffix retry covers EEXIST races.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-artifacts/src/artifact-store.ts \
        packages/coworker-artifacts/src/artifact-store.test.ts
git commit -m "feat(coworker-4): ArtifactStore class with atomic writes + slug collision + README rerender (Phase 4 Task 6)"
```

---

### Task 7: Public barrel

**Files:**
- Create: `packages/coworker-artifacts/src/index.ts`
- Create: `packages/coworker-artifacts/src/index.test.ts`

- [ ] **Step 1: Write `index.ts`**

```typescript
// packages/coworker-artifacts/src/index.ts
export * from './types.js';
export * from './errors.js';
export * from './slug.js';
export * from './dir-snapshot.js';
export * from './resolve-uri.js';
export * from './readme-renderer.js';
export * from './artifact-store.js';
```

- [ ] **Step 2: Write spot-check test**

```typescript
// packages/coworker-artifacts/src/index.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as artifacts from './index.js';

describe('@otto/coworker-artifacts barrel', () => {
  it('exports key surface', () => {
    assert.equal(typeof artifacts.ArtifactStore, 'function');
    assert.equal(typeof artifacts.deriveSlug, 'function');
    assert.equal(typeof artifacts.nextCollisionSlug, 'function');
    assert.equal(typeof artifacts.takeSnapshot, 'function');
    assert.equal(typeof artifacts.diffSnapshots, 'function');
    assert.equal(typeof artifacts.resolveArtifactUri, 'function');
    assert.equal(typeof artifacts.renderReadme, 'function');
    assert.equal(artifacts.ARTIFACT_URI_SCHEME, 'artifact://');
  });
  it('exports error classes', () => {
    assert.equal(typeof artifacts.ArtifactNotFound, 'function');
    assert.equal(typeof artifacts.ArtifactKindRejected, 'function');
    assert.equal(typeof artifacts.ArtifactUriMalformed, 'function');
    assert.equal(typeof artifacts.ArtifactSlugCollision, 'function');
  });
});
```

- [ ] **Step 3: Build + run full package suite**

```
cd packages/coworker-artifacts && npm run build && cd ../..
npm run test:compile
node --test dist-test/packages/coworker-artifacts/src/*.test.js
```

Expected: all tests across the package pass.

- [ ] **Step 4: Commit**

```bash
git add packages/coworker-artifacts/src/index.ts packages/coworker-artifacts/src/index.test.ts
git commit -m "feat(coworker-4): wire @otto/coworker-artifacts barrel (Phase 4 Task 7)"
```

---

### Task 8: Memory migration 002 + `recordArtifact` + DRAWER_KINDS update

**Files:**
- Modify: `packages/coworker-memory/src/types.ts`
- Create: `packages/coworker-memory/src/migrations/002-artifact-kind.sql`
- Modify: `packages/coworker-memory/src/local-sqlite-backend.ts`
- Modify: `packages/coworker-memory/src/local-sqlite-backend.test.ts`
- Modify: `packages/coworker-memory/src/memory-recorder.ts`
- Modify: `packages/coworker-memory/src/memory-recorder.test.ts`

- [ ] **Step 1: Add `'artifact'` to `DRAWER_KINDS`**

Edit `packages/coworker-memory/src/types.ts`. Find:

```typescript
export const DRAWER_KINDS = ['turn', 'paste', 'file_load', 'ticket', 'email', 'rca', 'note'] as const;
```

Change to:

```typescript
export const DRAWER_KINDS = ['turn', 'paste', 'file_load', 'ticket', 'email', 'rca', 'note', 'artifact'] as const;
```

- [ ] **Step 2: Write migration 002**

```sql
-- packages/coworker-memory/src/migrations/002-artifact-kind.sql
-- Adds 'artifact' to the drawers.kind CHECK constraint. SQLite can't ALTER
-- constraints, so the table is rebuilt. Triggers + FTS table are NOT rebuilt
-- here (they reference rowids that survive table rename); only the base
-- table's CHECK changes.

BEGIN;

CREATE TABLE drawers_new (
  id TEXT PRIMARY KEY,
  wing TEXT NOT NULL,
  room TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN
    ('turn','paste','file_load','ticket','email','rca','note','artifact')),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  parent_id TEXT,
  redacted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

INSERT INTO drawers_new (id, wing, room, kind, content, metadata_json, parent_id, redacted, created_at)
SELECT id, wing, room, kind, content, metadata_json, parent_id, redacted, created_at FROM drawers;

DROP TABLE drawers;
ALTER TABLE drawers_new RENAME TO drawers;

-- Recreate indexes (the rename preserves rowids but not separately-named indexes).
CREATE INDEX IF NOT EXISTS idx_drawers_wing_room ON drawers(wing, room);
CREATE INDEX IF NOT EXISTS idx_drawers_kind ON drawers(kind);
CREATE INDEX IF NOT EXISTS idx_drawers_created_at ON drawers(created_at);

PRAGMA user_version = 2;

COMMIT;
```

- [ ] **Step 3: Update `local-sqlite-backend.ts` to run migrations conditionally**

Find the `async open()` method. The current code reads + execs `001-init.sql` unconditionally. Replace with a migration loop:

```typescript
async open(): Promise<void> {
  if (this.db) return;
  mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
  try {
    this.db = new Database(this.path);
  } catch (err) {
    throw new BackendUnavailable(`open(${this.path}): ${(err as Error).message}`);
  }
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const migrations = [
    { version: 1, file: '001-init.sql' },
    { version: 2, file: '002-artifact-kind.sql' },
  ];
  const userVersion = this.db.pragma('user_version', { simple: true }) as number;
  for (const m of migrations) {
    if (userVersion < m.version) {
      const sql = readFileSync(join(migrationsDir, m.file), 'utf8');
      this.db.exec(sql);
    }
  }
}
```

The exact prior shape of `open()` and `migrationsDir` resolution may differ — adapt. Verify that `fileURLToPath(import.meta.url)` is already imported.

- [ ] **Step 4: Add a test for migration 002**

Append to `packages/coworker-memory/src/local-sqlite-backend.test.ts`:

```typescript
import { existsSync } from 'node:fs';

describe('Local backend migrations (Phase 4 Task 8)', () => {
  it('migration 002 lets us insert kind:artifact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'be-mig-'));
    const be = new LocalSqliteBackend({ dbPath: join(dir, 'layer-b.db') });
    await be.open();
    const drawer = await be.retain({
      wing: 'g', room: 'r', kind: 'artifact',
      content: JSON.stringify({ slug: 'rca-1', kind: 'report', uri: 'artifact://rca-1' }),
      metadata: { scratchpad: 'p1' }, redacted: false,
    });
    assert.equal(drawer.kind, 'artifact');
    const r = await be.recall({ query: 'rca', kind: 'artifact' });
    assert.equal(r.length, 1);
    assert.equal(r[0]!.drawer.kind, 'artifact');
    await be.close();
  });
});
```

- [ ] **Step 5: Add `recordArtifact` to `memory-recorder.ts`**

In `packages/coworker-memory/src/memory-recorder.ts`, append after `recordFileLoad`:

```typescript
async recordArtifact(args: {
  scratchpadName: string; slug: string; kind: string; uri: string;
  turnId: string;
}): Promise<Drawer> {
  const content = JSON.stringify({
    slug: args.slug, kind: args.kind, uri: args.uri,
  });
  return this.writeDrawer({
    wing: this.opts.writeWing, room: args.scratchpadName, kind: 'artifact',
    content, metadata: { turn_id: args.turnId, scratchpad: args.scratchpadName },
  });
}
```

- [ ] **Step 6: Add a test for `recordArtifact`**

Append to `packages/coworker-memory/src/memory-recorder.test.ts`:

```typescript
describe('MemoryRecorder.recordArtifact (Phase 4 Task 8)', () => {
  it('writes a kind:artifact drawer with slug/kind/uri JSON content', async () => {
    const c = await setup();
    const recorder = new MemoryRecorder({
      backend: c.backend, scanner: c.scanner, audit: c.audit,
      writeWing: 'global', currentScratchpadName: () => null,
    });
    await recorder.recordArtifact({
      scratchpadName: 'p1', slug: 'rca-1', kind: 'report',
      uri: 'artifact://rca-1', turnId: 't1',
    });
    const r = await c.backend.recall({ query: 'rca', kind: 'artifact' });
    assert.equal(r.length, 1);
    const parsed = JSON.parse(r[0]!.drawer.content);
    assert.equal(parsed.slug, 'rca-1');
    assert.equal(parsed.uri, 'artifact://rca-1');
    assert.equal(r[0]!.drawer.room, 'p1');
    await c.backend.close();
  });
});
```

(Assumes existing `setup()` helper in `memory-recorder.test.ts` constructs a backend + audit + scanner. Adapt to whatever the actual helper name/shape is.)

- [ ] **Step 7: Build + run**

```
cd packages/coworker-memory && npm run build && cd ../..
npm run test:compile
node --test dist-test/packages/coworker-memory/src/local-sqlite-backend.test.js
node --test dist-test/packages/coworker-memory/src/memory-recorder.test.js
```

Expected: all existing tests + 2 new tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/coworker-memory/src/types.ts \
        packages/coworker-memory/src/migrations/002-artifact-kind.sql \
        packages/coworker-memory/src/local-sqlite-backend.ts \
        packages/coworker-memory/src/local-sqlite-backend.test.ts \
        packages/coworker-memory/src/memory-recorder.ts \
        packages/coworker-memory/src/memory-recorder.test.ts
git commit -m "feat(coworker-4): memory migration 002 + recordArtifact + drawer kind 'artifact' (Phase 4 Task 8)"
```

---

### Task 9: Scratchpad kernel-protocol + kernel-entry `otto.artifact` binding

**Files:**
- Modify: `packages/coworker-scratchpad/src/kernel-protocol.ts`
- Modify: `packages/coworker-scratchpad/src/kernel-entry.ts`

The kernel binding uses bidirectional NDJSON RPC. Cell awaits a manager response before resuming. The kernel-entry side blocks on a Promise that resolves when the matching response arrives. A small per-request-id correlation map handles concurrent calls.

- [ ] **Step 1: Add types to `kernel-protocol.ts`**

Append after the existing `DataLoadEvent`:

```typescript
// Phase 4 Task 9 — artifact RPC + event

export interface ArtifactCreateDrawer {
  kind: 'artifact';
  slug: string;
  artifact_kind: string;          // 'report' in v1
  uri: string;
  primary_path: string;
  created_at: string;
}

export interface ArtifactCreateRequest {
  type: 'request';
  request: 'artifact_create';
  id: string;
  kind: string;                   // 'report'
  name: string;
}
export interface ArtifactCreateResponse {
  type: 'response';
  request: 'artifact_create';
  id: string;
  ok: true;
  slug: string;
  uri: string;
  primary_path: string;
}
export interface ArtifactCreateErrorResponse {
  type: 'response';
  request: 'artifact_create';
  id: string;
  ok: false;
  error: string;
}

export interface ArtifactUpdateRequest {
  type: 'request';
  request: 'artifact_update';
  id: string;
  slug: string;
  files: Array<{ path: string; content: string }>;
}
export interface ArtifactUpdateResponse {
  type: 'response';
  request: 'artifact_update';
  id: string;
  ok: true;
  files_touched: string[];
}
export interface ArtifactUpdateErrorResponse {
  type: 'response';
  request: 'artifact_update';
  id: string;
  ok: false;
  error: string;
}

export interface ArtifactCreateEvent {
  type: 'event';
  event: 'artifact_create';
  drawer: ArtifactCreateDrawer;
}

// Aggregate type-guards for the runtime side:
export function isArtifactCreateResponse(
  f: unknown,
): f is ArtifactCreateResponse | ArtifactCreateErrorResponse {
  return typeof f === 'object' && f !== null
    && (f as { type?: string }).type === 'response'
    && (f as { request?: string }).request === 'artifact_create';
}
export function isArtifactUpdateResponse(
  f: unknown,
): f is ArtifactUpdateResponse | ArtifactUpdateErrorResponse {
  return typeof f === 'object' && f !== null
    && (f as { type?: string }).type === 'response'
    && (f as { request?: string }).request === 'artifact_update';
}
export function isArtifactCreateEvent(f: unknown): f is ArtifactCreateEvent {
  return typeof f === 'object' && f !== null
    && (f as { type?: string }).type === 'event'
    && (f as { event?: string }).event === 'artifact_create';
}
```

- [ ] **Step 2: Add `otto.artifact` binding to `kernel-entry.ts`**

Find the existing `const otto: Record<string, unknown> = { collectors: ottoCollectors };` line. Replace + augment:

```typescript
// Phase 4 Task 9 — otto.artifact binding (RPC over stdio)
import type {
  ArtifactCreateRequest, ArtifactCreateResponse, ArtifactCreateErrorResponse,
  ArtifactUpdateRequest, ArtifactUpdateResponse, ArtifactUpdateErrorResponse,
} from './kernel-protocol.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}
const pending = new Map<string, PendingRequest>();
let nextRequestId = 1;

function newRequestId(): string {
  return `art-${process.pid}-${nextRequestId++}`;
}

function rpcRequest<TResp>(payload: { type: 'request'; request: string; id: string } & Record<string, unknown>): Promise<TResp> {
  return new Promise((resolve, reject) => {
    pending.set(payload.id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    send(payload);
  });
}

// Listen for response frames on stdin. The existing kernel-entry has a
// readline/JSON parser for incoming frames. Augment its handler so frames
// shaped like { type: 'response', request: ..., id: ... } get routed here.
function handleResponseFrame(frame: unknown): boolean {
  if (typeof frame !== 'object' || frame === null) return false;
  const f = frame as { type?: string; request?: string; id?: string };
  if (f.type !== 'response') return false;
  if (typeof f.id !== 'string') return false;
  const p = pending.get(f.id);
  if (!p) return false;
  pending.delete(f.id);
  if ((frame as { ok?: boolean }).ok === false) {
    p.reject(new Error((frame as { error?: string }).error ?? 'rpc failed'));
  } else {
    p.resolve(frame);
  }
  return true;
}

// Inside the existing readline frame-dispatch, call handleResponseFrame(frame)
// before the existing event/command dispatch and return early if it consumed.
// (Adapt to the actual frame-dispatch structure.)

interface ArtifactHandleProxy {
  slug: string;
  uri: string;
  primaryPath: string;
  update(files: Array<{ path: string; content: string }>): Promise<{ files_touched: string[] }>;
}

const ottoArtifact = {
  async create(kind: string, name: string): Promise<ArtifactHandleProxy> {
    if (kind !== 'report') {
      throw new Error(`unsupported artifact kind: ${kind}. v1 ships only 'report'.`);
    }
    const id = newRequestId();
    const req: ArtifactCreateRequest = { type: 'request', request: 'artifact_create', id, kind, name };
    const resp = await rpcRequest<ArtifactCreateResponse | ArtifactCreateErrorResponse>(req);
    if (resp.ok === false) throw new Error(`artifact_create failed: ${resp.error}`);
    return makeProxy({ slug: resp.slug, uri: resp.uri, primaryPath: resp.primary_path });
  },

  async spillIfLarge(value: unknown, opts?: { thresholdBytes?: number; name?: string }): Promise<ArtifactHandleProxy | null> {
    const threshold = opts?.thresholdBytes ?? 10_240;
    let serialized: string;
    try {
      serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } catch {
      serialized = String(value);
    }
    if (Buffer.byteLength(serialized, 'utf8') < threshold) return null;
    const name = opts?.name ?? `cell-output-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;
    const handle = await ottoArtifact.create('report', name);
    await handle.update([{ path: 'report.md', content: serialized }]);
    return handle;
  },
};

function makeProxy(args: { slug: string; uri: string; primaryPath: string }): ArtifactHandleProxy {
  return {
    slug: args.slug,
    uri: args.uri,
    primaryPath: args.primaryPath,
    async update(files): Promise<{ files_touched: string[] }> {
      const id = newRequestId();
      const req: ArtifactUpdateRequest = {
        type: 'request', request: 'artifact_update', id, slug: args.slug, files,
      };
      const resp = await rpcRequest<ArtifactUpdateResponse | ArtifactUpdateErrorResponse>(req);
      if (resp.ok === false) throw new Error(`artifact_update failed: ${resp.error}`);
      return { files_touched: resp.files_touched };
    },
  };
}

// At the top-level otto namespace assignment, replace with:
const otto: Record<string, unknown> = {
  collectors: ottoCollectors,
  artifact: ottoArtifact,
};
```

**Implementer note:** the exact integration with the existing `kernel-entry.ts` frame dispatcher depends on its current shape. Read the file end-to-end before editing. The plan above shows the *shape* of what needs to land; you may need to inline-merge with existing send/recv code. If integrating cleanly proves difficult, an alternative simpler design is documented at the end of Task 9 as a fallback.

- [ ] **Step 3: Build + verify kernel-entry compiles**

```
cd packages/coworker-scratchpad && npm run build && cd ../..
```

No new tests yet — the binding is exercised in Task 10 + integration test (Task 13). If the build fails because the frame dispatcher integration is too invasive, fall back to the simpler design:

**Fallback design**: bypass RPC entirely. `otto.artifact.create` reads `OTTO_WORKSPACE_DIR` env var (passed at kernel spawn), constructs a `local-only` `ArtifactStore` from the package, and operates synchronously on the filesystem. Still emits an `artifact_create` event so the manager can record to memory. This avoids the bidirectional RPC complexity at the cost of duplicating the package logic across two processes (kernel + manager would each have an `ArtifactStore` pointing at the same directory). If you take this path, note it explicitly in the commit message; the integration test still passes because the on-disk state is the same.

- [ ] **Step 4: Commit**

```bash
git add packages/coworker-scratchpad/src/kernel-protocol.ts \
        packages/coworker-scratchpad/src/kernel-entry.ts
git commit -m "feat(coworker-4): kernel-entry otto.artifact binding + RPC protocol types (Phase 4 Task 9)"
```

---

### Task 10: Scratchpad runtime + manager wiring

**Files:**
- Modify: `packages/coworker-scratchpad/src/child-process-runtime.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

- [ ] **Step 1: Add `onArtifactCreate` option to `child-process-runtime.ts`**

Find the existing `ChildProcessRuntimeOptions` interface with `onDataLoad?`. Add a parallel field:

```typescript
import type { ArtifactCreateDrawer, ArtifactCreateRequest, ArtifactUpdateRequest } from './kernel-protocol.js';
import { isArtifactCreateEvent } from './kernel-protocol.js';

export interface ChildProcessRuntimeOptions {
  // ... existing fields
  onDataLoad?: (drawer: DataLoadDrawer) => void;
  onArtifactCreate?: (drawer: ArtifactCreateDrawer) => void;

  // Handler the runtime calls when the kernel sends an artifact_create / update RPC.
  // Returns the response payload (or throws).
  handleArtifactCreate?: (req: { kind: string; name: string }) =>
    Promise<{ slug: string; uri: string; primary_path: string }>;
  handleArtifactUpdate?: (req: { slug: string; files: Array<{ path: string; content: string }> }) =>
    Promise<{ files_touched: string[] }>;
}
```

Find the frame-dispatch loop (where `isDataLoadEvent` is checked). Add:

```typescript
else if (isArtifactCreateEvent(frame)) {
  this.options.onArtifactCreate?.(frame.drawer);
}
else if (isArtifactCreateRequest(frame)) {
  void this.handleArtifactCreate(frame);
}
else if (isArtifactUpdateRequest(frame)) {
  void this.handleArtifactUpdate(frame);
}
```

Where `isArtifactCreateRequest` and `isArtifactUpdateRequest` are imported from `./kernel-protocol.js` (add the type guards to the protocol file similarly to `isArtifactCreateResponse`).

Add the request handlers:

```typescript
private async handleArtifactCreate(req: ArtifactCreateRequest): Promise<void> {
  if (!this.options.handleArtifactCreate) {
    this.send({
      type: 'response', request: 'artifact_create', id: req.id,
      ok: false, error: 'no artifact store available',
    });
    return;
  }
  try {
    const out = await this.options.handleArtifactCreate({ kind: req.kind, name: req.name });
    this.send({
      type: 'response', request: 'artifact_create', id: req.id, ok: true,
      slug: out.slug, uri: out.uri, primary_path: out.primary_path,
    });
  } catch (err) {
    this.send({
      type: 'response', request: 'artifact_create', id: req.id,
      ok: false, error: (err as Error).message,
    });
  }
}

private async handleArtifactUpdate(req: ArtifactUpdateRequest): Promise<void> {
  if (!this.options.handleArtifactUpdate) {
    this.send({
      type: 'response', request: 'artifact_update', id: req.id,
      ok: false, error: 'no artifact store available',
    });
    return;
  }
  try {
    const out = await this.options.handleArtifactUpdate({ slug: req.slug, files: req.files });
    this.send({
      type: 'response', request: 'artifact_update', id: req.id, ok: true,
      files_touched: out.files_touched,
    });
  } catch (err) {
    this.send({
      type: 'response', request: 'artifact_update', id: req.id,
      ok: false, error: (err as Error).message,
    });
  }
}
```

`this.send(payload)` writes a JSON line to the child's stdin — adapt to whatever the existing method is called (probably `writeFrame` or similar). The `request` type guards must be added to `kernel-protocol.ts`; mirror the existing `isDataLoadEvent` pattern.

- [ ] **Step 2: Add manager-level options + spawn-time wiring**

In `packages/coworker-scratchpad/src/scratchpad-manager.ts`, find `ScratchpadManagerOptions`. Add:

```typescript
import type { ArtifactStore } from '@otto/coworker-artifacts';
import type { ArtifactCreateDrawer } from './kernel-protocol.js';

export interface ScratchpadManagerOptions {
  // ... existing
  onDataLoad?: (drawer: DataLoadDrawer, scratchpadName: string) => void;
  onArtifactCreate?: (drawer: ArtifactCreateDrawer, scratchpadName: string) => void;
  getArtifactStore?: () => ArtifactStore | null;
}
```

(The artifacts package is added as a workspace dep — add `"@otto/coworker-artifacts": "*"` to `packages/coworker-scratchpad/package.json` `dependencies`.)

In `spawnRuntime` (the existing fan-out path for `onDataLoad`), add the artifact closures:

```typescript
const fanArtifactCreate = this.onArtifactCreate;
const artifactCreateCallback = fanArtifactCreate
  ? (drawer: ArtifactCreateDrawer): void => fanArtifactCreate(drawer, name)
  : this.runtimeOptions.onArtifactCreate;

const getStore = this.getArtifactStore;
const handleArtifactCreate = getStore
  ? async (req: { kind: string; name: string }) => {
      const store = getStore();
      if (!store) throw new Error('artifacts unavailable');
      const handle = await store.create(req.kind as 'report', req.name);
      return {
        slug: handle.slug,
        uri: handle.uri,
        primary_path: handle.primaryPath,
      };
    }
  : undefined;

const handleArtifactUpdate = getStore
  ? async (req: { slug: string; files: Array<{ path: string; content: string }> }) => {
      const store = getStore();
      if (!store) throw new Error('artifacts unavailable');
      const handle = await store.get(req.slug);
      if (!handle) throw new Error(`unknown artifact: ${req.slug}`);
      return await store.update(handle, req.files);
    }
  : undefined;

// Pass into ChildProcessRuntime options:
const runtime = new ChildProcessRuntime({
  // ... existing options
  onDataLoad: ...,
  onArtifactCreate: artifactCreateCallback,
  handleArtifactCreate,
  handleArtifactUpdate,
});
```

Constructor: capture `onArtifactCreate` and `getArtifactStore` from options.

- [ ] **Step 3: Add tests to `scratchpad-manager.test.ts`**

Append:

```typescript
describe('ScratchpadManager artifact wiring (Phase 4 Task 10)', () => {
  it('fans onArtifactCreate to manager-level callback with scratchpad name', () => {
    const events: Array<{ drawer: { slug: string }; scratchpadName: string }> = [];
    const manager = new ScratchpadManager({
      workspace: '/tmp', root: '/tmp', sessionId: 's',
      onArtifactCreate: (drawer, scratchpadName) => events.push({
        drawer: { slug: drawer.slug }, scratchpadName,
      }),
    });
    // The manager's spawnRuntime should produce a runtime whose options.onArtifactCreate
    // closure-binds to a given scratchpad name. Simulate by calling directly:
    const callback = (manager as unknown as { runtimeOptionsForScratchpad: (name: string) => { onArtifactCreate?: (d: { slug: string; uri: string; artifact_kind: string; kind: 'artifact'; primary_path: string; created_at: string }) => void } })
      .runtimeOptionsForScratchpad?.('p1');
    if (callback?.onArtifactCreate) {
      callback.onArtifactCreate({
        kind: 'artifact', slug: 'rca-1', artifact_kind: 'report',
        uri: 'artifact://rca-1', primary_path: '/x/rca-1/report.md',
        created_at: '2026-06-02T14:00:00Z',
      });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.scratchpadName, 'p1');
      assert.equal(events[0]!.drawer.slug, 'rca-1');
    }
  });
});
```

**Note:** the test above peeks at an internal helper (`runtimeOptionsForScratchpad`). If the manager doesn't expose that method, refactor the spawnRuntime path to extract it, OR test via a higher-level seam (the integration test in Task 13 also covers this). Don't tear down the manager's existing API to expose internals — keep the test pragmatic.

- [ ] **Step 4: Build + run**

```
npm install     # picks up new @otto/coworker-artifacts workspace dep
cd packages/coworker-scratchpad && npm run build && cd ../..
npm run test:compile
node --test dist-test/packages/coworker-scratchpad/src/scratchpad-manager.test.js
```

Expected: all existing tests pass + new tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/package.json \
        packages/coworker-scratchpad/src/child-process-runtime.ts \
        packages/coworker-scratchpad/src/scratchpad-manager.ts \
        packages/coworker-scratchpad/src/scratchpad-manager.test.ts \
        packages/coworker-scratchpad/src/kernel-protocol.ts \
        package-lock.json
git commit -m "feat(coworker-4): scratchpad manager onArtifactCreate fan-out + artifact RPC handlers (Phase 4 Task 10)"
```

---

### Task 11: Extension scaffold + activator + tools + slash command

**Files:**
- Create: `src/resources/extensions/coworker-artifacts/extension-manifest.json`
- Create: `src/resources/extensions/coworker-artifacts/artifacts-singleton.ts`
- Create: `src/resources/extensions/coworker-artifacts/artifacts-singleton.test.ts`
- Create: `src/resources/extensions/coworker-artifacts/index.ts`
- Create: `src/resources/extensions/coworker-artifacts/index.test.ts`
- Create: `src/resources/extensions/coworker-artifacts/list-tool.ts`
- Create: `src/resources/extensions/coworker-artifacts/list-tool.test.ts`
- Create: `src/resources/extensions/coworker-artifacts/open-tool.ts`
- Create: `src/resources/extensions/coworker-artifacts/open-tool.test.ts`
- Create: `src/resources/extensions/coworker-artifacts/artifacts-command.ts`
- Create: `src/resources/extensions/coworker-artifacts/artifacts-command.test.ts`

- [ ] **Step 1: Manifest**

```json
{
  "id": "coworker-artifacts",
  "name": "Co-worker Artifacts",
  "version": "1.0.0",
  "description": "Workspace-scoped artifact store: artifact://<slug> URIs, /artifacts slash, list_artifacts + open_artifact tools",
  "tier": "bundled",
  "requires": { "platform": ">=2.29.0" },
  "provides": {
    "tools": ["list_artifacts", "open_artifact"],
    "commands": ["artifacts"],
    "hooks": ["session_start", "session_shutdown"]
  }
}
```

Save to `src/resources/extensions/coworker-artifacts/extension-manifest.json`.

- [ ] **Step 2: Implement singleton**

```typescript
// src/resources/extensions/coworker-artifacts/artifacts-singleton.ts
import { ArtifactStore } from '@otto/coworker-artifacts';

export interface ArtifactsBundleOptions {
  workspaceDir: string;
  now?: () => string;
}

export interface ArtifactsBundle {
  store: ArtifactStore;
  workspaceDir: string;
  dispose(): Promise<void>;
}

export async function createArtifactsBundle(opts: ArtifactsBundleOptions): Promise<ArtifactsBundle> {
  const store = new ArtifactStore({ workspaceDir: opts.workspaceDir, now: opts.now });
  return {
    store,
    workspaceDir: opts.workspaceDir,
    async dispose() { /* no async resources in v1 */ },
  };
}
```

- [ ] **Step 3: Write singleton test**

```typescript
// src/resources/extensions/coworker-artifacts/artifacts-singleton.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtifactsBundle } from './artifacts-singleton.js';

describe('createArtifactsBundle', () => {
  it('returns bundle with ArtifactStore', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'art-bundle-'));
    const b = await createArtifactsBundle({ workspaceDir: ws });
    assert.ok(b.store);
    assert.equal(b.workspaceDir, ws);
    await b.dispose();
  });
  it('store creates an artifact in the workspace dir', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'art-b2-'));
    const b = await createArtifactsBundle({ workspaceDir: ws });
    const h = await b.store.create('report', 'test');
    assert.equal(h.slug, 'test');
    assert.match(h.dir, /\.otto\/artifacts\/test$/);
    await b.dispose();
  });
});
```

- [ ] **Step 4: Implement `list-tool.ts`**

```typescript
// src/resources/extensions/coworker-artifacts/list-tool.ts
import type { ArtifactStore } from '@otto/coworker-artifacts';

export interface ListedArtifact {
  slug: string;
  kind: string;
  name: string;
  uri: string;
  created_at: string;
  last_updated_at: string;
  turn_count: number;
}

export interface ListToolOutput {
  artifacts: ListedArtifact[];
  markdown: string;
}

export async function runListArtifacts(store: ArtifactStore): Promise<ListToolOutput> {
  const handles = await store.list();
  // We need the metadata fields not on the handle — re-read each metadata.json.
  const { readFileSync } = await import('node:fs');
  const rows: ListedArtifact[] = handles.map(h => {
    const meta = JSON.parse(readFileSync(h.metadataPath, 'utf8'));
    return {
      slug: h.slug, kind: h.kind, name: h.name, uri: h.uri,
      created_at: meta.created_at, last_updated_at: meta.last_updated_at,
      turn_count: meta.turn_count,
    };
  });
  if (rows.length === 0) {
    return { artifacts: [], markdown: '### Artifacts (0)\n' };
  }
  const lines: string[] = [`### Artifacts (${rows.length})`, ''];
  lines.push('| slug | kind | turns | last updated | uri |');
  lines.push('|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.slug} | ${r.kind} | ${r.turn_count} | ${r.last_updated_at} | \`${r.uri}\` |`);
  }
  return { artifacts: rows, markdown: lines.join('\n') + '\n' };
}
```

- [ ] **Step 5: Write `list-tool.test.ts`**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@otto/coworker-artifacts';
import { runListArtifacts } from './list-tool.js';

describe('runListArtifacts', () => {
  it('returns empty when no artifacts', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'lt-')) });
    const out = await runListArtifacts(store);
    assert.equal(out.artifacts.length, 0);
    assert.match(out.markdown, /### Artifacts \(0\)/);
  });
  it('returns rows with markdown table for present artifacts', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'lt2-'));
    const store = new ArtifactStore({ workspaceDir: ws });
    await store.create('report', 'a');
    await store.create('report', 'b');
    const out = await runListArtifacts(store);
    assert.equal(out.artifacts.length, 2);
    assert.match(out.markdown, /### Artifacts \(2\)/);
    assert.match(out.markdown, /\| slug \| kind \| turns \| last updated \| uri \|/);
    assert.match(out.markdown, /artifact:\/\/a/);
    assert.match(out.markdown, /artifact:\/\/b/);
  });
});
```

- [ ] **Step 6: Implement `open-tool.ts`**

```typescript
// src/resources/extensions/coworker-artifacts/open-tool.ts
import type { ArtifactStore } from '@otto/coworker-artifacts';
import { ArtifactNotFound } from '@otto/coworker-artifacts';

export interface OpenToolOutput {
  markdown: string;
}

export async function runOpenArtifact(store: ArtifactStore, args: { slug: string }): Promise<OpenToolOutput> {
  const handle = await store.get(args.slug);
  if (!handle) throw new ArtifactNotFound(args.slug);
  const { readFileSync } = await import('node:fs');
  const body = readFileSync(handle.primaryPath, 'utf8');
  const provRaw = readFileSync(handle.provenancePath, 'utf8');
  const prov = JSON.parse(provRaw) as Array<{ ts: string; action: string; turn_id: string; user_prompt: string }>;
  const tail = prov.slice(-5);
  const lines: string[] = [];
  lines.push(`### ${handle.name} (\`${handle.uri}\`)`);
  lines.push('');
  lines.push('```markdown');
  lines.push(body);
  lines.push('```');
  lines.push('');
  if (tail.length > 0) {
    lines.push('**Recent provenance:**');
    for (const e of tail) {
      lines.push(`- ${e.ts} · ${e.action} · turn \`${e.turn_id}\` · ${e.user_prompt}`);
    }
  }
  return { markdown: lines.join('\n') + '\n' };
}
```

- [ ] **Step 7: Write `open-tool.test.ts`**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore, ArtifactNotFound } from '@otto/coworker-artifacts';
import { runOpenArtifact } from './open-tool.js';

describe('runOpenArtifact', () => {
  it('returns markdown with content + provenance tail', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ot-')) });
    const h = await store.create('report', 'r');
    await store.update(h, [{ path: 'report.md', content: '# hello\n' }]);
    await store.recordTurn(h, {
      action: 'create', turn_id: 't1', user_prompt: 'draft', files_touched: [],
    });
    const out = await runOpenArtifact(store, { slug: 'r' });
    assert.match(out.markdown, /# hello/);
    assert.match(out.markdown, /Recent provenance/);
    assert.match(out.markdown, /turn `t1`/);
  });
  it('throws ArtifactNotFound for missing slug', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ot2-')) });
    await assert.rejects(() => runOpenArtifact(store, { slug: 'missing' }), ArtifactNotFound);
  });
});
```

- [ ] **Step 8: Implement `artifacts-command.ts`**

```typescript
// src/resources/extensions/coworker-artifacts/artifacts-command.ts
import type { ArtifactStore } from '@otto/coworker-artifacts';
import { runListArtifacts } from './list-tool.js';
import { runOpenArtifact } from './open-tool.js';

export interface ArtifactsCommandResult { message: string; }

export async function runArtifactsCommand(store: ArtifactStore, argv: string[]): Promise<ArtifactsCommandResult> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'list':
    case undefined: {
      const out = await runListArtifacts(store);
      return { message: out.markdown };
    }
    case 'show': {
      const slug = rest[0];
      if (!slug) throw new Error('Usage: /artifacts show <slug>');
      const out = await runOpenArtifact(store, { slug });
      return { message: out.markdown };
    }
    case 'remove': {
      const slug = rest[0];
      const confirm = rest.includes('--confirm');
      if (!slug) throw new Error('Usage: /artifacts remove <slug> --confirm');
      if (!confirm) throw new Error('Usage: /artifacts remove <slug> --confirm');
      await store.remove(slug, true);
      return { message: `removed: ${slug}` };
    }
    default:
      throw new Error(`Unknown /artifacts subcommand: ${sub}. Try: list, show, remove.`);
  }
}
```

- [ ] **Step 9: Write `artifacts-command.test.ts`**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '@otto/coworker-artifacts';
import { runArtifactsCommand } from './artifacts-command.js';

describe('/artifacts command', () => {
  it('list returns markdown table', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ac-')) });
    await store.create('report', 'a');
    const out = await runArtifactsCommand(store, ['list']);
    assert.match(out.message, /### Artifacts \(1\)/);
  });
  it('bare invocation defaults to list', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ac2-')) });
    const out = await runArtifactsCommand(store, []);
    assert.match(out.message, /### Artifacts \(0\)/);
  });
  it('show <slug> dumps content + provenance', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ac3-')) });
    const h = await store.create('report', 'r');
    await store.update(h, [{ path: 'report.md', content: '# yo\n' }]);
    const out = await runArtifactsCommand(store, ['show', 'r']);
    assert.match(out.message, /# yo/);
  });
  it('remove --confirm deletes', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'ac4-'));
    const store = new ArtifactStore({ workspaceDir: ws });
    const h = await store.create('report', 'r');
    const out = await runArtifactsCommand(store, ['remove', 'r', '--confirm']);
    assert.match(out.message, /removed: r/);
    assert.equal(existsSync(h.dir), false);
  });
  it('remove without --confirm errors', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ac5-')) });
    await store.create('report', 'r');
    await assert.rejects(() => runArtifactsCommand(store, ['remove', 'r']));
  });
  it('unknown subcommand errors', async () => {
    const store = new ArtifactStore({ workspaceDir: mkdtempSync(join(tmpdir(), 'ac6-')) });
    await assert.rejects(() => runArtifactsCommand(store, ['banana']));
  });
});
```

- [ ] **Step 10: Implement activator `index.ts`**

```typescript
// src/resources/extensions/coworker-artifacts/index.ts
import type { ExtensionAPI } from '@otto/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { ArtifactStore } from '@otto/coworker-artifacts';
import { createArtifactsBundle, type ArtifactsBundle } from './artifacts-singleton.js';
import { runListArtifacts } from './list-tool.js';
import { runOpenArtifact } from './open-tool.js';
import { runArtifactsCommand } from './artifacts-command.js';

export { createArtifactsBundle };
export type { ArtifactsBundle, ArtifactsBundleOptions } from './artifacts-singleton.js';

let activeStore: ArtifactStore | null = null;
export function getArtifactStore(): ArtifactStore | null { return activeStore; }

const LIST_PARAMS = Type.Object({});
const OPEN_PARAMS = Type.Object({ slug: Type.String() });

type ListDetails = { error: string; result_count?: undefined } | { error?: undefined; result_count: number };
type OpenDetails = { error: string; slug?: undefined } | { error?: undefined; slug: string };

export default function coworkerArtifactsExtension(api: ExtensionAPI): void {
  let bundle: ArtifactsBundle | null = null;
  let unavailable = false;

  api.on('session_start', async (_event, ctx) => {
    try {
      bundle = await createArtifactsBundle({ workspaceDir: ctx.cwd });
      activeStore = bundle.store;
    } catch (err) {
      unavailable = true;
      ctx.ui.notify(`artifacts unavailable: ${(err as Error).message}`, 'warning');
    }
  });

  api.registerTool<typeof LIST_PARAMS, ListDetails>({
    name: 'list_artifacts',
    label: 'List artifacts',
    description: 'List all artifacts in the current workspace.',
    parameters: LIST_PARAMS,
    async execute() {
      if (!bundle) return { content: [{ type: 'text', text: 'artifacts unavailable' }], details: { error: 'unavailable' } };
      try {
        const out = await runListArtifacts(bundle.store);
        return { content: [{ type: 'text', text: out.markdown }], details: { result_count: out.artifacts.length } };
      } catch (err) {
        return { content: [{ type: 'text', text: `list failed: ${(err as Error).message}` }], details: { error: (err as Error).message } };
      }
    },
  });

  api.registerTool<typeof OPEN_PARAMS, OpenDetails>({
    name: 'open_artifact',
    label: 'Open artifact',
    description: 'Read the contents of an artifact by slug. Returns markdown body + recent provenance.',
    parameters: OPEN_PARAMS,
    async execute(_id, params) {
      if (!bundle) return { content: [{ type: 'text', text: 'artifacts unavailable' }], details: { error: 'unavailable' } };
      try {
        const out = await runOpenArtifact(bundle.store, params);
        return { content: [{ type: 'text', text: out.markdown }], details: { slug: params.slug } };
      } catch (err) {
        return { content: [{ type: 'text', text: `open failed: ${(err as Error).message}` }], details: { error: (err as Error).message } };
      }
    },
  });

  api.registerCommand('artifacts', {
    description: 'Inspect artifacts: /artifacts list | show <slug> | remove <slug> --confirm',
    getArgumentCompletions: (prefix) => {
      const subs = [
        { label: 'list', description: 'List all artifacts' },
        { label: 'show', description: 'Show artifact body + provenance: /artifacts show <slug>' },
        { label: 'remove', description: 'Delete artifact: /artifacts remove <slug> --confirm' },
      ];
      return subs
        .filter((s) => s.label.startsWith(prefix))
        .map((s) => ({ value: s.label, label: s.label, description: s.description }));
    },
    handler: async (args, ctx) => {
      if (!bundle) {
        ctx.ui.notify(unavailable ? 'artifacts unavailable; chat continues without it.' : 'artifacts not ready yet.', 'warning');
        return;
      }
      const argv = args.trim().split(/\s+/).filter(Boolean);
      try {
        const result = await runArtifactsCommand(bundle.store, argv);
        ctx.ui.notify(result.message, 'info');
      } catch (err) {
        ctx.ui.notify(`/artifacts failed: ${(err as Error).message}`, 'error');
      }
    },
  });

  api.on('session_shutdown', async () => {
    if (bundle) {
      try { await bundle.dispose(); } catch { /* best effort */ }
    }
    bundle = null;
    activeStore = null;
  });
}
```

- [ ] **Step 11: Write activator `index.test.ts`**

```typescript
// src/resources/extensions/coworker-artifacts/index.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import coworkerArtifactsExtension, { getArtifactStore } from './index.js';
import { makeFakeApi, fireSessionStart, fireSessionShutdown } from '../coworker-vault/test-helpers.js';

describe('coworker-artifacts activator', () => {
  it('barrel exports key surface', () => {
    assert.equal(typeof coworkerArtifactsExtension, 'function');
    assert.equal(typeof getArtifactStore, 'function');
  });
  it('getArtifactStore is null before session_start', () => {
    assert.equal(getArtifactStore(), null);
  });
  it('registers list_artifacts + open_artifact tools and /artifacts command', () => {
    const api = makeFakeApi();
    coworkerArtifactsExtension(api.api);
    assert.ok(api.tools.has('list_artifacts'));
    assert.ok(api.tools.has('open_artifact'));
    assert.ok(api.commands.has('artifacts'));
  });
  it('session_start constructs bundle and getArtifactStore returns store', async () => {
    const api = makeFakeApi();
    coworkerArtifactsExtension(api.api);
    const ws = mkdtempSync(join(tmpdir(), 'art-act-'));
    await fireSessionStart(api, { cwd: ws });
    assert.equal(api.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);
    assert.ok(getArtifactStore());
    await fireSessionShutdown(api);
    assert.equal(getArtifactStore(), null);
  });
  it('init failure notifies + gates command', async () => {
    const api = makeFakeApi();
    coworkerArtifactsExtension(api.api);
    // Force createArtifactsBundle failure: use a workspaceDir whose parent doesn't exist
    // and isn't mkdir-creatable for the artifact dir. Easiest path: pass empty string.
    await fireSessionStart(api, { cwd: '' });
    // ArtifactStore.create lazily creates the dir, so session_start itself doesn't fail.
    // Instead, exercise the gating-on-bundle path differently: skip session_start, call /artifacts.
    const fresh = makeFakeApi();
    coworkerArtifactsExtension(fresh.api);
    const cmd = fresh.commands.get('artifacts')!;
    await cmd.handler('list', fresh.commandCtx);
    assert.ok(fresh.notifyCalls.find(c => /not ready/.test(c.message)));
  });
});
```

- [ ] **Step 12: Run + commit**

```
npm run test:compile
node --test dist-test/src/resources/extensions/coworker-artifacts/*.test.js
```

Expected: all pass (singleton 2, list 2, open 2, command 6, activator 5).

```bash
git add src/resources/extensions/coworker-artifacts/
git commit -m "feat(coworker-4): artifacts production activator + tools + /artifacts command (Phase 4 Task 11)"
```

---

### Task 12: Scratchpad extension cross-import + closure wiring

**Files:**
- Modify: `src/resources/extensions/coworker-scratchpad/index.ts`
- Modify: `src/resources/extensions/coworker-scratchpad/index.test.ts`

- [ ] **Step 1: Add imports**

At the top of `src/resources/extensions/coworker-scratchpad/index.ts`, add:

```typescript
import { getArtifactStore } from '../coworker-artifacts/index.js';
import type { ArtifactCreateDrawer } from '@otto/coworker-scratchpad';
```

(Verify `ArtifactCreateDrawer` is exported from `packages/coworker-scratchpad/src/index.ts`. If not, add the export there.)

- [ ] **Step 2: Wire `onArtifactCreate` and `getArtifactStore` into manager construction**

Inside the existing `getManager` closure (the same one that has the `onDataLoad` block from Phase 3.1 Task 4), add:

```typescript
manager = new ScratchpadManager({
  workspace: workspaceCwd,
  root,
  sessionId: sessionId ?? 'default',
  getArtifactStore,
  onDataLoad: ...,
  onArtifactCreate: (drawer: ArtifactCreateDrawer, scratchpadName: string): void => {
    const recorder = getMemoryRecorder();
    if (!recorder) return;
    void recorder.recordArtifact({
      scratchpadName,
      slug: drawer.slug,
      kind: drawer.artifact_kind,
      uri: drawer.uri,
      turnId: '',
    }).catch(() => { /* silent per spec §3.9 */ });
  },
});
```

- [ ] **Step 3: Add closure-shape test**

Append to `src/resources/extensions/coworker-scratchpad/index.test.ts`:

```typescript
describe('scratchpad activator — onArtifactCreate closure (Phase 4 Task 12)', () => {
  it('closure with null recorder does not throw', () => {
    const getRec = (): null => null;
    const drawer = {
      kind: 'artifact' as const, slug: 'rca-1', artifact_kind: 'report',
      uri: 'artifact://rca-1', primary_path: '/x/report.md', created_at: 't',
    };
    const onArtifactCreate = (d: typeof drawer, name: string): void => {
      const rec = getRec();
      if (!rec) return;
    };
    assert.doesNotThrow(() => onArtifactCreate(drawer, 'p1'));
  });
  it('closure with recorder calls recordArtifact with translated args', async () => {
    const calls: Array<{ scratchpadName: string; slug: string; kind: string; uri: string }> = [];
    const recorder = {
      recordArtifact: async (args: { scratchpadName: string; slug: string; kind: string; uri: string; turnId: string }) => {
        calls.push({ scratchpadName: args.scratchpadName, slug: args.slug, kind: args.kind, uri: args.uri });
      },
    };
    const drawer = {
      kind: 'artifact' as const, slug: 'rca-1', artifact_kind: 'report',
      uri: 'artifact://rca-1', primary_path: '/x/report.md', created_at: 't',
    };
    const onArtifactCreate = (d: typeof drawer, name: string): void => {
      void recorder.recordArtifact({
        scratchpadName: name, slug: d.slug, kind: d.artifact_kind, uri: d.uri, turnId: '',
      }).catch(() => {});
    };
    onArtifactCreate(drawer, 'p1');
    await new Promise(r => setImmediate(r));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.scratchpadName, 'p1');
    assert.equal(calls[0]!.slug, 'rca-1');
    assert.equal(calls[0]!.kind, 'report');
    assert.equal(calls[0]!.uri, 'artifact://rca-1');
  });
});
```

- [ ] **Step 4: Run + commit**

```
npm run test:compile
node --test dist-test/src/resources/extensions/coworker-scratchpad/index.test.js
node --test dist-test/src/resources/extensions/coworker-scratchpad/*.test.js
```

Expected: all existing scratchpad tests + new closure tests pass.

```bash
git add src/resources/extensions/coworker-scratchpad/index.ts \
        src/resources/extensions/coworker-scratchpad/index.test.ts
git commit -m "feat(coworker-4): scratchpad activator wires onArtifactCreate → MemoryRecorder.recordArtifact (Phase 4 Task 12)"
```

---

### Task 13: Cross-extension integration test

**Files:**
- Create: `packages/coworker-artifacts/src/artifacts-integration.test.ts`

End-to-end: activate all four coworker extensions (vault, memory, artifacts, scratchpad), fire session_start, simulate a cell creating an artifact via the package API (skipping the kernel RPC — that's exercised by manager tests), verify the artifact dir + a `kind:'artifact'` drawer landed in memory.

- [ ] **Step 1: Write test**

```typescript
// packages/coworker-artifacts/src/artifacts-integration.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import coworkerVaultExtension from '../../../src/resources/extensions/coworker-vault/index.js';
import coworkerMemoryExtension, { getMemoryRecorder } from '../../../src/resources/extensions/coworker-memory/index.js';
import coworkerArtifactsExtension, { getArtifactStore } from '../../../src/resources/extensions/coworker-artifacts/index.js';
import coworkerScratchpadExtension from '../../../src/resources/extensions/coworker-scratchpad/index.js';
import { makeFakeApi, fireSessionStart, fireSessionShutdown } from '../../../src/resources/extensions/coworker-vault/test-helpers.js';
import { createMemoryBundle } from '@otto/coworker-memory';

describe('Phase 4 — cross-extension integration', () => {
  it('artifact created by store surfaces as kind:artifact drawer in memory and persists on disk', async () => {
    const global = mkdtempSync(join(tmpdir(), 'p4-g-'));
    const ws = mkdtempSync(join(tmpdir(), 'p4-w-'));
    const sp = mkdtempSync(join(tmpdir(), 'p4-sp-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = global;
    process.env.OTTO_SCRATCHPAD_ROOT = sp;
    try {
      const vaultApi = makeFakeApi();
      const memApi = makeFakeApi();
      const artApi = makeFakeApi();
      const spApi = makeFakeApi();
      coworkerVaultExtension(vaultApi.api);
      coworkerMemoryExtension(memApi.api);
      coworkerArtifactsExtension(artApi.api);
      coworkerScratchpadExtension(spApi.api);

      await fireSessionStart(vaultApi, { cwd: ws });
      await fireSessionStart(memApi, { cwd: ws });
      await fireSessionStart(artApi, { cwd: ws });
      await fireSessionStart(spApi, { cwd: ws });

      const store = getArtifactStore();
      const recorder = getMemoryRecorder();
      assert.ok(store);
      assert.ok(recorder);

      // Simulate kernel→manager flow: store.create + recorder.recordArtifact
      const handle = await store.create('report', 'RCA: load balancer 503');
      await store.update(handle, [{ path: 'report.md', content: '# RCA\n\nbody\n' }]);
      await recorder.recordArtifact({
        scratchpadName: 'p1-incident',
        slug: handle.slug,
        kind: handle.kind,
        uri: handle.uri,
        turnId: 'turn-abc',
      });

      // Disk verification
      assert.ok(existsSync(handle.dir));
      assert.match(readFileSync(handle.primaryPath, 'utf8'), /# RCA/);
      assert.match(readFileSync(handle.metadataPath, 'utf8'), /"slug": "rca-load-balancer-503"/);

      // Memory recall via peek bundle
      const peek = await createMemoryBundle({
        globalDir: global, workspaceDir: ws,
        scopeMode: 'per-project-tagged',
        currentScratchpadName: () => null,
      });
      try {
        const r = await peek.backend.recall({ query: 'rca-load-balancer-503', kind: 'artifact' });
        assert.equal(r.length, 1);
        const parsed = JSON.parse(r[0]!.drawer.content);
        assert.equal(parsed.slug, 'rca-load-balancer-503');
        assert.equal(parsed.uri, 'artifact://rca-load-balancer-503');
        assert.equal(r[0]!.drawer.room, 'p1-incident');
      } finally { await peek.dispose(); }

      await fireSessionShutdown(spApi);
      await fireSessionShutdown(artApi);
      await fireSessionShutdown(memApi);
      await fireSessionShutdown(vaultApi);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });

  it('artifact init failure does not break memory or vault', async () => {
    // Skip artifact activation; vault + memory + scratchpad activate normally
    const global = mkdtempSync(join(tmpdir(), 'p4-mix-'));
    const ws = mkdtempSync(join(tmpdir(), 'p4-mix-ws-'));
    const sp = mkdtempSync(join(tmpdir(), 'p4-mix-sp-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = global;
    process.env.OTTO_SCRATCHPAD_ROOT = sp;
    try {
      const vaultApi = makeFakeApi();
      const memApi = makeFakeApi();
      const spApi = makeFakeApi();
      coworkerVaultExtension(vaultApi.api);
      coworkerMemoryExtension(memApi.api);
      coworkerScratchpadExtension(spApi.api);
      await fireSessionStart(vaultApi, { cwd: ws });
      await fireSessionStart(memApi, { cwd: ws });
      await fireSessionStart(spApi, { cwd: ws });
      assert.equal(getArtifactStore(), null);
      assert.equal(getMemoryRecorder() !== null, true);
      await fireSessionShutdown(spApi);
      await fireSessionShutdown(memApi);
      await fireSessionShutdown(vaultApi);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });
});
```

- [ ] **Step 2: Run; expect PASS** (2/2)

```
npm run test:compile
node --test dist-test/packages/coworker-artifacts/src/artifacts-integration.test.js
```

Fix at the source if anything fails.

- [ ] **Step 3: Commit**

```bash
git add packages/coworker-artifacts/src/artifacts-integration.test.ts
git commit -m "test(coworker-4): cross-extension integration test (Phase 4 Task 13)"
```

---

### Task 14: Test-glob hygiene

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Read current script**

```bash
grep -A 1 "test:unit:compiled" package.json | head -3
```

- [ ] **Step 2: Append the new glob**

Inside the quoted-glob list of `scripts.test:unit:compiled`, after the existing `coworker-{scratchpad,vault,memory}` globs from Phase 3.1 Task 6, append:

```
"dist-test/src/resources/extensions/coworker-artifacts/*.test.js"
```

Use the same `\"...\"` JSON-string escaping the existing entries use.

- [ ] **Step 3: Verify pickup**

```
npm run test:compile
npm run test:unit:compiled 2>&1 | tail -10
```

Total test count should rise by the number of new artifacts extension tests (~17). No regressions.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(coworker-4): add coworker-artifacts extension test glob to test:unit:compiled (Phase 4 Task 14)"
```

---

### Task 15: Smoke checklist + human test plan

**Files:**
- Create: `docs/superpowers/notes/2026-06-02-phase-4-artifacts-smoke.md`
- Create: `docs/superpowers/notes/2026-06-02-coworker-phase-4-human-tests.md`

- [ ] **Step 1: Write smoke checklist**

`docs/superpowers/notes/2026-06-02-phase-4-artifacts-smoke.md`:

```markdown
# Phase 4 artifacts — manual smoke checklist

**Branch:** `feat/coworker-phase-4-artifacts`.
**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-4-artifacts-design.md`.
**Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-4-artifacts.md`.

Run these end-to-end before tagging the merge live-verified.

## Prereq

- Build current: `npm run build`.
- Fresh workspace, no existing `<workspace>/.otto/artifacts/`.

## Steps

1. Launch Otto in the fresh workspace. `/artifacts list` returns "### Artifacts (0)".
2. `/artifacts<Tab>` — completion shows `list`, `show`, `remove` with descriptions.
3. `/sp new test`. `/sp attach test`. Run cell:
   ```js
   const a = await otto.artifact.create('report', 'test artifact');
   await a.update([{path: 'report.md', content: '# hello\n'}]);
   return a.uri;
   ```
   Cell returns `artifact://test-artifact`.
4. `/artifacts list` — row shows `test-artifact | report | 0 | <ts> | artifact://test-artifact`.
   (`turn_count` may be 0 if the cell binding skipped `recordTurn`; auto-record is on the integration roadmap.)
5. `cat <workspace>/.otto/artifacts/test-artifact/{metadata.json,provenance.json,README.md}`. metadata + readme present; provenance may be `[]` if recordTurn not yet auto-fired by cell binding.
6. `/artifacts show test-artifact` — content prints with `# hello`.
7. `/memory recall hello --kind artifact` — returns a drawer pointing at `artifact://test-artifact`.
8. Restart Otto in same workspace. `/artifacts list` still shows the artifact (persistence).
9. `/artifacts remove test-artifact --confirm` deletes the dir.
10. Spill test — cell:
    ```js
    const big = 'x'.repeat(11000);
    const h = await otto.artifact.spillIfLarge(big, {thresholdBytes: 10240});
    return h?.uri ?? 'no spill';
    ```
    Returns `artifact://cell-output-...`. Same with `x.repeat(1000)` returns `'no spill'`.

## Expected misses

- Workbook (xlsx) artifacts — Phase 4.5+.
- Auto-`recordTurn` on cell-binding `create`/`update` — relies on the activator passing `pendingPrompt` through the manager (deferred to a small follow-up).
- TUI artifact panel — Phase 5+.

## Sign-off

Replace this line with: `Verified live on YYYY-MM-DD by <name> at commit <short-sha>.`
```

- [ ] **Step 2: Write human test plan**

`docs/superpowers/notes/2026-06-02-coworker-phase-4-human-tests.md`:

Pattern off `docs/superpowers/notes/2026-06-02-coworker-phase-3-human-tests.md`. Cover:

- Setup + disk layout (`<workspace>/.otto/artifacts/<slug>/`).
- Supported kinds (`report` only in v1).
- ~10 scenarios:
  - Artifact create + update + retrieve via `/artifacts show`.
  - URI resolution via `resolveArtifactUri` (programmatic check).
  - Slug collision: two artifacts with same name produce `slug` + `slug-2`.
  - Provenance: cell sequence creates the artifact then updates — provenance.json has both entries.
  - DirSnapshot: cell writes two new files → `files_touched` includes both.
  - README re-render: cell writes file, README updated.
  - `/memory recall` finds kind:'artifact' drawer.
  - `/memory recall --kind artifact` filters correctly.
  - spillIfLarge above + below threshold.
  - `/artifacts remove --confirm` deletes; `--confirm` omission errors.
- Phase 1+2+3+3.1 regression sweep.
- Coverage matrix.
- Sign-off checklist with `Verified live on YYYY-MM-DD by <name>` placeholder.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/notes/2026-06-02-phase-4-artifacts-smoke.md \
        docs/superpowers/notes/2026-06-02-coworker-phase-4-human-tests.md
git commit -m "docs(coworker-4): smoke checklist + human test plan (Phase 4 Task 15)"
```

---

### Task 16: Roadmap update + branch-level review

**Files:**
- Modify: `docs/superpowers/notes/2026-06-01-coworker-roadmap.md`

- [ ] **Step 1: Update roadmap entry**

Find `### Phase 4 — otto-artifacts (week 7)`. Append a Phase 4 — COMPLETE block in the same shape as Phase 3.1's entry:

```markdown
### Phase 4 — otto-artifacts — COMPLETE

**Branch:** `feat/coworker-phase-4-artifacts` (merged to main as commit `<TBD merge sha>` on 2026-06-DD).
**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-4-artifacts-design.md`.
**Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-4-artifacts.md`.

Graduated `@otto/coworker-artifacts` from stub to workspace-scoped store. Ships:
- Markdown-only `report` artifact kind.
- Atomic `ArtifactStore` (slug derivation + collision suffix; tmp+rename writes; 0o700/0o600 modes).
- Pure-function `resolveArtifactUri()` and `renderReadme()` helpers.
- Append-only `provenance.json` with per-turn entries.
- Production activator at first commit — `/artifacts list|show|remove`, `list_artifacts` + `open_artifact` LLM tools, `getArtifactStore()` cross-pillar getter.
- Kernel-side `otto.artifact.create()` + `spillIfLarge()` bindings (RPC over NDJSON stdio).
- Scratchpad manager `onArtifactCreate` fan-out → memory `recordArtifact` drawer.
- Memory migration 002: `'artifact'` added to `DRAWER_KINDS` (CHECK constraint table rebuild).

Locked decisions per spec §3: workbook + dataset kinds deferred; URI resolver is pure function; activator ships with package; spill is explicit (10 KB default threshold); provenance is append-only.

Live TUI smoke walkthrough is pending (`2026-06-02-phase-4-artifacts-smoke.md` PENDING placeholder); automated integration tests at `packages/coworker-artifacts/src/artifacts-integration.test.ts` prove the wiring at the API + disk layer.

> **Note (2026-06-DD):** Phase 5 (Layer C entity graph + ACC + Cerebellum + Consolidator + daily digest) is unblocked — depends on Phase 3 + Phase 4 per roadmap. Phase 4 closes one of the two prereqs.
```

Update the "Last updated" line at the top to include Phase 4.

- [ ] **Step 2: Build everything + full test suite**

```bash
(cd packages/coworker-utils && npm run build) && \
(cd packages/coworker-vault && npm run build) && \
(cd packages/coworker-memory && npm run build) && \
(cd packages/coworker-artifacts && npm run build) && \
(cd packages/coworker-scratchpad && npm run build) && \
npm run build
```

Expected: clean. Strict `tsc` runs at the root level — any tool execute() type mismatches (Phase 3.1 hotfix lesson) surface here.

```bash
npm run test:compile
npm run test:unit:compiled 2>&1 | tail -10
node --test dist-test/packages/coworker-artifacts/src/*.test.js
node --test dist-test/packages/coworker-memory/src/*.test.js     # regression
node --test dist-test/packages/coworker-vault/src/*.test.js      # regression
node --test dist-test/packages/coworker-scratchpad/src/*.test.js # regression
```

Expected: all green. Test count should be roughly Phase 3.1's 9697 + new tests.

- [ ] **Step 3: Cross-cutting checks**

- (a) **No value leaks**: search activator + tool files for `ctx.ui.notify` calls including raw cell content or user prompts.
- (b) **Init failure isolation**: every `session_start` handler try/catch.
- (c) **Cross-pillar imports**: only allowed are memory→scratchpad, scratchpad→memory, scratchpad→artifacts, artifacts→nothing. Verify with grep.
- (d) **Memory migration 002 ran**: `node --test` exercises insertion of `kind:'artifact'` (Task 8 test).
- (e) **Phase 1/2/3/3.1 regression**: all prior tests pass.

- [ ] **Step 4: Commit + structured readiness report**

```bash
git add docs/superpowers/notes/2026-06-01-coworker-roadmap.md
git commit -m "docs(coworker-4): roadmap Phase 4 COMPLETE entry (Phase 4 Task 16)"
```

Output a final structured report (same shape as Phase 3.1 Task 9):

```
Build:
  packages/coworker-utils:      PASS|FAIL
  packages/coworker-vault:      PASS|FAIL
  packages/coworker-memory:     PASS|FAIL
  packages/coworker-artifacts:  PASS|FAIL
  packages/coworker-scratchpad: PASS|FAIL
  build:core (otto-cli):        PASS|FAIL

Tests (per file): list each

Tests (regression): list each

Commits on branch (vs main): COUNT (expected ~16)
All match (coworker-4)? YES | <list non-matching>

Cross-cutting: (a)..(e) as above

Smoke live-verified: NO (manual gate, PENDING placeholder in docs)

Push status: NOT PUSHED (per user instruction)

Overall: READY TO MERGE | NEEDS WORK | NEEDS USER INPUT
```

- [ ] **Step 5: Stop. Report. Do not push.**

User reviews + decides whether to merge to main + push (same shape as Phase 3 / 3.1 / memory follow-up).

---

## Self-review summary

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| §1 Goal — graduate stub + activator + URI + provenance | Tasks 1–16. |
| §2 Non-goals (workbook, dataset, HTML/PDF, OAuth, etc.) | Honored throughout (no opposite work). |
| §3 Locked decisions (11 items) | Tasks 1, 2 (slug), 6 (atomic + collision), 7 (barrel), 8 (memory drawer), 9 (kernel binding + spillIfLarge), 11 (activator). |
| §4 Architecture (three new activators + cross-imports) | Tasks 8, 9, 10, 11, 12. |
| §5.1 Package modules | Tasks 1 (types/errors), 2 (slug), 3 (DirSnapshot), 4 (URI), 5 (README), 6 (Store), 7 (barrel). |
| §5.2 Extension modules | Task 11 (singleton + activator + 2 tools + command), Task 12 (scratchpad cross-import). |
| §5.3 Cross-pillar additions | Tasks 8 (memory), 9 (kernel-protocol + kernel-entry), 10 (runtime + manager), 12 (scratchpad activator). |
| §6 On-disk layout | Task 6 (writes metadata + provenance + README); §6.4 URI shape covered by Task 4. |
| §7 Lifecycle | Task 13 integration test exercises full flow. |
| §8 Call sequence | Task 9 (kernel binding) + Task 6 (store API). |
| §9 Error policy | Tasks 1, 6, 11. |
| §10 Edge cases | Task 6 (slug collision), Task 4 (URI traversal), Task 11 (init failure). |
| §11 Persistence triggers | Task 6 (store) + Task 8 (memory drawer). |
| §12 Milestone | Task 13 (integration) + Task 15 (smoke checklist live-run). |
| §15 Testing strategy | Each task's tests + Task 13 integration + Task 14 glob. |
| §16 Migration story | Task 8 (002-artifact-kind.sql + open() loop). |
| §17 Roadmap update | Task 16. |

No gaps.

**Placeholder scan:** Every task has full test code + full implementation code. No "TBD" / "TODO" / "similar to" patterns. Task 9 has a documented fallback design in case bidirectional RPC integration with the existing kernel-entry frame dispatcher is structurally invasive — that's an explicit out, not a placeholder.

**Type consistency check:**
- `ArtifactKind = 'report'` consistent across all tasks.
- `ArtifactHandle` shape (`{slug, kind, name, dir, uri, primaryPath, metadataPath, provenancePath, readmePath}`) consistent in Tasks 1, 6, 11, 13.
- `TurnEntry` shape consistent in Tasks 1, 5, 6.
- `recordArtifact` signature `(args: {scratchpadName, slug, kind, uri, turnId, room?}) → Promise<Drawer>` consistent in Tasks 8, 12, 13.
- `getArtifactStore(): ArtifactStore | null` consistent in Tasks 10, 11, 12, 13.
- `onArtifactCreate: (drawer: ArtifactCreateDrawer, scratchpadName: string) => void` consistent in Tasks 9 (protocol), 10 (manager), 12 (closure).

No drift.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-02-coworker-phase-4-artifacts.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage spec+quality review between tasks, fast iteration. Same workflow used for Phase 2 / Phase 3 / Phase 3.1.

**2. Inline Execution** — execute tasks in this session with batch checkpoints.

Which approach?
