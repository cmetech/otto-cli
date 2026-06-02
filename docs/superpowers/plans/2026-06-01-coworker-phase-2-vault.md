# Phase 2 — otto-vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Graduate `@otto/coworker-vault` from `export {}` stub to a credential store with safe kernel handoff: `/connect jira prod` stores creds → `/sp new x --use jira:prod` spawns a kernel with `OTTO_DS_JIRA_PROD__*` env vars → cell code hits the Jira API.

**Architecture:** Vault package owns storage (chmod-600 per-entry JSON at `~/.otto/data_vault/` with workspace-first override), engine YAML registry (JIRA seed only), and credential injection (`CredentialInjector.injectEnv` builds `OTTO_DS_*` from a binding list). Slash commands `/connect`, `/datasource`, `/audit` live in a new `coworker-vault` extension. Scratchpad gains a `bindings: string[]` field on `meta.json` (schema v3 → v4); `ChildProcessRuntime.spawn` runs `vault.injectEnv` before `child_process.spawn`. `SecretScanner` (already in `@otto/coworker-utils`) wires into `kernel-bindings.ts` to redact cell stdout/stderr before journal write. New shared `AuditLog` at `~/.otto/audit.jsonl` is the sink for vault ops and secret-scanner hits (and Phase 3+ producers).

**Tech Stack:** TypeScript (Node ESM), `vitest` for unit tests, `@clack/prompts` for the `/connect` wizard, `yaml` for engine parsing, `zod` for engine schema validation, POSIX flock via existing `@otto/coworker-utils/lease.ts` style for audit rotation guard.

**Branch:** `feat/coworker-phase-2-vault` (already created from main).

**Spec:** `docs/superpowers/specs/2026-06-01-coworker-phase-2-vault-design.md`.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `packages/coworker-utils/src/audit-log.ts` | Shared append-only JSONL log at `~/.otto/audit.jsonl`; rotation at 10 MB; producer-tagged records. Vault is one producer; secret-scanner is another. |
| `packages/coworker-utils/src/audit-log.test.ts` | Unit tests for append, filter, rotation. |
| `packages/coworker-vault/src/types.ts` | `EntryRef`, `VaultEntry`, `EngineDefinition`, `EngineField`, `BindingList`. |
| `packages/coworker-vault/src/errors.ts` | `EngineNotFound`, `EngineValidationError`, `VaultEntryNotFound`, `VaultEntryMalformed`, `BindingRefMalformed`, `BindingNotFound`. |
| `packages/coworker-vault/src/vault-keep.ts` | `VAULT_KEEP = '[VAULT_KEEP]'` constant + edit-merge helper. |
| `packages/coworker-vault/src/vault-keep.test.ts` | Sentinel preserve/reject behavior. |
| `packages/coworker-vault/src/engine-registry.ts` | Load + validate engine YAMLs from builtin/user/workspace; precedence; lookup by id. |
| `packages/coworker-vault/src/engine-registry.test.ts` | YAML parse, zod validation, precedence, unknown-key tolerance. |
| `packages/coworker-vault/src/engines/jira.yaml` | JIRA seed (the only v1 engine). |
| `packages/coworker-vault/src/data-vault.ts` | `LocalDataVault.set/get/remove/list`; atomic write; chmod 600; workspace-first resolve; `_last_modified.json` sidecar. |
| `packages/coworker-vault/src/data-vault.test.ts` | Round-trip, atomic write, chmod, resolve precedence, sidecar correctness, orphan `.tmp` recovery. |
| `packages/coworker-vault/src/injector.ts` | `CredentialInjector.injectEnv` translates bindings → `OTTO_DS_*` env block; emits audit `inject` records; `clearEnv()` defensive no-op. |
| `packages/coworker-vault/src/injector.test.ts` | Env-var naming, strict vs loose missing-binding, audit emission, baseEnv immutability. |
| `packages/coworker-vault/src/index.ts` | Public re-exports. |
| `src/resources/extensions/coworker-vault/extension-manifest.json` | Extension declaration: commands `connect`, `datasource`, `audit`. |
| `src/resources/extensions/coworker-vault/connect-command.ts` | `/connect` wizard. |
| `src/resources/extensions/coworker-vault/connect-command.test.ts` | Wizard happy path, edit path, sentinel handling. |
| `src/resources/extensions/coworker-vault/datasource-command.ts` | `/datasource list/edit/remove/test`. |
| `src/resources/extensions/coworker-vault/datasource-command.test.ts` | Each subcommand path. |
| `src/resources/extensions/coworker-vault/audit-command.ts` | `/audit` reader with filters. |
| `src/resources/extensions/coworker-vault/audit-command.test.ts` | Filters, default 50-row truncation, `--json` mode. |
| `packages/coworker-scratchpad/src/staleness-banner.ts` | Compute staleness banner for bound scratchpads. |
| `packages/coworker-scratchpad/src/staleness-banner.test.ts` | One-shot per (scratchpad, binding, session); trigger condition. |
| `packages/coworker-scratchpad/tests/vault-integration.test.ts` | End-to-end vault + scratchpad integration test. |
| `docs/superpowers/notes/2026-06-XX-phase-2-vault-smoke.md` | Manual smoke checklist (written by Task 19). |

### Modified files

| Path | Change |
|---|---|
| `packages/coworker-utils/src/index.ts` | Re-export `audit-log.js`. |
| `packages/coworker-vault/package.json` | Add `dependencies`: `@otto/coworker-utils`, `yaml`, `zod`. |
| `packages/coworker-vault/tsconfig.json` | Add YAML asset copy step (engines/*.yaml ships in dist) — verify against existing pattern. |
| `packages/coworker-scratchpad/src/scratchpad-manager.ts` | Bump `META_SCHEMA_VERSION` 3 → 4; add `bindings: string[]` to meta; migration 3→4; `create()` accepts `bindings`. |
| `packages/coworker-scratchpad/src/child-process-runtime.ts` | Spawn calls `vault.injectEnv` to build env; stores `spawnTime`. |
| `packages/coworker-scratchpad/src/kernel-bindings.ts` | Wrap cell stdout/stderr through `SecretScanner.scan` + redact path before journal write; emit audit records. |
| `src/resources/extensions/coworker-scratchpad/sp-command.ts` | Add `use`, `unuse` subcommands; `list` shows binding count; `new` accepts `--use`; `fork` copies bindings; emit staleness banner on `attach`. |
| `src/resources/extensions/coworker-scratchpad/sp-command.test.ts` | Cover the new subcommands. |
| `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` | Update Phase 2 milestone to JIRA-first wording; note ServiceNow/Datadog/etc. seeds deferred. |

---

## Tasks

### Task 1: AuditLog primitive in `@otto/coworker-utils`

**Files:**
- Create: `packages/coworker-utils/src/audit-log.ts`
- Create: `packages/coworker-utils/src/audit-log.test.ts`
- Modify: `packages/coworker-utils/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-utils/src/audit-log.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, type AuditRecord } from './audit-log.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'audit-')); }

describe('AuditLog', () => {
  it('appends a record as one JSONL line', () => {
    const dir = tmp();
    const log = new AuditLog({ path: join(dir, 'audit.jsonl') });
    const rec: AuditRecord = {
      _schema: 1, ts: '2026-06-01T00:00:00.000Z',
      producer: 'vault', action: 'set', detail: { engine: 'jira', name: 'prod' },
    };
    log.append(rec);
    const text = readFileSync(join(dir, 'audit.jsonl'), 'utf8');
    expect(text.split('\n').filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(text.trim())).toMatchObject(rec);
  });

  it('reads records back, newest first, with filters', async () => {
    const dir = tmp();
    const log = new AuditLog({ path: join(dir, 'audit.jsonl') });
    log.append({ _schema: 1, ts: '2026-06-01T00:00:00.000Z', producer: 'vault', action: 'set', detail: {} });
    log.append({ _schema: 1, ts: '2026-06-01T00:00:01.000Z', producer: 'secret-scanner', action: 'redact', severity: 'warn', detail: {} });
    log.append({ _schema: 1, ts: '2026-06-01T00:00:02.000Z', producer: 'vault', action: 'get', detail: {} });
    const all: AuditRecord[] = [];
    for await (const r of log.read({})) all.push(r);
    expect(all.map(r => r.action)).toEqual(['get', 'redact', 'set']);
    const vaultOnly: AuditRecord[] = [];
    for await (const r of log.read({ producer: 'vault' })) vaultOnly.push(r);
    expect(vaultOnly.map(r => r.action)).toEqual(['get', 'set']);
  });

  it('rotates at maxBytes threshold', () => {
    const dir = tmp();
    const log = new AuditLog({ path: join(dir, 'audit.jsonl'), maxBytes: 200 });
    const big = 'x'.repeat(60);
    for (let i = 0; i < 5; i++) {
      log.append({ _schema: 1, ts: `2026-06-01T00:00:0${i}.000Z`, producer: 'vault', action: 'set', detail: { pad: big } });
    }
    expect(existsSync(join(dir, 'audit.1.jsonl'))).toBe(true);
    expect(statSync(join(dir, 'audit.jsonl')).size).toBeLessThan(200);
  });

  it('keeps at most 5 rotated tails', () => {
    const dir = tmp();
    const log = new AuditLog({ path: join(dir, 'audit.jsonl'), maxBytes: 100, maxTails: 5 });
    const pad = 'x'.repeat(40);
    for (let i = 0; i < 50; i++) {
      log.append({ _schema: 1, ts: `2026-06-01T00:00:${String(i).padStart(2,'0')}.000Z`, producer: 'vault', action: 'set', detail: { pad } });
    }
    for (let n = 1; n <= 5; n++) expect(existsSync(join(dir, `audit.${n}.jsonl`))).toBe(true);
    expect(existsSync(join(dir, 'audit.6.jsonl'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/coworker-utils && npx vitest run audit-log.test.ts`
Expected: FAIL — `Cannot find module './audit-log.js'` or similar.

- [ ] **Step 3: Implement `audit-log.ts`**

```typescript
// packages/coworker-utils/src/audit-log.ts
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuditRecord {
  _schema: 1;
  ts: string;
  producer: string;
  action: string;
  severity?: 'info' | 'warn';
  sessionId?: string;
  scratchpadName?: string;
  pid?: number;
  detail: Record<string, unknown>;
}

export interface AuditLogOptions {
  path: string;
  maxBytes?: number;
  maxTails?: number;
}

export interface AuditFilter {
  since?: string;             // ISO-8601 lower bound (inclusive)
  producer?: string;
  action?: string;
  severity?: 'info' | 'warn';
  engineId?: string;          // matches detail.engine if present
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TAILS = 5;

export class AuditLog {
  private readonly path: string;
  private readonly maxBytes: number;
  private readonly maxTails: number;

  constructor(opts: AuditLogOptions) {
    this.path = opts.path;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxTails = opts.maxTails ?? DEFAULT_MAX_TAILS;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
  }

  append(record: AuditRecord): void {
    this.rotateIfNeeded();
    const line = JSON.stringify(record) + '\n';
    try {
      appendFileSync(this.path, line, { mode: 0o600 });
    } catch (err) {
      process.stderr.write(`audit: write failed (${(err as Error).message}); continuing\n`);
    }
  }

  async *read(filter: AuditFilter): AsyncIterable<AuditRecord> {
    const files = this.listLogFiles().reverse(); // newest tail last in iteration to keep memory low? but we want newest first overall.
    const records: AuditRecord[] = [];
    for (const f of files) {
      if (!existsSync(f)) continue;
      const text = readFileSync(f, 'utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        try {
          const rec = JSON.parse(line) as AuditRecord;
          if (!this.matches(rec, filter)) continue;
          records.push(rec);
        } catch { /* skip malformed line */ }
      }
    }
    records.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    for (const r of records) yield r;
  }

  private listLogFiles(): string[] {
    const out = [this.path];
    for (let n = 1; n <= this.maxTails; n++) {
      out.push(`${this.path.replace(/\.jsonl$/, '')}.${n}.jsonl`);
    }
    return out;
  }

  private matches(rec: AuditRecord, f: AuditFilter): boolean {
    if (f.producer && rec.producer !== f.producer) return false;
    if (f.action && rec.action !== f.action) return false;
    if (f.severity && rec.severity !== f.severity) return false;
    if (f.since && rec.ts < f.since) return false;
    if (f.engineId && (rec.detail as { engine?: string }).engine !== f.engineId) return false;
    return true;
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.path)) return;
    const size = statSync(this.path).size;
    if (size < this.maxBytes) return;
    // Find next available tail slot; if maxTails full, drop tail N (delete) before shifting.
    const base = this.path.replace(/\.jsonl$/, '');
    const tailN = `${base}.${this.maxTails}.jsonl`;
    if (existsSync(tailN)) unlinkSync(tailN);
    for (let n = this.maxTails - 1; n >= 1; n--) {
      const src = `${base}.${n}.jsonl`;
      const dst = `${base}.${n + 1}.jsonl`;
      if (existsSync(src)) renameSync(src, dst);
    }
    renameSync(this.path, `${base}.1.jsonl`);
    closeSync(openSync(this.path, 'w', 0o600));
  }
}
```

- [ ] **Step 4: Wire export**

Edit `packages/coworker-utils/src/index.ts` — append:
```typescript
export * from './audit-log.js';
```

- [ ] **Step 5: Run tests; verify pass**

Run: `cd packages/coworker-utils && npx vitest run audit-log.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: Build + commit**

```bash
cd packages/coworker-utils && npx tsc -p tsconfig.json && cd ../..
git add packages/coworker-utils/src/audit-log.ts packages/coworker-utils/src/audit-log.test.ts packages/coworker-utils/src/index.ts
git commit -m "feat(coworker-2): AuditLog primitive in coworker-utils (Phase 2 Task 1)"
```

---

### Task 2: Vault types and errors

**Files:**
- Create: `packages/coworker-vault/src/types.ts`
- Create: `packages/coworker-vault/src/errors.ts`
- Create: `packages/coworker-vault/src/errors.test.ts`
- Modify: `packages/coworker-vault/package.json`

- [ ] **Step 1: Update `packages/coworker-vault/package.json`**

```json
{
  "name": "@otto/coworker-vault",
  "version": "0.0.1",
  "description": "Otto co-worker package: coworker-vault",
  "type": "module",
  "otto": { "linkable": true, "scope": "@otto", "name": "coworker-vault" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
  },
  "dependencies": {
    "@otto/coworker-utils": "*",
    "yaml": "^2.8.2",
    "zod": "^4.4.3"
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
// packages/coworker-vault/src/types.ts
export interface EntryRef {
  engine: string;        // e.g., 'jira'
  name: string;          // e.g., 'prod'
}

export interface EngineField {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  default?: string;
}

export interface EngineDefinition {
  schema_version: 1;
  id: string;
  label: string;
  description?: string;
  fields: EngineField[];
}

export interface VaultEntry {
  _schema: 1;
  engine: string;
  name: string;
  fields: Record<string, string>;
  created_at: string;
  last_modified_at: string;
}

export type EngineSource = 'builtin' | 'user' | 'workspace';
export type VaultScope = 'global' | 'workspace';
```

- [ ] **Step 3: Write `errors.test.ts`**

```typescript
// packages/coworker-vault/src/errors.test.ts
import { describe, expect, it } from 'vitest';
import {
  EngineNotFound, EngineValidationError, VaultEntryNotFound,
  VaultEntryMalformed, BindingRefMalformed, BindingNotFound,
} from './errors.js';

describe('vault errors', () => {
  it('EngineNotFound carries id and is named', () => {
    const e = new EngineNotFound('servicenow');
    expect(e.id).toBe('servicenow');
    expect(e.name).toBe('EngineNotFound');
    expect(e.message).toContain('servicenow');
  });

  it('VaultEntryNotFound carries searched paths', () => {
    const e = new VaultEntryNotFound('jira', 'prod', ['/ws/path', '/global/path']);
    expect(e.engine).toBe('jira');
    expect(e.entryName).toBe('prod');
    expect(e.searched).toEqual(['/ws/path', '/global/path']);
  });

  it('BindingRefMalformed carries input', () => {
    const e = new BindingRefMalformed('jira/prod');
    expect(e.input).toBe('jira/prod');
    expect(e.message).toContain('jira:prod');
  });

  it('BindingNotFound carries ref', () => {
    const e = new BindingNotFound('jira:prod');
    expect(e.ref).toBe('jira:prod');
  });

  it('EngineValidationError carries path and zod issue', () => {
    const e = new EngineValidationError('/etc/engines/x.yaml', 'fields[0].name: invalid');
    expect(e.yamlPath).toBe('/etc/engines/x.yaml');
    expect(e.issue).toBe('fields[0].name: invalid');
  });

  it('VaultEntryMalformed carries path', () => {
    const e = new VaultEntryMalformed('/p/jira-prod.json', 'bad json');
    expect(e.path).toBe('/p/jira-prod.json');
  });
});
```

- [ ] **Step 4: Implement `errors.ts`**

```typescript
// packages/coworker-vault/src/errors.ts
export class EngineNotFound extends Error {
  constructor(public readonly id: string) {
    super(`Unknown engine: ${id}. Available engines can be listed with /datasource list.`);
    this.name = 'EngineNotFound';
  }
}

export class EngineValidationError extends Error {
  constructor(public readonly yamlPath: string, public readonly issue: string) {
    super(`Engine ${yamlPath}: ${issue}`);
    this.name = 'EngineValidationError';
  }
}

export class VaultEntryNotFound extends Error {
  constructor(public readonly engine: string, public readonly entryName: string, public readonly searched: string[]) {
    super(`Vault entry not found: ${engine}:${entryName}. Searched: ${searched.join(', ')}. Use /connect ${engine} ${entryName} to create.`);
    this.name = 'VaultEntryNotFound';
  }
}

export class VaultEntryMalformed extends Error {
  constructor(public readonly path: string, public readonly reason: string) {
    super(`Vault entry corrupt: ${path} (${reason}). Move it aside and re-create with /connect.`);
    this.name = 'VaultEntryMalformed';
  }
}

export class BindingRefMalformed extends Error {
  constructor(public readonly input: string) {
    super(`Bad binding: ${input}. Expected <engine>:<name>, e.g., jira:prod.`);
    this.name = 'BindingRefMalformed';
  }
}

export class BindingNotFound extends Error {
  constructor(public readonly ref: string) {
    super(`Vault binding not resolvable: ${ref}. The entry may have been removed. Use /datasource list to inspect.`);
    this.name = 'BindingNotFound';
  }
}
```

- [ ] **Step 5: Run; pass**

Run: `cd packages/coworker-vault && npx vitest run errors.test.ts`
Expected: 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/coworker-vault/package.json packages/coworker-vault/src/types.ts packages/coworker-vault/src/errors.ts packages/coworker-vault/src/errors.test.ts
git commit -m "feat(coworker-2): vault types + error taxonomy (Phase 2 Task 2)"
```

---

### Task 3: `VAULT_KEEP` sentinel + edit-merge helper

**Files:**
- Create: `packages/coworker-vault/src/vault-keep.ts`
- Create: `packages/coworker-vault/src/vault-keep.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-vault/src/vault-keep.test.ts
import { describe, expect, it } from 'vitest';
import { VAULT_KEEP, mergeWithSentinel, assertNoSentinelInCreate } from './vault-keep.js';
import type { EngineField } from './types.js';

const FIELDS: EngineField[] = [
  { name: 'url',   label: 'URL',   secret: false, required: true },
  { name: 'token', label: 'Token', secret: true,  required: true },
  { name: 'email', label: 'Email', secret: false, required: false },
];

describe('VAULT_KEEP', () => {
  it('is the literal string "[VAULT_KEEP]"', () => {
    expect(VAULT_KEEP).toBe('[VAULT_KEEP]');
  });

  describe('mergeWithSentinel (edit mode)', () => {
    it('preserves stored secret when submitted value is the sentinel', () => {
      const stored = { url: 'https://old', token: 'SECRET', email: 'a@b' };
      const submitted = { url: 'https://new', token: VAULT_KEEP, email: 'c@d' };
      const out = mergeWithSentinel(FIELDS, stored, submitted);
      expect(out).toEqual({ url: 'https://new', token: 'SECRET', email: 'c@d' });
    });

    it('replaces stored secret when submitted value differs from the sentinel', () => {
      const stored = { url: 'u', token: 'OLD', email: 'e' };
      const submitted = { url: 'u', token: 'NEW', email: 'e' };
      const out = mergeWithSentinel(FIELDS, stored, submitted);
      expect(out.token).toBe('NEW');
    });

    it('ignores sentinel for non-secret fields (treats it as literal new value)', () => {
      const stored = { url: 'u', token: 't', email: 'e' };
      const submitted = { url: VAULT_KEEP, token: 't', email: 'e' };
      const out = mergeWithSentinel(FIELDS, stored, submitted);
      expect(out.url).toBe(VAULT_KEEP);
    });
  });

  describe('assertNoSentinelInCreate', () => {
    it('throws when a secret field input equals the sentinel', () => {
      expect(() => assertNoSentinelInCreate(FIELDS, { url: 'u', token: VAULT_KEEP, email: 'e' }))
        .toThrow(/VAULT_KEEP is reserved/);
    });

    it('passes when no secret field equals the sentinel', () => {
      expect(() => assertNoSentinelInCreate(FIELDS, { url: 'u', token: 'real', email: 'e' })).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run; verify FAIL**

Run: `cd packages/coworker-vault && npx vitest run vault-keep.test.ts`
Expected: FAIL — missing module.

- [ ] **Step 3: Implement `vault-keep.ts`**

```typescript
// packages/coworker-vault/src/vault-keep.ts
import type { EngineField } from './types.js';

export const VAULT_KEEP = '[VAULT_KEEP]' as const;

export function mergeWithSentinel(
  fields: EngineField[],
  stored: Record<string, string>,
  submitted: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const sub = submitted[f.name];
    if (f.secret && sub === VAULT_KEEP) {
      out[f.name] = stored[f.name] ?? '';
    } else {
      out[f.name] = sub ?? '';
    }
  }
  return out;
}

export function assertNoSentinelInCreate(
  fields: EngineField[],
  submitted: Record<string, string>,
): void {
  for (const f of fields) {
    if (f.secret && submitted[f.name] === VAULT_KEEP) {
      throw new Error(`VAULT_KEEP is reserved; pick a real value for field "${f.name}".`);
    }
  }
}
```

- [ ] **Step 4: Run; verify pass**

Run: `cd packages/coworker-vault && npx vitest run vault-keep.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-vault/src/vault-keep.ts packages/coworker-vault/src/vault-keep.test.ts
git commit -m "feat(coworker-2): VAULT_KEEP sentinel + merge helper (Phase 2 Task 3)"
```

---

### Task 4: EngineRegistry + JIRA seed

**Files:**
- Create: `packages/coworker-vault/src/engine-registry.ts`
- Create: `packages/coworker-vault/src/engine-registry.test.ts`
- Create: `packages/coworker-vault/src/engines/jira.yaml`
- Modify: `packages/coworker-vault/tsconfig.json` (copy YAML to dist)

- [ ] **Step 1: Write the JIRA seed**

```yaml
# packages/coworker-vault/src/engines/jira.yaml
schema_version: 1
id: jira
label: Jira
description: Atlassian Jira Cloud / Server via Basic auth (email + API token)
fields:
  - name: url
    label: "Instance URL (e.g. https://yourorg.atlassian.net)"
    secret: false
    required: true
  - name: email
    label: "Atlassian account email"
    secret: false
    required: true
  - name: token
    label: "API token (from id.atlassian.com → Account → Security)"
    secret: true
    required: true
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/coworker-vault/src/engine-registry.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { EngineRegistry } from './engine-registry.js';
import { EngineNotFound } from './errors.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'engines-')); }

describe('EngineRegistry', () => {
  it('loads the bundled JIRA seed by id', async () => {
    const reg = await EngineRegistry.load({ userDir: tmp(), workspaceDir: undefined });
    const jira = reg.get('jira');
    expect(jira).toBeDefined();
    expect(jira!.id).toBe('jira');
    expect(jira!.fields.map(f => f.name)).toEqual(['url', 'email', 'token']);
    expect(jira!.fields.find(f => f.name === 'token')!.secret).toBe(true);
  });

  it('throws EngineNotFound on unknown id', async () => {
    const reg = await EngineRegistry.load({ userDir: tmp(), workspaceDir: undefined });
    expect(() => reg.require('servicenow')).toThrow(EngineNotFound);
  });

  it('workspace YAML overrides user YAML overrides builtin', async () => {
    const userDir = tmp();
    const wsDir = tmp();
    writeFileSync(join(userDir, 'jira.yaml'), `schema_version: 1
id: jira
label: Jira (user)
fields:
  - { name: url, label: U, secret: false, required: true }
`);
    writeFileSync(join(wsDir, 'jira.yaml'), `schema_version: 1
id: jira
label: Jira (workspace)
fields:
  - { name: url, label: W, secret: false, required: true }
`);
    const reg = await EngineRegistry.load({ userDir, workspaceDir: wsDir });
    expect(reg.get('jira')!.label).toBe('Jira (workspace)');
  });

  it('accepts unknown top-level keys (forward compat with test: block)', async () => {
    const userDir = tmp();
    writeFileSync(join(userDir, 'future.yaml'), `schema_version: 1
id: future
label: Future
fields:
  - { name: url, label: U, secret: false, required: true }
test:
  method: GET
  url: "{{url}}/ping"
`);
    const reg = await EngineRegistry.load({ userDir, workspaceDir: undefined });
    expect(reg.get('future')!.id).toBe('future');
  });

  it('skips engines with malformed YAML and continues loading others', async () => {
    const userDir = tmp();
    writeFileSync(join(userDir, 'broken.yaml'), 'schema_version: 1\nid:\nfields: []\n');
    const reg = await EngineRegistry.load({ userDir, workspaceDir: undefined });
    // jira (bundled) still loads; broken skipped
    expect(reg.get('jira')).toBeDefined();
    expect(reg.get('broken')).toBeUndefined();
  });

  it('field name must match /^[a-z][a-z0-9_]*$/', async () => {
    const userDir = tmp();
    writeFileSync(join(userDir, 'bad.yaml'), `schema_version: 1
id: bad
label: Bad
fields:
  - { name: "Bad-Name", label: X, secret: false, required: true }
`);
    const reg = await EngineRegistry.load({ userDir, workspaceDir: undefined });
    expect(reg.get('bad')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run; verify FAIL**

Run: `cd packages/coworker-vault && npx vitest run engine-registry.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `engine-registry.ts`**

```typescript
// packages/coworker-vault/src/engine-registry.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type { EngineDefinition, EngineSource } from './types.js';
import { EngineNotFound, EngineValidationError } from './errors.js';

const ENGINE_FIELD_SCHEMA = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'name must match /^[a-z][a-z0-9_]*$/'),
  label: z.string().min(1),
  secret: z.boolean(),
  required: z.boolean(),
  default: z.string().optional(),
});

const ENGINE_SCHEMA = z.object({
  schema_version: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id must match /^[a-z][a-z0-9-]*$/'),
  label: z.string().min(1),
  description: z.string().optional(),
  fields: z.array(ENGINE_FIELD_SCHEMA).min(1),
}).passthrough(); // accept unknown top-level keys (e.g., test:)

function builtinDir(): string {
  // src/engine-registry.ts → dist/engine-registry.js at runtime; engines/ ships in dist via tsconfig copy.
  return join(dirname(fileURLToPath(import.meta.url)), 'engines');
}

export interface RegistryResolution {
  engine: EngineDefinition;
  source: EngineSource;
}

export interface LoadOptions {
  userDir?: string;
  workspaceDir?: string | undefined;
}

export class EngineRegistry {
  private constructor(private readonly resolutions: Map<string, RegistryResolution>) {}

  static async load(opts: LoadOptions = {}): Promise<EngineRegistry> {
    const map = new Map<string, RegistryResolution>();
    EngineRegistry.loadDir(builtinDir(), 'builtin', map);
    if (opts.userDir && existsSync(opts.userDir)) {
      EngineRegistry.loadDir(opts.userDir, 'user', map);
    }
    if (opts.workspaceDir && existsSync(opts.workspaceDir)) {
      EngineRegistry.loadDir(opts.workspaceDir, 'workspace', map);
    }
    return new EngineRegistry(map);
  }

  private static loadDir(dir: string, source: EngineSource, out: Map<string, RegistryResolution>): void {
    if (!existsSync(dir)) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml')); }
    catch { return; }
    for (const f of entries) {
      const path = join(dir, f);
      let parsed: unknown;
      try { parsed = parseYaml(readFileSync(path, 'utf8')); }
      catch (err) {
        process.stderr.write(`engine-registry: parse failed ${path}: ${(err as Error).message}\n`);
        continue;
      }
      const result = ENGINE_SCHEMA.safeParse(parsed);
      if (!result.success) {
        process.stderr.write(`engine-registry: schema invalid ${path}: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}\n`);
        continue;
      }
      out.set(result.data.id, { engine: result.data as EngineDefinition, source });
    }
  }

  get(id: string): EngineDefinition | undefined {
    return this.resolutions.get(id)?.engine;
  }

  require(id: string): EngineDefinition {
    const r = this.resolutions.get(id);
    if (!r) throw new EngineNotFound(id);
    return r.engine;
  }

  all(): RegistryResolution[] {
    return [...this.resolutions.values()];
  }
}

export { ENGINE_SCHEMA }; // re-export for tests that need the validator
export { EngineValidationError };
```

- [ ] **Step 5: Configure YAML copy to dist**

Inspect `packages/coworker-vault/tsconfig.json`. The default `tsc` does not copy `.yaml`. Add a postbuild step in `package.json` scripts:

```json
"build": "tsc -p tsconfig.json && node -e \"const fs=require('fs');const path=require('path');const src='src/engines';const dst='dist/engines';fs.mkdirSync(dst,{recursive:true});for(const f of fs.readdirSync(src))if(f.endsWith('.yaml'))fs.copyFileSync(path.join(src,f),path.join(dst,f));\""
```

Apply the same edit to `build:publish`.

- [ ] **Step 6: Run; verify pass**

Run: `cd packages/coworker-vault && npx vitest run engine-registry.test.ts`
Expected: 6 tests pass. (Test reads from `src/engines/` because vitest runs source, not dist.)

- [ ] **Step 7: Build + smoke**

Run: `cd packages/coworker-vault && npm run build`
Expected: `dist/engines/jira.yaml` exists.

- [ ] **Step 8: Commit**

```bash
git add packages/coworker-vault/src/engine-registry.ts packages/coworker-vault/src/engine-registry.test.ts packages/coworker-vault/src/engines/jira.yaml packages/coworker-vault/package.json packages/coworker-vault/tsconfig.json
git commit -m "feat(coworker-2): EngineRegistry + JIRA seed (Phase 2 Task 4)"
```

---

### Task 5: LocalDataVault — storage core (set/get/remove + atomic write + chmod)

**Files:**
- Create: `packages/coworker-vault/src/data-vault.ts`
- Create: `packages/coworker-vault/src/data-vault.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-vault/src/data-vault.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from '@otto/coworker-utils';
import { LocalDataVault } from './data-vault.js';
import { VaultEntryNotFound, VaultEntryMalformed, BindingRefMalformed } from './errors.js';

function ctx() {
  const root = mkdtempSync(join(tmpdir(), 'vault-'));
  const auditPath = join(root, 'audit.jsonl');
  return {
    root,
    auditPath,
    audit: new AuditLog({ path: auditPath }),
    globalDir: join(root, 'global'),
    wsDir: join(root, 'ws'),
  };
}

describe('LocalDataVault', () => {
  it('round-trips an entry through set/get', async () => {
    const c = ctx();
    const v = new LocalDataVault({ globalDir: c.globalDir, workspaceDir: undefined, audit: c.audit });
    await v.set({ engine: 'jira', name: 'prod' }, { url: 'u', email: 'e', token: 't' });
    const got = await v.get({ engine: 'jira', name: 'prod' });
    expect(got.fields).toEqual({ url: 'u', email: 'e', token: 't' });
    expect(got.engine).toBe('jira');
    expect(got.created_at).toBeTruthy();
  });

  it('stores files with mode 0600', async () => {
    const c = ctx();
    const v = new LocalDataVault({ globalDir: c.globalDir, workspaceDir: undefined, audit: c.audit });
    await v.set({ engine: 'jira', name: 'prod' }, { url: 'u' });
    const path = join(c.globalDir, 'data_vault', 'jira-prod.json');
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('throws VaultEntryNotFound when entry missing', async () => {
    const c = ctx();
    const v = new LocalDataVault({ globalDir: c.globalDir, workspaceDir: undefined, audit: c.audit });
    await expect(v.get({ engine: 'jira', name: 'missing' })).rejects.toThrow(VaultEntryNotFound);
  });

  it('throws VaultEntryMalformed when file is invalid JSON', async () => {
    const c = ctx();
    const v = new LocalDataVault({ globalDir: c.globalDir, workspaceDir: undefined, audit: c.audit });
    mkdirSync(join(c.globalDir, 'data_vault'), { recursive: true });
    writeFileSync(join(c.globalDir, 'data_vault', 'jira-prod.json'), 'not json');
    await expect(v.get({ engine: 'jira', name: 'prod' })).rejects.toThrow(VaultEntryMalformed);
  });

  it('atomic write does not leave torn files; orphan .tmp cleaned on next open', async () => {
    const c = ctx();
    mkdirSync(join(c.globalDir, 'data_vault'), { recursive: true });
    writeFileSync(join(c.globalDir, 'data_vault', 'jira-orphan.json.tmp'), 'partial');
    const v = new LocalDataVault({ globalDir: c.globalDir, workspaceDir: undefined, audit: c.audit });
    // construction sweeps orphans:
    expect(existsSync(join(c.globalDir, 'data_vault', 'jira-orphan.json.tmp'))).toBe(false);
  });

  it('remove deletes the entry file and emits audit', async () => {
    const c = ctx();
    const v = new LocalDataVault({ globalDir: c.globalDir, workspaceDir: undefined, audit: c.audit });
    await v.set({ engine: 'jira', name: 'prod' }, { url: 'u' });
    await v.remove({ engine: 'jira', name: 'prod' });
    expect(existsSync(join(c.globalDir, 'data_vault', 'jira-prod.json'))).toBe(false);
  });

  it('list returns entries with engine, name, scope, fields_set, last_modified', async () => {
    const c = ctx();
    const v = new LocalDataVault({ globalDir: c.globalDir, workspaceDir: undefined, audit: c.audit });
    await v.set({ engine: 'jira', name: 'prod' }, { url: 'u', email: 'e', token: 't' });
    await v.set({ engine: 'jira', name: 'test' }, { url: 'u2' });
    const rows = await v.list();
    const refs = rows.map(r => `${r.engine}:${r.name}`).sort();
    expect(refs).toEqual(['jira:prod', 'jira:test']);
    const prod = rows.find(r => r.name === 'prod')!;
    expect(prod.fields_set.sort()).toEqual(['email', 'token', 'url']);
    expect(prod.scope).toBe('global');
    expect(prod.last_modified_at).toBeTruthy();
  });

  it('parseRef parses jira:prod into { engine, name }', () => {
    expect(LocalDataVault.parseRef('jira:prod')).toEqual({ engine: 'jira', name: 'prod' });
  });

  it('parseRef throws BindingRefMalformed on bad input', () => {
    expect(() => LocalDataVault.parseRef('jira/prod')).toThrow(BindingRefMalformed);
    expect(() => LocalDataVault.parseRef('')).toThrow(BindingRefMalformed);
  });
});
```

- [ ] **Step 2: Run; verify FAIL**

Run: `cd packages/coworker-vault && npx vitest run data-vault.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `data-vault.ts` (storage core; resolution comes in Task 6)**

```typescript
// packages/coworker-vault/src/data-vault.ts
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditLog, type AuditRecord } from '@otto/coworker-utils';
import type { EntryRef, VaultEntry, VaultScope } from './types.js';
import { BindingRefMalformed, VaultEntryMalformed, VaultEntryNotFound } from './errors.js';

export interface LocalDataVaultOptions {
  globalDir: string;          // path of the GLOBAL .otto-style root (NOT including /data_vault)
  workspaceDir?: string;      // path of the WORKSPACE .otto-style root (NOT including /data_vault), if any
  audit: AuditLog;
  now?: () => string;
}

export interface ListedEntry {
  engine: string;
  name: string;
  scope: VaultScope;
  fields_set: string[];
  last_modified_at: string;
}

const REF_RE = /^([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)$/;

export class LocalDataVault {
  private readonly globalRoot: string;
  private readonly workspaceRoot?: string;
  private readonly audit: AuditLog;
  private readonly now: () => string;

  constructor(opts: LocalDataVaultOptions) {
    this.globalRoot = opts.globalDir;
    this.workspaceRoot = opts.workspaceDir;
    this.audit = opts.audit;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.sweepOrphans(this.globalVaultDir());
    if (this.workspaceRoot) this.sweepOrphans(this.workspaceVaultDir()!);
  }

  static parseRef(input: string): EntryRef {
    const m = REF_RE.exec(input);
    if (!m) throw new BindingRefMalformed(input);
    return { engine: m[1]!, name: m[2]! };
  }

  static formatRef(ref: EntryRef): string {
    return `${ref.engine}:${ref.name}`;
  }

  private globalVaultDir(): string { return join(this.globalRoot, 'data_vault'); }
  private workspaceVaultDir(): string | undefined { return this.workspaceRoot ? join(this.workspaceRoot, 'data_vault') : undefined; }

  private fileNameFor(ref: EntryRef): string { return `${ref.engine}-${ref.name}.json`; }

  private resolveScope(ref: EntryRef): { dir: string; scope: VaultScope } | null {
    const ws = this.workspaceVaultDir();
    if (ws && existsSync(join(ws, this.fileNameFor(ref)))) return { dir: ws, scope: 'workspace' };
    if (existsSync(join(this.globalVaultDir(), this.fileNameFor(ref)))) return { dir: this.globalVaultDir(), scope: 'global' };
    return null;
  }

  private writeScope(forceWorkspace: boolean): { dir: string; scope: VaultScope } {
    if (forceWorkspace) {
      const ws = this.workspaceVaultDir();
      if (!ws) throw new Error('Workspace scope requested but no workspace root configured.');
      return { dir: ws, scope: 'workspace' };
    }
    const ws = this.workspaceVaultDir();
    if (ws && existsSync(ws)) return { dir: ws, scope: 'workspace' };
    return { dir: this.globalVaultDir(), scope: 'global' };
  }

  async set(ref: EntryRef, fields: Record<string, string>, opts: { forceWorkspace?: boolean } = {}): Promise<void> {
    const target = this.writeScope(opts.forceWorkspace ?? false);
    mkdirSync(target.dir, { recursive: true, mode: 0o700 });
    const path = join(target.dir, this.fileNameFor(ref));
    const tmp = `${path}.tmp`;
    const existing = existsSync(path) ? this.readEntry(path) : null;
    const ts = this.now();
    const entry: VaultEntry = {
      _schema: 1,
      engine: ref.engine,
      name: ref.name,
      fields,
      created_at: existing?.created_at ?? ts,
      last_modified_at: ts,
    };
    writeFileSync(tmp, JSON.stringify(entry, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    this.audit.append({
      _schema: 1, ts, producer: 'vault', action: 'set',
      detail: { engine: ref.engine, name: ref.name, scope: target.scope, fields_set: Object.keys(fields) },
    } satisfies AuditRecord);
  }

  async get(ref: EntryRef): Promise<VaultEntry> {
    const r = this.resolveScope(ref);
    if (!r) {
      const searched: string[] = [];
      const ws = this.workspaceVaultDir();
      if (ws) searched.push(join(ws, this.fileNameFor(ref)));
      searched.push(join(this.globalVaultDir(), this.fileNameFor(ref)));
      throw new VaultEntryNotFound(ref.engine, ref.name, searched);
    }
    const entry = this.readEntry(join(r.dir, this.fileNameFor(ref)));
    this.audit.append({
      _schema: 1, ts: this.now(), producer: 'vault', action: 'get',
      detail: { engine: ref.engine, name: ref.name, scope_resolved: r.scope },
    });
    return entry;
  }

  async remove(ref: EntryRef): Promise<void> {
    const r = this.resolveScope(ref);
    if (!r) throw new VaultEntryNotFound(ref.engine, ref.name, []);
    unlinkSync(join(r.dir, this.fileNameFor(ref)));
    this.audit.append({
      _schema: 1, ts: this.now(), producer: 'vault', action: 'remove',
      detail: { engine: ref.engine, name: ref.name, scope: r.scope },
    });
  }

  async list(): Promise<ListedEntry[]> {
    const out: ListedEntry[] = [];
    const collect = (dir: string | undefined, scope: VaultScope) => {
      if (!dir || !existsSync(dir)) return;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json') || f.startsWith('_')) continue;
        try {
          const entry = this.readEntry(join(dir, f));
          out.push({
            engine: entry.engine, name: entry.name, scope,
            fields_set: Object.keys(entry.fields),
            last_modified_at: entry.last_modified_at,
          });
        } catch { /* skip malformed */ }
      }
    };
    collect(this.workspaceVaultDir(), 'workspace');
    collect(this.globalVaultDir(), 'global');
    return out;
  }

  private readEntry(path: string): VaultEntry {
    let raw: string;
    try { raw = readFileSync(path, 'utf8'); }
    catch (err) { throw new VaultEntryMalformed(path, (err as Error).message); }
    let json: unknown;
    try { json = JSON.parse(raw); }
    catch (err) { throw new VaultEntryMalformed(path, `JSON parse: ${(err as Error).message}`); }
    if (!json || typeof json !== 'object' || (json as { _schema?: unknown })._schema !== 1) {
      throw new VaultEntryMalformed(path, 'unexpected _schema');
    }
    return json as VaultEntry;
  }

  private sweepOrphans(dir: string): void {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.json.tmp')) {
        try { unlinkSync(join(dir, f)); } catch { /* best effort */ }
      }
    }
  }
}
```

- [ ] **Step 4: Run; verify pass**

Run: `cd packages/coworker-vault && npx vitest run data-vault.test.ts`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-vault/src/data-vault.ts packages/coworker-vault/src/data-vault.test.ts
git commit -m "feat(coworker-2): LocalDataVault storage core (Phase 2 Task 5)"
```

---

### Task 6: Workspace-first resolution + `_last_modified.json` sidecar

**Files:**
- Modify: `packages/coworker-vault/src/data-vault.ts`
- Modify: `packages/coworker-vault/src/data-vault.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `data-vault.test.ts`:

```typescript
describe('LocalDataVault — workspace + sidecar', () => {
  it('resolves workspace entry over global', async () => {
    const c = ctx();
    const v = new LocalDataVault({ globalDir: c.globalDir, workspaceDir: c.wsDir, audit: c.audit });
    await v.set({ engine: 'jira', name: 'prod' }, { url: 'global' }, { forceWorkspace: false });
    // The first set landed at workspace because workspace dir exists; force global with raw write:
    mkdirSync(join(c.globalDir, 'data_vault'), { recursive: true });
    writeFileSync(join(c.globalDir, 'data_vault', 'jira-prod.json'), JSON.stringify({
      _schema: 1, engine: 'jira', name: 'prod', fields: { url: 'g' },
      created_at: '2026-06-01T00:00:00.000Z', last_modified_at: '2026-06-01T00:00:00.000Z',
    }, null, 2), { mode: 0o600 });
    const got = await v.get({ engine: 'jira', name: 'prod' });
    expect(got.fields.url).toBe('global');  // workspace wins
  });

  it('falls back to global when workspace entry absent', async () => {
    const c = ctx();
    mkdirSync(c.wsDir, { recursive: true });   // workspace dir exists but no data_vault inside
    const v = new LocalDataVault({ globalDir: c.globalDir, workspaceDir: c.wsDir, audit: c.audit });
    mkdirSync(join(c.globalDir, 'data_vault'), { recursive: true });
    writeFileSync(join(c.globalDir, 'data_vault', 'jira-prod.json'), JSON.stringify({
      _schema: 1, engine: 'jira', name: 'prod', fields: { url: 'g' },
      created_at: '2026-06-01T00:00:00.000Z', last_modified_at: '2026-06-01T00:00:00.000Z',
    }, null, 2), { mode: 0o600 });
    const got = await v.get({ engine: 'jira', name: 'prod' });
    expect(got.fields.url).toBe('g');
  });

  it('updates _last_modified.json on set; lookupLastModified reads it', async () => {
    const c = ctx();
    const v = new LocalDataVault({ globalDir: c.globalDir, workspaceDir: undefined, audit: c.audit });
    await v.set({ engine: 'jira', name: 'prod' }, { url: 'u' });
    const sidecarPath = join(c.globalDir, 'data_vault', '_last_modified.json');
    expect(existsSync(sidecarPath)).toBe(true);
    const data = JSON.parse(readFileSync(sidecarPath, 'utf8'));
    expect(data['jira:prod']).toBeTruthy();
    const ts = await v.lookupLastModified('jira:prod');
    expect(ts).toBe(data['jira:prod']);
  });

  it('lookupLastModified returns null for missing entries', async () => {
    const c = ctx();
    const v = new LocalDataVault({ globalDir: c.globalDir, workspaceDir: undefined, audit: c.audit });
    expect(await v.lookupLastModified('jira:missing')).toBeNull();
  });

  it('remove updates sidecar (key dropped)', async () => {
    const c = ctx();
    const v = new LocalDataVault({ globalDir: c.globalDir, workspaceDir: undefined, audit: c.audit });
    await v.set({ engine: 'jira', name: 'prod' }, { url: 'u' });
    await v.remove({ engine: 'jira', name: 'prod' });
    expect(await v.lookupLastModified('jira:prod')).toBeNull();
  });
});
```

- [ ] **Step 2: Run; verify NEW tests fail**

Run: `cd packages/coworker-vault && npx vitest run data-vault.test.ts`
Expected: previous 9 pass, 5 new fail (missing `lookupLastModified`, sidecar not written).

- [ ] **Step 3: Extend `data-vault.ts`**

Add the sidecar helpers and call them from `set` / `remove`. Add after the `now: () => string` private field section:

```typescript
  private sidecarPathFor(scope: VaultScope): string {
    const dir = scope === 'workspace' ? this.workspaceVaultDir()! : this.globalVaultDir();
    return join(dir, '_last_modified.json');
  }

  async lookupLastModified(refStr: string): Promise<string | null> {
    const ref = LocalDataVault.parseRef(refStr);
    const r = this.resolveScope(ref);
    if (!r) return null;
    const sidecar = this.readSidecar(this.sidecarPathFor(r.scope));
    return sidecar[refStr] ?? null;
  }

  private readSidecar(path: string): Record<string, string> {
    if (!existsSync(path)) return {};
    try { return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>; }
    catch { return {}; }
  }

  private writeSidecar(scope: VaultScope, mutate: (m: Record<string, string>) => void): void {
    const path = this.sidecarPathFor(scope);
    const data = this.readSidecar(path);
    mutate(data);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  }
```

Then at the end of `set`, after the audit append, add:

```typescript
    this.writeSidecar(target.scope, m => { m[LocalDataVault.formatRef(ref)] = ts; });
```

And at the end of `remove`, after the audit append, add:

```typescript
    this.writeSidecar(r.scope, m => { delete m[LocalDataVault.formatRef(ref)]; });
```

Also adjust `list()` to skip `_last_modified.json` (already skipped via `f.startsWith('_')`).

- [ ] **Step 4: Run; verify pass**

Run: `cd packages/coworker-vault && npx vitest run data-vault.test.ts`
Expected: 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-vault/src/data-vault.ts packages/coworker-vault/src/data-vault.test.ts
git commit -m "feat(coworker-2): workspace-first resolution + _last_modified.json sidecar (Phase 2 Task 6)"
```

---

### Task 7: CredentialInjector + `clearEnv` no-op

**Files:**
- Create: `packages/coworker-vault/src/injector.ts`
- Create: `packages/coworker-vault/src/injector.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-vault/src/injector.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from '@otto/coworker-utils';
import { LocalDataVault } from './data-vault.js';
import { CredentialInjector, clearEnv } from './injector.js';
import { BindingNotFound, BindingRefMalformed } from './errors.js';

function ctx() {
  const root = mkdtempSync(join(tmpdir(), 'vault-inj-'));
  const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
  const vault = new LocalDataVault({ globalDir: join(root, 'global'), workspaceDir: undefined, audit });
  return { root, audit, vault };
}

describe('CredentialInjector.injectEnv', () => {
  it('returns OTTO_DS_<ENGINE>_<NAME>__<FIELD> for each field', async () => {
    const { vault, audit } = ctx();
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'https://x', email: 'a@b', token: 't' });
    const inj = new CredentialInjector({ vault, audit });
    const env = await inj.injectEnv({ PATH: '/bin' }, ['jira:prod'], { scratchpadName: 'sp', sessionId: 's', pid: 1 });
    expect(env.OTTO_DS_JIRA_PROD__URL).toBe('https://x');
    expect(env.OTTO_DS_JIRA_PROD__EMAIL).toBe('a@b');
    expect(env.OTTO_DS_JIRA_PROD__TOKEN).toBe('t');
    expect(env.PATH).toBe('/bin');
  });

  it('uppercases entry name and replaces hyphens with underscores in env var name', async () => {
    const { vault, audit } = ctx();
    await vault.set({ engine: 'jira', name: 'prod-east-1' }, { url: 'https://x' });
    const inj = new CredentialInjector({ vault, audit });
    const env = await inj.injectEnv({}, ['jira:prod-east-1'], { scratchpadName: 'sp', sessionId: 's', pid: 1 });
    expect(env.OTTO_DS_JIRA_PROD_EAST_1__URL).toBe('https://x');
  });

  it('does not mutate baseEnv', async () => {
    const { vault, audit } = ctx();
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'u' });
    const inj = new CredentialInjector({ vault, audit });
    const base = { PATH: '/bin' };
    await inj.injectEnv(base, ['jira:prod'], { scratchpadName: 'sp', sessionId: 's', pid: 1 });
    expect((base as Record<string, string>).OTTO_DS_JIRA_PROD__URL).toBeUndefined();
  });

  it('strict mode (default) throws BindingNotFound for missing binding', async () => {
    const { vault, audit } = ctx();
    const inj = new CredentialInjector({ vault, audit });
    await expect(inj.injectEnv({}, ['jira:missing'], { scratchpadName: 'sp', sessionId: 's', pid: 1 }))
      .rejects.toThrow(BindingNotFound);
  });

  it('loose mode (OTTO_VAULT_MISSING_OK=1) skips missing binding and warns', async () => {
    const { vault, audit } = ctx();
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'u' });
    const inj = new CredentialInjector({ vault, audit });
    process.env.OTTO_VAULT_MISSING_OK = '1';
    try {
      const env = await inj.injectEnv({}, ['jira:prod', 'jira:missing'], { scratchpadName: 'sp', sessionId: 's', pid: 1 });
      expect(env.OTTO_DS_JIRA_PROD__URL).toBe('u');
      expect(env.OTTO_DS_JIRA_MISSING__URL).toBeUndefined();
    } finally {
      delete process.env.OTTO_VAULT_MISSING_OK;
    }
  });

  it('throws BindingRefMalformed on bad ref', async () => {
    const { vault, audit } = ctx();
    const inj = new CredentialInjector({ vault, audit });
    await expect(inj.injectEnv({}, ['jira/prod'], { scratchpadName: 'sp', sessionId: 's', pid: 1 }))
      .rejects.toThrow(BindingRefMalformed);
  });

  it('emits one audit "inject" record per binding with fields_injected (names only)', async () => {
    const { vault, audit, root } = ctx();
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'u', token: 't' });
    const inj = new CredentialInjector({ vault, audit });
    await inj.injectEnv({}, ['jira:prod'], { scratchpadName: 'sp', sessionId: 's', pid: 42 });
    const records: { action: string; detail: { fields_injected?: string[] } }[] = [];
    for await (const r of audit.read({ producer: 'vault', action: 'inject' })) records.push(r as never);
    expect(records).toHaveLength(1);
    expect(records[0]!.detail.fields_injected!.sort()).toEqual(['token', 'url']);
  });
});

describe('clearEnv', () => {
  it('removes OTTO_DS_* from a passed env block and returns count removed', () => {
    const env = { PATH: '/bin', OTTO_DS_JIRA_PROD__URL: 'x', FOO: 'bar' } as Record<string, string>;
    const removed = clearEnv(env);
    expect(env.OTTO_DS_JIRA_PROD__URL).toBeUndefined();
    expect(env.PATH).toBe('/bin');
    expect(removed).toBe(1);
  });
});
```

- [ ] **Step 2: Run; verify FAIL**

Run: `cd packages/coworker-vault && npx vitest run injector.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `injector.ts`**

```typescript
// packages/coworker-vault/src/injector.ts
import { AuditLog } from '@otto/coworker-utils';
import { LocalDataVault } from './data-vault.js';
import { BindingNotFound, VaultEntryNotFound } from './errors.js';

export interface CredentialInjectorOptions {
  vault: LocalDataVault;
  audit: AuditLog;
}

export interface InjectionContext {
  scratchpadName: string;
  sessionId: string;
  pid: number;
}

export class CredentialInjector {
  constructor(private readonly opts: CredentialInjectorOptions) {}

  async injectEnv(
    baseEnv: NodeJS.ProcessEnv,
    bindings: string[],
    ctx: InjectionContext,
  ): Promise<NodeJS.ProcessEnv> {
    const out: NodeJS.ProcessEnv = { ...baseEnv };
    const loose = process.env.OTTO_VAULT_MISSING_OK === '1';
    for (const refStr of bindings) {
      const ref = LocalDataVault.parseRef(refStr);
      let entry;
      try { entry = await this.opts.vault.get(ref); }
      catch (err) {
        if (err instanceof VaultEntryNotFound) {
          if (loose) {
            process.stderr.write(`vault: binding ${refStr} missing — skipped (OTTO_VAULT_MISSING_OK=1)\n`);
            this.opts.audit.append({
              _schema: 1, ts: new Date().toISOString(), producer: 'vault', action: 'inject-skipped',
              severity: 'warn', sessionId: ctx.sessionId, scratchpadName: ctx.scratchpadName, pid: ctx.pid,
              detail: { ref: refStr, reason: 'not-found' },
            });
            continue;
          }
          throw new BindingNotFound(refStr);
        }
        throw err;
      }
      for (const [field, value] of Object.entries(entry.fields)) {
        out[envVarName(ref.engine, ref.name, field)] = value;
      }
      this.opts.audit.append({
        _schema: 1, ts: new Date().toISOString(), producer: 'vault', action: 'inject',
        sessionId: ctx.sessionId, scratchpadName: ctx.scratchpadName, pid: ctx.pid,
        detail: { engine: ref.engine, name: ref.name, fields_injected: Object.keys(entry.fields) },
      });
    }
    return out;
  }

  async loadForBinding(_serviceName: string): Promise<null> {
    return null; // Phase 3+
  }
}

export function envVarName(engineId: string, entryName: string, fieldName: string): string {
  const e = engineId.replace(/-/g, '_').toUpperCase();
  const n = entryName.replace(/-/g, '_').toUpperCase();
  const f = fieldName.toUpperCase();
  return `OTTO_DS_${e}_${n}__${f}`;
}

export function clearEnv(env: NodeJS.ProcessEnv = process.env): number {
  let n = 0;
  for (const key of Object.keys(env)) {
    if (key.startsWith('OTTO_DS_')) {
      delete env[key];
      n++;
    }
  }
  return n;
}
```

- [ ] **Step 4: Run; verify pass**

Run: `cd packages/coworker-vault && npx vitest run injector.test.ts`
Expected: 8 tests pass.

- [ ] **Step 5: Wire public exports**

```typescript
// packages/coworker-vault/src/index.ts
export * from './types.js';
export * from './errors.js';
export * from './vault-keep.js';
export * from './engine-registry.js';
export * from './data-vault.js';
export * from './injector.js';
```

- [ ] **Step 6: Build the vault package end-to-end**

Run: `cd packages/coworker-vault && npm run build`
Expected: succeeds; `dist/engines/jira.yaml` present; no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/coworker-vault/src/injector.ts packages/coworker-vault/src/injector.test.ts packages/coworker-vault/src/index.ts
git commit -m "feat(coworker-2): CredentialInjector + clearEnv defensive no-op (Phase 2 Task 7)"
```

---

### Task 8: `coworker-vault` extension scaffold

**Files:**
- Create: `src/resources/extensions/coworker-vault/extension-manifest.json`
- Create: `src/resources/extensions/coworker-vault/index.ts`
- Create: `src/resources/extensions/coworker-vault/vault-singleton.ts`
- Create: `src/resources/extensions/coworker-vault/vault-singleton.test.ts`

This task creates the extension shell + a small singleton that constructs `LocalDataVault`, `AuditLog`, and `EngineRegistry` pointed at user-global and workspace roots. Subsequent tasks add the slash commands using this singleton.

- [ ] **Step 1: Write the manifest**

```json
{
  "id": "coworker-vault",
  "name": "Co-worker Vault",
  "version": "1.0.0",
  "description": "Credential vault: /connect wizard, /datasource manager, /audit reader",
  "tier": "bundled",
  "requires": { "platform": ">=2.29.0" },
  "provides": {
    "commands": ["connect", "datasource", "audit"],
    "hooks": ["session_shutdown"]
  }
}
```

- [ ] **Step 2: Write the singleton test**

```typescript
// src/resources/extensions/coworker-vault/vault-singleton.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultBundle } from './vault-singleton.js';

describe('vault singleton bundle', () => {
  it('constructs vault, audit, and registry for given roots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vault-bundle-'));
    const b = await createVaultBundle({ globalDir: join(root, 'global'), workspaceDir: undefined });
    expect(b.vault).toBeDefined();
    expect(b.audit).toBeDefined();
    expect(b.registry).toBeDefined();
    expect(b.registry.get('jira')).toBeDefined();
  });

  it('honors workspace dir when provided', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vault-bundle-ws-'));
    const b = await createVaultBundle({
      globalDir: join(root, 'global'),
      workspaceDir: join(root, 'workspace'),
    });
    // smoke: list returns empty without throwing
    expect(await b.vault.list()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run; FAIL**

Run: `npx vitest run src/resources/extensions/coworker-vault/vault-singleton.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement singleton**

```typescript
// src/resources/extensions/coworker-vault/vault-singleton.ts
import { join } from 'node:path';
import { homedir } from 'node:os';
import { AuditLog } from '@otto/coworker-utils';
import { LocalDataVault, EngineRegistry } from '@otto/coworker-vault';

export interface VaultBundleOptions {
  globalDir?: string;     // defaults to ~/.otto
  workspaceDir?: string;  // optional workspace root (NOT including .otto suffix)
}

export interface VaultBundle {
  vault: LocalDataVault;
  audit: AuditLog;
  registry: EngineRegistry;
  globalDir: string;
  workspaceDir?: string;
}

export async function createVaultBundle(opts: VaultBundleOptions = {}): Promise<VaultBundle> {
  const globalDir = opts.globalDir ?? join(homedir(), '.otto');
  const auditPath = join(globalDir, 'audit.jsonl');
  const audit = new AuditLog({ path: auditPath });
  const vault = new LocalDataVault({
    globalDir,
    workspaceDir: opts.workspaceDir,
    audit,
  });
  const registry = await EngineRegistry.load({
    userDir: join(globalDir, 'engines'),
    workspaceDir: opts.workspaceDir ? join(opts.workspaceDir, 'engines') : undefined,
  });
  return { vault, audit, registry, globalDir, workspaceDir: opts.workspaceDir };
}
```

- [ ] **Step 5: Implement extension entry point**

```typescript
// src/resources/extensions/coworker-vault/index.ts
export { createVaultBundle } from './vault-singleton.js';
```

- [ ] **Step 6: Run; verify pass**

Run: `npx vitest run src/resources/extensions/coworker-vault/vault-singleton.test.ts`
Expected: 2 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/resources/extensions/coworker-vault/
git commit -m "feat(coworker-2): coworker-vault extension scaffold + singleton (Phase 2 Task 8)"
```

---

### Task 9: `/connect` wizard

**Files:**
- Create: `src/resources/extensions/coworker-vault/connect-command.ts`
- Create: `src/resources/extensions/coworker-vault/connect-command.test.ts`

The wizard is `@clack/prompts`-based, but tests bypass the prompt layer by injecting a "promptProvider" — a function that returns answers given a field. This is the same pattern existing extensions use (see how `sp-command.ts` is tested if precedent exists; otherwise, this is the new pattern).

- [ ] **Step 1: Write the failing test**

```typescript
// src/resources/extensions/coworker-vault/connect-command.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultBundle } from './vault-singleton.js';
import { runConnect } from './connect-command.js';
import { VAULT_KEEP } from '@otto/coworker-vault';

function answers(map: Record<string, string>) {
  return async (field: string) => map[field] ?? '';
}

describe('/connect', () => {
  it('creates a new entry from field prompts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'connect-create-'));
    const bundle = await createVaultBundle({ globalDir: join(root, 'global') });
    await runConnect(bundle, {
      engineId: 'jira', entryName: 'prod', forceWorkspace: false,
      promptProvider: answers({ url: 'https://x', email: 'a@b', token: 'tok' }),
    });
    const got = await bundle.vault.get({ engine: 'jira', name: 'prod' });
    expect(got.fields).toEqual({ url: 'https://x', email: 'a@b', token: 'tok' });
  });

  it('edits an existing entry; sentinel preserves the stored secret', async () => {
    const root = mkdtempSync(join(tmpdir(), 'connect-edit-'));
    const bundle = await createVaultBundle({ globalDir: join(root, 'global') });
    await bundle.vault.set({ engine: 'jira', name: 'prod' }, { url: 'u', email: 'e', token: 'OLD' });
    await runConnect(bundle, {
      engineId: 'jira', entryName: 'prod', forceWorkspace: false,
      promptProvider: answers({ url: 'NEW_URL', email: 'NEW_EMAIL', token: VAULT_KEEP }),
    });
    const got = await bundle.vault.get({ engine: 'jira', name: 'prod' });
    expect(got.fields).toEqual({ url: 'NEW_URL', email: 'NEW_EMAIL', token: 'OLD' });
  });

  it('rejects unknown engine', async () => {
    const root = mkdtempSync(join(tmpdir(), 'connect-unk-'));
    const bundle = await createVaultBundle({ globalDir: join(root, 'global') });
    await expect(runConnect(bundle, {
      engineId: 'nope', entryName: 'x', forceWorkspace: false,
      promptProvider: answers({}),
    })).rejects.toThrow(/Unknown engine/);
  });

  it('rejects sentinel in create-mode secret field', async () => {
    const root = mkdtempSync(join(tmpdir(), 'connect-sent-'));
    const bundle = await createVaultBundle({ globalDir: join(root, 'global') });
    await expect(runConnect(bundle, {
      engineId: 'jira', entryName: 'prod', forceWorkspace: false,
      promptProvider: answers({ url: 'u', email: 'e', token: VAULT_KEEP }),
    })).rejects.toThrow(/VAULT_KEEP is reserved/);
  });

  it('errors when a required field is empty', async () => {
    const root = mkdtempSync(join(tmpdir(), 'connect-empty-'));
    const bundle = await createVaultBundle({ globalDir: join(root, 'global') });
    await expect(runConnect(bundle, {
      engineId: 'jira', entryName: 'prod', forceWorkspace: false,
      promptProvider: answers({ url: '', email: 'e', token: 't' }),
    })).rejects.toThrow(/required/i);
  });
});
```

- [ ] **Step 2: Run; FAIL**

Run: `npx vitest run src/resources/extensions/coworker-vault/connect-command.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `connect-command.ts`**

```typescript
// src/resources/extensions/coworker-vault/connect-command.ts
import { mergeWithSentinel, assertNoSentinelInCreate, VAULT_KEEP } from '@otto/coworker-vault';
import type { VaultBundle } from './vault-singleton.js';
import { VaultEntryNotFound } from '@otto/coworker-vault';

export interface ConnectOptions {
  engineId: string;
  entryName: string;
  forceWorkspace: boolean;
  promptProvider: (field: string, opts: { label: string; secret: boolean; required: boolean; defaultValue?: string }) => Promise<string>;
}

export async function runConnect(bundle: VaultBundle, opts: ConnectOptions): Promise<void> {
  const engine = bundle.registry.require(opts.engineId);
  let existing: Record<string, string> | undefined;
  try {
    const got = await bundle.vault.get({ engine: opts.engineId, name: opts.entryName });
    existing = got.fields;
  } catch (err) {
    if (!(err instanceof VaultEntryNotFound)) throw err;
  }
  const submitted: Record<string, string> = {};
  for (const f of engine.fields) {
    const defaultValue = existing && f.secret ? VAULT_KEEP : (existing?.[f.name] ?? f.default ?? '');
    const value = await opts.promptProvider(f.name, {
      label: f.label, secret: f.secret, required: f.required, defaultValue,
    });
    if (f.required && value.trim() === '') {
      throw new Error(`Field "${f.name}" is required.`);
    }
    submitted[f.name] = value;
  }
  if (!existing) {
    assertNoSentinelInCreate(engine.fields, submitted);
  }
  const merged = existing
    ? mergeWithSentinel(engine.fields, existing, submitted)
    : submitted;
  await bundle.vault.set({ engine: opts.engineId, name: opts.entryName }, merged, {
    forceWorkspace: opts.forceWorkspace,
  });
}
```

- [ ] **Step 4: Run; verify pass**

Run: `npx vitest run src/resources/extensions/coworker-vault/connect-command.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/coworker-vault/connect-command.ts src/resources/extensions/coworker-vault/connect-command.test.ts
git commit -m "feat(coworker-2): /connect wizard with VAULT_KEEP edit flow (Phase 2 Task 9)"
```

---

### Task 10: `/datasource` command

**Files:**
- Create: `src/resources/extensions/coworker-vault/datasource-command.ts`
- Create: `src/resources/extensions/coworker-vault/datasource-command.test.ts`

`/datasource` exposes a programmatic API (`runDatasource(bundle, args)`) returning structured data; the TUI layer renders. Tests target the API.

- [ ] **Step 1: Write the failing test**

```typescript
// src/resources/extensions/coworker-vault/datasource-command.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultBundle } from './vault-singleton.js';
import { runDatasourceList, runDatasourceRemove, runDatasourceTest } from './datasource-command.js';

describe('/datasource', () => {
  it('list returns rows with engine, name, scope, fields_set (secret fields marked)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ds-list-'));
    const b = await createVaultBundle({ globalDir: join(root, 'global') });
    await b.vault.set({ engine: 'jira', name: 'prod' }, { url: 'u', email: 'e', token: 't' });
    const rows = await runDatasourceList(b, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.engine).toBe('jira');
    expect(rows[0]!.name).toBe('prod');
    expect(rows[0]!.scope).toBe('global');
    expect(rows[0]!.fields.sort((a, b2) => a.name.localeCompare(b2.name))).toEqual([
      { name: 'email', secret: false, display: 'e' },
      { name: 'token', secret: true,  display: '••••••' },
      { name: 'url',   secret: false, display: 'u' },
    ]);
  });

  it('list filters by --engine', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ds-filter-'));
    const b = await createVaultBundle({ globalDir: join(root, 'global') });
    await b.vault.set({ engine: 'jira', name: 'prod' }, { url: 'u' });
    const rows = await runDatasourceList(b, { engine: 'jira' });
    expect(rows).toHaveLength(1);
    const empty = await runDatasourceList(b, { engine: 'datadog' });
    expect(empty).toHaveLength(0);
  });

  it('remove deletes entry file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ds-rm-'));
    const b = await createVaultBundle({ globalDir: join(root, 'global') });
    await b.vault.set({ engine: 'jira', name: 'prod' }, { url: 'u' });
    await runDatasourceRemove(b, { ref: 'jira:prod' });
    expect(existsSync(join(root, 'global', 'data_vault', 'jira-prod.json'))).toBe(false);
  });

  it('test returns OTTO_DS_* env-var names that would inject (no network)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ds-test-'));
    const b = await createVaultBundle({ globalDir: join(root, 'global') });
    await b.vault.set({ engine: 'jira', name: 'prod' }, { url: 'u', email: 'e', token: 't' });
    const preview = await runDatasourceTest(b, { ref: 'jira:prod' });
    expect(preview.envVarNames.sort()).toEqual([
      'OTTO_DS_JIRA_PROD__EMAIL',
      'OTTO_DS_JIRA_PROD__TOKEN',
      'OTTO_DS_JIRA_PROD__URL',
    ]);
  });
});
```

- [ ] **Step 2: Run; FAIL**

Run: `npx vitest run src/resources/extensions/coworker-vault/datasource-command.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `datasource-command.ts`**

```typescript
// src/resources/extensions/coworker-vault/datasource-command.ts
import { LocalDataVault, envVarName } from '@otto/coworker-vault';
import type { VaultBundle } from './vault-singleton.js';

export interface ListedField { name: string; secret: boolean; display: string; }
export interface ListedRow {
  engine: string; name: string; scope: 'global' | 'workspace';
  fields: ListedField[]; last_modified_at: string;
}

export async function runDatasourceList(bundle: VaultBundle, filter: { engine?: string }): Promise<ListedRow[]> {
  const all = await bundle.vault.list();
  const out: ListedRow[] = [];
  for (const row of all) {
    if (filter.engine && row.engine !== filter.engine) continue;
    const engine = bundle.registry.get(row.engine);
    let fields: ListedField[] = [];
    if (engine) {
      const entry = await bundle.vault.get({ engine: row.engine, name: row.name });
      fields = engine.fields.map(f => ({
        name: f.name,
        secret: f.secret,
        display: f.secret ? '••••••' : (entry.fields[f.name] ?? ''),
      })).filter(f => row.fields_set.includes(f.name));
    } else {
      // engine YAML missing: show field names with no display
      fields = row.fields_set.map(n => ({ name: n, secret: false, display: '' }));
    }
    out.push({ engine: row.engine, name: row.name, scope: row.scope, fields, last_modified_at: row.last_modified_at });
  }
  return out;
}

export async function runDatasourceRemove(bundle: VaultBundle, args: { ref: string }): Promise<void> {
  const ref = LocalDataVault.parseRef(args.ref);
  await bundle.vault.remove(ref);
}

export interface TestPreview {
  ref: string;
  engine: string;
  envVarNames: string[];
}

export async function runDatasourceTest(bundle: VaultBundle, args: { ref: string }): Promise<TestPreview> {
  const ref = LocalDataVault.parseRef(args.ref);
  const entry = await bundle.vault.get(ref);
  return {
    ref: args.ref,
    engine: ref.engine,
    envVarNames: Object.keys(entry.fields).map(f => envVarName(ref.engine, ref.name, f)),
  };
}
```

- [ ] **Step 4: Run; verify pass**

Run: `npx vitest run src/resources/extensions/coworker-vault/datasource-command.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/coworker-vault/datasource-command.ts src/resources/extensions/coworker-vault/datasource-command.test.ts
git commit -m "feat(coworker-2): /datasource list/edit/remove/test (Phase 2 Task 10)"
```

---

### Task 11: `/audit` reader

**Files:**
- Create: `src/resources/extensions/coworker-vault/audit-command.ts`
- Create: `src/resources/extensions/coworker-vault/audit-command.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/resources/extensions/coworker-vault/audit-command.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVaultBundle } from './vault-singleton.js';
import { runAudit } from './audit-command.js';

describe('/audit', () => {
  it('returns last 50 records by default, newest first', async () => {
    const root = mkdtempSync(join(tmpdir(), 'audit-default-'));
    const b = await createVaultBundle({ globalDir: join(root, 'global') });
    for (let i = 0; i < 60; i++) {
      b.audit.append({
        _schema: 1, ts: `2026-06-01T00:00:${String(i).padStart(2, '0')}.000Z`,
        producer: 'vault', action: 'set',
        detail: { engine: 'jira', name: `n${i}` },
      });
    }
    const rows = await runAudit(b, {});
    expect(rows).toHaveLength(50);
    expect(rows[0]!.ts > rows[49]!.ts).toBe(true);
  });

  it('filters by producer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'audit-prod-'));
    const b = await createVaultBundle({ globalDir: join(root, 'global') });
    b.audit.append({ _schema: 1, ts: '2026-06-01T00:00:00.000Z', producer: 'vault',          action: 'set',    detail: {} });
    b.audit.append({ _schema: 1, ts: '2026-06-01T00:00:01.000Z', producer: 'secret-scanner', action: 'redact', detail: {} });
    const rows = await runAudit(b, { producer: 'secret-scanner' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.producer).toBe('secret-scanner');
  });

  it('filters by engine via detail.engine', async () => {
    const root = mkdtempSync(join(tmpdir(), 'audit-eng-'));
    const b = await createVaultBundle({ globalDir: join(root, 'global') });
    b.audit.append({ _schema: 1, ts: '2026-06-01T00:00:00.000Z', producer: 'vault', action: 'set', detail: { engine: 'jira' } });
    b.audit.append({ _schema: 1, ts: '2026-06-01T00:00:01.000Z', producer: 'vault', action: 'set', detail: { engine: 'datadog' } });
    const rows = await runAudit(b, { engine: 'jira' });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.detail as { engine: string }).engine).toBe('jira');
  });

  it('--since filter accepts duration tokens (1h, 24h, 7d)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'audit-since-'));
    const b = await createVaultBundle({ globalDir: join(root, 'global') });
    const now = Date.now();
    b.audit.append({ _schema: 1, ts: new Date(now - 2 * 60 * 60 * 1000).toISOString(), producer: 'vault', action: 'old', detail: {} });
    b.audit.append({ _schema: 1, ts: new Date(now - 30 * 1000).toISOString(),          producer: 'vault', action: 'new', detail: {} });
    const rows = await runAudit(b, { since: '1h' });
    expect(rows.map(r => r.action)).toEqual(['new']);
  });
});
```

- [ ] **Step 2: Run; FAIL**

Run: `npx vitest run src/resources/extensions/coworker-vault/audit-command.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `audit-command.ts`**

```typescript
// src/resources/extensions/coworker-vault/audit-command.ts
import type { AuditRecord } from '@otto/coworker-utils';
import type { VaultBundle } from './vault-singleton.js';

export interface AuditQuery {
  since?: string;                     // '1h' | '24h' | '7d' | ISO-8601
  producer?: string;
  engine?: string;
  action?: string;
  severity?: 'info' | 'warn';
  limit?: number;                     // default 50
}

const DURATION_RE = /^(\d+)([smhd])$/;
const MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function resolveSince(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const m = DURATION_RE.exec(token);
  if (m) {
    const n = parseInt(m[1]!, 10);
    const unit = m[2]!;
    return new Date(Date.now() - n * MS[unit]!).toISOString();
  }
  return token;  // treat as ISO-8601
}

export async function runAudit(bundle: VaultBundle, q: AuditQuery): Promise<AuditRecord[]> {
  const since = resolveSince(q.since);
  const out: AuditRecord[] = [];
  for await (const r of bundle.audit.read({
    since, producer: q.producer, action: q.action, severity: q.severity, engineId: q.engine,
  })) {
    out.push(r);
    if (out.length >= (q.limit ?? 50)) break;
  }
  return out;
}
```

- [ ] **Step 4: Run; verify pass**

Run: `npx vitest run src/resources/extensions/coworker-vault/audit-command.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/coworker-vault/audit-command.ts src/resources/extensions/coworker-vault/audit-command.test.ts
git commit -m "feat(coworker-2): /audit reader with filters (Phase 2 Task 11)"
```

---

### Task 12: Scratchpad `meta.json` bindings field + migration v3 → v4

**Files:**
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts`
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

- [ ] **Step 1: Read current meta types**

Open `packages/coworker-scratchpad/src/scratchpad-manager.ts` and find the `META_SCHEMA_VERSION` constant (currently 3) plus the `writeMeta`/`readMeta` helpers. Locate the `Meta` interface (or inline type literal).

- [ ] **Step 2: Add a failing test**

Append to `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`:

```typescript
import { readFileSync } from 'node:fs';
// ...

describe('ScratchpadManager — bindings (Phase 2)', () => {
  it('create() persists bindings to meta.json', async () => {
    const { manager, root } = makeManager(); // use existing helper from this test file
    await manager.create('p1', { bindings: ['jira:prod'] });
    const meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8'));
    expect(meta.schema_version).toBe(4);
    expect(meta.bindings).toEqual(['jira:prod']);
  });

  it('migrates v3 meta.json to v4 by adding empty bindings', async () => {
    const { manager, root } = makeManager();
    await manager.create('legacy', {});
    // forcibly write v3-style meta as if old version
    const metaPath = join(root, 'legacy', 'meta.json');
    const v3 = { ...JSON.parse(readFileSync(metaPath, 'utf8')), schema_version: 3 };
    delete v3.bindings;
    writeFileSync(metaPath, JSON.stringify(v3, null, 2));
    // attach triggers migration
    await manager.attach('legacy');
    const migrated = JSON.parse(readFileSync(metaPath, 'utf8'));
    expect(migrated.schema_version).toBe(4);
    expect(migrated.bindings).toEqual([]);
  });
});
```

If `makeManager` helper doesn't exist in current test file, use the pattern already established for setting up a manager in temp dir (see existing tests in the same file).

- [ ] **Step 3: Run; verify FAIL**

Run: `cd packages/coworker-scratchpad && npx vitest run scratchpad-manager.test.ts -t "bindings"`
Expected: FAIL.

- [ ] **Step 4: Implement**

In `scratchpad-manager.ts`:

1. Bump constant: `const META_SCHEMA_VERSION = 4;`
2. Extend the meta type (find existing definition) to include:
   ```typescript
   bindings: string[];
   ```
3. Update `create()` signature to accept `bindings?: string[]`. Pass through to meta write. Default `[]`.
4. In the readMeta path (where the manager reads `meta.json` on attach), add migration: if `meta.schema_version === 3`, set `meta.bindings = []` and `meta.schema_version = 4`, write back atomically.
5. Ensure all internal call sites that construct meta literals include `bindings: []` (default) when not specified.

(Exact edits depend on current code structure — keep changes minimal and self-contained.)

- [ ] **Step 5: Run; verify pass**

Run: `cd packages/coworker-scratchpad && npx vitest run scratchpad-manager.test.ts`
Expected: all tests pass (existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add packages/coworker-scratchpad/src/scratchpad-manager.ts packages/coworker-scratchpad/src/scratchpad-manager.test.ts
git commit -m "feat(coworker-2): meta.json bindings field + v3→v4 migration (Phase 2 Task 12)"
```

---

### Task 13: `ChildProcessRuntime` env injection on spawn

**Files:**
- Modify: `packages/coworker-scratchpad/src/child-process-runtime.ts`
- Modify: `packages/coworker-scratchpad/src/child-process-runtime.test.ts`
- Modify: `packages/coworker-scratchpad/package.json` (add `@otto/coworker-vault` dep)

- [ ] **Step 1: Add `@otto/coworker-vault` as a peer-like dependency**

Edit `packages/coworker-scratchpad/package.json`:
```json
  "dependencies": {
    "@otto/coworker-types": "*",
    "@otto/coworker-utils": "*",
    "@otto/coworker-vault": "*",
    "chokidar": "^5.0.0"
  },
```

- [ ] **Step 2: Add failing test**

Append to `child-process-runtime.test.ts`:

```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from '@otto/coworker-utils';
import { LocalDataVault, CredentialInjector } from '@otto/coworker-vault';

describe('ChildProcessRuntime — vault env injection (Phase 2)', () => {
  it('injects OTTO_DS_* env vars from bound vault entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cpr-env-'));
    const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
    const vault = new LocalDataVault({ globalDir: join(root, 'global'), workspaceDir: undefined, audit });
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'https://x', token: 't' });
    const injector = new CredentialInjector({ vault, audit });
    const runtime = new ChildProcessRuntime({
      workspace: root,
      scratchpadName: 'sp',
      sessionId: 's',
      injector,
      bindings: ['jira:prod'],
      // ... other required options per existing constructor
    });
    await runtime.start();
    // Send a probe cell that returns process.env
    const result = await runtime.exec('return { url: process.env.OTTO_DS_JIRA_PROD__URL, tok: process.env.OTTO_DS_JIRA_PROD__TOKEN };');
    expect(result.value).toEqual({ url: 'https://x', tok: 't' });
    await runtime.dispose();
  });

  it('records spawnTime for staleness checks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cpr-spawn-'));
    const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
    const vault = new LocalDataVault({ globalDir: join(root, 'global'), workspaceDir: undefined, audit });
    const injector = new CredentialInjector({ vault, audit });
    const before = Date.now();
    const runtime = new ChildProcessRuntime({
      workspace: root, scratchpadName: 'sp', sessionId: 's',
      injector, bindings: [],
    });
    await runtime.start();
    expect(runtime.spawnTime.getTime()).toBeGreaterThanOrEqual(before);
    await runtime.dispose();
  });
});
```

(Adjust the `ChildProcessRuntime` constructor arguments to match the existing signature — see other tests in the file for the canonical option set.)

- [ ] **Step 3: Run; verify FAIL**

Run: `cd packages/coworker-scratchpad && npx vitest run child-process-runtime.test.ts -t "vault env"`
Expected: FAIL — runtime doesn't accept `injector` / `bindings`.

- [ ] **Step 4: Extend `ChildProcessRuntime`**

In `child-process-runtime.ts`:

1. Add to options interface:
   ```typescript
   injector?: import('@otto/coworker-vault').CredentialInjector;
   bindings?: string[];
   ```
2. Add public field: `public spawnTime: Date = new Date(0);`
3. In the spawn path (where `child_process.spawn` or `fork` is called), before computing the env:
   ```typescript
   let env: NodeJS.ProcessEnv = this.buildBaseEnv(); // existing env-filter logic
   if (this.opts.injector && this.opts.bindings?.length) {
     env = await this.opts.injector.injectEnv(env, this.opts.bindings, {
       scratchpadName: this.opts.scratchpadName,
       sessionId: this.opts.sessionId ?? '',
       pid: process.pid,
     });
   }
   // pass `env` to spawn options
   this.spawnTime = new Date();
   ```

If the current runtime constructs env inline, refactor that into a `buildBaseEnv()` helper first (small, self-contained change).

- [ ] **Step 5: Wire ScratchpadManager → runtime**

In `scratchpad-manager.ts`, where the runtime is constructed, pass `injector` and `meta.bindings` through. This means the manager needs an injector reference. Add to `ScratchpadManagerOptions`:

```typescript
injector?: import('@otto/coworker-vault').CredentialInjector;
```

Pass it down to every `new ChildProcessRuntime(...)` call.

- [ ] **Step 6: Run; verify pass**

Run: `cd packages/coworker-scratchpad && npx vitest run child-process-runtime.test.ts`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/coworker-scratchpad/src/child-process-runtime.ts packages/coworker-scratchpad/src/child-process-runtime.test.ts packages/coworker-scratchpad/src/scratchpad-manager.ts packages/coworker-scratchpad/package.json
git commit -m "feat(coworker-2): ChildProcessRuntime injects OTTO_DS_* env from vault bindings (Phase 2 Task 13)"
```

---

### Task 14: SecretScanner output redaction in `kernel-bindings.ts`

**Files:**
- Modify: `packages/coworker-scratchpad/src/kernel-bindings.ts`
- Modify: `packages/coworker-scratchpad/src/kernel-bindings.test.ts`

The journal write path for cell stdout/stderr already exists in `kernel-bindings.ts`. Add a redaction hop that:
1. Scans the buffered output with `SecretScanner.scan`.
2. Emits one audit record per hit (`producer: 'secret-scanner'`, `action: 'redact'`).
3. Writes the redacted string to the journal (not the raw).
4. Leaves live TUI output untouched.

- [ ] **Step 1: Add failing test**

```typescript
// append to packages/coworker-scratchpad/src/kernel-bindings.test.ts
import { AuditLog } from '@otto/coworker-utils';

describe('kernel-bindings — secret redaction (Phase 2)', () => {
  it('redacts secret patterns in stdout before journaling', async () => {
    const auditPath = join(mkdtempSync(join(tmpdir(), 'kb-audit-')), 'audit.jsonl');
    const audit = new AuditLog({ path: auditPath });
    const raw = 'before AKIAABCDEFGHIJKLMNOP after';   // fake AWS access key id pattern
    const result = redactForJournal(raw, {
      audit, sessionId: 's', scratchpadName: 'sp', pid: 1, cellId: 'c1',
    });
    expect(result).toBe('before [REDACTED:aws_access_key_id] after');
    const records: { producer: string; action: string }[] = [];
    for await (const r of audit.read({ producer: 'secret-scanner' })) records.push(r as never);
    expect(records).toHaveLength(1);
    expect(records[0]!.action).toBe('redact');
  });

  it('returns input unchanged when no secrets present', () => {
    const auditPath = join(mkdtempSync(join(tmpdir(), 'kb-audit-clean-')), 'audit.jsonl');
    const audit = new AuditLog({ path: auditPath });
    const out = redactForJournal('hello world', { audit, sessionId: 's', scratchpadName: 'sp', pid: 1, cellId: 'c1' });
    expect(out).toBe('hello world');
  });
});
```

- [ ] **Step 2: Run; verify FAIL**

Run: `cd packages/coworker-scratchpad && npx vitest run kernel-bindings.test.ts -t "secret redaction"`
Expected: FAIL — `redactForJournal` not exported.

- [ ] **Step 3: Implement `redactForJournal` and wire into the journal path**

In `kernel-bindings.ts`:

```typescript
import { SecretScanner, type AuditLog, type AuditRecord } from '@otto/coworker-utils';

export interface RedactionContext {
  audit: AuditLog;
  sessionId: string;
  scratchpadName: string;
  pid: number;
  cellId: string;
}

const scanner = new SecretScanner();

export function redactForJournal(raw: string, ctx: RedactionContext): string {
  const hits = scanner.scan(raw);
  if (hits.length === 0) return raw;
  const ts = new Date().toISOString();
  for (const h of hits) {
    ctx.audit.append({
      _schema: 1, ts, producer: 'secret-scanner', action: 'redact', severity: 'warn',
      sessionId: ctx.sessionId, scratchpadName: ctx.scratchpadName, pid: ctx.pid,
      detail: { cell_id: ctx.cellId, kind: h.kind, offset: h.start, length: h.end - h.start },
    } satisfies AuditRecord);
  }
  return scanner.redact(raw);
}
```

Find the spot in `kernel-bindings.ts` where cell stdout/stderr is appended to the journal (a `CellArchive.append` call or similar). Wrap the stdout/stderr strings:

```typescript
const stdout = redactForJournal(rawStdout, ctx);
const stderr = redactForJournal(rawStderr, ctx);
// existing append() now sees redacted strings
```

The `ctx.audit` and other fields need to be plumbed from `ScratchpadManager` (which has access to the bundle's audit). Add the audit to whichever object passes through `kernel-bindings.ts`. Live-TUI emission (the path that streams stdout to the user) is upstream of this redaction — verify by inspection.

- [ ] **Step 4: Wire audit through to kernel-bindings**

In `ScratchpadManager`: when constructing the runtime, pass `audit` along the same path used for `injector`. Then the runtime forwards `audit` into the journal-write helper (most likely `CellArchive` or wherever `redactForJournal` is called). Keep changes minimal — the audit is purely additional context.

- [ ] **Step 5: Run; verify pass**

Run: `cd packages/coworker-scratchpad && npx vitest run kernel-bindings.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/coworker-scratchpad/src/kernel-bindings.ts packages/coworker-scratchpad/src/kernel-bindings.test.ts packages/coworker-scratchpad/src/scratchpad-manager.ts
git commit -m "feat(coworker-2): SecretScanner redaction on cell-output journal writes (Phase 2 Task 14)"
```

---

### Task 15: Staleness banner

**Files:**
- Create: `packages/coworker-scratchpad/src/staleness-banner.ts`
- Create: `packages/coworker-scratchpad/src/staleness-banner.test.ts`

The banner state lives in-memory per (scratchpadName, bindingRef, sessionId). On each cell exec, the manager calls `checkStaleness(bindings, spawnTime)`; the helper consults `vault.lookupLastModified(ref)` per binding and returns the banner string (or null).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coworker-scratchpad/src/staleness-banner.test.ts
import { describe, expect, it } from 'vitest';
import { StalenessBanner } from './staleness-banner.js';

describe('StalenessBanner', () => {
  const lookup = (refToTs: Record<string, string>) => async (ref: string) => refToTs[ref] ?? null;

  it('returns null when no binding is stale', async () => {
    const sb = new StalenessBanner();
    const banner = await sb.check({
      scratchpadName: 'sp', sessionId: 's',
      bindings: ['jira:prod'], spawnTime: new Date('2026-06-01T00:01:00.000Z'),
      lookupLastModified: lookup({ 'jira:prod': '2026-06-01T00:00:00.000Z' }),
    });
    expect(banner).toBeNull();
  });

  it('returns banner string when a binding was modified after spawnTime', async () => {
    const sb = new StalenessBanner();
    const banner = await sb.check({
      scratchpadName: 'sp', sessionId: 's',
      bindings: ['jira:prod'], spawnTime: new Date('2026-06-01T00:00:00.000Z'),
      lookupLastModified: lookup({ 'jira:prod': '2026-06-01T00:05:00.000Z' }),
    });
    expect(banner).toContain('jira:prod');
    expect(banner).toContain('/sp reset');
  });

  it('returns null on the second check for the same (scratchpad, binding, session)', async () => {
    const sb = new StalenessBanner();
    const args = {
      scratchpadName: 'sp', sessionId: 's',
      bindings: ['jira:prod'], spawnTime: new Date('2026-06-01T00:00:00.000Z'),
      lookupLastModified: lookup({ 'jira:prod': '2026-06-01T00:05:00.000Z' }),
    };
    expect(await sb.check(args)).not.toBeNull();
    expect(await sb.check(args)).toBeNull();
  });

  it('re-fires after spawnTime advances (kernel respawn)', async () => {
    const sb = new StalenessBanner();
    const base = {
      scratchpadName: 'sp', sessionId: 's', bindings: ['jira:prod'],
      lookupLastModified: lookup({ 'jira:prod': '2026-06-01T00:05:00.000Z' }),
    };
    await sb.check({ ...base, spawnTime: new Date('2026-06-01T00:00:00.000Z') }); // shown once
    await sb.check({ ...base, spawnTime: new Date('2026-06-01T00:00:00.000Z') }); // suppressed
    sb.resetForRespawn('sp');
    const banner = await sb.check({ ...base, spawnTime: new Date('2026-06-01T00:10:00.000Z') });
    expect(banner).toBeNull(); // post-respawn, the binding's last_modified < spawnTime
  });
});
```

- [ ] **Step 2: Run; FAIL**

Run: `cd packages/coworker-scratchpad && npx vitest run staleness-banner.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `staleness-banner.ts`**

```typescript
// packages/coworker-scratchpad/src/staleness-banner.ts
export interface StalenessCheck {
  scratchpadName: string;
  sessionId: string;
  bindings: string[];
  spawnTime: Date;
  lookupLastModified: (ref: string) => Promise<string | null>;
}

export class StalenessBanner {
  private readonly shown = new Map<string, Set<string>>(); // scratchpadName → set of "session|ref"

  async check(args: StalenessCheck): Promise<string | null> {
    const stale: string[] = [];
    for (const ref of args.bindings) {
      const lm = await args.lookupLastModified(ref);
      if (!lm) continue;
      if (new Date(lm).getTime() <= args.spawnTime.getTime()) continue;
      const key = `${args.sessionId}|${ref}`;
      const set = this.shown.get(args.scratchpadName) ?? new Set<string>();
      if (set.has(key)) continue;
      set.add(key);
      this.shown.set(args.scratchpadName, set);
      stale.push(ref);
    }
    if (stale.length === 0) return null;
    const list = stale.join(', ');
    return `${list} was modified after this kernel was spawned; env vars are stale. Run /sp reset to respawn with current values.`;
  }

  resetForRespawn(scratchpadName: string): void {
    this.shown.delete(scratchpadName);
  }
}
```

- [ ] **Step 4: Run; verify pass**

Run: `cd packages/coworker-scratchpad && npx vitest run staleness-banner.test.ts`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/staleness-banner.ts packages/coworker-scratchpad/src/staleness-banner.test.ts
git commit -m "feat(coworker-2): staleness banner (Phase 2 Task 15)"
```

---

### Task 16: `/sp` subcommands — `use`, `unuse`, `list` binding column, `--use` flag, `fork` copies bindings; staleness banner emission

**Files:**
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.ts`
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `sp-command.test.ts` (use existing setup helpers from the file):

```typescript
describe('/sp — vault bindings (Phase 2)', () => {
  it('new --use <ref> records bindings in meta.json', async () => {
    const { sp, root, vaultBundle } = await makeWithVault();
    await vaultBundle.vault.set({ engine: 'jira', name: 'prod' }, { url: 'u' });
    await sp(['new', 'p1', '--use', 'jira:prod']);
    const meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8'));
    expect(meta.bindings).toEqual(['jira:prod']);
  });

  it('use <name> <ref> appends to bindings', async () => {
    const { sp, root, vaultBundle } = await makeWithVault();
    await vaultBundle.vault.set({ engine: 'jira', name: 'prod' }, { url: 'u' });
    await sp(['new', 'p1']);
    await sp(['use', 'p1', 'jira:prod']);
    const meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8'));
    expect(meta.bindings).toEqual(['jira:prod']);
  });

  it('unuse <name> <ref> removes from bindings', async () => {
    const { sp, root, vaultBundle } = await makeWithVault();
    await vaultBundle.vault.set({ engine: 'jira', name: 'prod' }, { url: 'u' });
    await sp(['new', 'p1', '--use', 'jira:prod']);
    await sp(['unuse', 'p1', 'jira:prod']);
    const meta = JSON.parse(readFileSync(join(root, 'p1', 'meta.json'), 'utf8'));
    expect(meta.bindings).toEqual([]);
  });

  it('list output includes a bindings count column', async () => {
    const { sp, vaultBundle } = await makeWithVault();
    await vaultBundle.vault.set({ engine: 'jira', name: 'prod' }, { url: 'u' });
    await sp(['new', 'p1', '--use', 'jira:prod']);
    const result = await sp(['list']);
    expect(result.rows[0]).toMatchObject({ name: 'p1', bindings: 1 });
  });

  it('fork copies bindings from src to dst', async () => {
    const { sp, root, vaultBundle } = await makeWithVault();
    await vaultBundle.vault.set({ engine: 'jira', name: 'prod' }, { url: 'u' });
    await sp(['new', 'p1', '--use', 'jira:prod']);
    await sp(['fork', 'p1', 'p1-alt']);
    const meta = JSON.parse(readFileSync(join(root, 'p1-alt', 'meta.json'), 'utf8'));
    expect(meta.bindings).toEqual(['jira:prod']);
  });
});
```

`makeWithVault()` is a helper to be added at the top of the test file:

```typescript
async function makeWithVault() {
  const root = mkdtempSync(join(tmpdir(), 'sp-vault-'));
  const vaultBundle = await createVaultBundle({ globalDir: join(root, 'home') });
  const manager = new ScratchpadManager({
    workspace: root, root: join(root, 'sp'), injector: new CredentialInjector({ vault: vaultBundle.vault, audit: vaultBundle.audit }),
  });
  const sp = makeSpCommand({ manager, vaultBundle });  // existing factory pattern
  return { sp, root: join(root, 'sp'), vaultBundle };
}
```

(Adjust to match the actual test factories used in the existing file.)

- [ ] **Step 2: Run; verify FAIL**

Run: `npx vitest run src/resources/extensions/coworker-scratchpad/sp-command.test.ts -t "vault bindings"`
Expected: FAIL — subcommands missing.

- [ ] **Step 3: Implement subcommands**

In `sp-command.ts`:

1. Add `case 'use': ...` — parses `<name> <ref>`, validates ref via `LocalDataVault.parseRef`, appends to `meta.bindings` if not already present, writes meta, emits message `binding added; /sp reset to inject into the live kernel.`.

2. Add `case 'unuse': ...` — removes ref from `meta.bindings`.

3. Modify `case 'new':` — accept `--use <ref>` flag (can repeat or be comma-separated); pass to `manager.create({ bindings: [...] })`.

4. Modify `case 'fork':` — read src `meta.bindings`, copy to dst meta after fork completes.

5. Modify `case 'list':` — include `bindings: meta.bindings.length` in the row output.

6. In the cell-exec dispatch path (wherever `cw_scratchpad action=exec` lands or wherever a /sp-driven exec runs), call the staleness banner:
   ```typescript
   const banner = await stalenessBanner.check({
     scratchpadName: name, sessionId, bindings: meta.bindings, spawnTime: runtime.spawnTime,
     lookupLastModified: (ref) => vaultBundle.vault.lookupLastModified(ref),
   });
   if (banner) emitBanner(banner);
   ```
   `stalenessBanner` is a module-level singleton (`new StalenessBanner()`); reset on `/sp reset` for that scratchpad name.

- [ ] **Step 4: Run; verify pass**

Run: `npx vitest run src/resources/extensions/coworker-scratchpad/sp-command.test.ts`
Expected: existing + new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/coworker-scratchpad/sp-command.ts src/resources/extensions/coworker-scratchpad/sp-command.test.ts
git commit -m "feat(coworker-2): /sp use, /sp unuse, /sp list binding col, --use flag, fork copies bindings, staleness banner (Phase 2 Task 16)"
```

---

### Task 17: End-to-end integration test

**Files:**
- Create: `packages/coworker-scratchpad/tests/vault-integration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// packages/coworker-scratchpad/tests/vault-integration.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from '@otto/coworker-utils';
import { LocalDataVault, CredentialInjector, EngineRegistry } from '@otto/coworker-vault';
import { ScratchpadManager } from '../src/scratchpad-manager.js';

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'vault-e2e-'));
  const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
  const vault = new LocalDataVault({ globalDir: join(root, 'home'), workspaceDir: undefined, audit });
  const injector = new CredentialInjector({ vault, audit });
  await vault.set({ engine: 'jira', name: 'prod' }, { url: 'https://x', email: 'a@b', token: 'tok' });
  const manager = new ScratchpadManager({
    workspace: root, root: join(root, 'scratchpads'),
    injector,
    sessionId: 'sess-1',
  });
  return { root, audit, vault, injector, manager };
}

describe('vault + scratchpad end-to-end', () => {
  it('--use binding injects OTTO_DS_* into kernel; cell reads it', async () => {
    const { manager } = await setup();
    await manager.create('p1', { bindings: ['jira:prod'] });
    await manager.attach('p1');
    const out = await manager.exec('p1', 'return { url: process.env.OTTO_DS_JIRA_PROD__URL, tok: process.env.OTTO_DS_JIRA_PROD__TOKEN };');
    expect(out.value).toEqual({ url: 'https://x', tok: 'tok' });
    await manager.detach('p1');
  });

  it('secret printed by cell is redacted in the journal but live result preserved', async () => {
    const { manager, audit } = await setup();
    await manager.create('p2', { bindings: ['jira:prod'] });
    await manager.attach('p2');
    // Print a recognizable AWS-shaped fake to trigger redaction (cell journal write):
    const out = await manager.exec('p2', 'console.log("leaked AKIAABCDEFGHIJKLMNOP"); return 1;');
    expect(out.value).toBe(1);
    // Journal:
    const cellsPath = join(manager.pathOf('p2'), 'cells.jsonl');
    const journal = readFileSync(cellsPath, 'utf8');
    expect(journal).toContain('[REDACTED:aws_access_key_id]');
    expect(journal).not.toContain('AKIAABCDEFGHIJKLMNOP');
    // Audit:
    const found: { producer: string; action: string }[] = [];
    for await (const r of audit.read({ producer: 'secret-scanner' })) found.push(r as never);
    expect(found.length).toBeGreaterThanOrEqual(1);
    await manager.detach('p2');
  });

  it('vault entry rotation triggers staleness banner on next exec', async () => {
    const { manager, vault } = await setup();
    await manager.create('p3', { bindings: ['jira:prod'] });
    await manager.attach('p3');
    await manager.exec('p3', 'return 1;');  // first exec, no banner
    // simulate user editing the vault entry while kernel is alive:
    await new Promise(r => setTimeout(r, 10)); // ensure last_modified_at advances
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'NEW', email: 'a@b', token: 'tok' });
    const out = await manager.exec('p3', 'return 1;');
    expect(out.banner).toContain('jira:prod');
    expect(out.banner).toContain('/sp reset');
    await manager.detach('p3');
  });

  it('workspace vault entry shadows global', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vault-shadow-'));
    const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
    // create both directories so vault writes default to workspace
    const vault = new LocalDataVault({ globalDir: join(root, 'home'), workspaceDir: join(root, 'ws'), audit });
    // global entry
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'GLOBAL' });
    // explicit workspace entry — write directly to workspace dir
    await vault.set({ engine: 'jira', name: 'prod' }, { url: 'WORKSPACE' }, { forceWorkspace: true });
    const got = await vault.get({ engine: 'jira', name: 'prod' });
    expect(got.fields.url).toBe('WORKSPACE');
  });
});
```

- [ ] **Step 2: Run; FAIL initially as needed**

Run: `cd packages/coworker-scratchpad && npx vitest run tests/vault-integration.test.ts`
Expected: any FAIL here indicates a gap in Tasks 12–16. Iterate fixes back into the relevant source files; don't add code in the test to mask gaps.

- [ ] **Step 3: Iterate until all pass**

Each fix should be a small edit in the producing source file, with a corresponding regression test in that file's unit suite. Commit fixes there, not in the integration test.

- [ ] **Step 4: Commit**

```bash
git add packages/coworker-scratchpad/tests/vault-integration.test.ts
git commit -m "test(coworker-2): end-to-end vault + scratchpad integration (Phase 2 Task 17)"
```

---

### Task 18: Roadmap update + smoke checklist

**Files:**
- Modify: `docs/superpowers/notes/2026-06-01-coworker-roadmap.md`
- Create: `docs/superpowers/notes/2026-06-XX-phase-2-vault-smoke.md` (replace XX with actual date)

- [ ] **Step 1: Update the Phase 2 entry in the roadmap**

Edit `docs/superpowers/notes/2026-06-01-coworker-roadmap.md`. Find the Phase 2 milestone bullet:

> **Milestone:** `/connect servicenow` stores creds; next `/sp` cell spawns with `SERVICENOW_URL` + `SERVICENOW_TOKEN` env vars; cell can hit the ServiceNow API.

Replace with:

> **Milestone:** `/connect jira <name>` stores creds; next `/sp new --use jira:<name>` cell spawns with `OTTO_DS_JIRA_<NAME>__URL` + `OTTO_DS_JIRA_<NAME>__EMAIL` + `OTTO_DS_JIRA_<NAME>__TOKEN` env vars; cell can hit the Jira REST API.
>
> **Note (2026-06-XX):** Phase 2 ships JIRA as the only seeded engine. ServiceNow / IMAP / Datadog / SolarWinds / generic-REST seeds deferred to Phase 2.5 / Phase 6 — `EngineRegistry` is structurally ready; only the YAML content awaits.

- [ ] **Step 2: Write the smoke checklist**

```markdown
# Phase 2 vault — manual smoke checklist

**Branch:** `feat/coworker-phase-2-vault`. **Spec:** `docs/superpowers/specs/2026-06-01-coworker-phase-2-vault-design.md`.

Run these end-to-end before merging.

## Prereq

- Atlassian account with API token (id.atlassian.com → Account → Security).
- Clean Otto checkout; no existing `~/.otto/data_vault/`.

## Steps

1. `/connect jira prod` → wizard prompts URL, email, token → entry stored.
   - Verify: `ls -l ~/.otto/data_vault/jira-prod.json` shows mode `-rw-------` (0600).
   - Verify: `/audit --producer vault` shows the `set` record.

2. `/sp new rca-test --use jira:prod` → kernel spawns with bindings.
   - Verify: kernel can `console.log(process.env.OTTO_DS_JIRA_PROD__URL)` — prints URL.

3. Cell: `await axios.get(process.env.OTTO_DS_JIRA_PROD__URL + '/rest/api/3/myself', { headers: { Authorization: 'Basic ' + Buffer.from(process.env.OTTO_DS_JIRA_PROD__EMAIL + ':' + process.env.OTTO_DS_JIRA_PROD__TOKEN).toString('base64') } });` → returns Jira account JSON.
   - Verify: `/audit --producer vault` shows `inject` records for jira:prod.

4. Cell: `console.log("AKIAABCDEFGHIJKLMNOP")` → live TUI shows the string; `/sp view rca-test` shows `[REDACTED:aws_access_key_id]`; `/audit --producer secret-scanner` shows the redact record.

5. `/connect jira prod` (edit) — press Enter on token prompt (leaves `[VAULT_KEEP]`) → token preserved.
   - Verify: next `cw_scratchpad exec` on `rca-test` shows the staleness banner.

6. `/sp reset rca-test` → banner clears on next exec.

7. `/sp new rca-clone --use jira:prod` → spawn succeeds. `/sp fork rca-clone rca-clone-alt` → `meta.bindings` in `rca-clone-alt` equals `['jira:prod']`.

8. `/datasource list` shows two rows (`rca-test`'s effective binding is for kernel only; vault rows are jira:prod single entry — confirm we have one row).

9. `/datasource remove jira:prod` → entry file deleted.
   - Verify: `/audit --producer vault --action remove` shows the record.
   - Verify: next exec on `rca-test` shows BindingNotFound (strict mode default).

## Expected misses (NOT failures)

- `/audit --tail` (follow mode) — deferred to Phase 3.
- Engine YAML test: block / smoke runner — deferred.
- ServiceNow / Datadog / etc. seeds — deferred.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/notes/2026-06-01-coworker-roadmap.md docs/superpowers/notes/2026-06-XX-phase-2-vault-smoke.md
git commit -m "docs(coworker-2): roadmap update + Phase 2 smoke checklist (Phase 2 Task 18)"
```

---

### Task 19: Branch-level build + full suite + final review

**Files:** none (verification only)

- [ ] **Step 1: Build every changed package**

```bash
cd packages/coworker-utils && npm run build
cd ../coworker-vault && npm run build
cd ../coworker-scratchpad && npm run build
cd ../..
```

Expected: no type errors anywhere.

- [ ] **Step 2: Full test suite across affected packages**

```bash
cd packages/coworker-utils && npx vitest run
cd ../coworker-vault && npx vitest run
cd ../coworker-scratchpad && npx vitest run
cd ../..
npx vitest run src/resources/extensions/coworker-vault/
npx vitest run src/resources/extensions/coworker-scratchpad/
```

Expected: all green.

- [ ] **Step 3: Run repo-wide lints / type checks**

Whatever the repo's "check everything" command is — look for `npm run check` / `npm run lint` / a top-level `tsc -b`. Run it.

- [ ] **Step 4: Branch-level review handoff**

Push the branch and surface for human review:

```bash
git push -u origin feat/coworker-phase-2-vault
```

The reviewer will check that Tasks 1–18 individually pass review, the smoke checklist runs clean, and the spec is satisfied. No PR is created until that gate passes.

---

## Self-review summary

**Spec coverage check:**
- §2 decision matrix → Tasks 1, 5, 7, 12, 14, 17 cover the six locked decisions (audit, storage, injection, scratchpad integration, redaction, end-to-end).
- §3 package architecture → Tasks 1–11 build the modules listed.
- §4 on-disk layout → Tasks 5, 6, 1 implement.
- §5 engine YAML → Task 4.
- §6 kernel handoff → Tasks 7, 13.
- §7 slash commands → Tasks 9, 10, 11.
- §8 SecretScanner integration → Task 14.
- §9 AuditLog → Task 1.
- §10 error taxonomy → Task 2.
- §11 edge cases — concurrent writes (Task 5 atomic rename), fork (Task 16), engine YAML edited at runtime (no live reload — natural; manual smoke covers).
- §12 testing — every task has its own unit suite + integration (Task 17) + smoke (Task 18).
- §13 milestone — Task 18 smoke covers the milestone steps.

**Placeholder scan:** no "TBD" or "implement later" in any task; each step has the full code or explicit edit instruction.

**Type consistency check:**
- `AuditRecord` shape is identical across producers (Task 1 defines; Tasks 7, 14 use).
- `EntryRef` defined in Task 2; used by Tasks 5–7, 9–11.
- `LocalDataVault.parseRef` is the single ref-parser (Task 5); all consumers route through it.
- `envVarName` is the single name builder (Task 7); used by Task 10 (preview) and Task 13 (live injection).
- `bindings: string[]` field is the same shape in meta.json (Task 12), `ChildProcessRuntime` options (Task 13), and `/sp use/unuse` (Task 16).

No remaining gaps.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-01-coworker-phase-2-vault.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage spec+quality review between tasks, fast iteration. Matches the workflow you described in your original prompt ("two-stage spec+quality review per task; final branch-level review before merge").

**2. Inline Execution** — execute tasks in this session with batch checkpoints.

Which approach?
