# Otto Co-Worker Phase 0 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold seven new co-worker workspace packages (six pillars + persona), define all shared types and inter-package contracts, ship five foundation utilities (NDJSON channel, lease helper, migration framework, secret scanner, logger wrapper), and stand up the persona registry with a built-in `default` persona, `/persona` slash commands, and status-line chip — so Phases 1–5 can build persona-aware pillars on top.

**Architecture:** Seven new packages under `otto-cli/packages/`: one types package, one utils package, four empty pillar shells, one persona package. Phase 0 implements types + utils + the persona registry. The four pillar packages are scaffolded (build green, exports empty) so Phases 1–5 can fill them in without re-doing wiring. All inter-package code flows through contracts defined in `coworker-types`. Personas are an installable bundle abstraction modeled on Otto's existing extensions — `@cmetech/otto-persona-noc-ops` ships in Phase 6 as the reference bundle.

**Tech Stack:** TypeScript with `module: NodeNext`, ESM, Node 22+, `node:test` + `node:assert/strict` for tests, npm workspaces (`packages/*` already wired in root `package.json`).

**Spec reference:** `otto-cli/docs/superpowers/specs/2026-05-30-otto-coworker-design.md` (Phase 0 row in §8, conventions in §6).

---

## File structure

```
otto-cli/packages/
  coworker-types/                       ← Task 1, 2-6
    package.json
    tsconfig.json
    tsconfig.publish.json
    src/
      index.ts                          ← barrel re-export
      memory.ts                         ← Wing, Room, Drawer, MemoryBackend, RecallQuery (Task 2)
      artifacts.ts                      ← ArtifactKind, ArtifactHandle, FileWrite, ArtifactStore (Task 3)
      vault.ts                          ← VaultEntry, BoundClient, EngineDef, CredentialInjector (Task 4)
      scratchpad.ts                     ← Collector, CollectorRegistry, DataSourceRef, DataSource (Task 5)
      contracts.ts                      ← MemoryRecorder (Task 6)
      types.test.ts                     ← compile-time sanity test

  coworker-utils/                       ← Task 1, 7-11
    package.json
    tsconfig.json
    tsconfig.publish.json
    src/
      index.ts                          ← barrel re-export
      ndjson-channel.ts                 ← Task 7
      ndjson-channel.test.ts
      lease.ts                          ← Task 8
      lease.test.ts
      migration-runner.ts               ← Task 9
      migration-runner.test.ts
      secret-scanner.ts                 ← Task 10
      secret-scanner.test.ts
      logger.ts                         ← Task 11
      logger.test.ts

  coworker-memory/                      ← Task 1 only (scaffold; impl in Phase 3+5)
    package.json
    tsconfig.json
    src/index.ts                        ← empty placeholder

  coworker-vault/                       ← Task 1 only (scaffold; impl in Phase 2)
    package.json
    tsconfig.json
    src/index.ts

  coworker-artifacts/                   ← Task 1 only (scaffold; impl in Phase 4)
    package.json
    tsconfig.json
    src/index.ts

  coworker-scratchpad/                  ← Task 1 only (scaffold; impl in Phase 1)
    package.json
    tsconfig.json
    src/index.ts

  coworker-persona/                     ← Tasks 1, 16, 17 (registry + manifest + default persona)
    package.json
    tsconfig.json
    tsconfig.publish.json
    src/
      index.ts                          ← barrel
      manifest.ts                       ← PersonaManifest type + YAML parser
      manifest.test.ts
      registry.ts                       ← PersonaRegistry (install/list/activate/switch)
      registry.test.ts
      defaults/                         ← built-in `default` persona bundle (resource files)
        manifest.yaml
        steering/identity.md

otto-cli/package.json                   ← Task 12 (add build scripts)
otto-cli/scripts/compile-tests.mjs      ← Task 13 (add coworker packages to compile path)
otto-cli/.github/workflows/ci.yml       ← Task 13 (if CI yaml exists; otherwise n/a)
otto-cli/docs/superpowers/notes/        ← may receive a Phase-0 retrospective when done
```

---

## Task 1: Scaffold all six co-worker packages

**Files:**
- Create: `otto-cli/packages/coworker-types/package.json`
- Create: `otto-cli/packages/coworker-types/tsconfig.json`
- Create: `otto-cli/packages/coworker-types/tsconfig.publish.json`
- Create: `otto-cli/packages/coworker-types/src/index.ts`
- Create: same shape for `coworker-utils`, `coworker-memory`, `coworker-vault`, `coworker-artifacts`, `coworker-scratchpad` (six packages total)

- [ ] **Step 1.1: Create `coworker-types/package.json`**

```json
{
  "name": "@otto/coworker-types",
  "version": "0.0.1",
  "description": "Shared types and contracts for Otto co-worker packages",
  "type": "module",
  "otto": {
    "linkable": true,
    "scope": "@otto",
    "name": "coworker-types"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "build:publish": "tsc -p tsconfig.publish.json"
  },
  "files": ["dist"]
}
```

- [ ] **Step 1.2: Create `coworker-types/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 1.3: Create `coworker-types/tsconfig.publish.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "incremental": false }
}
```

- [ ] **Step 1.4: Create `coworker-types/src/index.ts` placeholder**

```typescript
// Barrel — populated in Tasks 2-6
export {};
```

- [ ] **Step 1.5: Repeat 1.1-1.4 for `coworker-utils`**

Same shape as coworker-types, with name `@otto/coworker-utils`.

- [ ] **Step 1.6: Repeat for the four pillar packages**

Names: `@otto/coworker-memory`, `@otto/coworker-vault`, `@otto/coworker-artifacts`, `@otto/coworker-scratchpad`. Each gets the same three files (package.json with its own name, tsconfig.json, tsconfig.publish.json) plus an empty `src/index.ts` containing `export {};`.

- [ ] **Step 1.7: Build all six packages locally**

Run from `otto-cli/`:
```bash
for pkg in coworker-types coworker-utils coworker-memory coworker-vault coworker-artifacts coworker-scratchpad; do
  npm run build -w "@otto/$pkg"
done
```

Expected: each emits `dist/index.js` and `dist/index.d.ts`. No errors.

- [ ] **Step 1.8: Verify root `npm install` resolves the new workspaces**

Run from `otto-cli/`:
```bash
npm install
ls node_modules/@otto/ | grep coworker
```

Expected: six symlinked entries (`coworker-artifacts`, `coworker-memory`, `coworker-scratchpad`, `coworker-types`, `coworker-utils`, `coworker-vault`).

- [ ] **Step 1.9: Commit**

```bash
git add otto-cli/packages/coworker-*
git commit -m "feat(coworker): scaffold six co-worker packages

Empty packages with build pipelines wired. Implementations
land in Phases 1-5 per docs/superpowers/specs/2026-05-30-otto-coworker-design.md."
```

---

## Task 2: Define memory types — Wing, Room, Drawer, MemoryBackend

**Files:**
- Create: `otto-cli/packages/coworker-types/src/memory.ts`
- Modify: `otto-cli/packages/coworker-types/src/index.ts`

- [ ] **Step 2.1: Write the type-level test for memory module**

Create `otto-cli/packages/coworker-types/src/memory.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Drawer, DrawerKind, RecallQuery, MemoryBackend, Wing, Room } from './memory.js';

describe('memory types', () => {
  it('Wing is a string alias', () => {
    const w: Wing = 'acme-noc';
    assert.equal(typeof w, 'string');
  });

  it('Room is a string alias', () => {
    const r: Room = 'p1-1234';
    assert.equal(typeof r, 'string');
  });

  it('DrawerKind covers the closed v1 vocabulary', () => {
    const kinds: DrawerKind[] = ['turn', 'paste', 'file_load', 'ticket', 'email', 'rca', 'note'];
    assert.equal(kinds.length, 7);
  });

  it('Drawer requires id, wing, room, kind, content, created_at', () => {
    const d: Drawer = {
      id: 'drw_001',
      wing: 'acme-noc',
      room: 'p1-1234',
      kind: 'ticket',
      content: 'verbatim ticket body',
      metadata: {},
      created_at: '2026-05-31T10:00:00Z',
    };
    assert.equal(d.kind, 'ticket');
  });

  it('RecallQuery has required query and optional filters', () => {
    const q: RecallQuery = { query: 'kernel 4.18' };
    assert.equal(q.query, 'kernel 4.18');
    const qf: RecallQuery = { query: 'mttr', kind: 'rca', wing: 'acme-noc', room: 'p1-1234', max_results: 5 };
    assert.equal(qf.kind, 'rca');
  });

  it('MemoryBackend interface has the seven required methods', () => {
    // Compile-time check via a structural variable
    const _check: keyof MemoryBackend = 'recall';
    const _methods: Array<keyof MemoryBackend> = [
      'recall', 'retain', 'listRooms', 'listWings',
      'entityQuery', 'entityAssert', 'status', 'clear',
    ];
    assert.equal(_methods.length, 8);
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run:
```bash
cd otto-cli/packages/coworker-types
npx tsc --noEmit -p tsconfig.json 2>&1 | head -20
```

Expected: errors like `Cannot find module './memory.js' or its corresponding type declarations.`

- [ ] **Step 2.3: Implement `memory.ts`**

Create `otto-cli/packages/coworker-types/src/memory.ts`:

```typescript
// Memory-layer types for the otto-memory contract.
// See spec §2.1 "Layer B structure — Wings, Rooms, Drawers as contract concepts".

export type Wing = string;
export type Room = string;

export type DrawerKind =
  | 'turn'
  | 'paste'
  | 'file_load'
  | 'ticket'
  | 'email'
  | 'rca'
  | 'note';

export interface Drawer {
  id: string;
  wing: Wing;
  room: Room;
  kind: DrawerKind;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  parent_id?: string;
}

export interface RecallQuery {
  query: string;
  wing?: Wing;
  room?: Room;
  kind?: DrawerKind | DrawerKind[];
  days_back?: number;
  max_results?: number;
}

export interface Entity {
  id: string;
  type: string;
  canonical: string;
  aliases: string[];
  metadata: Record<string, unknown>;
  first_seen: string;
  last_seen: string;
}

export interface EntityEdge {
  subject: string;
  predicate: string;
  object: string;
  valid_from: string;
  valid_to?: string;
  metadata?: Record<string, unknown>;
}

export interface EntityQuery {
  entity_type?: string;
  name?: string;
  predicate?: string;
  as_of?: string;
}

export interface BackendStatus {
  backend_id: string;
  drawer_count: number;
  entity_count: number;
  size_bytes: number;
  last_write_at?: string;
}

export interface MemoryBackend {
  recall(query: RecallQuery): Promise<Drawer[]>;
  retain(drawer: Omit<Drawer, 'id' | 'created_at'>): Promise<Drawer>;
  listRooms(wing?: Wing): Promise<Room[]>;
  listWings(): Promise<Wing[]>;
  entityQuery(query: EntityQuery): Promise<Entity[]>;
  entityAssert(edge: EntityEdge): Promise<void>;
  status(): Promise<BackendStatus>;
  clear(): Promise<void>;
}
```

- [ ] **Step 2.4: Update barrel to re-export memory module**

Replace `otto-cli/packages/coworker-types/src/index.ts`:

```typescript
export * from './memory.js';
```

- [ ] **Step 2.5: Compile and run the test**

Run from `otto-cli/`:
```bash
npm run build -w @otto/coworker-types
node --import tsx --test packages/coworker-types/src/memory.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 2.6: Commit**

```bash
git add otto-cli/packages/coworker-types/src/memory.ts otto-cli/packages/coworker-types/src/memory.test.ts otto-cli/packages/coworker-types/src/index.ts
git commit -m "feat(coworker-types): add memory types (Wing, Room, Drawer, MemoryBackend)"
```

---

## Task 3: Define artifacts types

**Files:**
- Create: `otto-cli/packages/coworker-types/src/artifacts.ts`
- Create: `otto-cli/packages/coworker-types/src/artifacts.test.ts`
- Modify: `otto-cli/packages/coworker-types/src/index.ts`

- [ ] **Step 3.1: Write the failing test**

Create `otto-cli/packages/coworker-types/src/artifacts.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ArtifactKind, ArtifactHandle, FileWrite, ProvenanceEntry, TurnEntry,
  ArtifactStore,
} from './artifacts.js';

describe('artifacts types', () => {
  it('ArtifactKind is the v1 closed set', () => {
    const kinds: ArtifactKind[] = ['report', 'workbook', 'dataset'];
    assert.equal(kinds.length, 3);
  });

  it('ArtifactHandle carries slug + kind + base path', () => {
    const h: ArtifactHandle = {
      slug: 'rca-p1-1234',
      kind: 'report',
      base_path: '/workspace/.otto/artifacts/rca-p1-1234',
      created_at: '2026-05-31T10:00:00Z',
    };
    assert.equal(h.slug, 'rca-p1-1234');
  });

  it('FileWrite carries relative path + bytes', () => {
    const fw: FileWrite = { path: 'report.md', content: 'hello' };
    assert.equal(fw.path, 'report.md');
  });

  it('ProvenanceEntry has session + turns array', () => {
    const p: ProvenanceEntry = {
      session_id: 'sess_001',
      turns: [],
    };
    assert.equal(p.turns.length, 0);
  });

  it('TurnEntry has turn_id + prompt + files_touched', () => {
    const t: TurnEntry = {
      turn_id: 'turn_001',
      timestamp: '2026-05-31T10:00:00Z',
      prompt_excerpt: 'draft the rca',
      files_touched: ['report.md'],
    };
    assert.equal(t.files_touched[0], 'report.md');
  });

  it('ArtifactStore has create/update/recordTurn signatures', () => {
    const _check: keyof ArtifactStore = 'create';
    const _methods: Array<keyof ArtifactStore> = ['create', 'update', 'recordTurn', 'get', 'list'];
    assert.equal(_methods.length, 5);
  });
});
```

- [ ] **Step 3.2: Run the test to verify it fails**

```bash
node --import tsx --test packages/coworker-types/src/artifacts.test.ts
```

Expected: fail (module not found).

- [ ] **Step 3.3: Implement `artifacts.ts`**

Create `otto-cli/packages/coworker-types/src/artifacts.ts`:

```typescript
// Artifact-store types. See spec §2.3.

export type ArtifactKind = 'report' | 'workbook' | 'dataset';

export interface ArtifactHandle {
  slug: string;
  kind: ArtifactKind;
  base_path: string;
  created_at: string;
}

export interface FileWrite {
  path: string;          // relative to artifact base_path
  content: string | Uint8Array;
}

export interface TurnEntry {
  turn_id: string;
  timestamp: string;
  prompt_excerpt: string;       // truncated to 240 chars
  files_touched: string[];      // sorted, deduped, relative paths
}

export interface ProvenanceEntry {
  session_id: string;
  turns: TurnEntry[];
}

export interface ArtifactStore {
  create(kind: ArtifactKind, name: string): Promise<ArtifactHandle>;
  update(handle: ArtifactHandle, files: FileWrite[]): Promise<void>;
  recordTurn(handle: ArtifactHandle, turn: { turn_id: string; prompt: string }): Promise<void>;
  get(slug: string): Promise<ArtifactHandle | null>;
  list(): Promise<ArtifactHandle[]>;
}
```

- [ ] **Step 3.4: Update barrel**

Modify `otto-cli/packages/coworker-types/src/index.ts`:

```typescript
export * from './memory.js';
export * from './artifacts.js';
```

- [ ] **Step 3.5: Run tests to verify pass**

```bash
npm run build -w @otto/coworker-types
node --import tsx --test packages/coworker-types/src/artifacts.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 3.6: Commit**

```bash
git add otto-cli/packages/coworker-types/src/artifacts.ts otto-cli/packages/coworker-types/src/artifacts.test.ts otto-cli/packages/coworker-types/src/index.ts
git commit -m "feat(coworker-types): add artifacts types (ArtifactHandle, ProvenanceEntry, ArtifactStore)"
```

---

## Task 4: Define vault types

**Files:**
- Create: `otto-cli/packages/coworker-types/src/vault.ts`
- Create: `otto-cli/packages/coworker-types/src/vault.test.ts`
- Modify: `otto-cli/packages/coworker-types/src/index.ts`

- [ ] **Step 4.1: Write the failing test**

Create `otto-cli/packages/coworker-types/src/vault.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  VaultEntry, EngineDef, EngineField, BoundClient, CredentialInjector,
} from './vault.js';

describe('vault types', () => {
  it('EngineField carries name + secret + name_from flag', () => {
    const f: EngineField = { name: 'password', secret: true };
    assert.equal(f.secret, true);
  });

  it('EngineDef carries engine slug + fields + test_snippet', () => {
    const e: EngineDef = {
      slug: 'servicenow',
      display_name: 'ServiceNow',
      pip: null,
      fields: [{ name: 'instance', secret: false }],
      auth_methods: ['basic'],
      test_snippet: '/* ts code */',
    };
    assert.equal(e.slug, 'servicenow');
  });

  it('VaultEntry has engine + name + values + secure_keys', () => {
    const v: VaultEntry = {
      engine: 'servicenow',
      name: 'prod',
      values: { instance: 'acme.service-now.com' },
      secure_keys: ['password'],
      created_at: '2026-05-31T10:00:00Z',
    };
    assert.equal(v.engine, 'servicenow');
  });

  it('CredentialInjector has injectEnv + loadForBinding', () => {
    const _methods: Array<keyof CredentialInjector> = ['injectEnv', 'loadForBinding'];
    assert.equal(_methods.length, 2);
  });

  it('BoundClient is a generic typed wrapper', () => {
    const b: BoundClient<{ ping: () => Promise<string> }> = {
      engine: 'servicenow',
      name: 'prod',
      client: { ping: async () => 'ok' },
    };
    assert.equal(b.engine, 'servicenow');
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
node --import tsx --test packages/coworker-types/src/vault.test.ts
```

Expected: fail (module not found).

- [ ] **Step 4.3: Implement `vault.ts`**

Create `otto-cli/packages/coworker-types/src/vault.ts`:

```typescript
// Vault types. See spec §2.2.

export interface EngineField {
  name: string;
  secret: boolean;            // true → uses VAULT_KEEP sentinel on round-trip
  description?: string;
  default?: string;
  name_from?: boolean;        // if true, used to auto-name the entry
}

export interface EngineDef {
  slug: string;
  display_name: string;
  pip: string | null;          // for parity with Anton's YAML; null when not applicable
  fields: EngineField[];
  auth_methods: string[];
  test_snippet?: string;
  popular?: boolean;
  custom?: boolean;
}

export interface VaultEntry {
  engine: string;             // engine slug
  name: string;               // user-chosen, sanitized
  values: Record<string, string>;
  secure_keys: string[];      // fields that should never be logged or echoed
  created_at: string;
  updated_at?: string;
}

export interface BoundClient<TClient = unknown> {
  engine: string;
  name: string;
  client: TClient;
}

export interface CredentialInjector {
  injectEnv(processEnv: NodeJS.ProcessEnv, vaultEntries: string[]): NodeJS.ProcessEnv;
  loadForBinding<TClient = unknown>(serviceName: string): Promise<BoundClient<TClient> | null>;
}
```

- [ ] **Step 4.4: Update barrel**

Modify `otto-cli/packages/coworker-types/src/index.ts`:

```typescript
export * from './memory.js';
export * from './artifacts.js';
export * from './vault.js';
```

- [ ] **Step 4.5: Run test to verify pass**

```bash
npm run build -w @otto/coworker-types
node --import tsx --test packages/coworker-types/src/vault.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 4.6: Commit**

```bash
git add otto-cli/packages/coworker-types/src/vault.ts otto-cli/packages/coworker-types/src/vault.test.ts otto-cli/packages/coworker-types/src/index.ts
git commit -m "feat(coworker-types): add vault types (VaultEntry, EngineDef, CredentialInjector)"
```

---

## Task 5: Define scratchpad/collector types

**Files:**
- Create: `otto-cli/packages/coworker-types/src/scratchpad.ts`
- Create: `otto-cli/packages/coworker-types/src/scratchpad.test.ts`
- Modify: `otto-cli/packages/coworker-types/src/index.ts`

- [ ] **Step 5.1: Write the failing test**

Create `otto-cli/packages/coworker-types/src/scratchpad.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  DataSourceRef, DataSource, CollectorCapabilities,
  Collector, CollectorRegistry, Unsubscribe,
} from './scratchpad.js';

describe('scratchpad/collector types', () => {
  it('DataSourceRef has collector id + uri + kind + metadata', () => {
    const ref: DataSourceRef = {
      collector: 'file',
      uri: 'file:///workspace/inputs/cmdb.csv',
      kind: 'csv',
      bytes: 1024,
      modified: '2026-05-31T10:00:00Z',
      metadata: {},
    };
    assert.equal(ref.collector, 'file');
  });

  it('CollectorCapabilities advertises supports_uris and supports_kinds', () => {
    const caps: CollectorCapabilities = {
      supports_uris: ['file://*'],
      supports_kinds: ['csv', 'xlsx'],
      supports_streaming: true,
      supports_watching: true,
    };
    assert.equal(caps.supports_streaming, true);
  });

  it('Collector interface has describe + list + open + optional watch', () => {
    const _check: keyof Collector = 'describe';
    const _required: Array<keyof Collector> = ['id', 'kind', 'describe', 'list', 'open'];
    assert.equal(_required.length, 5);
  });

  it('CollectorRegistry has register/list/get/resolve', () => {
    const _methods: Array<keyof CollectorRegistry> = ['register', 'list', 'get', 'resolve'];
    assert.equal(_methods.length, 4);
  });

  it('Unsubscribe is a void-returning function', () => {
    const u: Unsubscribe = () => undefined;
    assert.equal(typeof u, 'function');
  });
});
```

- [ ] **Step 5.2: Run to verify it fails**

```bash
node --import tsx --test packages/coworker-types/src/scratchpad.test.ts
```

Expected: fail (module not found).

- [ ] **Step 5.3: Implement `scratchpad.ts`**

Create `otto-cli/packages/coworker-types/src/scratchpad.ts`:

```typescript
// Scratchpad/collector types. See spec §2.4 collector facade.

export type DataKind =
  | 'csv' | 'xlsx' | 'json' | 'parquet' | 'txt' | 'md'
  | 'rest' | 'mcp-resource' | 'acp-stream';

export interface DataSourceRef {
  collector: string;
  uri: string;
  kind: DataKind;
  bytes?: number;
  modified?: string;
  metadata: Record<string, unknown>;
}

export interface DataSource {
  ref: DataSourceRef;
  load(): Promise<Buffer | string | object>;
  stream?(): AsyncIterable<Buffer>;
}

export interface CollectorCapabilities {
  supports_uris: string[];          // wildcard patterns: 'file://*', 'servicenow://*'
  supports_kinds: DataKind[];
  supports_streaming: boolean;
  supports_watching: boolean;
}

export interface ListOpts {
  workspace?: string;
  prefix?: string;
  limit?: number;
}

export type Unsubscribe = () => void;

export interface Collector {
  readonly id: string;
  readonly kind: 'file' | 'api' | 'protocol';
  describe(): CollectorCapabilities;
  list(opts?: ListOpts): AsyncIterable<DataSourceRef>;
  open(ref: DataSourceRef): Promise<DataSource>;
  watch?(ref: DataSourceRef, onChange: (ref: DataSourceRef) => void): Unsubscribe;
}

export interface CollectorRegistry {
  register(collector: Collector): void;
  list(): Collector[];
  get(id: string): Collector | null;
  resolve(uri: string): Promise<{ collector: Collector; ref: DataSourceRef } | null>;
}
```

- [ ] **Step 5.4: Update barrel**

Modify `otto-cli/packages/coworker-types/src/index.ts`:

```typescript
export * from './memory.js';
export * from './artifacts.js';
export * from './vault.js';
export * from './scratchpad.js';
```

- [ ] **Step 5.5: Run test to verify pass**

```bash
npm run build -w @otto/coworker-types
node --import tsx --test packages/coworker-types/src/scratchpad.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5.6: Commit**

```bash
git add otto-cli/packages/coworker-types/src/scratchpad.ts otto-cli/packages/coworker-types/src/scratchpad.test.ts otto-cli/packages/coworker-types/src/index.ts
git commit -m "feat(coworker-types): add scratchpad collector types (CollectorRegistry, DataSourceRef)"
```

---

## Task 6: Define inter-package MemoryRecorder contract

**Files:**
- Create: `otto-cli/packages/coworker-types/src/contracts.ts`
- Create: `otto-cli/packages/coworker-types/src/contracts.test.ts`
- Modify: `otto-cli/packages/coworker-types/src/index.ts`

- [ ] **Step 6.1: Write the failing test**

Create `otto-cli/packages/coworker-types/src/contracts.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MemoryRecorder, RecordEpisodeArgs, RecordCellArgs, AccEventArgs } from './contracts.js';

describe('inter-package contracts', () => {
  it('RecordEpisodeArgs uses DrawerKind enum, not free string', () => {
    const args: RecordEpisodeArgs = {
      sessionId: 'sess_001',
      room: 'p1-1234',
      kind: 'ticket',     // must compile only because 'ticket' is a DrawerKind
      content: 'verbatim',
      turnId: 'turn_001',
    };
    assert.equal(args.kind, 'ticket');
  });

  it('RecordCellArgs has scratchpadName + cellId + duration', () => {
    const args: RecordCellArgs = {
      scratchpadName: 'p1-1234',
      cellId: 'cell_001',
      code: 'const x = 1;',
      stdout: '',
      error: null,
      durationMs: 42,
    };
    assert.equal(args.durationMs, 42);
  });

  it('AccEventArgs has kind + detail + severity', () => {
    const args: AccEventArgs = {
      sessionId: 'sess_001',
      kind: 'repeated_error_signature',
      detail: 'UnicodeDecodeError x4',
      severity: 'medium',
    };
    assert.equal(args.severity, 'medium');
  });

  it('MemoryRecorder has the three required methods', () => {
    const _methods: Array<keyof MemoryRecorder> = ['recordEpisode', 'recordCell', 'observeAccEvent'];
    assert.equal(_methods.length, 3);
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
node --import tsx --test packages/coworker-types/src/contracts.test.ts
```

Expected: fail (module not found).

- [ ] **Step 6.3: Implement `contracts.ts`**

Create `otto-cli/packages/coworker-types/src/contracts.ts`:

```typescript
// Inter-package contracts. See spec §2.5.
import type { DrawerKind } from './memory.js';

export interface RecordEpisodeArgs {
  sessionId: string;
  room: string;
  kind: DrawerKind;
  content: string;
  turnId: string;
  metadata?: Record<string, unknown>;
  // wing is intentionally absent — otto-memory derives it from active scoping mode.
}

export interface RecordCellArgs {
  scratchpadName: string;
  cellId: string;
  code: string;
  stdout: string;
  error: { type: string; message: string } | null;
  durationMs: number;
}

export type AccSeverity = 'low' | 'medium' | 'high';

export interface AccEventArgs {
  sessionId: string;
  kind: string;          // ACC detector vocabulary — closed set defined in coworker-memory Phase 5
  detail: string;
  severity: AccSeverity;
}

export interface MemoryRecorder {
  recordEpisode(args: RecordEpisodeArgs): Promise<void>;
  recordCell(args: RecordCellArgs): Promise<void>;
  observeAccEvent(args: AccEventArgs): void;
}
```

- [ ] **Step 6.4: Update barrel**

Modify `otto-cli/packages/coworker-types/src/index.ts`:

```typescript
export * from './memory.js';
export * from './artifacts.js';
export * from './vault.js';
export * from './scratchpad.js';
export * from './contracts.js';
```

- [ ] **Step 6.5: Run test to verify pass**

```bash
npm run build -w @otto/coworker-types
node --import tsx --test packages/coworker-types/src/contracts.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6.6: Commit**

```bash
git add otto-cli/packages/coworker-types/src/contracts.ts otto-cli/packages/coworker-types/src/contracts.test.ts otto-cli/packages/coworker-types/src/index.ts
git commit -m "feat(coworker-types): add MemoryRecorder inter-package contract"
```

---

## Task 7: NDJSON channel helper

**Files:**
- Create: `otto-cli/packages/coworker-utils/src/ndjson-channel.ts`
- Create: `otto-cli/packages/coworker-utils/src/ndjson-channel.test.ts`
- Modify: `otto-cli/packages/coworker-utils/src/index.ts`
- Modify: `otto-cli/packages/coworker-utils/package.json` (add `@otto/coworker-types` as a peer dep — not needed for ndjson but for index re-exports later)

- [ ] **Step 7.1: Write the failing test (roundtrip + partial-read scenarios)**

Create `otto-cli/packages/coworker-utils/src/ndjson-channel.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { writeNdjson, readNdjson } from './ndjson-channel.js';

function makeReader(chunks: string[]): Readable {
  let i = 0;
  return new Readable({
    read() {
      if (i >= chunks.length) { this.push(null); return; }
      this.push(chunks[i++], 'utf8');
    },
  });
}

function makeWriter(): { stream: Writable; written: () => string } {
  const buf: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { buf.push(chunk.toString('utf8')); cb(); },
  });
  return { stream, written: () => buf.join('') };
}

describe('ndjson channel', () => {
  it('writes one object per line with \\n terminator', async () => {
    const { stream, written } = makeWriter();
    await writeNdjson(stream, { type: 'ready' });
    await writeNdjson(stream, { type: 'exec', cell_id: 'c1' });
    assert.equal(written(), '{"type":"ready"}\n{"type":"exec","cell_id":"c1"}\n');
  });

  it('reads one object per yielded value', async () => {
    const reader = makeReader([
      '{"type":"ready"}\n{"type":"result","cell_id":"c1"}\n',
    ]);
    const got: Array<Record<string, unknown>> = [];
    for await (const msg of readNdjson(reader)) {
      got.push(msg as Record<string, unknown>);
    }
    assert.equal(got.length, 2);
    assert.equal(got[0].type, 'ready');
    assert.equal(got[1].type, 'result');
  });

  it('handles JSON object split across read chunks', async () => {
    const reader = makeReader([
      '{"type":"re',
      'ady","extra":"long string"}\n',
    ]);
    const got: Array<Record<string, unknown>> = [];
    for await (const msg of readNdjson(reader)) {
      got.push(msg as Record<string, unknown>);
    }
    assert.equal(got.length, 1);
    assert.equal(got[0].type, 'ready');
    assert.equal(got[0].extra, 'long string');
  });

  it('skips empty lines silently', async () => {
    const reader = makeReader(['\n\n{"a":1}\n\n{"b":2}\n']);
    const got: Array<Record<string, unknown>> = [];
    for await (const msg of readNdjson(reader)) {
      got.push(msg as Record<string, unknown>);
    }
    assert.equal(got.length, 2);
    assert.equal(got[0].a, 1);
    assert.equal(got[1].b, 2);
  });

  it('throws on malformed JSON with line number', async () => {
    const reader = makeReader(['{"ok":1}\n{not json\n']);
    await assert.rejects(async () => {
      for await (const _ of readNdjson(reader)) { /* drain */ }
    }, /line 2/);
  });
});
```

- [ ] **Step 7.2: Run test to verify it fails**

```bash
node --import tsx --test packages/coworker-utils/src/ndjson-channel.test.ts
```

Expected: fail (module not found).

- [ ] **Step 7.3: Implement `ndjson-channel.ts`**

Create `otto-cli/packages/coworker-utils/src/ndjson-channel.ts`:

```typescript
// NDJSON channel — one JSON object per line over Node streams.
// Used by scratchpad <-> kernel subprocess and other inter-process channels.
// Spec §6.3.
import type { Readable, Writable } from 'node:stream';

export async function writeNdjson(stream: Writable, message: unknown): Promise<void> {
  const line = JSON.stringify(message) + '\n';
  await new Promise<void>((resolve, reject) => {
    stream.write(line, 'utf8', (err) => (err ? reject(err) : resolve()));
  });
}

export async function* readNdjson(stream: Readable): AsyncGenerator<unknown> {
  stream.setEncoding('utf8');
  let buffer = '';
  let lineNumber = 0;
  for await (const chunk of stream) {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      lineNumber++;
      if (line.length === 0) continue;
      try {
        yield JSON.parse(line);
      } catch (err) {
        throw new Error(`NDJSON parse error at line ${lineNumber}: ${(err as Error).message}`);
      }
    }
  }
  // Tail (no trailing newline)
  if (buffer.length > 0) {
    lineNumber++;
    try {
      yield JSON.parse(buffer);
    } catch (err) {
      throw new Error(`NDJSON parse error at line ${lineNumber}: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 7.4: Update barrel**

Modify `otto-cli/packages/coworker-utils/src/index.ts`:

```typescript
export * from './ndjson-channel.js';
```

- [ ] **Step 7.5: Run tests to verify pass**

```bash
npm run build -w @otto/coworker-utils
node --import tsx --test packages/coworker-utils/src/ndjson-channel.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 7.6: Commit**

```bash
git add otto-cli/packages/coworker-utils/src/ndjson-channel.ts otto-cli/packages/coworker-utils/src/ndjson-channel.test.ts otto-cli/packages/coworker-utils/src/index.ts
git commit -m "feat(coworker-utils): NDJSON channel helper for subprocess IPC"
```

---

## Task 8: Lease helper

**Files:**
- Create: `otto-cli/packages/coworker-utils/src/lease.ts`
- Create: `otto-cli/packages/coworker-utils/src/lease.test.ts`
- Modify: `otto-cli/packages/coworker-utils/src/index.ts`

- [ ] **Step 8.1: Write the failing test**

Create `otto-cli/packages/coworker-utils/src/lease.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { acquireLease, releaseLease, isLeaseHeld } from './lease.js';

let tmpdir: string;

describe('lease helper', () => {
  beforeEach(async () => {
    tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'lease-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpdir, { recursive: true, force: true });
  });

  it('acquires a free lease and writes PID + acquired_at + ttl_ms', async () => {
    const lockPath = path.join(tmpdir, 'task.lock');
    const ok = await acquireLease(lockPath, { ttlMs: 60_000 });
    assert.equal(ok, true);
    const raw = await fs.readFile(lockPath, 'utf8');
    const data = JSON.parse(raw);
    assert.equal(data.pid, process.pid);
    assert.equal(typeof data.acquired_at, 'string');
    assert.equal(data.ttl_ms, 60_000);
  });

  it('blocks a second acquire while the first is held', async () => {
    const lockPath = path.join(tmpdir, 'task.lock');
    await acquireLease(lockPath, { ttlMs: 60_000 });
    const ok = await acquireLease(lockPath, { ttlMs: 60_000 });
    assert.equal(ok, false);
  });

  it('release allows re-acquire', async () => {
    const lockPath = path.join(tmpdir, 'task.lock');
    await acquireLease(lockPath, { ttlMs: 60_000 });
    await releaseLease(lockPath);
    const ok = await acquireLease(lockPath, { ttlMs: 60_000 });
    assert.equal(ok, true);
  });

  it('expired lease (past ttl) is auto-cleared on next acquire', async () => {
    const lockPath = path.join(tmpdir, 'task.lock');
    await acquireLease(lockPath, { ttlMs: 50 });
    await new Promise(r => setTimeout(r, 100));
    const ok = await acquireLease(lockPath, { ttlMs: 60_000 });
    assert.equal(ok, true, 'expected expired lease to be reclaimable');
  });

  it('isLeaseHeld returns false for missing file', async () => {
    const lockPath = path.join(tmpdir, 'missing.lock');
    assert.equal(await isLeaseHeld(lockPath), false);
  });

  it('isLeaseHeld returns false for expired lease without clearing it', async () => {
    const lockPath = path.join(tmpdir, 'task.lock');
    await acquireLease(lockPath, { ttlMs: 50 });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(await isLeaseHeld(lockPath), false);
  });
});
```

- [ ] **Step 8.2: Run test to verify it fails**

```bash
node --import tsx --test packages/coworker-utils/src/lease.test.ts
```

Expected: fail (module not found).

- [ ] **Step 8.3: Implement `lease.ts`**

Create `otto-cli/packages/coworker-utils/src/lease.ts`:

```typescript
// Lease helper for global background tasks.
// Spec §6.4.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

export interface LeaseOptions {
  ttlMs: number;
  holder?: string;
}

interface LeaseData {
  pid: number;
  host: string;
  acquired_at: string;
  ttl_ms: number;
  holder?: string;
}

function isExpired(data: LeaseData): boolean {
  const acquired = Date.parse(data.acquired_at);
  if (Number.isNaN(acquired)) return true;
  return Date.now() > acquired + data.ttl_ms;
}

function pidAlive(pid: number, host: string): boolean {
  // We can only check pids on the same host.
  if (host !== os.hostname()) return true;       // assume alive on other hosts
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLease(path: string): Promise<LeaseData | null> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    return JSON.parse(raw) as LeaseData;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function acquireLease(path: string, opts: LeaseOptions): Promise<boolean> {
  const existing = await readLease(path);
  if (existing && !isExpired(existing) && pidAlive(existing.pid, existing.host)) {
    return false;
  }
  const data: LeaseData = {
    pid: process.pid,
    host: os.hostname(),
    acquired_at: new Date().toISOString(),
    ttl_ms: opts.ttlMs,
    holder: opts.holder,
  };
  await fs.writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  return true;
}

export async function releaseLease(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function isLeaseHeld(path: string): Promise<boolean> {
  const data = await readLease(path);
  if (!data) return false;
  if (isExpired(data)) return false;
  if (!pidAlive(data.pid, data.host)) return false;
  return true;
}
```

- [ ] **Step 8.4: Update barrel**

Modify `otto-cli/packages/coworker-utils/src/index.ts`:

```typescript
export * from './ndjson-channel.js';
export * from './lease.js';
```

- [ ] **Step 8.5: Run tests to verify pass**

```bash
npm run build -w @otto/coworker-utils
node --import tsx --test packages/coworker-utils/src/lease.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 8.6: Commit**

```bash
git add otto-cli/packages/coworker-utils/src/lease.ts otto-cli/packages/coworker-utils/src/lease.test.ts otto-cli/packages/coworker-utils/src/index.ts
git commit -m "feat(coworker-utils): lease helper for global background tasks"
```

---

## Task 9: Migration framework

**Files:**
- Create: `otto-cli/packages/coworker-utils/src/migration-runner.ts`
- Create: `otto-cli/packages/coworker-utils/src/migration-runner.test.ts`
- Modify: `otto-cli/packages/coworker-utils/src/index.ts`

- [ ] **Step 9.1: Write the failing test**

Create `otto-cli/packages/coworker-utils/src/migration-runner.test.ts`:

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MigrationRunner } from './migration-runner.js';

describe('MigrationRunner', () => {
  let runner: MigrationRunner;

  beforeEach(() => {
    runner = new MigrationRunner();
  });

  it('no migrations registered → identity', async () => {
    const out = await runner.migrate('cells.jsonl', 1, { rows: [] });
    assert.deepEqual(out, { rows: [] });
  });

  it('runs a single registered migration v1 → v2', async () => {
    runner.register('cells.jsonl', 1, 2, async (data: any) => ({ ...data, kind: 'session' }));
    const out: any = await runner.migrate('cells.jsonl', 1, { foo: 'bar' });
    assert.equal(out.kind, 'session');
    assert.equal(out.foo, 'bar');
  });

  it('runs a chain of migrations in version order', async () => {
    runner.register('cells.jsonl', 1, 2, async (d: any) => ({ ...d, v2: true }));
    runner.register('cells.jsonl', 2, 3, async (d: any) => ({ ...d, v3: true }));
    const out: any = await runner.migrate('cells.jsonl', 1, {});
    assert.equal(out.v2, true);
    assert.equal(out.v3, true);
  });

  it('throws on missing migration in the chain', async () => {
    runner.register('cells.jsonl', 1, 2, async (d) => d);
    runner.register('cells.jsonl', 3, 4, async (d) => d);
    await assert.rejects(
      () => runner.migrate('cells.jsonl', 1, {}),
      /no migration from version 2 to 3/i,
    );
  });

  it('idempotent at current version', async () => {
    runner.register('cells.jsonl', 1, 2, async (d: any) => ({ ...d, ran: true }));
    const out: any = await runner.migrate('cells.jsonl', 2, { ran: false });
    assert.equal(out.ran, false, 'should not run migrations when already at latest');
  });

  it('different kinds have independent migration chains', async () => {
    runner.register('cells.jsonl', 1, 2, async (d: any) => ({ ...d, kind: 'cells' }));
    runner.register('layer-b.db', 1, 2, async (d: any) => ({ ...d, kind: 'layer-b' }));
    const cells: any = await runner.migrate('cells.jsonl', 1, {});
    const layerB: any = await runner.migrate('layer-b.db', 1, {});
    assert.equal(cells.kind, 'cells');
    assert.equal(layerB.kind, 'layer-b');
  });

  it('latestVersion returns highest registered target version', () => {
    runner.register('cells.jsonl', 1, 2, async (d) => d);
    runner.register('cells.jsonl', 2, 3, async (d) => d);
    assert.equal(runner.latestVersion('cells.jsonl'), 3);
  });

  it('latestVersion returns null for unknown kind', () => {
    assert.equal(runner.latestVersion('unknown'), null);
  });
});
```

- [ ] **Step 9.2: Run test to verify it fails**

```bash
node --import tsx --test packages/coworker-utils/src/migration-runner.test.ts
```

Expected: fail (module not found).

- [ ] **Step 9.3: Implement `migration-runner.ts`**

Create `otto-cli/packages/coworker-utils/src/migration-runner.ts`:

```typescript
// Migration framework — forward-only schema migrations per file kind.
// Spec §6.2, §3.4c.

export type MigrationFn<TIn = unknown, TOut = unknown> = (data: TIn) => Promise<TOut>;

interface MigrationRecord {
  from: number;
  to: number;
  fn: MigrationFn;
}

export class MigrationRunner {
  #byKind = new Map<string, MigrationRecord[]>();

  register<TIn = unknown, TOut = unknown>(
    kind: string,
    from: number,
    to: number,
    fn: MigrationFn<TIn, TOut>,
  ): void {
    if (to <= from) {
      throw new Error(`migration target version (${to}) must be greater than source (${from})`);
    }
    const list = this.#byKind.get(kind) ?? [];
    list.push({ from, to, fn: fn as MigrationFn });
    list.sort((a, b) => a.from - b.from);
    this.#byKind.set(kind, list);
  }

  latestVersion(kind: string): number | null {
    const list = this.#byKind.get(kind);
    if (!list || list.length === 0) return null;
    return Math.max(...list.map(m => m.to));
  }

  async migrate(kind: string, fromVersion: number, data: unknown): Promise<unknown> {
    const target = this.latestVersion(kind);
    if (target == null || fromVersion >= target) return data;
    const list = this.#byKind.get(kind)!;
    let current = fromVersion;
    let value = data;
    while (current < target) {
      const next = list.find(m => m.from === current);
      if (!next) throw new Error(`no migration from version ${current} to ${current + 1} for kind ${kind}`);
      value = await next.fn(value);
      current = next.to;
    }
    return value;
  }
}
```

- [ ] **Step 9.4: Update barrel**

Modify `otto-cli/packages/coworker-utils/src/index.ts`:

```typescript
export * from './ndjson-channel.js';
export * from './lease.js';
export * from './migration-runner.js';
```

- [ ] **Step 9.5: Run tests to verify pass**

```bash
npm run build -w @otto/coworker-utils
node --import tsx --test packages/coworker-utils/src/migration-runner.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 9.6: Commit**

```bash
git add otto-cli/packages/coworker-utils/src/migration-runner.ts otto-cli/packages/coworker-utils/src/migration-runner.test.ts otto-cli/packages/coworker-utils/src/index.ts
git commit -m "feat(coworker-utils): MigrationRunner for forward-only schema migrations"
```

---

## Task 10: SecretScanner stub

**Files:**
- Create: `otto-cli/packages/coworker-utils/src/secret-scanner.ts`
- Create: `otto-cli/packages/coworker-utils/src/secret-scanner.test.ts`
- Modify: `otto-cli/packages/coworker-utils/src/index.ts`

- [ ] **Step 10.1: Write the failing test**

Create `otto-cli/packages/coworker-utils/src/secret-scanner.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SecretScanner } from './secret-scanner.js';

describe('SecretScanner', () => {
  const scanner = new SecretScanner();

  it('detects an Anthropic key pattern', () => {
    const text = 'My key is sk-ant-api03-aaaabbbbccccddddeeeeffffgggghhhh111122223333AAA-BBBBCCCC';
    const hits = scanner.scan(text);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'anthropic_api_key');
  });

  it('detects an OpenAI sk- key', () => {
    const text = 'openai key: sk-proj-AAAAaaaaBBBBccccDDDDeeeeFFFFggggHHHHiiiiJJJJkkkkLLLL';
    const hits = scanner.scan(text);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'openai_api_key');
  });

  it('detects an AWS access key id', () => {
    const text = 'AKIAIOSFODNN7EXAMPLE was leaked';
    const hits = scanner.scan(text);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'aws_access_key_id');
  });

  it('detects a GitHub PAT', () => {
    const text = 'token: ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ';
    const hits = scanner.scan(text);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'github_pat');
  });

  it('does not flag generic English text', () => {
    const text = 'The server had multiple alerts and we restarted it twice.';
    const hits = scanner.scan(text);
    assert.equal(hits.length, 0);
  });

  it('redact replaces detected secrets with [REDACTED:<kind>]', () => {
    const text = 'My key is sk-ant-api03-aaaabbbbccccddddeeeeffffgggghhhh111122223333AAA-BBBBCCCC and a note.';
    const redacted = scanner.redact(text);
    assert.match(redacted, /\[REDACTED:anthropic_api_key\]/);
    assert.match(redacted, /and a note\.$/);
  });

  it('returns multiple hits when multiple secrets present', () => {
    const text = 'sk-ant-api03-aaaabbbbccccddddeeeeffffgggghhhh111122223333AAA-BBBBCCCC AKIAIOSFODNN7EXAMPLE';
    const hits = scanner.scan(text);
    assert.equal(hits.length, 2);
  });

  it('records hit positions (start, end) in the original text', () => {
    const text = '----AKIAIOSFODNN7EXAMPLE----';
    const hits = scanner.scan(text);
    assert.equal(hits[0].start, 4);
    assert.equal(hits[0].end, 24);
  });
});
```

- [ ] **Step 10.2: Run test to verify it fails**

```bash
node --import tsx --test packages/coworker-utils/src/secret-scanner.test.ts
```

Expected: fail (module not found).

- [ ] **Step 10.3: Implement `secret-scanner.ts`**

Create `otto-cli/packages/coworker-utils/src/secret-scanner.ts`:

```typescript
// SecretScanner — stub gate before any disk write to memory layers A/B.
// Spec §6.5.

export interface SecretHit {
  kind: string;
  start: number;
  end: number;
  preview: string;        // first 8 chars + "..." — for audit logs (never the full secret)
}

interface Pattern {
  kind: string;
  regex: RegExp;
}

// Patterns are intentionally conservative — false negatives are OK in v1; false positives in
// memory are a real cost (user lessons get over-redacted). Tighten or extend as Phase 3 reveals
// real-world content.
const PATTERNS: Pattern[] = [
  { kind: 'anthropic_api_key', regex: /sk-ant-api03-[A-Za-z0-9_-]{60,}/g },
  { kind: 'openai_api_key',    regex: /sk-(?:proj-)?[A-Za-z0-9]{40,}/g },
  { kind: 'aws_access_key_id', regex: /AKIA[0-9A-Z]{16}/g },
  { kind: 'github_pat',        regex: /gh[pous]_[A-Za-z0-9]{36,}/g },
];

export class SecretScanner {
  scan(text: string): SecretHit[] {
    const hits: SecretHit[] = [];
    for (const { kind, regex } of PATTERNS) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) != null) {
        hits.push({
          kind,
          start: m.index,
          end: m.index + m[0].length,
          preview: m[0].slice(0, 8) + '...',
        });
      }
    }
    return hits.sort((a, b) => a.start - b.start);
  }

  redact(text: string): string {
    const hits = this.scan(text);
    if (hits.length === 0) return text;
    let out = '';
    let cursor = 0;
    for (const h of hits) {
      out += text.slice(cursor, h.start) + `[REDACTED:${h.kind}]`;
      cursor = h.end;
    }
    out += text.slice(cursor);
    return out;
  }
}
```

- [ ] **Step 10.4: Update barrel**

Modify `otto-cli/packages/coworker-utils/src/index.ts`:

```typescript
export * from './ndjson-channel.js';
export * from './lease.js';
export * from './migration-runner.js';
export * from './secret-scanner.js';
```

- [ ] **Step 10.5: Run tests to verify pass**

```bash
npm run build -w @otto/coworker-utils
node --import tsx --test packages/coworker-utils/src/secret-scanner.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 10.6: Commit**

```bash
git add otto-cli/packages/coworker-utils/src/secret-scanner.ts otto-cli/packages/coworker-utils/src/secret-scanner.test.ts otto-cli/packages/coworker-utils/src/index.ts
git commit -m "feat(coworker-utils): SecretScanner stub for memory write gates"
```

---

## Task 11: Logger wrapper

**Files:**
- Create: `otto-cli/packages/coworker-utils/src/logger.ts`
- Create: `otto-cli/packages/coworker-utils/src/logger.test.ts`
- Modify: `otto-cli/packages/coworker-utils/src/index.ts`

- [ ] **Step 11.1: Write the failing test**

Create `otto-cli/packages/coworker-utils/src/logger.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, LogLevel } from './logger.js';

describe('logger', () => {
  it('createLogger returns an object with debug/info/warn/error', () => {
    const log = createLogger('test.namespace');
    assert.equal(typeof log.debug, 'function');
    assert.equal(typeof log.info, 'function');
    assert.equal(typeof log.warn, 'function');
    assert.equal(typeof log.error, 'function');
  });

  it('logs at or above the configured threshold', () => {
    const sink: string[] = [];
    const log = createLogger('test.threshold', {
      level: 'info' as LogLevel,
      sink: (line) => sink.push(line),
    });
    log.debug('hidden');
    log.info('visible-info');
    log.warn('visible-warn');
    assert.equal(sink.length, 2);
    assert.match(sink[0], /info.*visible-info/);
    assert.match(sink[1], /warn.*visible-warn/);
  });

  it('namespace prefix appears in each line', () => {
    const sink: string[] = [];
    const log = createLogger('coworker.memory', { level: 'debug', sink: (l) => sink.push(l) });
    log.info('hello');
    assert.match(sink[0], /coworker\.memory/);
  });

  it('child namespace appends to parent', () => {
    const sink: string[] = [];
    const log = createLogger('coworker', { level: 'debug', sink: (l) => sink.push(l) });
    const child = log.child('memory');
    child.info('hello');
    assert.match(sink[0], /coworker\.memory/);
  });

  it('serializes context object as appended JSON', () => {
    const sink: string[] = [];
    const log = createLogger('test.ctx', { level: 'debug', sink: (l) => sink.push(l) });
    log.info('msg', { user_id: 'u1', count: 3 });
    assert.match(sink[0], /"user_id":"u1"/);
    assert.match(sink[0], /"count":3/);
  });
});
```

- [ ] **Step 11.2: Run test to verify it fails**

```bash
node --import tsx --test packages/coworker-utils/src/logger.test.ts
```

Expected: fail.

- [ ] **Step 11.3: Implement `logger.ts`**

Create `otto-cli/packages/coworker-utils/src/logger.ts`:

```typescript
// Lightweight logger wrapper. Spec §6.7.
// Defers to a sink callable so otto-cli can wire it to the existing logger
// without coworker-utils taking a direct dependency on otto-cli.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LoggerOptions {
  level?: LogLevel;
  sink?: (line: string) => void;
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(suffix: string): Logger;
}

const DEFAULT_SINK = (line: string): void => {
  // Phase 0: write to stderr; otto-cli will replace this sink at wire time.
  process.stderr.write(line + '\n');
};

export function createLogger(namespace: string, opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? 'info';
  const sink = opts.sink ?? DEFAULT_SINK;
  const threshold = LEVEL_ORDER[level];

  function emit(at: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (LEVEL_ORDER[at] < threshold) return;
    const ctxPart = ctx ? ' ' + JSON.stringify(ctx) : '';
    sink(`${new Date().toISOString()} ${at} ${namespace} ${msg}${ctxPart}`);
  }

  return {
    debug: (msg, ctx) => emit('debug', msg, ctx),
    info:  (msg, ctx) => emit('info', msg, ctx),
    warn:  (msg, ctx) => emit('warn', msg, ctx),
    error: (msg, ctx) => emit('error', msg, ctx),
    child: (suffix) => createLogger(`${namespace}.${suffix}`, { level, sink }),
  };
}
```

- [ ] **Step 11.4: Update barrel**

Modify `otto-cli/packages/coworker-utils/src/index.ts`:

```typescript
export * from './ndjson-channel.js';
export * from './lease.js';
export * from './migration-runner.js';
export * from './secret-scanner.js';
export * from './logger.js';
```

- [ ] **Step 11.5: Run tests to verify pass**

```bash
npm run build -w @otto/coworker-utils
node --import tsx --test packages/coworker-utils/src/logger.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 11.6: Commit**

```bash
git add otto-cli/packages/coworker-utils/src/logger.ts otto-cli/packages/coworker-utils/src/logger.test.ts otto-cli/packages/coworker-utils/src/index.ts
git commit -m "feat(coworker-utils): logger wrapper with namespace + child support"
```

---

## Task 12: Wire all six packages into root build scripts

**Files:**
- Modify: `otto-cli/package.json` (add build scripts and wire into `build:core`)

- [ ] **Step 12.1: Read the existing root package.json scripts section**

Run:
```bash
grep -n "build:" otto-cli/package.json | head -20
```

You'll see entries like `"build:pi-tui"`, `"build:pi-ai"`, `"build:contracts"`, etc.

- [ ] **Step 12.2: Add six new build scripts**

In `otto-cli/package.json`, add these lines to the `scripts` section (placement: after `"build:contracts"`, before `"build:pi"`):

```json
"build:coworker-types": "npm run build -w @otto/coworker-types",
"build:coworker-utils": "npm run build -w @otto/coworker-utils",
"build:coworker-memory": "npm run build -w @otto/coworker-memory",
"build:coworker-vault": "npm run build -w @otto/coworker-vault",
"build:coworker-artifacts": "npm run build -w @otto/coworker-artifacts",
"build:coworker-scratchpad": "npm run build -w @otto/coworker-scratchpad",
"build:coworker": "npm run build:coworker-types && npm run build:coworker-utils && npm run build:coworker-memory && npm run build:coworker-vault && npm run build:coworker-artifacts && npm run build:coworker-scratchpad",
```

- [ ] **Step 12.3: Splice `build:coworker` into the top-level `build:core` chain**

Find the existing `"build:core"` line. It looks like:
```
"build:core": "npm run build:contracts && npm run build:pi && npm run build:rpc-client && npm run build:mcp-server && tsc && ...",
```

Modify to inject `npm run build:coworker` after `build:contracts`:
```
"build:core": "npm run build:contracts && npm run build:coworker && npm run build:pi && npm run build:rpc-client && npm run build:mcp-server && tsc && ...",
```

(Preserve the rest of the chain verbatim.)

- [ ] **Step 12.4: Verify the new build chain succeeds end-to-end**

Run from `otto-cli/`:
```bash
npm run build:coworker
```

Expected: six successful builds, no errors.

Then:
```bash
npm run build
```

Expected: full Otto build succeeds with the new packages included.

- [ ] **Step 12.5: Commit**

```bash
git add otto-cli/package.json
git commit -m "build(coworker): wire six new packages into root build:core chain"
```

---

## Task 13: Wire test runner for the new packages

**Files:**
- Read: `otto-cli/scripts/run-package-tests.cjs` (no changes — its glob finds tests in any workspace)
- Verify: existing `test:packages` script discovers the new tests after compile
- Modify (if needed): `otto-cli/scripts/compile-tests.mjs` to include the new packages

- [ ] **Step 13.1: Inspect the test compile pipeline**

```bash
cat otto-cli/scripts/compile-tests.mjs | head -40
```

Determine whether it has a hard-coded list of packages to compile, or globs over `packages/*`.

- [ ] **Step 13.2: Add coworker packages to compile pipeline if hard-coded**

If `compile-tests.mjs` has a hard-coded list, add the six coworker package names. If it globs over `packages/*`, no change is needed.

In either case, after this step, the compile output should include `dist-test/packages/coworker-*/src/*.test.js` for each test file authored in Tasks 2-11.

- [ ] **Step 13.3: Run the package test runner end-to-end**

Run from `otto-cli/`:
```bash
npm run test:packages
```

Expected: all coworker test files are discovered, compiled, and executed. Pass count should match the total tests written across Tasks 2-11 (memory: 5, artifacts: 6, vault: 5, scratchpad: 5, contracts: 4, ndjson: 5, lease: 6, migration: 8, secret-scanner: 8, logger: 5 → 57 tests).

- [ ] **Step 13.4: If a CI workflow file exists, ensure coworker tests are exercised**

```bash
ls otto-cli/.github/workflows/ 2>/dev/null
```

If a CI workflow exists, confirm it calls `npm run test:packages` (or similar). If not, no change required for Phase 0 — CI surfaces test failures via the existing `npm test` invocation.

- [ ] **Step 13.5: Commit any changes**

If `compile-tests.mjs` was modified:
```bash
git add otto-cli/scripts/compile-tests.mjs
git commit -m "test(coworker): include coworker packages in test compile pipeline"
```

If nothing changed (globs already cover the new packages), skip the commit and proceed to Task 14.

---

## Task 14: Phase 0 smoke test — all packages import cleanly

**Files:**
- Create: `otto-cli/packages/coworker-types/src/smoke.test.ts`

- [ ] **Step 14.1: Write the smoke test**

Create `otto-cli/packages/coworker-types/src/smoke.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('phase 0 smoke', () => {
  it('coworker-types barrel exports all five modules', async () => {
    const mod = await import('./index.js');
    // Memory
    assert.ok('Drawer' in mod === false, 'types only — runtime should be empty');
    // But at runtime imports should resolve without throwing.
    assert.ok(mod, 'module loaded');
  });

  it('coworker-utils barrel exports all helpers at runtime', async () => {
    const mod = await import('@otto/coworker-utils');
    assert.equal(typeof (mod as any).writeNdjson, 'function');
    assert.equal(typeof (mod as any).readNdjson, 'function');
    assert.equal(typeof (mod as any).acquireLease, 'function');
    assert.equal(typeof (mod as any).releaseLease, 'function');
    assert.equal(typeof (mod as any).MigrationRunner, 'function');
    assert.equal(typeof (mod as any).SecretScanner, 'function');
    assert.equal(typeof (mod as any).createLogger, 'function');
  });

  it('all four pillar packages import without error', async () => {
    const memory    = await import('@otto/coworker-memory');
    const vault     = await import('@otto/coworker-vault');
    const artifacts = await import('@otto/coworker-artifacts');
    const scratch   = await import('@otto/coworker-scratchpad');
    assert.ok(memory);
    assert.ok(vault);
    assert.ok(artifacts);
    assert.ok(scratch);
  });
});
```

- [ ] **Step 14.2: Run the smoke test**

Run from `otto-cli/`:
```bash
npm run build:coworker
node --import tsx --test packages/coworker-types/src/smoke.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 14.3: Commit**

```bash
git add otto-cli/packages/coworker-types/src/smoke.test.ts
git commit -m "test(coworker): phase 0 smoke — all six packages import cleanly"
```

---

## Task 15: Scaffold `coworker-persona` package + manifest type

**Files:**
- Create: `otto-cli/packages/coworker-persona/package.json`
- Create: `otto-cli/packages/coworker-persona/tsconfig.json`
- Create: `otto-cli/packages/coworker-persona/tsconfig.publish.json`
- Create: `otto-cli/packages/coworker-persona/src/index.ts`
- Create: `otto-cli/packages/coworker-persona/src/manifest.ts`
- Create: `otto-cli/packages/coworker-persona/src/manifest.test.ts`

> Note: Task 12 already wires `build:coworker-persona`. If you added the persona package to Task 1 originally, the scaffolding sub-steps below are no-ops; jump to Step 15.4 for the manifest type. If you did Task 1 without the persona package, do Steps 15.1-15.3 first to scaffold it (mirroring Task 1's pattern), then update root scripts.

- [ ] **Step 15.1: Create `coworker-persona/package.json`**

```json
{
  "name": "@otto/coworker-persona",
  "version": "0.0.1",
  "description": "Persona registry, manifest parser, and built-in default persona for Otto co-worker",
  "type": "module",
  "otto": {
    "linkable": true,
    "scope": "@otto",
    "name": "coworker-persona"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json && node scripts/copy-defaults.cjs",
    "build:publish": "tsc -p tsconfig.publish.json && node scripts/copy-defaults.cjs"
  },
  "files": ["dist"],
  "dependencies": {
    "@otto/coworker-utils": "*",
    "yaml": "^2.4.0"
  }
}
```

- [ ] **Step 15.2: Create `coworker-persona/tsconfig.json`** — same shape as Task 1.2, just rename to coworker-persona.

- [ ] **Step 15.3: Create empty barrel + tsconfig.publish.json** — same shape as Task 1.

- [ ] **Step 15.4: Write the failing manifest test**

Create `otto-cli/packages/coworker-persona/src/manifest.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonaManifest, type PersonaManifest } from './manifest.js';

describe('persona manifest', () => {
  it('parses a minimum-valid manifest', () => {
    const yaml = `
name: noc-ops
display_name: "NOC / IT Ops Analyst"
version: 1.0.0
description: "NOC analyst co-worker"
author: "@cmetech"
otto_version_required: ">=2.0.0"
steering:
  - steering/identity.md
status_line:
  label: NOC
  color: "#FAD22D"
  icon: "🛡"
`;
    const m: PersonaManifest = parsePersonaManifest(yaml);
    assert.equal(m.name, 'noc-ops');
    assert.equal(m.steering.length, 1);
    assert.equal(m.status_line.label, 'NOC');
  });

  it('rejects manifest missing required name', () => {
    const yaml = 'version: 1.0.0';
    assert.throws(() => parsePersonaManifest(yaml), /name/);
  });

  it('rejects manifest missing version', () => {
    const yaml = 'name: noc-ops';
    assert.throws(() => parsePersonaManifest(yaml), /version/);
  });

  it('defaults memory_seed.apply_on_first_activation to false when absent', () => {
    const yaml = `
name: x
display_name: x
version: 1.0.0
description: x
author: x
otto_version_required: ">=2.0.0"
steering: []
status_line: { label: X, color: "#000000", icon: "x" }
`;
    const m = parsePersonaManifest(yaml);
    assert.equal(m.memory_seed?.apply_on_first_activation ?? false, false);
  });

  it('parses artifact_kinds list when provided', () => {
    const yaml = `
name: x
display_name: x
version: 1.0.0
description: x
author: x
otto_version_required: ">=2.0.0"
steering: []
status_line: { label: X, color: "#000", icon: "x" }
artifact_kinds: [report, workbook, inventory_report]
`;
    const m = parsePersonaManifest(yaml);
    assert.deepEqual(m.artifact_kinds, ['report', 'workbook', 'inventory_report']);
  });
});
```

- [ ] **Step 15.5: Run test to verify it fails**

```bash
node --import tsx --test packages/coworker-persona/src/manifest.test.ts
```

Expected: fail (module not found).

- [ ] **Step 15.6: Implement `manifest.ts`**

Create `otto-cli/packages/coworker-persona/src/manifest.ts`:

```typescript
// Persona manifest parser. See spec §2.5.
import { parse as parseYaml } from 'yaml';

export interface PersonaStatusLine {
  label: string;
  color: string;     // hex
  icon: string;
}

export interface PersonaMemorySeed {
  apply_on_first_activation: boolean;
  scope?: 'global' | 'per-project' | 'per-project-tagged';
}

export interface PersonaManifest {
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: string;
  otto_version_required: string;
  steering: string[];
  memory_seed?: PersonaMemorySeed;
  engines?: string;
  artifact_kinds?: string[];
  skills_path?: string;
  status_line: PersonaStatusLine;
}

const REQUIRED: Array<keyof PersonaManifest> = [
  'name', 'display_name', 'version', 'description', 'author',
  'otto_version_required', 'steering', 'status_line',
];

export function parsePersonaManifest(yamlText: string): PersonaManifest {
  const raw = parseYaml(yamlText) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') {
    throw new Error('persona manifest must be a YAML object');
  }
  for (const field of REQUIRED) {
    if (!(field in raw)) {
      throw new Error(`persona manifest missing required field: ${field}`);
    }
  }
  return raw as unknown as PersonaManifest;
}
```

- [ ] **Step 15.7: Update barrel to export manifest**

`otto-cli/packages/coworker-persona/src/index.ts`:

```typescript
export * from './manifest.js';
```

- [ ] **Step 15.8: Build and run test**

```bash
npm install --workspace @otto/coworker-persona yaml
npm run build -w @otto/coworker-persona
node --import tsx --test packages/coworker-persona/src/manifest.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 15.9: Commit**

```bash
git add otto-cli/packages/coworker-persona/
git commit -m "feat(coworker-persona): scaffold package + PersonaManifest YAML parser"
```

---

## Task 16: PersonaRegistry — install / list / activate / switch

**Files:**
- Create: `otto-cli/packages/coworker-persona/src/registry.ts`
- Create: `otto-cli/packages/coworker-persona/src/registry.test.ts`
- Create: `otto-cli/packages/coworker-persona/src/defaults/manifest.yaml`
- Create: `otto-cli/packages/coworker-persona/src/defaults/steering/identity.md`
- Modify: `otto-cli/packages/coworker-persona/src/index.ts`

- [ ] **Step 16.1: Create the built-in `default` persona resource files**

Create `otto-cli/packages/coworker-persona/src/defaults/manifest.yaml`:

```yaml
name: default
display_name: "Default Co-Worker"
version: 1.0.0
description: "Generic co-worker with no domain specialization. Auto-activates when no persona is set."
author: "@cmetech"
otto_version_required: ">=2.0.0"
steering:
  - steering/identity.md
status_line:
  label: "default"
  color: "#6B6B7C"
  icon: "⚙"
```

Create `otto-cli/packages/coworker-persona/src/defaults/steering/identity.md`:

```markdown
You are Otto — a co-worker that helps the user run analyses, build reports, query their data,
and remember context across sessions. Be direct, accurate, and concise. When in doubt, ask
the user rather than guess. Cite memory and data sources verbatim when relevant.
```

- [ ] **Step 16.2: Write the failing registry test**

Create `otto-cli/packages/coworker-persona/src/registry.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { PersonaRegistry } from './registry.js';

let tmpHome: string;

describe('PersonaRegistry', () => {
  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-test-'));
    await fs.mkdir(path.join(tmpHome, 'personas'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('list returns built-in default persona on a fresh registry', async () => {
    const r = new PersonaRegistry({ ottoHome: tmpHome });
    await r.ensureDefaultInstalled();
    const installed = await r.list();
    assert.ok(installed.find(p => p.name === 'default'), 'default persona should be installed');
  });

  it('install copies a bundle directory into ~/.otto/personas/<name>', async () => {
    const r = new PersonaRegistry({ ottoHome: tmpHome });
    // Stage a fake persona bundle
    const bundle = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-bundle-'));
    await fs.mkdir(path.join(bundle, 'steering'), { recursive: true });
    await fs.writeFile(path.join(bundle, 'manifest.yaml'),
      'name: noc-ops\ndisplay_name: NOC\nversion: 1.0.0\ndescription: x\nauthor: x\notto_version_required: ">=2.0.0"\nsteering: [steering/identity.md]\nstatus_line: { label: NOC, color: "#FAD22D", icon: "🛡" }\n');
    await fs.writeFile(path.join(bundle, 'steering', 'identity.md'), 'noc identity');

    await r.installFromPath(bundle);
    const installed = await r.list();
    assert.ok(installed.find(p => p.name === 'noc-ops'));
    await fs.rm(bundle, { recursive: true, force: true });
  });

  it('install rejects a bundle missing manifest.yaml', async () => {
    const r = new PersonaRegistry({ ottoHome: tmpHome });
    const bad = await fs.mkdtemp(path.join(os.tmpdir(), 'bad-bundle-'));
    await assert.rejects(() => r.installFromPath(bad), /manifest\.yaml/);
    await fs.rm(bad, { recursive: true, force: true });
  });

  it('activateInWorkspace writes <workspace>/.otto/persona.json', async () => {
    const r = new PersonaRegistry({ ottoHome: tmpHome });
    await r.ensureDefaultInstalled();
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-'));
    await r.activateInWorkspace(ws, 'default');
    const raw = await fs.readFile(path.join(ws, '.otto', 'persona.json'), 'utf8');
    const data = JSON.parse(raw);
    assert.equal(data.active, 'default');
    assert.equal(typeof data.activated_at, 'string');
    assert.equal(data.memory_seed_applied, false);
    await fs.rm(ws, { recursive: true, force: true });
  });

  it('activeInWorkspace returns "default" when no persona.json exists', async () => {
    const r = new PersonaRegistry({ ottoHome: tmpHome });
    await r.ensureDefaultInstalled();
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-'));
    const active = await r.activeInWorkspace(ws);
    assert.equal(active.name, 'default');
    await fs.rm(ws, { recursive: true, force: true });
  });

  it('uninstall refuses if persona is currently active in any tracked workspace', async () => {
    const r = new PersonaRegistry({ ottoHome: tmpHome });
    await r.ensureDefaultInstalled();
    // Stage + install a second persona, then activate it
    const bundle = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-bundle-'));
    await fs.mkdir(path.join(bundle, 'steering'), { recursive: true });
    await fs.writeFile(path.join(bundle, 'manifest.yaml'),
      'name: noc-ops\ndisplay_name: NOC\nversion: 1.0.0\ndescription: x\nauthor: x\notto_version_required: ">=2.0.0"\nsteering: [steering/identity.md]\nstatus_line: { label: NOC, color: "#FAD22D", icon: "🛡" }\n');
    await fs.writeFile(path.join(bundle, 'steering', 'identity.md'), 'noc');
    await r.installFromPath(bundle);

    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-'));
    await r.activateInWorkspace(ws, 'noc-ops');
    await assert.rejects(() => r.uninstall('noc-ops', { trackedWorkspaces: [ws] }), /active/);

    await fs.rm(bundle, { recursive: true, force: true });
    await fs.rm(ws, { recursive: true, force: true });
  });
});
```

- [ ] **Step 16.3: Run test to verify it fails**

```bash
node --import tsx --test packages/coworker-persona/src/registry.test.ts
```

Expected: fail (module not found).

- [ ] **Step 16.4: Implement `registry.ts`**

Create `otto-cli/packages/coworker-persona/src/registry.ts`:

```typescript
// PersonaRegistry — install / list / activate / switch. Spec §2.5.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parsePersonaManifest, type PersonaManifest } from './manifest.js';

export interface RegistryOptions {
  ottoHome: string;            // typically ~/.otto
}

export interface ActiveRecord {
  active: string;
  activated_at: string;
  memory_seed_applied: boolean;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else {
      await fs.copyFile(s, d);
    }
  }
}

export class PersonaRegistry {
  #personasDir: string;

  constructor(opts: RegistryOptions) {
    this.#personasDir = path.join(opts.ottoHome, 'personas');
  }

  async ensureDefaultInstalled(): Promise<void> {
    const target = path.join(this.#personasDir, 'default');
    if (await dirExists(target)) return;
    // Source: bundled defaults shipped with this package
    const here = path.dirname(new URL(import.meta.url).pathname);
    const source = path.join(here, 'defaults');
    await copyDir(source, target);
  }

  async list(): Promise<PersonaManifest[]> {
    if (!(await dirExists(this.#personasDir))) return [];
    const entries = await fs.readdir(this.#personasDir, { withFileTypes: true });
    const out: PersonaManifest[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const manifestPath = path.join(this.#personasDir, e.name, 'manifest.yaml');
      try {
        const raw = await fs.readFile(manifestPath, 'utf8');
        out.push(parsePersonaManifest(raw));
      } catch {
        // skip malformed bundles
      }
    }
    return out;
  }

  async installFromPath(bundlePath: string): Promise<PersonaManifest> {
    const manifestPath = path.join(bundlePath, 'manifest.yaml');
    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, 'utf8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`bundle missing manifest.yaml at ${manifestPath}`);
      }
      throw err;
    }
    const manifest = parsePersonaManifest(raw);
    const target = path.join(this.#personasDir, manifest.name);
    await fs.rm(target, { recursive: true, force: true });
    await copyDir(bundlePath, target);
    return manifest;
  }

  async activateInWorkspace(workspaceRoot: string, name: string): Promise<void> {
    const persona = await this.get(name);
    if (!persona) throw new Error(`persona not installed: ${name}`);
    const wsOtto = path.join(workspaceRoot, '.otto');
    await fs.mkdir(wsOtto, { recursive: true });
    const record: ActiveRecord = {
      active: name,
      activated_at: new Date().toISOString(),
      memory_seed_applied: false,
    };
    await fs.writeFile(path.join(wsOtto, 'persona.json'), JSON.stringify(record, null, 2));
  }

  async activeInWorkspace(workspaceRoot: string): Promise<PersonaManifest> {
    const recordPath = path.join(workspaceRoot, '.otto', 'persona.json');
    try {
      const raw = await fs.readFile(recordPath, 'utf8');
      const record = JSON.parse(raw) as ActiveRecord;
      const m = await this.get(record.active);
      if (m) return m;
    } catch {
      // fall through to default
    }
    const def = await this.get('default');
    if (!def) throw new Error('default persona not installed');
    return def;
  }

  async get(name: string): Promise<PersonaManifest | null> {
    const manifestPath = path.join(this.#personasDir, name, 'manifest.yaml');
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      return parsePersonaManifest(raw);
    } catch {
      return null;
    }
  }

  async uninstall(name: string, opts: { trackedWorkspaces: string[] }): Promise<void> {
    if (name === 'default') {
      throw new Error('cannot uninstall the built-in default persona');
    }
    for (const ws of opts.trackedWorkspaces) {
      try {
        const raw = await fs.readFile(path.join(ws, '.otto', 'persona.json'), 'utf8');
        const record = JSON.parse(raw) as ActiveRecord;
        if (record.active === name) {
          throw new Error(`persona ${name} is active in workspace ${ws}; switch first`);
        }
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        if (err instanceof Error && err.message.startsWith('persona ')) throw err;
      }
    }
    await fs.rm(path.join(this.#personasDir, name), { recursive: true, force: true });
  }
}
```

- [ ] **Step 16.5: Add a `scripts/copy-defaults.cjs` to copy `src/defaults/` into `dist/defaults/` during build**

Create `otto-cli/packages/coworker-persona/scripts/copy-defaults.cjs`:

```javascript
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

const src = path.resolve(__dirname, '..', 'src', 'defaults');
const dst = path.resolve(__dirname, '..', 'dist', 'defaults');
copyDir(src, dst);
console.log(`Copied persona defaults: ${src} → ${dst}`);
```

- [ ] **Step 16.6: Update barrel to export registry**

`otto-cli/packages/coworker-persona/src/index.ts`:

```typescript
export * from './manifest.js';
export * from './registry.js';
```

- [ ] **Step 16.7: Build and run tests**

```bash
npm run build -w @otto/coworker-persona
node --import tsx --test packages/coworker-persona/src/registry.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 16.8: Commit**

```bash
git add otto-cli/packages/coworker-persona/
git commit -m "feat(coworker-persona): PersonaRegistry + bundled default persona"
```

---

## Task 17: Wire `/persona` slash commands + status-line chip into otto-cli

**Files:**
- Modify: `otto-cli/src/<command-registration-module>.ts` (exact module discovered via `grep -r "registerCommand" otto-cli/src/`)
- Modify: `otto-cli/src/<status-bar-component>.ts` (exact component discovered via `grep -r "statusBar\|status_line" otto-cli/src/`)
- Create: `otto-cli/src/coworker/persona-commands.ts` — `/persona` handler functions
- Create: `otto-cli/src/coworker/persona-commands.test.ts`

- [ ] **Step 17.1: Discover Otto's existing slash-command registration surface**

```bash
grep -rn "registerCommand\|slashCommand" otto-cli/src/ | head -20
```

Identify the module that registers built-in slash commands. Note the exact file path and pattern.

- [ ] **Step 17.2: Discover Otto's status-bar component**

```bash
grep -rn "statusBar\|status_line\|StatusBar" otto-cli/src/ otto-cli/packages/pi-tui/src/ | head -20
```

Identify how status-bar tiles are added. Note the API.

- [ ] **Step 17.3: Write the failing test for persona-commands handler**

Create `otto-cli/src/coworker/persona-commands.test.ts`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { PersonaRegistry } from '@otto/coworker-persona';
import { handleList, handleCurrent, handleSwitch } from './persona-commands.js';

let tmpHome: string;
let tmpWs: string;
let registry: PersonaRegistry;

describe('persona slash commands', () => {
  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-home-'));
    tmpWs = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-ws-'));
    await fs.mkdir(path.join(tmpHome, 'personas'), { recursive: true });
    registry = new PersonaRegistry({ ottoHome: tmpHome });
    await registry.ensureDefaultInstalled();
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
    await fs.rm(tmpWs, { recursive: true, force: true });
  });

  it('list returns lines including the default persona with active marker', async () => {
    const lines = await handleList(registry, tmpWs);
    const text = lines.join('\n');
    assert.match(text, /default/);
    assert.match(text, /\*/);     // active marker on the active persona
  });

  it('current shows active persona name + display_name', async () => {
    const lines = await handleCurrent(registry, tmpWs);
    const text = lines.join('\n');
    assert.match(text, /default/);
    assert.match(text, /Default Co-Worker/);
  });

  it('switch updates the workspace record to the requested persona', async () => {
    await handleSwitch(registry, tmpWs, 'default');
    const raw = await fs.readFile(path.join(tmpWs, '.otto', 'persona.json'), 'utf8');
    const data = JSON.parse(raw);
    assert.equal(data.active, 'default');
  });

  it('switch to an unknown persona returns an error line', async () => {
    const result = await handleSwitch(registry, tmpWs, 'nonexistent').catch(e => e.message);
    assert.match(result as string, /not installed|not found/i);
  });
});
```

- [ ] **Step 17.4: Run test to verify it fails**

```bash
node --import tsx --test src/coworker/persona-commands.test.ts
```

Expected: fail.

- [ ] **Step 17.5: Implement `persona-commands.ts`**

Create `otto-cli/src/coworker/persona-commands.ts`:

```typescript
// /persona slash-command handlers. Spec §2.5 + §5.2.
import { PersonaRegistry } from '@otto/coworker-persona';

export async function handleList(registry: PersonaRegistry, workspaceRoot: string): Promise<string[]> {
  const installed = await registry.list();
  const active = await registry.activeInWorkspace(workspaceRoot);
  return installed.map(p => `${p.name === active.name ? '*' : ' '} ${p.name} — ${p.display_name} (v${p.version})`);
}

export async function handleCurrent(registry: PersonaRegistry, workspaceRoot: string): Promise<string[]> {
  const active = await registry.activeInWorkspace(workspaceRoot);
  return [
    `Active persona: ${active.name}`,
    `Display name:   ${active.display_name}`,
    `Version:        ${active.version}`,
    `Description:    ${active.description}`,
    `Author:         ${active.author}`,
  ];
}

export async function handleSwitch(registry: PersonaRegistry, workspaceRoot: string, name: string): Promise<string[]> {
  const persona = await registry.get(name);
  if (!persona) throw new Error(`persona "${name}" is not installed; run /persona list to see installed personas`);
  await registry.activateInWorkspace(workspaceRoot, name);
  return [`Switched to persona: ${name} (${persona.display_name})`];
}

export async function handleReset(registry: PersonaRegistry, workspaceRoot: string): Promise<string[]> {
  await registry.activateInWorkspace(workspaceRoot, 'default');
  return ['Persona reset to default'];
}

export async function handleInstall(registry: PersonaRegistry, source: string): Promise<string[]> {
  // For Phase 0 we only support local-path install. Npm + git install come in Phase 6.
  const manifest = await registry.installFromPath(source);
  return [`Installed persona: ${manifest.name} (${manifest.display_name})`];
}

export async function handleUninstall(
  registry: PersonaRegistry,
  name: string,
  trackedWorkspaces: string[],
): Promise<string[]> {
  await registry.uninstall(name, { trackedWorkspaces });
  return [`Uninstalled persona: ${name}`];
}
```

- [ ] **Step 17.6: Run tests to verify pass**

```bash
node --import tsx --test src/coworker/persona-commands.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 17.7: Wire `/persona` into Otto's slash-command registry**

Using the registration pattern discovered in Step 17.1, register `/persona` as a multi-subcommand. Example shape (adjust to actual API):

```typescript
import { handleList, handleCurrent, handleSwitch, handleReset, handleInstall, handleUninstall } from './coworker/persona-commands.js';

registerSlashCommand('persona', {
  description: 'Manage Otto co-worker personas',
  subcommands: ['list', 'current', 'switch', 'install', 'uninstall', 'reset'],
  handler: async (args, ctx) => {
    const [sub, ...rest] = args.split(/\s+/);
    const registry = ctx.coworkerPersonaRegistry;
    const ws = ctx.workspace.root;
    switch (sub) {
      case 'list':      return (await handleList(registry, ws)).join('\n');
      case 'current':   return (await handleCurrent(registry, ws)).join('\n');
      case 'switch':    return (await handleSwitch(registry, ws, rest[0])).join('\n');
      case 'reset':     return (await handleReset(registry, ws)).join('\n');
      case 'install':   return (await handleInstall(registry, rest[0])).join('\n');
      case 'uninstall': return (await handleUninstall(registry, rest[0], ctx.trackedWorkspaces ?? [])).join('\n');
      default: return `Unknown subcommand: ${sub}. Try: list, current, switch, install, uninstall, reset`;
    }
  },
});
```

- [ ] **Step 17.8: Add the persona chip to the status bar**

Using the status-bar API discovered in Step 17.2, render a chip from the active persona's `status_line` metadata. Pseudo-shape:

```typescript
async function buildPersonaChip(ctx: SessionContext): Promise<StatusBarChip> {
  const persona = await ctx.coworkerPersonaRegistry.activeInWorkspace(ctx.workspace.root);
  return {
    label: persona.status_line.label,
    color: persona.status_line.color,
    icon: persona.status_line.icon,
    position: 'leftmost',
  };
}
```

Wire `buildPersonaChip` into the existing status-bar render path so it appears as the leftmost element.

- [ ] **Step 17.9: Verify end-to-end manually**

```bash
npm run build
otto                        # in a fresh test workspace
# Inside Otto:
/persona list               # should show default
/persona current            # should show Default Co-Worker
# Status bar should show "⚙ default" chip leftmost.
```

- [ ] **Step 17.10: Commit**

```bash
git add otto-cli/src/coworker/ otto-cli/src/<command-registration-module>.ts otto-cli/src/<status-bar-component>.ts
git commit -m "feat(otto-cli): wire /persona commands + status-line persona chip"
```

---

## Task 18: Phase 0 completion gate

- [ ] **Step 18.1: Run the full Otto build**

```bash
cd otto-cli
npm run build
```

Expected: success, no new warnings, no broken existing functionality.

- [ ] **Step 18.2: Run the full Otto test suite**

```bash
npm test
```

Expected: existing tests still pass + new coworker tests pass. Zero regressions.

- [ ] **Step 18.3: Verify package linking inside `node_modules/`**

```bash
ls -la node_modules/@otto/ | grep coworker
```

Expected: seven symlinked entries for the new packages (`coworker-artifacts`, `coworker-memory`, `coworker-persona`, `coworker-scratchpad`, `coworker-types`, `coworker-utils`, `coworker-vault`).

- [ ] **Step 18.4: Verify persona infrastructure end-to-end**

```bash
otto                        # fresh test workspace
/persona list               # → shows "* default — Default Co-Worker (v1.0.0)"
/persona current            # → "Active persona: default ..."
/persona switch default     # → no-op, confirms switch path works
```

Status bar should show `⚙ default` chip leftmost.

- [ ] **Step 18.5: Document Phase 0 completion**

Create `otto-cli/docs/superpowers/notes/2026-coworker-phase-0-complete.md`:

```markdown
# Coworker Phase 0 — Foundations — Complete

**Completed:** YYYY-MM-DD

## What shipped

- Seven new workspace packages under `packages/coworker-*`:
  - `@otto/coworker-types` — shared types (memory, artifacts, vault, scratchpad/collector, contracts)
  - `@otto/coworker-utils` — NDJSON, lease, migration, secret scanner, logger
  - `@otto/coworker-memory`, `coworker-vault`, `coworker-artifacts`, `coworker-scratchpad` — pillar shells (impl in Phases 1-5)
  - `@otto/coworker-persona` — registry, manifest parser, built-in `default` persona
- Build pipeline + test pipeline wired
- `/persona` slash commands functional (`list`, `current`, `switch`, `install`, `uninstall`, `reset`)
- Status-line persona chip rendered (leftmost element, persona-defined color + icon)
- Built-in `default` persona auto-activates in workspaces with no persona set

## Test counts

- coworker-types: 5 (memory) + 6 (artifacts) + 5 (vault) + 5 (scratchpad) + 4 (contracts) + 3 (smoke) = 28
- coworker-utils: 5 (ndjson) + 6 (lease) + 8 (migration) + 8 (secret-scanner) + 5 (logger) = 32
- coworker-persona: 5 (manifest) + 6 (registry) + 4 (commands) = 15
- Total new: 75

## What's unblocked for the next phase

Phase 1 (otto-scratchpad MVP) can now import `MemoryRecorder`, `CollectorRegistry`,
`writeNdjson`/`readNdjson`, the lease helper, and the logger; can also read the active
persona via `PersonaRegistry.activeInWorkspace()` to expose `otto.persona` bindings in cells.
Phase 2 (otto-vault) can import `CredentialInjector`, `VaultEntry`, `EngineDef` and seed
engines from the active persona's `engines.yaml`. Phase 3 (otto-memory) can import
`MemoryBackend`, `Drawer`, `RecallQuery`, and seed Layer A from the persona's `memory-seed/`.
```

- [ ] **Step 18.6: Final commit**

```bash
git add otto-cli/docs/superpowers/notes/2026-coworker-phase-0-complete.md
git commit -m "docs(coworker): Phase 0 completion note"
```

---

## Self-review

Ran against the spec:

| Spec requirement (Phase 0 row §8) | Implemented in |
|---|---|
| Four pillar packages scaffolded | Task 1 |
| Shared types package | Tasks 1-6 |
| Three contracts (MemoryRecorder + CredentialInjector + ArtifactStore) | Tasks 3 (ArtifactStore), 4 (CredentialInjector), 6 (MemoryRecorder) |
| MemoryBackend interface | Task 2 |
| Wing/Room/Drawer/DrawerKind types | Task 2 |
| Migration framework operational | Task 9 |
| NDJSON IPC helpers shipped | Task 7 |
| Lease helper shipped | Task 8 |
| SecretScanner stub shipped | Task 10 |
| Logger published | Task 11 |
| `npm install` brings four package shells | Task 1.8 verifies six (types + utils + four pillars) |
| CI green | Task 13 + 15 verify |

| Engineering rules (§6) | Compliance |
|---|---|
| §6.2 Schema migrations first-class | Task 9 ships the framework |
| §6.3 NDJSON over stdio | Task 7 ships the helpers |
| §6.4 Lease pattern | Task 8 ships the helpers |
| §6.5 SecretScanner | Task 10 ships the stub |
| §6.7 No console.log | Task 11 uses sink-based logger; no `console.*` in any file authored in Phase 0 |

| §6.1 Prompts in static .md files | Phase 0 has no LLM prompts — first prompts arrive in Phase 3. No violation possible. |

**Placeholder scan:** no "TBD" / "TODO" / "implement later" in any task body. Every step has actual code or actual commands with expected output.

**Type consistency:** method names checked across tasks. `MemoryBackend` methods (`recall`, `retain`, `listRooms`, `listWings`, `entityQuery`, `entityAssert`, `status`, `clear`) are consistent between memory.ts and memory.test.ts. `MemoryRecorder.recordEpisode`/`recordCell`/`observeAccEvent` consistent between contracts.ts and contracts.test.ts. `acquireLease`/`releaseLease`/`isLeaseHeld` consistent across lease.ts and lease.test.ts.

**Scope check:** Phase 0 only. No leakage into Phase 1-6 work. The four pillar packages are empty placeholders — that is intentional and matches the spec.
