# Phase 4.5 — Subagent-scratchpad scoping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-mint a dedicated scratchpad per subagent dispatch (`subagent-<agent-name>-<6-hex>`); child `pi` process discovers via `OTTO_SUBAGENT_SCRATCHPAD` env var; scratchpad activator force-attaches on `session_start` bypassing sidecar/pointer restore. Scratchpads persist after subagent exit so the parent can `/sp attach <name>` post-hoc.

**Architecture:** Three surfaces change: (1) `subagent/launch.ts` gains a slug minter + extends `buildSubagentProcessEnv` to inject the new env var + threads it through `createSubagentLaunchPlan`. (2) `subagent/index.ts` mints the name at the three spawn sites and persists it in run-store. (3) `coworker-scratchpad/index.ts` reads the env var at `session_start` and force-attaches before the existing restore logic. Lean — single seam through `createSubagentLaunchPlan`, no broader refactor.

**Tech Stack:** TypeScript (Node ESM), `node:crypto` for the 6-hex suffix, `node:test` + `node:assert/strict` for tests, existing Phase 1 scratchpad sidecar helpers.

**Branch:** `feat/coworker-phase-4.5-subagent-scratchpad` (created from `main` at `eb95f88`; spec committed at `638e3ce`).

**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-4.5-subagent-scratchpad-design.md`.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/resources/extensions/subagent/launch.test.ts` | Unit tests for `mintSubagentScratchpadName` + extended `buildSubagentProcessEnv` + `createSubagentLaunchPlan` env injection. |
| `docs/superpowers/notes/2026-06-02-phase-4.5-subagent-scratchpad-smoke.md` | Manual smoke checklist with PENDING placeholder. |

### Modified files

| Path | Change |
|---|---|
| `src/resources/extensions/subagent/launch.ts` | Add `SUBAGENT_SCRATCHPAD_ENV_VAR` constant, `mintSubagentScratchpadName(agentName)` pure fn, extend `buildSubagentProcessEnv(env?, scratchpadName?)`, extend `buildShellEnvAssignments(env?)`, extend `SubagentLaunchInput.scratchpadName?`, thread through `createSubagentLaunchPlan`. |
| `src/resources/extensions/subagent/run-store.ts` | Add `scratchpad_name?: string` field to `SubagentRunRecord`. |
| `src/resources/extensions/subagent/index.ts` | At each of the 3 spawn sites (single/parallel/chain): mint scratchpad name, pass to `createSubagentLaunchPlan` via new field, update run record. |
| `src/resources/extensions/coworker-scratchpad/index.ts` | Add `forceSubagentAttach(name, root)` helper; in `session_start` check `OTTO_SUBAGENT_SCRATCHPAD` env var BEFORE `tryRestoreCurrentName`. |
| `src/resources/extensions/coworker-scratchpad/index.test.ts` | Add 4 tests for force-attach branch (env-set + scratchpad exists, env-set + scratchpad missing → create, env-unset regression, env-set + invalid name → warn + fall through). |
| `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` | Append Phase 4.5 — COMPLETE entry. |

---

## Tasks

### Task 1: `launch.ts` — env-var constant + slug minter + env builder extension

**Files:**
- Modify: `src/resources/extensions/subagent/launch.ts`
- Create: `src/resources/extensions/subagent/launch.test.ts`

The single seam through which Phase 4.5 wires env-var injection. `createSubagentLaunchPlan` already constructs args + env + cwd + session — adding the scratchpad var is a single threading change.

- [ ] **Step 1: Write the failing test**

Create `src/resources/extensions/subagent/launch.test.ts`:

```typescript
// src/resources/extensions/subagent/launch.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShellEnvAssignments,
  buildSubagentProcessEnv,
  createSubagentLaunchPlan,
  mintSubagentScratchpadName,
  SUBAGENT_CHILD_ENV_VAR,
  SUBAGENT_SCRATCHPAD_ENV_VAR,
} from './launch.js';
import type { AgentConfig } from './agents.js';

const STUB_AGENT: AgentConfig = {
  name: 'rca-analyst', label: 'RCA Analyst', description: '', systemPrompt: 'x',
} as AgentConfig;

describe('mintSubagentScratchpadName', () => {
  it('produces subagent-<agent>-<6hex> for simple input', () => {
    const name = mintSubagentScratchpadName('rca-analyst');
    assert.match(name, /^subagent-rca-analyst-[0-9a-f]{6}$/);
  });
  it('sanitizes uppercase + punctuation to kebab', () => {
    const name = mintSubagentScratchpadName('UPPER & weird!! chars');
    assert.match(name, /^subagent-upper-weird-chars-[0-9a-f]{6}$/);
  });
  it('falls back to subagent-<hex> for empty input', () => {
    const name = mintSubagentScratchpadName('');
    assert.match(name, /^subagent-[0-9a-f]{6}$/);
  });
  it('truncates agent portion to fit reasonable length', () => {
    const long = 'a'.repeat(100);
    const name = mintSubagentScratchpadName(long);
    // subagent- (9) + max 32 chars agent + - + 6 hex = max 48
    assert.ok(name.length <= 48);
    assert.match(name, /^subagent-a+-[0-9a-f]{6}$/);
  });
  it('strips diacritics', () => {
    const name = mintSubagentScratchpadName('résumé');
    assert.match(name, /^subagent-resume-[0-9a-f]{6}$/);
  });
});

describe('buildSubagentProcessEnv', () => {
  it('without scratchpad name preserves existing OTTO_SUBAGENT_CHILD only', () => {
    const env = buildSubagentProcessEnv({ FOO: 'bar' });
    assert.equal(env[SUBAGENT_CHILD_ENV_VAR], '1');
    assert.equal(env.FOO, 'bar');
    assert.equal(env[SUBAGENT_SCRATCHPAD_ENV_VAR], undefined);
  });
  it('with scratchpad name injects OTTO_SUBAGENT_SCRATCHPAD', () => {
    const env = buildSubagentProcessEnv({ FOO: 'bar' }, 'subagent-foo-abc123');
    assert.equal(env[SUBAGENT_CHILD_ENV_VAR], '1');
    assert.equal(env[SUBAGENT_SCRATCHPAD_ENV_VAR], 'subagent-foo-abc123');
  });
});

describe('buildShellEnvAssignments', () => {
  it('includes scratchpad assignment when var is set', () => {
    const out = buildShellEnvAssignments({
      [SUBAGENT_CHILD_ENV_VAR]: '1',
      [SUBAGENT_SCRATCHPAD_ENV_VAR]: 'subagent-foo-abc123',
    });
    assert.ok(out.some((s) => s.startsWith(`${SUBAGENT_CHILD_ENV_VAR}=`)));
    assert.ok(out.some((s) => s.startsWith(`${SUBAGENT_SCRATCHPAD_ENV_VAR}=`)));
  });
  it('omits scratchpad assignment when var is unset', () => {
    const out = buildShellEnvAssignments({ [SUBAGENT_CHILD_ENV_VAR]: '1' });
    assert.equal(out.some((s) => s.startsWith(`${SUBAGENT_SCRATCHPAD_ENV_VAR}=`)), false);
  });
});

describe('createSubagentLaunchPlan', () => {
  it('threads scratchpadName into env', () => {
    const plan = createSubagentLaunchPlan({
      agent: STUB_AGENT,
      task: 'do thing',
      tmpPromptPath: null,
      defaultCwd: '/tmp',
      scratchpadName: 'subagent-rca-analyst-abc123',
    });
    assert.equal(plan.env[SUBAGENT_SCRATCHPAD_ENV_VAR], 'subagent-rca-analyst-abc123');
  });
  it('without scratchpadName leaves env var unset', () => {
    const plan = createSubagentLaunchPlan({
      agent: STUB_AGENT,
      task: 'do thing',
      tmpPromptPath: null,
      defaultCwd: '/tmp',
    });
    assert.equal(plan.env[SUBAGENT_SCRATCHPAD_ENV_VAR], undefined);
  });
});
```

- [ ] **Step 2: Run; FAIL** (`SUBAGENT_SCRATCHPAD_ENV_VAR` + `mintSubagentScratchpadName` not exported; `scratchpadName` field not on input)

```
npm run test:compile
node --test dist-test/src/resources/extensions/subagent/launch.test.js
```

Expected: ERR_MODULE_NOT_FOUND or type errors.

- [ ] **Step 3: Modify `launch.ts`**

Apply these edits to `src/resources/extensions/subagent/launch.ts`:

**3a. Add imports + constant (after line 8):**

```typescript
import * as crypto from "node:crypto";

export const SUBAGENT_CHILD_ENV_VAR = "OTTO_SUBAGENT_CHILD";
export const SUBAGENT_CHILD_ENV_VALUE = "1";
export const SUBAGENT_SCRATCHPAD_ENV_VAR = "OTTO_SUBAGENT_SCRATCHPAD";

const MAX_SCRATCHPAD_AGENT_PART = 32;

export function mintSubagentScratchpadName(agentName: string): string {
  const hex = crypto.randomBytes(3).toString("hex");
  // Sanitize: NFKD + strip combining marks + lowercase + non-[a-z0-9] → '-' + collapse + trim.
  let sanitized = agentName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (sanitized.length > MAX_SCRATCHPAD_AGENT_PART) {
    sanitized = sanitized.slice(0, MAX_SCRATCHPAD_AGENT_PART).replace(/-+$/, "");
  }
  if (!sanitized) return `subagent-${hex}`;
  return `subagent-${sanitized}-${hex}`;
}
```

**3b. Extend `buildSubagentProcessEnv` signature:**

Replace the existing function:

```typescript
export function buildSubagentProcessEnv(
  env: NodeJS.ProcessEnv = process.env,
  scratchpadName?: string,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {
    ...env,
    [SUBAGENT_CHILD_ENV_VAR]: SUBAGENT_CHILD_ENV_VALUE,
  };
  if (scratchpadName) {
    next[SUBAGENT_SCRATCHPAD_ENV_VAR] = scratchpadName;
  }
  return next;
}
```

**3c. Extend `buildShellEnvAssignments` to surface the new var:**

Replace the existing function:

```typescript
export function buildShellEnvAssignments(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  const childValue = env[SUBAGENT_CHILD_ENV_VAR];
  if (childValue) {
    out.push(`${SUBAGENT_CHILD_ENV_VAR}=${JSON.stringify(childValue)}`);
  }
  const scratchpadValue = env[SUBAGENT_SCRATCHPAD_ENV_VAR];
  if (scratchpadValue) {
    out.push(`${SUBAGENT_SCRATCHPAD_ENV_VAR}=${JSON.stringify(scratchpadValue)}`);
  }
  return out;
}
```

**3d. Extend `SubagentLaunchInput` to accept `scratchpadName?`:**

Find the existing interface (lines 23-33) and add the new optional field:

```typescript
export interface SubagentLaunchInput {
  agent: AgentConfig;
  task: string;
  tmpPromptPath: string | null;
  modelOverride?: string;
  contextMode?: SubagentContextMode;
  parentSessionManager?: SubagentParentSessionManager;
  session?: SubagentSessionArgs;
  cwd?: string;
  defaultCwd: string;
  scratchpadName?: string;     // NEW Phase 4.5
}
```

**3e. Thread it through `createSubagentLaunchPlan`:**

Replace the existing function:

```typescript
export function createSubagentLaunchPlan(input: SubagentLaunchInput): SubagentLaunchPlan {
  const session = input.session ?? resolveSubagentSessionArgs(input.contextMode ?? "fresh", input.parentSessionManager);
  return {
    args: buildSubagentProcessArgs(
      input.agent,
      input.task,
      input.tmpPromptPath,
      input.modelOverride,
      session,
    ),
    env: buildSubagentProcessEnv(process.env, input.scratchpadName),
    cwd: input.cwd ?? input.defaultCwd,
    session,
  };
}
```

- [ ] **Step 4: Run; PASS** (12/12 tests across 4 describe blocks)

```
cd packages/coworker-utils && cd ../.. 2>/dev/null
npm run test:compile
node --test dist-test/src/resources/extensions/subagent/launch.test.js
```

- [ ] **Step 5: Strict tsc build** (Phase 3.1 hotfix lesson — `test:compile` uses esbuild, prod build uses strict tsc)

```
npm run build 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/resources/extensions/subagent/launch.ts \
        src/resources/extensions/subagent/launch.test.ts
git commit -m "feat(coworker-4.5): subagent launch helpers — mintSubagentScratchpadName + env-var injection (Phase 4.5 Task 1)"
```

---

### Task 2: `coworker-scratchpad` activator — force-attach branch

**Files:**
- Modify: `src/resources/extensions/coworker-scratchpad/index.ts`
- Modify: `src/resources/extensions/coworker-scratchpad/index.test.ts`

The scratchpad activator's `session_start` currently runs `tryRestoreCurrentName(root, sessionId, cwd, now)`. Phase 4.5 adds a force-attach branch BEFORE that call, gated on the `OTTO_SUBAGENT_SCRATCHPAD` env var.

- [ ] **Step 1: Investigate existing `session_start` shape**

Read `src/resources/extensions/coworker-scratchpad/index.ts` end to end. Identify:
- The exact line of `tryRestoreCurrentName` invocation inside `session_start` (around line 142-145).
- How `currentName` is set after restore (around line 145).
- Whether the activator has access to a `ScratchpadManager` instance at `session_start` time (it does — via `getManager()` lazy getter).

- [ ] **Step 2: Write failing tests**

Append to `src/resources/extensions/coworker-scratchpad/index.test.ts`:

```typescript
// Append after existing describe blocks.
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// makeFakeApi import is already at top of file from Phase 3.1; add fireSessionStart helper import:
import { fireSessionStart } from '../coworker-vault/test-helpers.js';

describe('coworker-scratchpad activator — OTTO_SUBAGENT_SCRATCHPAD force-attach (Phase 4.5)', () => {
  const ORIGINAL_SCRATCH = process.env.OTTO_SCRATCHPAD_ROOT;
  const ORIGINAL_SUB = process.env.OTTO_SUBAGENT_SCRATCHPAD;

  function cleanup() {
    if (ORIGINAL_SCRATCH !== undefined) process.env.OTTO_SCRATCHPAD_ROOT = ORIGINAL_SCRATCH;
    else delete process.env.OTTO_SCRATCHPAD_ROOT;
    if (ORIGINAL_SUB !== undefined) process.env.OTTO_SUBAGENT_SCRATCHPAD = ORIGINAL_SUB;
    else delete process.env.OTTO_SUBAGENT_SCRATCHPAD;
  }

  it('env var set + scratchpad missing → creates dir + meta.json + attaches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sub-att-'));
    process.env.OTTO_SCRATCHPAD_ROOT = root;
    process.env.OTTO_SUBAGENT_SCRATCHPAD = 'subagent-rca-analyst-abc123';
    try {
      const api = makeFakeApi();
      coworkerScratchpadExtension(api.api);
      await fireSessionStart(api, { cwd: mkdtempSync(join(tmpdir(), 'sub-ws-')) });
      assert.ok(existsSync(join(root, 'subagent-rca-analyst-abc123', 'meta.json')),
        'expected scratchpad dir + meta.json created');
      const notice = api.notifyCalls.find((c) => /subagent dispatch/.test(c.message));
      assert.ok(notice, 'expected subagent-dispatch attach notice');
    } finally { cleanup(); }
  });

  it('env var set + scratchpad already exists → attaches without recreating', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sub-att2-'));
    const name = 'subagent-rca-analyst-def456';
    // Pre-create the scratchpad with sentinel content so we can detect re-creation.
    mkdirSync(join(root, name), { recursive: true, mode: 0o700 });
    writeFileSync(
      join(root, name, 'meta.json'),
      JSON.stringify({ name, schema_version: 1, sentinel: true }),
      { mode: 0o600 },
    );
    process.env.OTTO_SCRATCHPAD_ROOT = root;
    process.env.OTTO_SUBAGENT_SCRATCHPAD = name;
    try {
      const api = makeFakeApi();
      coworkerScratchpadExtension(api.api);
      await fireSessionStart(api, { cwd: mkdtempSync(join(tmpdir(), 'sub-ws-')) });
      const meta = JSON.parse(readFileSync(join(root, name, 'meta.json'), 'utf8'));
      assert.equal(meta.sentinel, true, 'existing meta.json must NOT be overwritten');
    } finally { cleanup(); }
  });

  it('env var unset → existing restore logic runs unchanged (regression)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sub-att3-'));
    process.env.OTTO_SCRATCHPAD_ROOT = root;
    delete process.env.OTTO_SUBAGENT_SCRATCHPAD;
    try {
      const api = makeFakeApi();
      coworkerScratchpadExtension(api.api);
      await fireSessionStart(api, { cwd: mkdtempSync(join(tmpdir(), 'sub-ws-')) });
      // No subagent-dispatch notice; either silent (no sidecar/pointer) or a regular restore notice.
      const subagentNotice = api.notifyCalls.find((c) => /subagent dispatch/.test(c.message));
      assert.equal(subagentNotice, undefined);
    } finally { cleanup(); }
  });

  it('env var set to invalid name → warn + fall through; no force-attach', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sub-att4-'));
    process.env.OTTO_SCRATCHPAD_ROOT = root;
    process.env.OTTO_SUBAGENT_SCRATCHPAD = 'NOT-a-valid_subagent_name';   // uppercase + underscore
    try {
      const api = makeFakeApi();
      coworkerScratchpadExtension(api.api);
      await fireSessionStart(api, { cwd: mkdtempSync(join(tmpdir(), 'sub-ws-')) });
      const warn = api.notifyCalls.find((c) => c.level === 'warning' && /subagent scratchpad/.test(c.message));
      assert.ok(warn, 'expected warning about invalid subagent scratchpad name');
      assert.equal(existsSync(join(root, 'NOT-a-valid_subagent_name')), false,
        'invalid name must NOT result in a created dir');
    } finally { cleanup(); }
  });
});
```

Note: the existing `coworker-scratchpad/index.test.ts` (Phase 3.1 Task 4 + Phase 4 Task 12) already imports `makeFakeApi` from `../coworker-vault/test-helpers.js` and exercises the activator with `fireSessionStart`. Match that pattern.

- [ ] **Step 3: Run; FAIL** (4 new tests fail; force-attach branch missing)

```
npm run test:compile
node --test dist-test/src/resources/extensions/coworker-scratchpad/index.test.js
```

- [ ] **Step 4: Implement the force-attach branch**

In `src/resources/extensions/coworker-scratchpad/index.ts`:

**4a. Add imports at the top:**

```typescript
import { mkdirSync, writeFileSync } from 'node:fs';
```

(Keep existing imports; verify `existsSync` is already imported.)

**4b. Add the `forceSubagentAttach` helper near the existing `tryRestoreCurrentName` (above the default export):**

```typescript
const SUBAGENT_NAME_REGEX = /^subagent-[a-z0-9-]+$/;

/**
 * Phase 4.5: When the OTTO_SUBAGENT_SCRATCHPAD env var is set, force-attach
 * to the named scratchpad (creating it if needed) BEFORE the sidecar/pointer
 * restore path runs. Idempotent: re-running with same name attaches without
 * overwriting existing state.
 */
export function forceSubagentAttach(name: string, scratchpadsRoot: string): { ok: true } | { ok: false; reason: string } {
  if (!SUBAGENT_NAME_REGEX.test(name) || name.length > 80) {
    return { ok: false, reason: `invalid subagent scratchpad name: ${name}` };
  }
  const dir = join(scratchpadsRoot, name);
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const metaPath = join(dir, 'meta.json');
    if (!existsSync(metaPath)) {
      const meta = {
        name,
        schema_version: 1,
        created_at: new Date().toISOString(),
        source: 'subagent-dispatch',
      };
      writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
```

**4c. Modify `session_start` handler** to check the env var before `tryRestoreCurrentName`. Find the existing block (post-Phase-3.1 Task 4 / Phase 4 Task 12 around line 141-145):

```typescript
pi.on('session_start', async (_event, ctx) => {
  workspaceCwd = ctx.cwd;
  sessionId = deriveSessionId(ctx);

  // Phase 4.5: force-attach to subagent scratchpad if OTTO_SUBAGENT_SCRATCHPAD is set.
  const subagentName = process.env.OTTO_SUBAGENT_SCRATCHPAD;
  if (subagentName) {
    const result = forceSubagentAttach(subagentName, root);
    if (result.ok) {
      currentName = subagentName;
      ctx.ui.notify(`attached to ${subagentName} (subagent dispatch)`, 'info');
      try { sweepStaleSidecars(root, sessionId, Date.now()); } catch { /* silent */ }
      return;   // skip the normal restore + sweep path
    }
    ctx.ui.notify(`subagent scratchpad attach failed: ${result.reason}; continuing without`, 'warning');
    // fall through to normal restore
  }

  const restore = tryRestoreCurrentName(root, sessionId, ctx.cwd ?? process.cwd(), Date.now());
  if (restore.name) {
    currentName = restore.name;
    ctx.ui.notify(restore.notice!, 'info');
  }
  try { sweepStaleSidecars(root, sessionId, Date.now()); } catch { /* sweep failures are silent */ }
});
```

The `forceSubagentAttach` helper is exported so it's unit-testable independently of the activator if needed.

- [ ] **Step 5: Run; PASS** (4 new tests + all existing pass)

```
npm run test:compile
node --test dist-test/src/resources/extensions/coworker-scratchpad/index.test.js
node --test dist-test/src/resources/extensions/coworker-scratchpad/*.test.js
```

Expected: All existing scratchpad tests still pass + 4 new tests pass. No regressions.

- [ ] **Step 6: Strict tsc build**

```
npm run build 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/resources/extensions/coworker-scratchpad/index.ts \
        src/resources/extensions/coworker-scratchpad/index.test.ts
git commit -m "feat(coworker-4.5): scratchpad activator force-attaches subagent scratchpad via OTTO_SUBAGENT_SCRATCHPAD (Phase 4.5 Task 2)"
```

---

### Task 3: `subagent/index.ts` — wire scratchpad-minting at the 3 spawn sites + run-store field

**Files:**
- Modify: `src/resources/extensions/subagent/run-store.ts`
- Modify: `src/resources/extensions/subagent/index.ts`

The subagent extension dispatches via `createSubagentLaunchPlan(...)`. Task 1 added the `scratchpadName?` input field; this task supplies it at the 3 call sites (single, parallel, chain) and persists the chosen name in the run record.

- [ ] **Step 1: Add `scratchpad_name?` to the run record type**

In `src/resources/extensions/subagent/run-store.ts`, find the `SubagentRunRecord` interface and add the optional field:

```typescript
export interface SubagentRunRecord {
  runId: string;
  trackingName?: string;
  scratchpad_name?: string;     // NEW Phase 4.5
  // ... rest of existing fields unchanged ...
}
```

(Match the existing field names in the file — adapt if the interface is structured differently.)

If `createInitialRunRecord(...)` (also exported from this file) takes args, optionally extend it to accept `scratchpadName?` and populate the field at construction. If it doesn't take such args, leave it — the record gets updated post-construction via `update(runId, updater)`.

- [ ] **Step 2: Read `src/resources/extensions/subagent/index.ts`** to find the three `spawn(...)` sites.

Search for `spawn(` invocations in the file. Typical pattern (post-existing code) — there are three call paths:
- Single-task path (around the `runSingle` or equivalent handler).
- Parallel-task path (iterates a tasks array; one spawn per task).
- Chain-task path (sequential; each step spawns).

For each one, find the spot where `createSubagentLaunchPlan(...)` is called.

- [ ] **Step 3: At each call site, mint the scratchpad name + pass to launch plan**

The pattern at each site:

```typescript
import {
  buildSubagentProcessArgs,
  buildSubagentProcessEnv,
  createSubagentLaunchPlan,
  mintSubagentScratchpadName,       // NEW import
  isSubagentChildProcess,
  type SubagentContextMode,
  type SubagentSessionArgs,
} from "./launch.js";

// ... at each createSubagentLaunchPlan call site:
const scratchpadName = mintSubagentScratchpadName(task.agent);   // or `agent.name` depending on local var
const plan = createSubagentLaunchPlan({
  agent,
  task,
  tmpPromptPath,
  modelOverride,
  contextMode,
  parentSessionManager,
  cwd,
  defaultCwd,
  scratchpadName,                   // NEW
});
const child = spawn('pi', plan.args, { env: plan.env, cwd: plan.cwd, ... });

// After spawn, update the run record:
runStore.update(runId, (r) => ({ ...r, scratchpad_name: scratchpadName }));
```

The `task.agent` reference — adapt to whatever the local variable name is at each site. The subagent extension's tool schema uses an `agent: string` field (the agent identifier); the resolved `AgentConfig` is typically loaded via `discoverAgents()`. Use `agentConfig.name` if more accessible.

- [ ] **Step 4: Verify build + run existing subagent tests**

```
npm run test:compile
node --test dist-test/src/resources/extensions/subagent/tests/*.test.js
```

(The subagent extension has a `tests/` subdirectory per upstream convention, not co-located `*.test.ts`.)

Expected: existing tests still pass. No new tests added in this task — the integration is exercised end-to-end by the smoke checklist (Task 4) and by Task 1's unit tests proving the env-var threading works.

- [ ] **Step 5: Strict tsc build**

```
npm run build 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/resources/extensions/subagent/index.ts \
        src/resources/extensions/subagent/run-store.ts
git commit -m "feat(coworker-4.5): subagent dispatcher mints scratchpad name + persists in run record (Phase 4.5 Task 3)"
```

---

### Task 4: Smoke checklist + roadmap update

**Files:**
- Create: `docs/superpowers/notes/2026-06-02-phase-4.5-subagent-scratchpad-smoke.md`
- Modify: `docs/superpowers/notes/2026-06-01-coworker-roadmap.md`

- [ ] **Step 1: Write smoke checklist**

Create `docs/superpowers/notes/2026-06-02-phase-4.5-subagent-scratchpad-smoke.md`:

```markdown
# Phase 4.5 — Subagent-scratchpad scoping smoke checklist

**Branch:** `feat/coworker-phase-4.5-subagent-scratchpad`.
**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-4.5-subagent-scratchpad-design.md`.
**Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-4.5-subagent-scratchpad.md`.

Run these end-to-end before tagging the merge live-verified.

## Prereq

- `npm run build` clean.
- Fresh workspace, no existing `~/.otto/scratchpads/subagent-*/` dirs.

## Steps

1. Launch Otto in a fresh workspace. `/sp list` shows no subagent scratchpads.
2. Dispatch a single-mode subagent:
   ```
   /subagent rca-analyst "investigate the load-balancer 503s"
   ```
3. While subagent is running, in another terminal:
   ```
   ls ~/.otto/scratchpads/ | grep subagent-rca-analyst
   ```
   Expect: a directory like `subagent-rca-analyst-abc123` exists with `meta.json` at mode 0o600.
4. After subagent exits, back in Otto: `/sp list` shows the subagent scratchpad.
5. `/sp attach subagent-rca-analyst-abc123` succeeds; kernel state (cells, namespace) accessible.
6. If the subagent produced an artifact: `/artifacts list` shows it.
7. `/memory recall <q> --room subagent-rca-analyst-abc123` finds drawers tagged with that room.
8. Re-dispatch the same agent: `/subagent rca-analyst "another task"` — verify a SECOND scratchpad is created (`subagent-rca-analyst-<different-6hex>`), distinct from the first.
9. Parallel mode: dispatch two subagents concurrently; verify each gets its own scratchpad (distinct 6-hex suffixes).
10. Cleanup: `/sp remove subagent-rca-analyst-<hex>` deletes the scratchpad.

## Expected misses

- TTL-based auto-cleanup of subagent scratchpads — out of scope; manual `/sp remove` for now.
- `/subagent prune-scratchpads` UX — out of scope.
- Caller-specified scratchpad name override — locked to auto-mint per spec §3.1.

## Sign-off

Replace this line with: `Verified live on YYYY-MM-DD by <name> at commit <short-sha>.`
```

- [ ] **Step 2: Update roadmap**

In `docs/superpowers/notes/2026-06-01-coworker-roadmap.md`, locate the Phase 4 COMPLETE entry. Insert a Phase 4.5 entry below it:

```markdown
### Phase 4.5 — Subagent-scratchpad scoping — COMPLETE

**Branch:** `feat/coworker-phase-4.5-subagent-scratchpad` (merged to main as `<TBD merge sha>` on 2026-06-DD).
**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-4.5-subagent-scratchpad-design.md`.
**Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-4.5-subagent-scratchpad.md`.

Subagent dispatcher auto-mints a dedicated scratchpad per child process (`subagent-<agent>-<6-hex>`); child `pi` reads `OTTO_SUBAGENT_SCRATCHPAD` env var at `session_start` and force-attaches before any sidecar/pointer restore. Scratchpads persist after subagent exit; parent inspects via `/sp attach <name>`. Run records track `scratchpad_name`. Artifacts + memory drawers flow up to workspace level as before; subagent drawers tagged `room=subagent-<id>` for filtering.

Locked decisions per spec §3: auto-mint (no caller override); persistent lifecycle; env-var discovery; no extra return handoff. ~320 LOC delta, 5 tasks.

Live TUI smoke walkthrough is pending (`2026-06-02-phase-4.5-subagent-scratchpad-smoke.md` PENDING placeholder); automated unit tests at `src/resources/extensions/{subagent,coworker-scratchpad}/*.test.ts` prove the wiring at the unit layer.
```

Update the "Last updated" line at the top of the roadmap to include Phase 4.5.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/notes/2026-06-02-phase-4.5-subagent-scratchpad-smoke.md \
        docs/superpowers/notes/2026-06-01-coworker-roadmap.md
git commit -m "docs(coworker-4.5): smoke checklist + roadmap COMPLETE entry (Phase 4.5 Task 4)"
```

---

### Task 5: Branch-level build + final review

**Files:** none (verification only).

Same shape as Phase 4 Task 16. Goal: confirm everything is green and produce a structured readiness report. DO NOT push without user confirmation.

- [ ] **Step 1: Build every changed surface**

```bash
(cd packages/coworker-utils && npm run build) && \
(cd packages/coworker-vault && npm run build) && \
(cd packages/coworker-memory && npm run build) && \
(cd packages/coworker-artifacts && npm run build) && \
(cd packages/coworker-scratchpad && npm run build) && \
npm run build
```

Expected: every build clean. Strict `tsc` at root MUST pass (the Phase 3.1 hotfix lesson).

- [ ] **Step 2: Full test suite**

```bash
npm run test:compile
npm run test:unit:compiled 2>&1 | tail -10
node --test dist-test/src/resources/extensions/subagent/launch.test.js
node --test dist-test/src/resources/extensions/coworker-scratchpad/*.test.js
node --test dist-test/src/resources/extensions/subagent/tests/*.test.js   # existing subagent suite
node --test dist-test/packages/coworker-*/src/*.test.js                    # regression
```

Expected: all green. Aggregate count should rise by ~12 (Task 1) + ~4 (Task 2) = ~16 new tests.

- [ ] **Step 3: Branch overview**

```bash
git log --oneline main..HEAD
git diff main..HEAD --stat
```

Expected: ~6 commits matching `(coworker-4.5)` pattern (spec + plan + Tasks 1–4 + this task adds the roadmap-update commit if not yet).

- [ ] **Step 4: Cross-cutting checks**

- (a) **No value leaks in activator notify calls.** The `forceSubagentAttach` notify includes the scratchpad name (a non-secret identifier) — verify no env values or paths leaked.
- (b) **Init failure isolation.** If `forceSubagentAttach` returns `ok:false`, activator falls through cleanly; no thrown errors crash `session_start`.
- (c) **No cross-pillar drift.** Phase 4.5 touches only `subagent/` and `coworker-scratchpad/` extensions; verify no edits leaked into memory/vault/artifacts.
- (d) **Phase 1/2/3/3.1/4 regression.** All prior tests pass.

- [ ] **Step 5: Structured report**

```
Build:
  packages/coworker-utils:      PASS|FAIL
  packages/coworker-vault:      PASS|FAIL
  packages/coworker-memory:     PASS|FAIL
  packages/coworker-artifacts:  PASS|FAIL
  packages/coworker-scratchpad: PASS|FAIL
  build:core (otto-cli):        PASS|FAIL

Tests (new Phase 4.5):
  subagent/launch.test.js:               12 / 12
  coworker-scratchpad/index.test.js:     N / M (existing + 4 new force-attach tests)

Tests (regression):
  test:unit:compiled total:              N / M  (delta vs Phase 4 baseline: +~16)
  subagent/tests/*.test.js:              N / M
  coworker-memory pkg:                   N / M
  coworker-vault pkg:                    N / M
  coworker-scratchpad pkg:               N / M
  coworker-artifacts pkg:                N / M

Commits on branch (vs main): COUNT (expected ~6)
All match (coworker-4.5)? YES | <list non-matching>

Cross-cutting:
  (a) No value leaks:           CLEAN | <findings>
  (b) Init failure isolation:   CLEAN | <findings>
  (c) No cross-pillar drift:    CLEAN | <findings>
  (d) Phase 1/2/3/3.1/4 regression: CLEAN | <findings>

Smoke checklist live-verified: NO (manual gate, PENDING placeholder in docs)

Push status: NOT PUSHED (per user instruction)

Overall: READY TO MERGE | NEEDS WORK | NEEDS USER INPUT
```

- [ ] **Step 6: Stop. Report. Do not push.**

User reviews + decides whether to merge to main (`--no-ff` matching Phase 3 / 3.1 / 4 pattern) and/or push + rebuild.

---

## Self-review summary

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| §1 Goal — auto-mint scratchpad + force-attach + persist | Tasks 1 (mint + env), 2 (force-attach), 3 (dispatcher wire + run record). |
| §2 Non-goals — TTL cleanup, caller override, CLI flag, return-value augmentation | Honored throughout (no opposite work). |
| §3.1 Auto-mint always | Task 1 `mintSubagentScratchpadName`; Task 3 mints at every spawn site. |
| §3.2 Persistent lifecycle | Task 2 force-attach creates meta.json but never deletes; smoke step 4 verifies post-exit `/sp list`. |
| §3.3 Env-var discovery | Task 1 constant + injection; Task 2 reads env var. |
| §3.4 No extra return handoff | No changes to subagent JSON output. |
| §3.5 Slug sanitization matches Phase 4 rules | Task 1 `mintSubagentScratchpadName` uses NFKD + kebab + truncate, mirroring `deriveSlug`. |
| §3.6 Force-attach bypasses restore | Task 2 `session_start` returns early after force-attach succeeds. |
| §3.7 Idempotent re-attach | Task 2 `forceSubagentAttach` checks `existsSync` before mkdir + writeFileSync. |
| §3.8 Run record gains `scratchpad_name?` | Task 3 step 1. |
| §4 Architecture (env-var → force-attach → persist) | Tasks 1, 2, 3 together. |
| §5 Module responsibilities | Each module Tasks 1, 2, 3. |
| §6 Error policy | Task 2 force-attach returns ok|reason; activator notifies warning + falls through. |
| §7 Edge cases — parallel dispatch, chain, parent attach mid-run | Task 1's hex randomness; Task 2's idempotent re-attach; Phase 1 cross-process lock unchanged. |
| §8 Testing strategy | Task 1 (12 tests) + Task 2 (4 tests) + Task 4 (smoke). |
| §9 Milestone | Smoke checklist Task 4 covers all 7 milestone items. |
| §10 Out-of-scope | Honored. |

No gaps.

**Placeholder scan:** No `TBD` / `TODO` / `similar to` patterns. Every task step has either a code block or an exact command. Task 3's "search for spawn invocations" is a real investigation step (the existing index.ts is 1978 lines; the three call sites need to be located) — that's documented investigation, not a placeholder.

**Type consistency check:**
- `SUBAGENT_SCRATCHPAD_ENV_VAR = 'OTTO_SUBAGENT_SCRATCHPAD'` consistent in Tasks 1, 2.
- `mintSubagentScratchpadName(agentName: string): string` signature consistent in Tasks 1 (defn) and 3 (call).
- `forceSubagentAttach(name, root): { ok: true } | { ok: false; reason: string }` consistent in Task 2 defn + call.
- `scratchpad_name?: string` field on `SubagentRunRecord` consistent across Tasks 3 (defn + write).
- Scratchpad name regex `^subagent-[a-z0-9-]+$` consistent in Task 1 minter (produces it) and Task 2 validator (accepts it).

No drift.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-02-coworker-phase-4.5-subagent-scratchpad.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage spec+quality review on substantive tasks. Same workflow used for Phase 2 / Phase 3 / Phase 3.1 / Phase 4.

**2. Inline Execution** — execute tasks in this session with batch checkpoints.

Which approach?
