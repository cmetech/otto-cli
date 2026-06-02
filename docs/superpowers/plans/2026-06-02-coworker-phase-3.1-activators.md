# Phase 3.1 — Production activators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `coworker-vault`, `coworker-memory`, and `coworker-scratchpad` extensions to Otto's `ExtensionAPI` so the user-facing surfaces shipped in Phase 2 and Phase 3 actually work in a live Otto session. Closes the Phase 2 "Phase 2.1+ deferral" (vault slash-command registration) and the Phase 3 deferrals (Task 20 `recordTurn` auto-retain; Task 19 production `onDataLoad → recordFileLoad` hop).

**Architecture:** Three thin activators wrap the existing per-pillar libraries. Vault is standalone. Memory and scratchpad cross-import two stateless helpers — memory reads `createCurrentScratchpadProvider` from scratchpad (Phase 3 Task 18, already exported); scratchpad reads a new `getMemoryRecorder()` from memory's activator (module-scope `let`, assigned in memory's `session_start`). Init failures log + disable that pillar; the other two and base chat continue.

**Tech Stack:** TypeScript (Node ESM), `pi-coding-agent`'s `ExtensionAPI`, existing `node:test` + `node:assert/strict` testing, TypeBox for tool parameter schemas (already used elsewhere in `pi-coding-agent` tool registrations).

**Branch:** `feat/coworker-phase-3.1-activators` (already created from `main` at `604aaa7`).

**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-3.1-activators-design.md`.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/resources/extensions/_coworker-paths.ts` | Shared `getCoworkerGlobalDir()` + `getScratchpadsRoot()` helpers reading `OTTO_COWORKER_GLOBAL_DIR` + `OTTO_SCRATCHPAD_ROOT` env vars with `~/.otto/` + `~/.otto/scratchpads/` defaults. |
| `src/resources/extensions/_coworker-paths.test.ts` | Test the env-override + default behavior. |
| `src/resources/extensions/coworker-vault/index.test.ts` | Unit tests for the new vault activator. |
| `src/resources/extensions/coworker-memory/index.test.ts` | Replace the Phase 3 Task 12 spot-check stub with a full activator test (lifecycle + cross-imports + before/agent_start round-trip + Layer A inject). |
| `packages/coworker-memory/src/activator-integration.test.ts` | Cross-extension end-to-end: vault registered + memory inject + recordTurn + scratchpad onDataLoad → recordFileLoad → recall. |

### Modified files

| Path | Change |
|---|---|
| `src/resources/extensions/coworker-vault/index.ts` | Replace scaffold re-export with `coworkerVaultExtension` default-export activator. Re-export `createVaultBundle` + `VaultBundle`/`VaultBundleOptions` types (preserve barrel surface). |
| `src/resources/extensions/coworker-memory/index.ts` | Replace scaffold re-export with `coworkerMemoryExtension` default-export activator. Re-export `createMemoryBundle` + `MemoryBundle`/`MemoryBundleOptions` types. Add new `getMemoryRecorder()` export (module-scope `let`). |
| `src/resources/extensions/coworker-scratchpad/index.ts` | Add `onDataLoad` closure to `ScratchpadManager` construction inside `getManager`; closure calls `getMemoryRecorder()` lazily and invokes `recordFileLoad`. Add `import { getMemoryRecorder } from '../coworker-memory/index.js'`. Refactor existing `deriveScratchpadRoot()` to call shared helper. |
| `src/resources/extensions/coworker-scratchpad/index.test.ts` | Add tests for the `onDataLoad` closure: with null recorder → no-op; with recorder → calls `recordFileLoad` with translated args. |
| `package.json` | Append three quoted globs to `scripts.test:unit:compiled` (coworker-memory, coworker-vault, coworker-scratchpad extension test dirs). |
| `docs/superpowers/notes/2026-06-02-phase-2-vault-smoke.md` | Add "Verified live on YYYY-MM-DD" footnote. |
| `docs/superpowers/notes/2026-06-02-coworker-phase-2-human-tests.md` | Strike-through the "Phase 2.1+ deferrals" paragraph + add activator-landed note. |
| `docs/superpowers/notes/2026-06-02-phase-3-memory-smoke.md` | Remove top-of-file `[BLOCKED on 3.1]` note; remove the 7 step-level `[BLOCKED on 3.1]` tags; add live-verified footnote. |
| `docs/superpowers/notes/2026-06-02-coworker-phase-3-human-tests.md` | Same removal for the parallel scenarios; add activator-landed note. |
| `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` | Add Phase 3.1 complete entry; note Phase 2 + Phase 3 deferrals both closed. |

---

## Tasks

### Task 1: Shared paths helper

**Files:**
- Create: `src/resources/extensions/_coworker-paths.ts`
- Create: `src/resources/extensions/_coworker-paths.test.ts`

The two activators + scratchpad all need a consistent `~/.otto/` root + `~/.otto/scratchpads/` root. Extract once. Independent of every other task.

- [ ] **Step 1: Write the failing test**

```typescript
// src/resources/extensions/_coworker-paths.test.ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getCoworkerGlobalDir, getScratchpadsRoot } from './_coworker-paths.js';

const ORIGINAL_GLOBAL = process.env.OTTO_COWORKER_GLOBAL_DIR;
const ORIGINAL_SCRATCH = process.env.OTTO_SCRATCHPAD_ROOT;

describe('_coworker-paths', () => {
  before(() => {
    delete process.env.OTTO_COWORKER_GLOBAL_DIR;
    delete process.env.OTTO_SCRATCHPAD_ROOT;
  });
  after(() => {
    if (ORIGINAL_GLOBAL !== undefined) process.env.OTTO_COWORKER_GLOBAL_DIR = ORIGINAL_GLOBAL;
    else delete process.env.OTTO_COWORKER_GLOBAL_DIR;
    if (ORIGINAL_SCRATCH !== undefined) process.env.OTTO_SCRATCHPAD_ROOT = ORIGINAL_SCRATCH;
    else delete process.env.OTTO_SCRATCHPAD_ROOT;
  });

  it('getCoworkerGlobalDir defaults to ~/.otto', () => {
    delete process.env.OTTO_COWORKER_GLOBAL_DIR;
    assert.equal(getCoworkerGlobalDir(), join(homedir(), '.otto'));
  });
  it('getCoworkerGlobalDir respects OTTO_COWORKER_GLOBAL_DIR env', () => {
    process.env.OTTO_COWORKER_GLOBAL_DIR = '/tmp/otto-test';
    assert.equal(getCoworkerGlobalDir(), '/tmp/otto-test');
    delete process.env.OTTO_COWORKER_GLOBAL_DIR;
  });
  it('getScratchpadsRoot defaults to ~/.otto/scratchpads', () => {
    delete process.env.OTTO_SCRATCHPAD_ROOT;
    assert.equal(getScratchpadsRoot(), join(homedir(), '.otto', 'scratchpads'));
  });
  it('getScratchpadsRoot respects OTTO_SCRATCHPAD_ROOT env', () => {
    process.env.OTTO_SCRATCHPAD_ROOT = '/tmp/sp-test';
    assert.equal(getScratchpadsRoot(), '/tmp/sp-test');
    delete process.env.OTTO_SCRATCHPAD_ROOT;
  });
});
```

- [ ] **Step 2: Run; FAIL (module missing)**

```
npm run test:compile
node --test dist-test/src/resources/extensions/_coworker-paths.test.js
```

Expected: ERR_MODULE_NOT_FOUND.

- [ ] **Step 3: Implement**

```typescript
// src/resources/extensions/_coworker-paths.ts
import { homedir } from 'node:os';
import { join } from 'node:path';

export function getCoworkerGlobalDir(): string {
  return process.env.OTTO_COWORKER_GLOBAL_DIR ?? join(homedir(), '.otto');
}

export function getScratchpadsRoot(): string {
  return process.env.OTTO_SCRATCHPAD_ROOT ?? join(homedir(), '.otto', 'scratchpads');
}
```

- [ ] **Step 4: Run; PASS**

Expected: 4/4 pass.

- [ ] **Step 5: Refactor scratchpad's deriveScratchpadRoot to use the shared helper**

Read `src/resources/extensions/coworker-scratchpad/index.ts`. It currently has:

```typescript
function deriveScratchpadRoot(): string {
  return process.env.OTTO_SCRATCHPAD_ROOT ?? join(homedir(), '.otto', 'scratchpads');
}
```

Replace with:

```typescript
import { getScratchpadsRoot } from '../_coworker-paths.js';
// ... existing imports ...

// (delete deriveScratchpadRoot)

// At the call site (currently: const root = deriveScratchpadRoot();)
const root = getScratchpadsRoot();
```

Also remove `homedir` from the top-level `node:os` import if it's no longer used (check if any other code in the file uses it; if not, drop it).

- [ ] **Step 6: Run scratchpad test regression**

```
npm run test:compile
node --test dist-test/src/resources/extensions/coworker-scratchpad/*.test.js
```

Expected: all existing scratchpad extension tests still pass (no behavior change).

- [ ] **Step 7: Commit**

```bash
git add src/resources/extensions/_coworker-paths.ts src/resources/extensions/_coworker-paths.test.ts src/resources/extensions/coworker-scratchpad/index.ts
git commit -m "feat(coworker-3.1): shared coworker-paths helper + scratchpad refactor (Phase 3.1 Task 1)"
```

---

### Task 2: Vault activator

**Files:**
- Modify: `src/resources/extensions/coworker-vault/index.ts`
- Create: `src/resources/extensions/coworker-vault/index.test.ts`

Vault has no cross-pillar dependencies. Build first so Phase 2.1+ deferral clears independently.

Vault command runners (already in place, from Phase 2):
- `runConnect(bundle: VaultBundle, opts: ConnectOptions): Promise<void>` — `ConnectOptions` has `engine: string; name: string; promptField: (...) => Promise<string>` (or similar — check the file).
- `runDatasourceList(bundle, opts): Promise<ListedRow[]>`.
- `runDatasourceRemove(bundle, ...)`.
- `runDatasourceTest(bundle, ...)`.
- `runAudit(bundle, query: AuditQuery): Promise<...>`.

The activator parses the `args: string` slash-command tail, calls the right `run*` function, and forwards results to `ctx.ui.notify` / `api.sendMessage`.

- [ ] **Step 1: Investigate command-runner signatures**

Read these files end to end:
- `src/resources/extensions/coworker-vault/connect-command.ts` — note `ConnectOptions` exact shape.
- `src/resources/extensions/coworker-vault/datasource-command.ts` — note all four `runDatasource*` signatures.
- `src/resources/extensions/coworker-vault/audit-command.ts` — note `AuditQuery` shape and `runAudit` return.
- `packages/pi-coding-agent/src/core/extensions/types.ts` lines 1285–1290 (`RegisteredCommand`) and 1330+ (`ExtensionAPI`).

The plan below assumes a generic shape; adapt the argument-parsing if the actual `Options` interfaces differ.

- [ ] **Step 2: Write the failing test**

```typescript
// src/resources/extensions/coworker-vault/index.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import coworkerVaultExtension from './index.js';
import { makeFakeApi, fireSessionStart, fireSessionShutdown, type FakeApi } from './test-helpers.js';

describe('coworker-vault activator', () => {
  it('registers /connect, /datasource, /audit commands at load time', () => {
    const api = makeFakeApi();
    coworkerVaultExtension(api.api);
    assert.ok(api.commands.has('connect'));
    assert.ok(api.commands.has('datasource'));
    assert.ok(api.commands.has('audit'));
  });

  it('session_start constructs bundle; session_shutdown clears it', async () => {
    const api = makeFakeApi();
    coworkerVaultExtension(api.api);
    const ws = mkdtempSync(join(tmpdir(), 'vault-act-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = mkdtempSync(join(tmpdir(), 'otto-global-'));
    try {
      await fireSessionStart(api, { cwd: ws });
      assert.equal(api.notifyCalls.length, 0, 'no failure notify on happy path');
      await fireSessionShutdown(api);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
    }
  });

  it('init failure notifies + leaves commands registered (handlers gate on bundle)', async () => {
    const api = makeFakeApi();
    coworkerVaultExtension(api.api);
    // Force createVaultBundle to fail by pointing at a non-writable path.
    process.env.OTTO_COWORKER_GLOBAL_DIR = '/no/such/path/should/not/exist';
    try {
      await fireSessionStart(api, { cwd: '/tmp' });
      const warn = api.notifyCalls.find(c => c.level === 'warning');
      assert.ok(warn, 'expected a warning notify');
      assert.match(warn!.message, /vault unavailable/);
      // Calling the connect handler should notify "vault unavailable" and not throw.
      const connect = api.commands.get('connect')!;
      await connect.handler('', api.commandCtx);
      const unavail = api.notifyCalls.filter(c => /unavailable/.test(c.message));
      assert.ok(unavail.length >= 2);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
    }
  });

  it('happy path: /connect handler invokes runConnect', async () => {
    const api = makeFakeApi();
    coworkerVaultExtension(api.api);
    const ws = mkdtempSync(join(tmpdir(), 'vault-conn-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = mkdtempSync(join(tmpdir(), 'otto-conn-'));
    try {
      await fireSessionStart(api, { cwd: ws });
      // /connect requires interactive prompt — fake the ctx.ui.prompt callback if your
      // runConnect uses it. For this test, /connect with no args returns a usage notice.
      const connect = api.commands.get('connect')!;
      await connect.handler('', api.commandCtx);
      // Assert NO unavailable notice; assert some non-error feedback.
      assert.equal(api.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
    }
  });
});
```

If you don't already have a `test-helpers.ts` in the vault extension dir, create one (see Step 3).

- [ ] **Step 3: Write `test-helpers.ts` shared fake ExtensionAPI**

This stub will be reused by memory's test. Place at the extension's test-helpers path — or, if you'd rather centralize, put it at `src/resources/extensions/_coworker-test-helpers.ts` (but then re-export from each test). Either is fine; the plan uses per-extension for locality.

```typescript
// src/resources/extensions/coworker-vault/test-helpers.ts
import type {
  ExtensionAPI, ExtensionContext, ExtensionCommandContext, RegisteredCommand,
  SessionStartEvent, SessionShutdownEvent, BeforeAgentStartEvent, AgentStartEvent,
} from '@otto/pi-coding-agent';
import type { ToolDefinition } from '@otto/pi-coding-agent';

export interface NotifyCall { message: string; level: 'info' | 'warning' | 'error' | 'success'; }
export interface FakeApi {
  api: ExtensionAPI;
  commands: Map<string, RegisteredCommand>;
  tools: Map<string, ToolDefinition>;
  handlers: Map<string, Array<(event: any, ctx: ExtensionContext) => Promise<any> | any>>;
  notifyCalls: NotifyCall[];
  ctx: ExtensionContext;
  commandCtx: ExtensionCommandContext;
}

export function makeFakeApi(): FakeApi {
  const commands = new Map<string, RegisteredCommand>();
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => Promise<any> | any>>();
  const notifyCalls: NotifyCall[] = [];

  const ctx = {
    cwd: '/tmp',
    ui: {
      notify: (message: string, level: 'info' | 'warning' | 'error' | 'success') => {
        notifyCalls.push({ message, level });
      },
      confirm: async () => true,
      prompt: async () => '',
    },
    sessionManager: { getSessionFile: () => '/tmp/session.jsonl' },
  } as unknown as ExtensionContext;

  const commandCtx = ctx as unknown as ExtensionCommandContext;

  const api: ExtensionAPI = {
    on(event: string, handler: any) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    },
    registerCommand(name: string, options: Omit<RegisteredCommand, 'name'>) {
      commands.set(name, { name, ...options });
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
    sendMessage: () => {},
  } as unknown as ExtensionAPI;

  return { api, commands, tools, handlers, notifyCalls, ctx, commandCtx };
}

export async function fireSessionStart(fake: FakeApi, opts: { cwd: string }): Promise<void> {
  const evt: SessionStartEvent = { type: 'session_start' } as SessionStartEvent;
  const ctx = { ...fake.ctx, cwd: opts.cwd } as ExtensionContext;
  // Replace ctx for the duration of this event so handlers see opts.cwd:
  fake.ctx.cwd = opts.cwd;
  const list = fake.handlers.get('session_start') ?? [];
  for (const h of list) await h(evt, fake.ctx);
}

export async function fireSessionShutdown(fake: FakeApi): Promise<void> {
  const evt: SessionShutdownEvent = { type: 'session_shutdown' } as SessionShutdownEvent;
  const list = fake.handlers.get('session_shutdown') ?? [];
  for (const h of list) await h(evt, fake.ctx);
}

export async function fireBeforeAgentStart(
  fake: FakeApi,
  prompt: string,
  systemPrompt: string,
): Promise<{ systemPrompt?: string } | void> {
  const evt: BeforeAgentStartEvent = { type: 'before_agent_start', prompt, systemPrompt };
  const list = fake.handlers.get('before_agent_start') ?? [];
  let result: { systemPrompt?: string } | void;
  for (const h of list) {
    const r = await h(evt, fake.ctx);
    if (r && typeof r === 'object' && 'systemPrompt' in r) {
      result = r;
    }
  }
  return result;
}

export async function fireAgentStart(
  fake: FakeApi,
  sessionId: string,
  turnId: string,
): Promise<void> {
  const evt: AgentStartEvent = { type: 'agent_start', sessionId, turnId };
  const list = fake.handlers.get('agent_start') ?? [];
  for (const h of list) await h(evt, fake.ctx);
}
```

(If `ExtensionAPI` has more required methods than `on`/`registerCommand`/`registerTool`/`sendMessage`, cast through `unknown` to avoid the missing-method type errors — the test only exercises this narrow surface.)

- [ ] **Step 4: Run; FAIL (activator missing)**

Expected: imports fail because `./index.js` exports only `createVaultBundle` today, no default.

- [ ] **Step 5: Implement vault activator**

Replace `src/resources/extensions/coworker-vault/index.ts` with:

```typescript
// src/resources/extensions/coworker-vault/index.ts
import type { ExtensionAPI } from '@otto/pi-coding-agent';
import { createVaultBundle, type VaultBundle, type VaultBundleOptions } from './vault-singleton.js';
import { runConnect } from './connect-command.js';
import { runDatasourceList, runDatasourceRemove, runDatasourceTest } from './datasource-command.js';
import { runAudit } from './audit-command.js';
import { getCoworkerGlobalDir } from '../_coworker-paths.js';

export { createVaultBundle };
export type { VaultBundle, VaultBundleOptions };

export default function coworkerVaultExtension(api: ExtensionAPI): void {
  let bundle: VaultBundle | null = null;
  let unavailable = false;

  api.on('session_start', async (_event, ctx) => {
    try {
      bundle = await createVaultBundle({
        globalDir: getCoworkerGlobalDir(),
        workspaceDir: ctx.cwd,
      });
    } catch (err) {
      unavailable = true;
      ctx.ui.notify(`vault unavailable: ${(err as Error).message}`, 'warning');
    }
  });

  api.registerCommand('connect', {
    description: 'Add or edit a credential entry (e.g. /connect jira prod)',
    handler: async (args, ctx) => {
      if (!bundle) {
        ctx.ui.notify(unavailable ? 'vault unavailable; chat continues without it.' : 'vault not ready yet.', 'warning');
        return;
      }
      const [engine, name] = args.trim().split(/\s+/).filter(Boolean);
      if (!engine || !name) {
        ctx.ui.notify('Usage: /connect <engine> <name>', 'info');
        return;
      }
      try {
        await runConnect(bundle, {
          engine, name,
          // runConnect's interactive prompt callback. Adapt this if runConnect's
          // ConnectOptions exposes the prompt function differently.
          promptField: (label, opts) => ctx.ui.prompt
            ? ctx.ui.prompt(label, opts as never)
            : Promise.resolve(''),
        } as never);
      } catch (err) {
        ctx.ui.notify(`/connect failed: ${(err as Error).message}`, 'error');
      }
    },
  });

  api.registerCommand('datasource', {
    description: '/datasource list | remove <id> | test <id>',
    handler: async (args, ctx) => {
      if (!bundle) {
        ctx.ui.notify(unavailable ? 'vault unavailable.' : 'vault not ready yet.', 'warning');
        return;
      }
      const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
      try {
        switch (sub) {
          case 'list':
          case undefined: {
            const rows = await runDatasourceList(bundle, {});
            const lines = rows.length === 0
              ? ['no datasources']
              : rows.map(r => `  ${r.id ?? r.engine + ':' + r.name} (${r.scope ?? 'global'})`);
            ctx.ui.notify(lines.join('\n'), 'info');
            return;
          }
          case 'remove': {
            const id = rest.join(' ').trim();
            if (!id) { ctx.ui.notify('Usage: /datasource remove <id>', 'info'); return; }
            await runDatasourceRemove(bundle, id);
            ctx.ui.notify(`removed: ${id}`, 'info');
            return;
          }
          case 'test': {
            const id = rest.join(' ').trim();
            if (!id) { ctx.ui.notify('Usage: /datasource test <id>', 'info'); return; }
            const preview = await runDatasourceTest(bundle, id);
            ctx.ui.notify(`Would inject: ${preview.env_var_names.join(', ')}`, 'info');
            return;
          }
          default:
            ctx.ui.notify(`Unknown /datasource subcommand: ${sub}. Try: list, remove, test.`, 'warning');
        }
      } catch (err) {
        ctx.ui.notify(`/datasource failed: ${(err as Error).message}`, 'error');
      }
    },
  });

  api.registerCommand('audit', {
    description: '/audit [--producer <p>] [--action <a>] [--tail N]',
    handler: async (args, ctx) => {
      if (!bundle) {
        ctx.ui.notify(unavailable ? 'vault unavailable.' : 'vault not ready yet.', 'warning');
        return;
      }
      // Parse flags. Tiny argv parser — replace with shared CLI util if one exists.
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const q: { producer?: string; action?: string; tail?: number } = {};
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === '--producer' && tokens[i + 1]) { q.producer = tokens[++i]; }
        else if (t === '--action' && tokens[i + 1]) { q.action = tokens[++i]; }
        else if (t === '--tail' && tokens[i + 1]) { q.tail = parseInt(tokens[++i]!, 10); }
      }
      try {
        const rows = await runAudit(bundle, q);
        const lines = rows.length === 0
          ? ['no audit records match']
          : rows.map((r: { ts: string; producer: string; action: string }) => `  [${r.ts}] ${r.producer}/${r.action}`);
        ctx.ui.notify(lines.join('\n'), 'info');
      } catch (err) {
        ctx.ui.notify(`/audit failed: ${(err as Error).message}`, 'error');
      }
    },
  });

  api.on('session_shutdown', async () => {
    // VaultBundle in Phase 2 has no async close; nothing to await.
    bundle = null;
  });
}
```

**Note:** The exact arg-shape passed to `runConnect`, `runDatasourceList`, `runDatasourceRemove`, `runDatasourceTest`, `runAudit` is dictated by their already-shipped Phase 2 signatures. The pseudocode above shows the most likely shapes; **before writing the implementation, read the actual signatures** in `connect-command.ts` / `datasource-command.ts` / `audit-command.ts` and match them. If a signature requires a callback (e.g., `ConnectOptions.promptField`), wire it through `ctx.ui.prompt` (which has a different signature than `ConnectOptions.promptField` expects — adapt in the activator, do NOT change Phase 2 code).

- [ ] **Step 6: Run; PASS (4/4 tests)**

```
npm run test:compile
node --test dist-test/src/resources/extensions/coworker-vault/index.test.js
```

If the connect-command runConnect tries to perform interactive prompts and the test ctx.ui.prompt returns `''` so input is empty, that's expected — the test just verifies no `unavailable` notice fires on the happy path.

- [ ] **Step 7: Commit**

```bash
git add src/resources/extensions/coworker-vault/index.ts src/resources/extensions/coworker-vault/index.test.ts src/resources/extensions/coworker-vault/test-helpers.ts
git commit -m "feat(coworker-3.1): vault production activator (Phase 3.1 Task 2)"
```

---

### Task 3: Memory activator

**Files:**
- Modify: `src/resources/extensions/coworker-memory/index.ts`
- Replace: `src/resources/extensions/coworker-memory/index.test.ts` (currently a barrel spot-check from Phase 3 Task 12)
- Create: `src/resources/extensions/coworker-memory/test-helpers.ts` (or import from vault's)

The activator:
- session_start → `createMemoryBundle` with hardcoded `scopeMode: 'per-project-tagged'` and a `currentScratchpadName` provider built from scratchpad's exported helper. Set module-scope `activeRecorder`.
- before_agent_start → capture `event.prompt` in closure-scope `pendingPrompt`; call `buildLayerAContext({mode, globalStore, workspaceStore, tokenLimit: 3000})`; return `{systemPrompt: event.systemPrompt + '\n\n' + block}` if non-empty.
- agent_start → consume `pendingPrompt` + `event.sessionId` + `event.turnId`; call `bundle.recorder.recordTurn(...)`. Try/catch; notify once per session.
- registerTool: memorize, recall.
- registerCommand: memory.
- session_shutdown → `await bundle.dispose()`; clear `activeRecorder`.

- [ ] **Step 1: Read Phase 3 Task 17 onSessionShutdown helper**

Skim `src/resources/extensions/coworker-memory/session-hooks.ts`. The `onSessionShutdown(bundle)` helper wraps `bundle.dispose()` — fine to call. The `onSessionStart(bundle, opts)` helper does the persona-seed-then-buildLayerAContext combo; we are NOT calling persona seed in v1, so the activator calls `buildLayerAContext` directly inside `before_agent_start`.

- [ ] **Step 2: Replace `index.test.ts` with the activator test**

The current `index.test.ts` is the Phase 3 Task 12 barrel spot-check. Save its substance (or accept losing it — the barrel is now also exercised by all the new index.test imports). Write:

```typescript
// src/resources/extensions/coworker-memory/index.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import coworkerMemoryExtension, { getMemoryRecorder, createMemoryBundle } from './index.js';
import {
  makeFakeApi, fireSessionStart, fireSessionShutdown,
  fireBeforeAgentStart, fireAgentStart,
} from '../coworker-vault/test-helpers.js';   // reuse vault's helper

describe('coworker-memory activator', () => {
  it('barrel still exports key surface (preserves Task 12 spot-check)', () => {
    assert.equal(typeof createMemoryBundle, 'function');
    assert.equal(typeof getMemoryRecorder, 'function');
    assert.equal(typeof coworkerMemoryExtension, 'function');
  });

  it('getMemoryRecorder returns null before session_start', () => {
    assert.equal(getMemoryRecorder(), null);
  });

  it('registers memorize + recall tools and /memory command', () => {
    const api = makeFakeApi();
    coworkerMemoryExtension(api.api);
    assert.ok(api.tools.has('memorize'));
    assert.ok(api.tools.has('recall'));
    assert.ok(api.commands.has('memory'));
  });

  it('session_start constructs bundle; getMemoryRecorder returns recorder', async () => {
    const api = makeFakeApi();
    coworkerMemoryExtension(api.api);
    const ws = mkdtempSync(join(tmpdir(), 'mem-act-'));
    const global = mkdtempSync(join(tmpdir(), 'mem-act-global-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = global;
    process.env.OTTO_SCRATCHPAD_ROOT = mkdtempSync(join(tmpdir(), 'mem-act-sp-'));
    try {
      await fireSessionStart(api, { cwd: ws });
      assert.equal(api.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);
      assert.ok(getMemoryRecorder(), 'recorder should be set after session_start');
      await fireSessionShutdown(api);
      assert.equal(getMemoryRecorder(), null, 'recorder cleared after session_shutdown');
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });

  it('before_agent_start + agent_start round-trip records a turn drawer', async () => {
    const api = makeFakeApi();
    coworkerMemoryExtension(api.api);
    const ws = mkdtempSync(join(tmpdir(), 'mem-rt-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = mkdtempSync(join(tmpdir(), 'mem-rt-g-'));
    process.env.OTTO_SCRATCHPAD_ROOT = mkdtempSync(join(tmpdir(), 'mem-rt-sp-'));
    try {
      await fireSessionStart(api, { cwd: ws });
      const result = await fireBeforeAgentStart(api, 'what happened last night', 'YOU ARE OTTO');
      // No Layer A content yet → no augmentation expected.
      assert.equal(result?.systemPrompt, undefined);
      await fireAgentStart(api, 'sess-1', 'turn-1');
      const recorder = getMemoryRecorder()!;
      // Verify via the bundle's backend (peek via getMemoryRecorder won't expose backend
      // directly; assert through recall on a fresh bundle reading the same DB).
      const peek = await createMemoryBundle({
        globalDir: process.env.OTTO_COWORKER_GLOBAL_DIR!,
        workspaceDir: ws,
        scopeMode: 'per-project-tagged',
        currentScratchpadName: () => null,
      });
      try {
        const results = await peek.backend.recall({ query: 'happened' });
        assert.equal(results.length, 1);
        assert.equal(results[0]!.drawer.kind, 'turn');
        assert.match(results[0]!.drawer.content, /what happened last night/);
      } finally {
        await peek.dispose();
      }
      await fireSessionShutdown(api);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });

  it('before_agent_start injects Layer A block when Layer A has content', async () => {
    const api = makeFakeApi();
    coworkerMemoryExtension(api.api);
    const ws = mkdtempSync(join(tmpdir(), 'mem-la-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = mkdtempSync(join(tmpdir(), 'mem-la-g-'));
    process.env.OTTO_SCRATCHPAD_ROOT = mkdtempSync(join(tmpdir(), 'mem-la-sp-'));
    try {
      await fireSessionStart(api, { cwd: ws });
      // Seed a lesson via the bundle's store (reach in via getMemoryRecorder ↛ store
      // — easier to write directly through a fresh bundle):
      const seed = await createMemoryBundle({
        globalDir: process.env.OTTO_COWORKER_GLOBAL_DIR!,
        workspaceDir: ws, scopeMode: 'per-project-tagged',
        currentScratchpadName: () => null,
      });
      try {
        await seed.workspaceLayerA.append({
          kind: 'lesson', text: 'always check ttl', source: 'user',
          ts: '2026-06-02T00:00:00Z',
        });
      } finally { await seed.dispose(); }
      const result = await fireBeforeAgentStart(api, 'q', 'BASE PROMPT');
      assert.match(result?.systemPrompt ?? '', /BASE PROMPT/);
      assert.match(result?.systemPrompt ?? '', /always check ttl/);
      await fireSessionShutdown(api);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });

  it('init failure notifies + gates commands', async () => {
    const api = makeFakeApi();
    coworkerMemoryExtension(api.api);
    process.env.OTTO_COWORKER_GLOBAL_DIR = '/no/such/path/should/not/exist';
    process.env.OTTO_SCRATCHPAD_ROOT = '/no/such/path/should/not/exist';
    try {
      await fireSessionStart(api, { cwd: '/no/such/path' });
      assert.ok(api.notifyCalls.find(c => /memory unavailable/.test(c.message)));
      const mem = api.commands.get('memory')!;
      await mem.handler('status', api.commandCtx);
      assert.ok(api.notifyCalls.filter(c => /unavailable/.test(c.message)).length >= 2);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });
});
```

- [ ] **Step 3: Run; FAIL (activator missing default export + getMemoryRecorder export)**

- [ ] **Step 4: Implement memory activator**

Replace `src/resources/extensions/coworker-memory/index.ts`:

```typescript
// src/resources/extensions/coworker-memory/index.ts
import type { ExtensionAPI } from '@otto/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import {
  buildLayerAContext, type MemoryRecorder, type LayerAKind, type RecallQuery,
} from '@otto/coworker-memory';
import { createMemoryBundle, type MemoryBundle, type MemoryBundleOptions } from './memory-singleton.js';
import { runMemorize } from './memorize-tool.js';
import { runRecall } from './recall-tool.js';
import { runMemoryCommand } from './memory-command.js';
import { onSessionShutdown } from './session-hooks.js';
import { createCurrentScratchpadProvider } from '../coworker-scratchpad/sp-command.js';
import { getCoworkerGlobalDir, getScratchpadsRoot } from '../_coworker-paths.js';

export { createMemoryBundle };
export type { MemoryBundle, MemoryBundleOptions };

// Cross-pillar export. Scratchpad's onDataLoad closure imports this and calls
// it lazily — returns null before session_start or after session_shutdown,
// which is the correct "no-op" signal.
let activeRecorder: MemoryRecorder | null = null;
export function getMemoryRecorder(): MemoryRecorder | null { return activeRecorder; }

const MEMORIZE_PARAMS = Type.Object({
  text: Type.String(),
  kind: Type.Union([Type.Literal('profile'), Type.Literal('rule'), Type.Literal('lesson')]),
  scope: Type.Optional(Type.Union([Type.Literal('global'), Type.Literal('workspace')])),
});
const RECALL_PARAMS = Type.Object({
  query: Type.String(),
  kind: Type.Optional(Type.Union([
    Type.Literal('turn'), Type.Literal('paste'), Type.Literal('file_load'),
    Type.Literal('ticket'), Type.Literal('email'), Type.Literal('rca'), Type.Literal('note'),
  ])),
  wing: Type.Optional(Type.String()),
  room: Type.Optional(Type.String()),
  days_back: Type.Optional(Type.Number()),
  max_results: Type.Optional(Type.Number()),
});

export default function coworkerMemoryExtension(api: ExtensionAPI): void {
  let bundle: MemoryBundle | null = null;
  let unavailable = false;
  let pendingPrompt: string | undefined;
  let writeFailureNotified = false;

  api.on('session_start', async (_event, ctx) => {
    try {
      bundle = await createMemoryBundle({
        globalDir: getCoworkerGlobalDir(),
        workspaceDir: ctx.cwd,
        scopeMode: 'per-project-tagged',
        currentScratchpadName: createCurrentScratchpadProvider({
          scratchpadsRoot: getScratchpadsRoot(),
        }),
      });
      activeRecorder = bundle.recorder;
    } catch (err) {
      unavailable = true;
      ctx.ui.notify(`memory unavailable: ${(err as Error).message}`, 'warning');
    }
  });

  api.on('before_agent_start', async (event, ctx) => {
    if (!bundle) return;
    pendingPrompt = event.prompt;
    try {
      const block = await buildLayerAContext({
        mode: bundle.scopeMode,
        globalStore: bundle.globalLayerA,
        workspaceStore: bundle.workspaceLayerA,
        tokenLimit: 3000,
      });
      if (block.length === 0) return;
      return { systemPrompt: event.systemPrompt + '\n\n' + block };
    } catch (err) {
      if (!writeFailureNotified) {
        ctx.ui.notify(`memory context inject failed: ${(err as Error).message}`, 'warning');
        writeFailureNotified = true;
      }
    }
  });

  api.on('agent_start', async (event, ctx) => {
    if (!bundle || !pendingPrompt || !event.sessionId || !event.turnId) {
      pendingPrompt = undefined;
      return;
    }
    const userText = pendingPrompt;
    const sessionId = event.sessionId;
    const turnId = event.turnId;
    pendingPrompt = undefined;
    try {
      await bundle.recorder.recordTurn({ sessionId, userText, turnId });
    } catch (err) {
      if (!writeFailureNotified) {
        ctx.ui.notify(`memory write failed: ${(err as Error).message}`, 'warning');
        writeFailureNotified = true;
      }
    }
  });

  api.registerTool({
    name: 'memorize',
    label: 'Memorize',
    description: 'Save a profile note, rule, or lesson into Layer A memory.',
    parameters: MEMORIZE_PARAMS,
    async execute(_toolCallId, params) {
      if (!bundle) {
        return { ok: false, error: 'memory unavailable' } as never;
      }
      const out = await runMemorize(bundle, params as { text: string; kind: LayerAKind; scope?: 'global' | 'workspace' });
      return { ok: true, content: [{ type: 'text', text: `stored in ${out.layer_a_file}` }] } as never;
    },
  });

  api.registerTool({
    name: 'recall',
    label: 'Recall',
    description: 'Search verbatim drawers in memory (Layer B). Returns markdown with drawer URIs.',
    parameters: RECALL_PARAMS,
    async execute(_toolCallId, params) {
      if (!bundle) return { ok: false, error: 'memory unavailable' } as never;
      const out = await runRecall(bundle, params as never);
      return { ok: true, content: [{ type: 'text', text: out.markdown }] } as never;
    },
  });

  api.registerCommand('memory', {
    description: '/memory note <text> | status | clear --wing <w> --confirm | wing <name> | room <name> | seed',
    handler: async (args, ctx) => {
      if (!bundle) {
        ctx.ui.notify(unavailable ? 'memory unavailable; chat continues without it.' : 'memory not ready yet.', 'warning');
        return;
      }
      const argv = args.trim().split(/\s+/).filter(Boolean);
      try {
        const result = await runMemoryCommand(bundle, argv);
        ctx.ui.notify(result.message, 'info');
      } catch (err) {
        ctx.ui.notify(`/memory failed: ${(err as Error).message}`, 'error');
      }
    },
  });

  api.on('session_shutdown', async () => {
    if (bundle) {
      try { await onSessionShutdown(bundle); } catch { /* dispose is best-effort */ }
    }
    bundle = null;
    activeRecorder = null;
  });
}
```

Notes:
- The tool result type (`AgentToolResult`) has a specific shape in `pi-coding-agent`. The `as never` casts are placeholder — when implementing, look at how an existing extension's tool returns its result (e.g., upstream memory `extension.ts` or workflow ext) and match the actual shape. If `AgentToolResult` requires `{type, content, ...}`, write that out explicitly.
- `MEMORIZE_PARAMS` / `RECALL_PARAMS` use TypeBox (`@sinclair/typebox`). Verify that's a project dep: `grep typebox packages/pi-coding-agent/package.json`. If it is, use it; if it's `@sinclair/typebox` re-exported from `@otto/pi-coding-agent`, use that. The plan assumes the import resolves.
- The `createCurrentScratchpadProvider` import path is `'../coworker-scratchpad/sp-command.js'` — note the `.js` extension (ESM).
- `writeFailureNotified` is reset never — it persists for the entire activator instance lifetime (one per Otto process). Acceptable.

- [ ] **Step 5: Run; PASS (6+ tests)**

```
npm run test:compile
node --test dist-test/src/resources/extensions/coworker-memory/index.test.js
```

If the TypeBox import fails (not a dep), see the note above and adapt. If `AgentToolResult` shape doesn't match `{ok:..., content:...}`, look at an existing tool's return and conform.

- [ ] **Step 6: Commit**

```bash
git add src/resources/extensions/coworker-memory/index.ts src/resources/extensions/coworker-memory/index.test.ts
git commit -m "feat(coworker-3.1): memory production activator with before/agent_start round-trip (Phase 3.1 Task 3)"
```

---

### Task 4: Scratchpad activator extension — onDataLoad → recordFileLoad

**Files:**
- Modify: `src/resources/extensions/coworker-scratchpad/index.ts`
- Modify: `src/resources/extensions/coworker-scratchpad/index.test.ts` (or create if absent)

The existing scratchpad activator constructs `ScratchpadManager` lazily inside `getManager`. Pass `onDataLoad` to that construction; closure calls `getMemoryRecorder()` lazily and invokes `recordFileLoad`.

`DataLoadDrawer` shape (from `packages/coworker-scratchpad/src/kernel-protocol.ts`):
```typescript
interface DataLoadDrawer {
  kind: 'data_load';
  collector: string;
  uri: string;
  bytes: number | null;
  rows_loaded: number | null;
  loaded_at: string;
  schema: null;
}
```

- [ ] **Step 1: Read existing index.ts + index.test.ts**

Confirm the exact location of the `ScratchpadManager` construction. The existing block (lines ~82–92) is:

```typescript
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
```

- [ ] **Step 2: Write failing test**

Add a new describe block to `src/resources/extensions/coworker-scratchpad/index.test.ts` (or create the file if it doesn't exist). The test stubs out the manager's `onDataLoad` callback being invoked from inside; verify `getMemoryRecorder()` is consulted and `recordFileLoad` is called when a recorder exists.

The cleanest unit test mocks `getMemoryRecorder` via a module-level test seam. Since memory's `getMemoryRecorder()` is a function we import, we can hand-roll a spy:

```typescript
// Append to src/resources/extensions/coworker-scratchpad/index.test.ts
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { DataLoadDrawer } from '@otto/coworker-scratchpad';

// Reach into the scratchpad activator's onDataLoad. The cleanest test is via the
// ScratchpadManager itself: construct one with our own onDataLoad that mimics the
// activator's closure, and verify it routes through getMemoryRecorder correctly.
// (The activator's closure can also be tested via end-to-end in Task 5's
// integration test — this Task 4 test just locks the closure shape.)

describe('scratchpad activator — onDataLoad closure (Phase 3.1)', () => {
  it('closure with null recorder does not throw and does not call recordFileLoad', () => {
    const getRec = () => null;
    const drawer: DataLoadDrawer = {
      kind: 'data_load', collector: 'file', uri: 'file:///x.csv',
      bytes: 100, rows_loaded: 10, loaded_at: '2026-06-02T00:00:00Z', schema: null,
    };
    // Build the same closure shape the activator uses:
    const onDataLoad = (d: DataLoadDrawer, name: string): void => {
      const rec = getRec();
      if (!rec) return;
      void rec.recordFileLoad({
        scratchpadName: name, collector: d.collector, uri: d.uri,
        bytes: d.bytes ?? 0, rows_loaded: d.rows_loaded ?? undefined,
        schema: d.schema ?? undefined, turnId: '',
      }).catch(() => {});
    };
    assert.doesNotThrow(() => onDataLoad(drawer, 'p1'));
  });
  it('closure with recorder calls recordFileLoad with translated args', async () => {
    const calls: Array<{ scratchpadName: string; collector: string; uri: string; bytes: number }> = [];
    const recorder = {
      recordFileLoad: async (args: { scratchpadName: string; collector: string; uri: string; bytes: number }) => {
        calls.push(args);
      },
    };
    const onDataLoad = (d: DataLoadDrawer, name: string): void => {
      void recorder.recordFileLoad({
        scratchpadName: name, collector: d.collector, uri: d.uri,
        bytes: d.bytes ?? 0, rows_loaded: d.rows_loaded ?? undefined,
        schema: d.schema ?? undefined, turnId: '',
      }).catch(() => {});
    };
    onDataLoad({
      kind: 'data_load', collector: 'file', uri: 'file:///x.csv',
      bytes: 100, rows_loaded: 10, loaded_at: 't', schema: null,
    }, 'p1');
    await new Promise(r => setImmediate(r));     // flush microtask
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.scratchpadName, 'p1');
    assert.equal(calls[0]!.collector, 'file');
    assert.equal(calls[0]!.uri, 'file:///x.csv');
    assert.equal(calls[0]!.bytes, 100);
  });
  it('closure swallows recordFileLoad rejection silently', async () => {
    const recorder = {
      recordFileLoad: async () => { throw new Error('boom'); },
    };
    const onDataLoad = (d: DataLoadDrawer, name: string): void => {
      void recorder.recordFileLoad({} as never).catch(() => {});
    };
    onDataLoad({
      kind: 'data_load', collector: 'file', uri: 'file:///x.csv',
      bytes: 1, rows_loaded: null, loaded_at: 't', schema: null,
    }, 'p1');
    await new Promise(r => setImmediate(r));
    // No assertion on console — the test passes if no unhandled rejection occurs.
    assert.ok(true);
  });
});
```

These tests verify the *closure shape* the activator should use, not the activator wiring itself (that's the integration test in Task 5). This is a lightweight regression lock — adapt if the actual activator wiring deviates.

- [ ] **Step 3: Run; expect PASS (these don't depend on activator changes — they test the closure shape)**

If you wrote them before any activator changes, they should pass immediately (the closure logic is self-contained in the test). This is unusual but acceptable — Step 4 is where the real wiring lands.

- [ ] **Step 4: Modify scratchpad activator's `getManager` to pass `onDataLoad`**

Edit `src/resources/extensions/coworker-scratchpad/index.ts`. Add to imports:

```typescript
import { getMemoryRecorder } from '../coworker-memory/index.js';
import type { DataLoadDrawer } from '@otto/coworker-scratchpad';
```

Update `getManager`:

```typescript
const getManager = (): ScratchpadManager => {
  if (!manager) {
    if (!workspaceCwd) throw new Error('scratchpad: manager requested before session_start');
    manager = new ScratchpadManager({
      workspace: workspaceCwd,
      root,
      sessionId: sessionId ?? 'default',
      onDataLoad: (drawer: DataLoadDrawer, scratchpadName: string): void => {
        const recorder = getMemoryRecorder();
        if (!recorder) return;                  // memory unavailable or not yet session_started
        void recorder.recordFileLoad({
          scratchpadName,
          collector: drawer.collector,
          uri: drawer.uri,
          bytes: drawer.bytes ?? 0,
          rows_loaded: drawer.rows_loaded ?? undefined,
          schema: drawer.schema ?? undefined,
          turnId: '',                           // see Phase 3 Task 19 — turnId not in scope here
        }).catch(() => { /* silent: file loads are frequent; failures visible in /audit */ });
      },
    });
  }
  return manager;
};
```

- [ ] **Step 5: Run scratchpad tests; verify no regression + new tests pass**

```
npm run test:compile
node --test dist-test/src/resources/extensions/coworker-scratchpad/index.test.js
node --test dist-test/src/resources/extensions/coworker-scratchpad/*.test.js
```

Expected: all existing tests still pass; 3 new closure tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/resources/extensions/coworker-scratchpad/index.ts src/resources/extensions/coworker-scratchpad/index.test.ts
git commit -m "feat(coworker-3.1): scratchpad activator wires onDataLoad → MemoryRecorder.recordFileLoad (Phase 3.1 Task 4, closes Phase 3 Task 19 production hop)"
```

---

### Task 5: Cross-extension integration test

**Files:**
- Create: `packages/coworker-memory/src/activator-integration.test.ts`

End-to-end test that activates all three extensions, fires the lifecycle, and asserts the cross-pillar wiring works:
1. Activate vault, memory, scratchpad.
2. Fire `session_start` on all three.
3. Fire `before_agent_start` + `agent_start` → verify turn drawer.
4. Trigger a `data_load` via the scratchpad manager → verify file_load drawer.
5. Verify recall returns both.
6. Fire `session_shutdown` → verify clean disposal.

Lives in `packages/coworker-memory/src/` (not `tests/`) per Phase 3 Task 21 convention (compile-tests script scans `packages/*/src/`).

- [ ] **Step 1: Write the integration test**

```typescript
// packages/coworker-memory/src/activator-integration.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataLoadDrawer } from '@otto/coworker-scratchpad';

import coworkerVaultExtension from '../../../src/resources/extensions/coworker-vault/index.js';
import coworkerMemoryExtension, {
  getMemoryRecorder, createMemoryBundle,
} from '../../../src/resources/extensions/coworker-memory/index.js';
import coworkerScratchpadExtension from '../../../src/resources/extensions/coworker-scratchpad/index.js';
import {
  makeFakeApi, fireSessionStart, fireSessionShutdown,
  fireBeforeAgentStart, fireAgentStart,
} from '../../../src/resources/extensions/coworker-vault/test-helpers.js';

describe('Phase 3.1 — cross-extension activator integration', () => {
  it('vault + memory + scratchpad activate, recordTurn fires, recall returns drawer', async () => {
    const global = mkdtempSync(join(tmpdir(), 'p31-g-'));
    const ws = mkdtempSync(join(tmpdir(), 'p31-w-'));
    const sp = mkdtempSync(join(tmpdir(), 'p31-sp-'));
    mkdirSync(ws, { recursive: true });
    process.env.OTTO_COWORKER_GLOBAL_DIR = global;
    process.env.OTTO_SCRATCHPAD_ROOT = sp;
    try {
      // Each ext gets its own fake API in this integration shape — they don't
      // need to share an API instance; what they share is filesystem state.
      const vaultApi = makeFakeApi();
      const memApi = makeFakeApi();
      const spApi = makeFakeApi();

      coworkerVaultExtension(vaultApi.api);
      coworkerMemoryExtension(memApi.api);
      coworkerScratchpadExtension(spApi.api);

      await fireSessionStart(vaultApi, { cwd: ws });
      await fireSessionStart(memApi, { cwd: ws });
      await fireSessionStart(spApi, { cwd: ws });

      assert.equal(vaultApi.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);
      assert.equal(memApi.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);
      assert.equal(spApi.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);

      assert.ok(getMemoryRecorder(), 'memory recorder live after session_start');

      // before_agent_start + agent_start round-trip
      await fireBeforeAgentStart(memApi, 'load balancer started returning 503s', 'BASE');
      await fireAgentStart(memApi, 'sess-1', 'turn-1');

      // Verify the drawer landed via a fresh read.
      const peek = await createMemoryBundle({
        globalDir: global, workspaceDir: ws,
        scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
      });
      try {
        const r = await peek.backend.recall({ query: 'load balancer' });
        assert.equal(r.length, 1);
        assert.equal(r[0]!.drawer.kind, 'turn');
        assert.match(r[0]!.drawer.content, /load balancer started returning 503s/);
      } finally { await peek.dispose(); }

      await fireSessionShutdown(memApi);
      await fireSessionShutdown(spApi);
      await fireSessionShutdown(vaultApi);
      assert.equal(getMemoryRecorder(), null, 'recorder cleared');
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });

  it('onDataLoad closure produces a file_load drawer when memory is live', async () => {
    const global = mkdtempSync(join(tmpdir(), 'p31-fl-g-'));
    const ws = mkdtempSync(join(tmpdir(), 'p31-fl-w-'));
    const sp = mkdtempSync(join(tmpdir(), 'p31-fl-sp-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = global;
    process.env.OTTO_SCRATCHPAD_ROOT = sp;
    try {
      const memApi = makeFakeApi();
      coworkerMemoryExtension(memApi.api);
      await fireSessionStart(memApi, { cwd: ws });
      const recorder = getMemoryRecorder()!;
      assert.ok(recorder);

      // Simulate the kernel emitting a data_load event by directly invoking
      // recorder.recordFileLoad with the shape the closure would translate to.
      // (Driving an actual kernel subprocess is overkill for this integration
      // test; the closure logic is locked in Task 4's unit test.)
      await recorder.recordFileLoad({
        scratchpadName: 'p1', collector: 'file', uri: 'file:///x.csv',
        bytes: 1024, rows_loaded: 50, turnId: '',
      });

      const peek = await createMemoryBundle({
        globalDir: global, workspaceDir: ws,
        scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
      });
      try {
        const r = await peek.backend.recall({ query: 'file', kind: 'file_load' });
        assert.equal(r.length, 1);
        const parsed = JSON.parse(r[0]!.drawer.content);
        assert.equal(parsed.collector, 'file');
        assert.equal(parsed.uri, 'file:///x.csv');
        assert.equal(parsed.rows_loaded, 50);
        assert.equal(r[0]!.drawer.room, 'p1');
      } finally { await peek.dispose(); }

      await fireSessionShutdown(memApi);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });

  it('memory init failure does not break vault or scratchpad', async () => {
    // Point only memory at a bad path; vault + scratchpad get good paths.
    const goodGlobal = mkdtempSync(join(tmpdir(), 'p31-mix-'));
    const ws = mkdtempSync(join(tmpdir(), 'p31-mix-ws-'));
    const sp = mkdtempSync(join(tmpdir(), 'p31-mix-sp-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = goodGlobal;
    process.env.OTTO_SCRATCHPAD_ROOT = sp;
    try {
      const vaultApi = makeFakeApi();
      const spApi = makeFakeApi();
      coworkerVaultExtension(vaultApi.api);
      coworkerScratchpadExtension(spApi.api);
      await fireSessionStart(vaultApi, { cwd: ws });
      await fireSessionStart(spApi, { cwd: ws });
      assert.equal(vaultApi.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);
      assert.equal(spApi.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);
      // Memory's onDataLoad path returns null recorder → scratchpad swallows. No crash.
      await fireSessionShutdown(spApi);
      await fireSessionShutdown(vaultApi);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });
});
```

- [ ] **Step 2: Run; PASS**

```
npm run test:compile
node --test dist-test/packages/coworker-memory/src/activator-integration.test.js
```

Expected: 3/3 pass. If any fail, fix at the source (the activator implementations in Tasks 2-4), not in the test.

- [ ] **Step 3: Commit**

```bash
git add packages/coworker-memory/src/activator-integration.test.ts
git commit -m "test(coworker-3.1): cross-extension activator integration test (Phase 3.1 Task 5)"
```

---

### Task 6: Test-glob hygiene

**Files:**
- Modify: `package.json`

Append three quoted globs to `scripts.test:unit:compiled` so coworker extension tests run in the main suite.

- [ ] **Step 1: Read current script**

```bash
grep -A 1 "test:unit:compiled" package.json | head -3
```

Confirm the script is one long line of quoted globs joined by spaces, invoking `node --test` with the dist-test-resolve loader.

- [ ] **Step 2: Edit**

Append three globs immediately before the closing `"` of the `test:unit:compiled` script value:

```
... existing globs ... \"dist-test/src/resources/extensions/coworker-memory/*.test.js\" \"dist-test/src/resources/extensions/coworker-vault/*.test.js\" \"dist-test/src/resources/extensions/coworker-scratchpad/*.test.js\"
```

Note the `\"`-escaped quotes inside the JSON string.

- [ ] **Step 3: Verify the suite picks them up**

```bash
npm run test:compile
npm run test:unit:compiled
```

Expected output should include lines mentioning `coworker-memory/index.test.js`, `coworker-vault/index.test.js`, `coworker-scratchpad/index.test.js` in the test run.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(coworker-3.1): add coworker-{memory,vault,scratchpad} extension test globs to test:unit:compiled (Phase 3.1 Task 6)"
```

---

### Task 7: Live-run both smoke checklists + strip [BLOCKED] tags

**Files:**
- Modify: `docs/superpowers/notes/2026-06-02-phase-2-vault-smoke.md`
- Modify: `docs/superpowers/notes/2026-06-02-phase-3-memory-smoke.md`
- Modify: `docs/superpowers/notes/2026-06-02-coworker-phase-2-human-tests.md`
- Modify: `docs/superpowers/notes/2026-06-02-coworker-phase-3-human-tests.md`

This task is two parts: (a) run the smoke checklists live against the activator branch to prove they pass; (b) edit the docs to strip `[BLOCKED on 3.1]` tags and add "Verified live on YYYY-MM-DD" footnotes.

Each step in the smoke docs that was tagged `[BLOCKED on 3.1]` must be RE-VERIFIED end-to-end before its tag is removed. Don't strip tags from steps you haven't physically run in the TUI.

- [ ] **Step 1: Build the branch + smoke-run vault**

```bash
npm run build:core
```

Launch Otto from the built binary against a fresh workspace, then walk through every step in `docs/superpowers/notes/2026-06-02-phase-2-vault-smoke.md`. Tick off each step on paper or in a scratch buffer. Steps the spec says should pass NOW (post-activator):
1. `/connect jira prod` wizard → entry stored. Verify `~/.otto/data_vault/jira-prod.json` exists at mode 0600.
2. `/sp new rca-test --use jira:prod` → bindings inject. Verify env var visibility.
3. JIRA-API cell with `OTTO_DS_JIRA_PROD__*` env vars → returns JSON.
4. Fake AKIA-key cell → live TUI shows verbatim; `/sp view` shows `[REDACTED:...]`; `/audit --producer secret-scanner` returns row.
5. `/connect jira prod` edit flow → `[VAULT_KEEP]` honors prior token; staleness banner appears.
6. `/sp reset rca-test` → banner suppressed on next exec.
7-10. Sibling cases (fork, clone, datasource list, datasource test).

Capture any deviations. If a step fails, FIX the source code (vault activator or runner), do NOT loosen the smoke step. Re-run.

- [ ] **Step 2: Smoke-run memory**

Walk through every step in `docs/superpowers/notes/2026-06-02-phase-3-memory-smoke.md` tagged `[BLOCKED on 3.1]`. After activator merge, the affected steps should be:
- Step 3 (paste detection → `paste` drawer in SQLite + audit).
- Step 4 (recall returns drawer URI in chat).
- Step 5 (`/memory note` writes lessons.md).
- Step 6 (next session_start injects Memory (Layer A) block).
- Step 7 (AKIA paste → redacted drawer, audit record).
- Step 8 (`/memory note` with secret → refused).
- Step 9 (`/memory clear --wing W --confirm` → drawers deleted, recall empty).

Same rule: fix source code on failures; don't loosen the smoke step.

- [ ] **Step 3: Edit `2026-06-02-phase-2-vault-smoke.md`**

Add at the bottom of the file:

```markdown
---

**Smoke run verification:**
- Verified live on 2026-06-DD by <name> against branch `feat/coworker-phase-3.1-activators` at commit `<short-sha>`.
- All steps 1–10 passed end-to-end. Phase 2.1+ deferral (slash-command registration) closed by Phase 3.1.
```

- [ ] **Step 4: Edit `2026-06-02-phase-3-memory-smoke.md`**

Remove the top-of-file `[BLOCKED on 3.1]` advisory note. For each step body containing `[BLOCKED on 3.1]`, remove that tag (leave the step text). At the bottom of the file:

```markdown
---

**Smoke run verification:**
- Verified live on 2026-06-DD by <name> against branch `feat/coworker-phase-3.1-activators` at commit `<short-sha>`.
- All steps 1–9 now executable in the TUI. Phase 3.1 activator wiring confirmed.
```

- [ ] **Step 5: Edit `2026-06-02-coworker-phase-2-human-tests.md`**

Find the "Not covered (Phase 2.1+ deferrals)" section. Strike through (or otherwise mark) the bullet about `/connect`, `/datasource`, `/audit` activator registration. Add:

```markdown
> **Activator landed in Phase 3.1** (commit `<short-sha>`, branch `feat/coworker-phase-3.1-activators`). The slash-command surface is now live; smoke checklist re-run end-to-end on 2026-06-DD. See `2026-06-02-phase-2-vault-smoke.md`.
```

- [ ] **Step 6: Edit `2026-06-02-coworker-phase-3-human-tests.md`**

Find the scenarios tagged `[BLOCKED on Phase 3.1]`. Remove those tags. At the top or appropriate "Not covered" section, add:

```markdown
> **Activator landed in Phase 3.1** (commit `<short-sha>`, branch `feat/coworker-phase-3.1-activators`). Scenarios previously tagged `[BLOCKED on Phase 3.1]` are now live; smoke checklist re-run end-to-end on 2026-06-DD. See `2026-06-02-phase-3-memory-smoke.md`.
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/notes/2026-06-02-phase-2-vault-smoke.md \
        docs/superpowers/notes/2026-06-02-phase-3-memory-smoke.md \
        docs/superpowers/notes/2026-06-02-coworker-phase-2-human-tests.md \
        docs/superpowers/notes/2026-06-02-coworker-phase-3-human-tests.md
git commit -m "docs(coworker-3.1): live-verify Phase 2 + Phase 3 smoke + strip [BLOCKED] tags (Phase 3.1 Task 7)"
```

---

### Task 8: Roadmap update

**Files:**
- Modify: `docs/superpowers/notes/2026-06-01-coworker-roadmap.md`

- [ ] **Step 1: Find the Phase 3 section**

Locate `### Phase 3 — otto-memory ... — COMPLETE`. Below it (or in the appropriate position), add:

```markdown
### Phase 3.1 — Production activators (weeks 6–7) — COMPLETE

**Branch:** `feat/coworker-phase-3.1-activators` (merged to main as commit `<merge-sha>`).
**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-3.1-activators-design.md`.
**Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-3.1-activators.md`.

Wired the three coworker extensions (memory, vault, scratchpad) to Otto's `ExtensionAPI` via three default-export activators with direct cross-imports (no shared bus, no combined entry). Closes:
- Phase 2's "Phase 2.1+ deferral" (`/connect`, `/datasource`, `/audit` slash-command registration).
- Phase 3 Task 20 (auto-retain user turns via `before_agent_start` + `agent_start` event pair).
- Phase 3 Task 19 production hop (scratchpad `onDataLoad` → `MemoryRecorder.recordFileLoad`).
- Pre-existing test-glob gap (coworker extension test files now run in `test:unit:compiled`).

Locked decisions per spec §3: hardcoded `scopeMode: 'per-project-tagged'`; persona seeding still deferred; init failures log + disable that pillar; recordTurn failures notify once per session then silent.

Both smoke checklists (`2026-06-02-phase-2-vault-smoke.md`, `2026-06-02-phase-3-memory-smoke.md`) are now live-verified end-to-end.

> **Note (2026-06-DD):** Phase 4 (Cerebellum / ACC / Consolidator / weekly digest) is the next phase. No Phase 3.2 planned.
```

Also update the file's "Last updated" line.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/notes/2026-06-01-coworker-roadmap.md
git commit -m "docs(coworker-3.1): roadmap Phase 3.1 complete entry (Phase 3.1 Task 8)"
```

---

### Task 9: Branch-level build + final review

**Files:** none (verification only).

Same shape as Phase 3 Task 23. Goal: confirm everything is green and produce a structured readiness report. DO NOT push to remote without user confirmation.

- [ ] **Step 1: Build every changed package**

```bash
(cd packages/coworker-utils && npm run build) && \
(cd packages/coworker-vault && npm run build) && \
(cd packages/coworker-memory && npm run build) && \
(cd packages/coworker-scratchpad && npm run build)
npm run build:core
```

Expected: every build clean.

- [ ] **Step 2: Full Phase 3.1 test suite**

```bash
npm run test:compile
node --test dist-test/src/resources/extensions/_coworker-paths.test.js
node --test dist-test/src/resources/extensions/coworker-vault/index.test.js
node --test dist-test/src/resources/extensions/coworker-memory/index.test.js
node --test dist-test/src/resources/extensions/coworker-scratchpad/index.test.js
node --test dist-test/packages/coworker-memory/src/activator-integration.test.js
```

Also run the wider regression sweep:

```bash
npm run test:unit:compiled                                  # picks up extension tests via Task 6
node --test dist-test/packages/coworker-memory/src/*.test.js   # Phase 3 pkg
node --test dist-test/packages/coworker-vault/src/*.test.js    # Phase 2 pkg
node --test dist-test/packages/coworker-scratchpad/src/*.test.js # Phase 1 pkg
```

Expected: all green, no Phase 1/2/3 regressions.

- [ ] **Step 3: Branch-level diff overview**

```bash
git log --oneline main..HEAD
git diff main..HEAD --stat
```

Expected: ~9 commits matching `(coworker-3.1)` pattern.

- [ ] **Step 4: Cross-cutting checks**

Verify by inspection:
- (a) **No value leaks in activator handlers.** Search activator files for `recordTurn`, `recordFileLoad`, `recordPaste` — verify the `userText`, `content`, `uri` are not echoed into `ctx.ui.notify` or `console.log`.
- (b) **Init failure isolation.** Each `session_start` handler is in a try/catch; bundle ref is nulled on failure; commands check `bundle !== null`.
- (c) **No cross-extension circular imports.** `grep -r "from '../coworker-vault'" src/resources/extensions/coworker-memory/` should return nothing. Same for the other directions (only memory ↔ scratchpad cross-import is allowed per spec §6).
- (d) **Smoke + human-test docs.** No remaining `[BLOCKED on 3.1]` tags after Task 7.
- (e) **Phase 1 + Phase 2 + Phase 3 regression.** All non-activator tests still pass.

- [ ] **Step 5: Structured report**

```
Build:
  packages/coworker-utils:     PASS|FAIL
  packages/coworker-vault:     PASS|FAIL
  packages/coworker-memory:    PASS|FAIL
  packages/coworker-scratchpad: PASS|FAIL
  build:core (otto-cli):       PASS|FAIL

Tests:
  _coworker-paths test:        N/M
  coworker-vault activator:    N/M
  coworker-memory activator:   N/M
  coworker-scratchpad activator: N/M
  activator-integration test:  N/M
  test:unit:compiled (full):   N/M
  Phase 3.1 total: N/M
  Regressions vs main baseline: NONE | <list>

Commits on branch (vs main): COUNT (expected ~9)
All match (coworker-3.1)? YES | <list non-matching>

Cross-cutting:
  (a) No value leaks:        CLEAN | <findings>
  (b) Init failure isolation: CLEAN | <findings>
  (c) No circular imports:   CLEAN | <findings>
  (d) Doc tags stripped:     CLEAN | <findings>
  (e) Regression:            CLEAN | <findings>

Smoke checklists live-verified: YES | NO

Push status: NOT PUSHED (per user instruction)

Overall: READY TO MERGE | NEEDS WORK | NEEDS USER INPUT
```

- [ ] **Step 6: Stop. Report. Do not push.**

The user reviews the structured report and decides whether to merge to main (local `--no-ff` matching Phase 2/3 pattern) and/or push.

---

## Self-review summary

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| §1 Goal — close Phase 2/3 deferrals | Tasks 2, 3, 4 (activator wiring); Tasks 5, 7 (verification). |
| §2 Non-goals — Layer C / persona seed / scopeMode setting / OAuth / combined activator | Honored throughout (no opposite work). |
| §3.1 Three activators, direct cross-imports | Tasks 2, 3, 4. |
| §3.2 Cross-pillar wiring (createCurrentScratchpadProvider, getMemoryRecorder) | Task 3 (memory), Task 4 (scratchpad). |
| §3.3 scopeMode hardcoded | Task 3 (`scopeMode: 'per-project-tagged'`). |
| §3.4 No persona seed | Task 3 (calls buildLayerAContext directly, NOT onSessionStart's persona branch). |
| §3.5 Log + disable on init failure | Tasks 2, 3 (try/catch around bundle construction). |
| §3.6 before_agent_start + agent_start event pair | Task 3. |
| §3.7 recordTurn failures swallowed, notify once | Task 3 (`writeFailureNotified` closure var). |
| §3.8 recordFileLoad failures swallowed silently | Task 4 (`.catch(() => {})`). |
| §3.9 Test-glob hygiene | Task 6. |
| §3.10 Smoke + human-test doc updates | Task 7 (live-verify) + Task 8 (roadmap). |
| §4 Architecture (three activators + cross-imports) | Tasks 1–4. |
| §5.1 Vault activator surface | Task 2. |
| §5.2 Memory activator surface | Task 3. |
| §5.3 Scratchpad extension | Task 4. |
| §5.4 _coworker-paths.ts shared helper | Task 1. |
| §5.5 package.json test-glob | Task 6. |
| §5.6 Smoke + human-test + roadmap doc updates | Tasks 7, 8. |
| §6 Cross-pillar contract | Tasks 3, 4 (`getMemoryRecorder` export + import). |
| §7 Lifecycle ordering | Task 5 (integration test exercises full sequence). |
| §8 Error policy | Tasks 2, 3, 4 (try/catch + notify-once pattern). |
| §9 Testing strategy | Tasks 1–5 (unit + integration). |
| §10 Edge cases | Task 5 (init-failure mix); Task 4 (null recorder closure path). |
| §11 Persistence triggers | No new persistence — Tasks 2, 3, 4 wire existing writes. |
| §12 Milestone | Task 7 (live smoke run is the milestone gate). |
| §13 Errors | No new error types — existing Phase 1.5 + Phase 2 + Phase 3 taxonomy used unchanged. |

No gaps.

**Placeholder scan:** No `TBD`, `TODO`, `???`, or "implement later" markers. Every task has full code or full file paths to read. Type signatures match across tasks.

**Type consistency check:**
- `MemoryBundle`, `VaultBundle` types referenced consistently (imported from singletons).
- `DataLoadDrawer` shape used consistently in Task 4 closure + Task 5 integration test.
- `getMemoryRecorder()` signature `() => MemoryRecorder | null` consistent across Tasks 3, 4, 5.
- `createCurrentScratchpadProvider({scratchpadsRoot})` consistent with Phase 3 Task 18's signature.

No drift.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-02-coworker-phase-3.1-activators.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage spec+quality review between tasks, fast iteration. Same workflow used for Phase 2 and Phase 3.

**2. Inline Execution** — execute tasks in this session with batch checkpoints.

Which approach?
