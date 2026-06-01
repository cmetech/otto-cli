# Otto Co-Worker Phase 1.5 — Polish Wave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all open Phase 1 known-issues (Issues #1/#2/#4/#5/#6 + GH #66/#67) in one focused wave before Phase 2 (otto-vault) starts. Headline: workspace-pointer restore so the spec's canonical day-2 RCA scenario works without `--resume`.

**Architecture:** Six tasks bundled in a single branch. Task A adds a workspace-keyed restore pointer alongside the existing per-session sidecar. Task B renames + GCs old sidecars on init. Task C tightens `/sp attach` to error on typos. Task D adds `/sp list` idle-age + `/sp evict [--force]`. Task E fixes a stale-meta-on-fresh-attach quirk. Task F adds `otto.duckdb.registerDf` so polars→DuckDB is a 2-cell operation instead of an 8-cell exploration.

**Tech Stack:** Node 22, `node:test`, `node:fs` (renameSync, existsSync), `node:child_process` (execSync for git toplevel detection), `node:crypto` (sha256), existing `ScratchpadManager` + `ChildProcessRuntime` + `cw_scratchpad` extension surface.

**Branch:** new `feat/coworker-phase-1.5-polish` (branched from main after Phase 1 merge).

**Spec:** `docs/superpowers/specs/2026-06-01-coworker-phase-1.5-polish-design.md`

---

## Plan adjustments (divergences from spec, with rationale)

### Adjustment 1: `--force` uses existing `runtime.cancel()`, skips snapshot

The spec (§4.4) drafted `evict --force` with a fresh `CELL_CANCEL_TIMEOUT_MS = 5000` constant and a hand-rolled SIGTERM→wait→SIGKILL escalation. But `ChildProcessRuntime` already exposes `cancel(): Promise<void>` (child-process-runtime.ts:203) that does the full SIGINT→`cancelGraceMs`→SIGTERM+SIGKILL escalation internally.

This plan uses `runtime.cancel()` directly. After cancel resolves, the runtime is dead (`alive: false`) and the child is SIGKILLed — `snapshotThenDispose` would fail because the kernel is gone. So `--force` ALWAYS skips the snapshot and just cleans up the entry. Loss of fidelity: any pending namespace.json state not yet snapshotted is lost; next attach is a cold-restart from `cells.jsonl` (which has the completed-cell record). This matches the "your kernel is wedged, I'm killing it" mental model of `--force`.

No new `CELL_CANCEL_TIMEOUT_MS` constant. `cancelGraceMs` is already the configurable knob.

### Adjustment 2: Sidecar filename = `sidecar_<sessionId>.json`

The spec (§3.6, §4.2) proposed `sidecar_<attached_at>_<sessionId>.json` with `attached_at` baked into the filename. But Otto's `sessionId` already encodes a timestamp (format `<ISO8601>_<uuid>`), so adding `attached_at` would be redundant + would break `deleteSessionSidecar` (which only knows the sessionId, not the attached_at).

This plan uses `sidecar_<sessionId>.json`. Token in prefix for visual scan + `sidecar_*` glob; `attached_at` stays in the JSON payload only. Simpler, no API change to delete sites.

### Adjustment 3: `ScratchpadInfo` gains `hasActiveCell: boolean`

The spec (§4.4) shows the `/sp list` formatter consulting `entries.get(name)?.hasActiveCell` to distinguish `active` from `idle 0m`. But `manager.list()` returns `ScratchpadInfo[]` (scratchpad-manager.ts:575) and the extension shouldn't reach into the manager's private `entries` map.

This plan adds `hasActiveCell: boolean` to the `ScratchpadInfo` interface and populates it from `entry.runtime?.hasActiveCell ?? false`. Clean API; no encapsulation break.

---

## File Structure

```
packages/coworker-scratchpad/src/
  scratchpad-manager.ts          ← MODIFY: evict(name, opts) method (Task D);
                                            ScratchpadInfo.hasActiveCell field (Task D);
                                            second writeMeta after spawnRuntime (Task E)
  scratchpad-manager.test.ts     ← MODIFY: +6 tests across Tasks D+E
  index.ts                       ← MODIFY: export evict-related types if needed (Task D)
  kernel-bindings.ts             ← MODIFY: registerDf + coerceToRecords + inferSchema
                                            + registerViaAppender (Task F)
  kernel-bindings.test.ts        ← MODIFY: +5 tests for Task F

src/resources/extensions/coworker-scratchpad/
  workspace-root.ts              ← NEW: detectWorkspaceRoot (Task A)
  workspace-root.test.ts         ← NEW: +3 tests (Task A)
  workspace-pointer.ts           ← NEW: hash/path/read/write/freshness (Task A)
  workspace-pointer.test.ts      ← NEW: +4 tests (Task A)
  session-sidecar.ts             ← MODIFY: filename `sidecar_` prefix +
                                            sweepStaleSidecars + SIDECAR_GC_STALE_DAYS
                                            (Task B)
  session-sidecar.test.ts        ← MODIFY: +3 tests for sweep (Task B)
  format-age.ts                  ← NEW: formatRelativeAge — shared by A + D
  format-age.test.ts             ← NEW: +4 tests
  sp-command.ts                  ← MODIFY: existence guard in 'attach' (Task C);
                                            list idle-age formatter +
                                            evict verb with --force (Task D);
                                            workspace-pointer writes on attach/new (Task A)
  sp-command.test.ts             ← MODIFY: +7 tests across Tasks C+D+A
  index.ts                       ← MODIFY: workspace-pointer restore branch with
                                            sidecar-fallback + sweep call (Tasks A + B);
                                            broken-sidecar cleanup
  index.test.ts (NEW if absent)  ← +4 tests for restore precedence (Task A)
  scratchpad-tool.ts             ← MODIFY: promptGuidelines bullet for registerDf (Task F)
```

## Standing test commands

```bash
# Single library test (fast iteration)
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/<file>.test.ts

# Single extension test
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/<file>.test.ts

# Build (BEFORE typecheck — 1g lesson)
npm run build:coworker-scratchpad

# Type gate
npm run typecheck:extensions

# Package gate
npm run test:packages

# Extension gate
npm run test:extensions
```

## Suggested task order

A → B → C → E → D → F. Rationale: A is independent and unblocks restore re-testing; B is adjacent to A (same files); C is a tiny mechanical fix; E is one line; D is the largest extension change; F is fully independent (lib only) and can run in parallel with any of the above.

---

## Task A: Workspace-pointer restore + git-root detection (Issue #6)

**Files:**
- Create: `src/resources/extensions/coworker-scratchpad/workspace-root.ts`
- Create: `src/resources/extensions/coworker-scratchpad/workspace-root.test.ts`
- Create: `src/resources/extensions/coworker-scratchpad/workspace-pointer.ts`
- Create: `src/resources/extensions/coworker-scratchpad/workspace-pointer.test.ts`
- Create: `src/resources/extensions/coworker-scratchpad/format-age.ts` (shared with Task D — created here)
- Create: `src/resources/extensions/coworker-scratchpad/format-age.test.ts`
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.ts:131-198` (add pointer writes in `case 'new'` and `case 'attach'`)
- Modify: `src/resources/extensions/coworker-scratchpad/index.ts:50-65` (restore precedence)
- Create: `src/resources/extensions/coworker-scratchpad/index.test.ts` (if absent)

### Step A.1 — Write failing tests for `detectWorkspaceRoot`

- [ ] **Create** `src/resources/extensions/coworker-scratchpad/workspace-root.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectWorkspaceRoot } from './workspace-root.js';

describe('detectWorkspaceRoot', () => {
  it('returns git toplevel when invoked inside a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-git-'));
    try {
      execSync('git init -q', { cwd: dir });
      const sub = join(dir, 'a', 'b');
      mkdirSync(sub, { recursive: true });
      const root = detectWorkspaceRoot(sub);
      // On macOS, /tmp resolves through /private — compare resolved paths.
      assert.equal(execSync('pwd -P', { cwd: dir, encoding: 'utf8' }).trim(), execSync('pwd -P', { cwd: root, encoding: 'utf8' }).trim());
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('returns cwd when not in a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-nogit-'));
    try {
      assert.equal(detectWorkspaceRoot(dir), dir);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('returns cwd when git command fails (mocked via PATH override)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-pathfail-'));
    try {
      // Run with PATH=/nonexistent so git isn't findable; detection should fall back to cwd.
      const origPath = process.env.PATH;
      process.env.PATH = '/nonexistent';
      try {
        assert.equal(detectWorkspaceRoot(dir), dir);
      } finally {
        process.env.PATH = origPath;
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
```

### Step A.2 — Run tests to verify they fail

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/workspace-root.test.ts`

Expected: FAIL with `Cannot find module './workspace-root.js'`.

### Step A.3 — Implement `workspace-root.ts`

- [ ] **Create** `src/resources/extensions/coworker-scratchpad/workspace-root.ts`:

```ts
import { execSync } from 'node:child_process';

export function detectWorkspaceRoot(cwd: string): string {
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 500,
    }).trim();
    if (out) return out;
  } catch { /* not a git repo, git not installed, or timeout — fall through */ }
  return cwd;
}
```

### Step A.4 — Run tests to verify they pass

Run the same command from A.2. Expected: 3 passing.

### Step A.5 — Write failing tests for `workspace-pointer`

- [ ] **Create** `src/resources/extensions/coworker-scratchpad/workspace-pointer.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  workspaceHash,
  workspacePointerPath,
  readWorkspacePointer,
  writeWorkspacePointer,
  isPointerFresh,
  WORKSPACE_POINTER_STALE_MS,
  type WorkspacePointer,
} from './workspace-pointer.js';

describe('workspace-pointer', () => {
  it('writes and round-trip reads a pointer', () => {
    const root = mkdtempSync(join(tmpdir(), 'wsp-'));
    try {
      const hash = workspaceHash('/home/me/project');
      const path = workspacePointerPath(root, hash);
      const payload: WorkspacePointer = {
        schema_version: 1,
        workspace_hash: hash,
        workspace_root: '/home/me/project',
        last_session_id: 'sess-A',
        last_current_name: 't04-tree',
        last_attached_at: '2026-06-01T12:00:00.000Z',
      };
      writeWorkspacePointer(path, payload);
      assert.deepEqual(readWorkspacePointer(path), payload);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('isPointerFresh respects the 7-day boundary', () => {
    const base: WorkspacePointer = {
      schema_version: 1, workspace_hash: 'h', workspace_root: '/x',
      last_session_id: 's', last_current_name: 'n',
      last_attached_at: '2026-06-01T00:00:00.000Z',
    };
    const at0 = Date.parse(base.last_attached_at);
    assert.equal(isPointerFresh(base, at0 + WORKSPACE_POINTER_STALE_MS - 1), true);
    assert.equal(isPointerFresh(base, at0 + WORKSPACE_POINTER_STALE_MS), false);
    assert.equal(isPointerFresh(base, at0 + WORKSPACE_POINTER_STALE_MS + 1000), false);
  });

  it('returns null for corrupt JSON or missing schema_version', () => {
    const root = mkdtempSync(join(tmpdir(), 'wsp-bad-'));
    try {
      const path = workspacePointerPath(root, 'abc');
      writeFileSync(path.replace(/[^/]+$/, '') + '/dummy.json', '{not json'); // setup dir
      writeFileSync(path, 'not valid json at all');
      assert.equal(readWorkspacePointer(path), null);
      writeFileSync(path, JSON.stringify({ schema_version: 99, foo: 'bar' }));
      assert.equal(readWorkspacePointer(path), null);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('workspaceHash is deterministic 16-char hex and varies by input', () => {
    const a = workspaceHash('/home/me/projA');
    const b = workspaceHash('/home/me/projB');
    assert.equal(a.length, 16);
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.notEqual(a, b);
    assert.equal(workspaceHash('/home/me/projA'), a);
  });
});
```

### Step A.6 — Implement `workspace-pointer.ts`

- [ ] **Create** `src/resources/extensions/coworker-scratchpad/workspace-pointer.ts`:

```ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface WorkspacePointer {
  schema_version: 1;
  workspace_hash: string;
  workspace_root: string;
  last_session_id: string;
  last_current_name: string;
  last_attached_at: string;
}

export const WORKSPACE_POINTER_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export function workspaceHash(workspaceRoot: string): string {
  return createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16);
}

export function workspacePointerPath(rootDir: string, hash: string): string {
  return join(rootDir, '_workspaces', `${hash}.json`);
}

export function readWorkspacePointer(path: string): WorkspacePointer | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<WorkspacePointer>;
    if (
      parsed.schema_version === 1 &&
      typeof parsed.workspace_hash === 'string' &&
      typeof parsed.workspace_root === 'string' &&
      typeof parsed.last_session_id === 'string' &&
      typeof parsed.last_current_name === 'string' &&
      typeof parsed.last_attached_at === 'string'
    ) {
      return parsed as WorkspacePointer;
    }
    return null;
  } catch { return null; }
}

export function writeWorkspacePointer(path: string, payload: WorkspacePointer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, path);
}

export function isPointerFresh(pointer: WorkspacePointer, now: number): boolean {
  const attachedAt = Date.parse(pointer.last_attached_at);
  if (Number.isNaN(attachedAt)) return false;
  return (now - attachedAt) < WORKSPACE_POINTER_STALE_MS;
}
```

### Step A.7 — Run tests to verify they pass

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/workspace-pointer.test.ts`

Expected: 4 passing.

### Step A.8 — Write failing tests for `format-age`

- [ ] **Create** `src/resources/extensions/coworker-scratchpad/format-age.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatRelativeAge } from './format-age.js';

describe('formatRelativeAge', () => {
  it('returns "active" for ages under 30s', () => {
    assert.equal(formatRelativeAge(0), 'active');
    assert.equal(formatRelativeAge(15_000), 'active');
    assert.equal(formatRelativeAge(29_999), 'active');
  });

  it('returns "idle Xm" for ages 30s–1h (floored minutes)', () => {
    assert.equal(formatRelativeAge(30_000), 'idle 0m');
    assert.equal(formatRelativeAge(60_000), 'idle 1m');
    assert.equal(formatRelativeAge(30 * 60_000), 'idle 30m');
    assert.equal(formatRelativeAge(59 * 60_000 + 59_000), 'idle 59m');
  });

  it('returns "idle Xh" for ages 1h–24h (floored hours)', () => {
    assert.equal(formatRelativeAge(60 * 60_000), 'idle 1h');
    assert.equal(formatRelativeAge(2 * 60 * 60_000 + 30 * 60_000), 'idle 2h');
    assert.equal(formatRelativeAge(23 * 60 * 60_000 + 59 * 60_000), 'idle 23h');
  });

  it('returns "idle Xd" for ages 24h+ (floored days)', () => {
    assert.equal(formatRelativeAge(24 * 60 * 60_000), 'idle 1d');
    assert.equal(formatRelativeAge(7 * 24 * 60 * 60_000), 'idle 7d');
    assert.equal(formatRelativeAge(30 * 24 * 60 * 60_000 + 5 * 60 * 60_000), 'idle 30d');
  });
});
```

### Step A.9 — Implement `format-age.ts`

- [ ] **Create** `src/resources/extensions/coworker-scratchpad/format-age.ts`:

```ts
export function formatRelativeAge(ageMs: number): string {
  if (ageMs < 30_000) return 'active';
  if (ageMs < 60 * 60_000) return `idle ${Math.floor(ageMs / 60_000)}m`;
  if (ageMs < 24 * 60 * 60_000) return `idle ${Math.floor(ageMs / (60 * 60_000))}h`;
  return `idle ${Math.floor(ageMs / (24 * 60 * 60_000))}d`;
}
```

### Step A.10 — Run format-age tests

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/format-age.test.ts`

Expected: 4 passing.

### Step A.11 — Wire workspace-pointer writes into `sp-command.ts`

- [ ] **Read** `src/resources/extensions/coworker-scratchpad/sp-command.ts` lines 1-15 to confirm import order. Add to imports (near the existing `session-sidecar` import on line 8):

```ts
import { detectWorkspaceRoot } from './workspace-root.js';
import { workspaceHash, workspacePointerPath, writeWorkspacePointer, type WorkspacePointer } from './workspace-pointer.js';
```

- [ ] **In** `case 'new':` (around line 136), AFTER the existing `writeSessionSidecar(...)` call, ADD:

```ts
const wsRoot = detectWorkspaceRoot(process.cwd());
const wsHash = workspaceHash(wsRoot);
const wsPath = workspacePointerPath(deps.rootDir(), wsHash);
const wsPayload: WorkspacePointer = {
  schema_version: 1,
  workspace_hash: wsHash,
  workspace_root: wsRoot,
  last_session_id: deps.getSessionId(),
  last_current_name: name,
  last_attached_at: new Date().toISOString(),
};
writeWorkspacePointer(wsPath, wsPayload);
```

- [ ] **In** `case 'attach':` (around line 188), AFTER the existing `writeSessionSidecar(...)` call, ADD the same block (uses the same `name` variable bound in the case).

### Step A.12 — Write index.test.ts for restore precedence

- [ ] **Create** `src/resources/extensions/coworker-scratchpad/index.test.ts` (or extend if it exists — grep first). New describe block:

```ts
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionSidecarPath, writeSessionSidecar } from './session-sidecar.js';
import { workspaceHash, workspacePointerPath, writeWorkspacePointer } from './workspace-pointer.js';
import { detectWorkspaceRoot } from './workspace-root.js';
// IMPORTANT: import the restore helper from the extension entrypoint; if the helper is
// not exported, refactor index.ts to export `tryRestoreCurrentName(root, sessionId, cwd, now): { name: string | null, notice: string | null }`
// and call it from the existing register() flow. The test then drives this helper directly
// (it stays pure: no notifier side-effects).
import { tryRestoreCurrentName } from './index.js';

describe('coworker-scratchpad restore precedence', () => {
  let root: string;
  let ws: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cws-root-'));
    ws = mkdtempSync(join(tmpdir(), 'cws-ws-'));
    execSync('git init -q', { cwd: ws });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  });

  function makeScratchpad(name: string): void {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, 'meta.json'), JSON.stringify({ name, schema_version: 3 }));
  }

  it('(a) sidecar wins when its scratchpad exists', () => {
    makeScratchpad('alpha');
    makeScratchpad('beta');
    const sessionId = 'sess-A';
    writeSessionSidecar(sessionSidecarPath(root, sessionId), {
      schema_version: 1, session_id: sessionId, current_name: 'alpha', attached_at: new Date().toISOString(),
    });
    const wsRoot = detectWorkspaceRoot(ws);
    writeWorkspacePointer(workspacePointerPath(root, workspaceHash(wsRoot)), {
      schema_version: 1, workspace_hash: workspaceHash(wsRoot), workspace_root: wsRoot,
      last_session_id: 'sess-OTHER', last_current_name: 'beta',
      last_attached_at: new Date().toISOString(),
    });

    const result = tryRestoreCurrentName(root, sessionId, ws, Date.now());
    assert.equal(result.name, 'alpha');
    assert.match(result.notice!, /alpha.*restored/);
  });

  it('(b) sidecar falls through to workspace pointer when its scratchpad is gone', () => {
    makeScratchpad('beta'); // alpha intentionally absent
    const sessionId = 'sess-A';
    const sidecarPath = sessionSidecarPath(root, sessionId);
    writeSessionSidecar(sidecarPath, {
      schema_version: 1, session_id: sessionId, current_name: 'alpha-gone', attached_at: new Date().toISOString(),
    });
    const wsRoot = detectWorkspaceRoot(ws);
    writeWorkspacePointer(workspacePointerPath(root, workspaceHash(wsRoot)), {
      schema_version: 1, workspace_hash: workspaceHash(wsRoot), workspace_root: wsRoot,
      last_session_id: 'sess-OTHER', last_current_name: 'beta',
      last_attached_at: new Date().toISOString(),
    });

    const result = tryRestoreCurrentName(root, sessionId, ws, Date.now());
    assert.equal(result.name, 'beta');
    assert.match(result.notice!, /beta.*from workspace/);
    assert.equal(existsSync(sidecarPath), false, 'broken sidecar should be deleted');
  });

  it('(c) pointer-only path (no sidecar)', () => {
    makeScratchpad('beta');
    const wsRoot = detectWorkspaceRoot(ws);
    writeWorkspacePointer(workspacePointerPath(root, workspaceHash(wsRoot)), {
      schema_version: 1, workspace_hash: workspaceHash(wsRoot), workspace_root: wsRoot,
      last_session_id: 'sess-OTHER', last_current_name: 'beta',
      last_attached_at: new Date().toISOString(),
    });
    const result = tryRestoreCurrentName(root, 'sess-FRESH', ws, Date.now());
    assert.equal(result.name, 'beta');
    assert.match(result.notice!, /beta.*from workspace/);
  });

  it('(d) no restore when neither sidecar nor fresh pointer exist', () => {
    const result = tryRestoreCurrentName(root, 'sess-FRESH', ws, Date.now());
    assert.equal(result.name, null);
    assert.equal(result.notice, null);
  });
});
```

### Step A.13 — Update `index.ts` restore flow

- [ ] **Read** `src/resources/extensions/coworker-scratchpad/index.ts:1-100` first to confirm the current structure.

- [ ] **Refactor** the existing restore block (around lines 50-65) into a pure exported helper `tryRestoreCurrentName(root: string, sessionId: string, cwd: string, now: number): { name: string | null, notice: string | null }`. The caller (the existing `register` flow) consumes the result and assigns `currentName` + invokes `ctx.ui.notify` from the helper's `notice` field.

Concrete shape of the helper:

```ts
import { sessionSidecarPath, readSessionSidecar, deleteSessionSidecar } from './session-sidecar.js';
import { detectWorkspaceRoot } from './workspace-root.js';
import { workspaceHash, workspacePointerPath, readWorkspacePointer, isPointerFresh } from './workspace-pointer.js';
import { formatRelativeAge } from './format-age.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function tryRestoreCurrentName(
  root: string,
  sessionId: string,
  cwd: string,
  now: number,
): { name: string | null; notice: string | null } {
  // (a) Sidecar restore
  const sidecarPath = sessionSidecarPath(root, sessionId);
  const sidecar = readSessionSidecar(sidecarPath);
  if (sidecar) {
    const meta = join(root, sidecar.current_name, 'meta.json');
    if (existsSync(meta)) {
      return { name: sidecar.current_name, notice: `attached to ${sidecar.current_name} (restored)` };
    }
    deleteSessionSidecar(sidecarPath); // broken sidecar — clean up silently
  }

  // (b) Workspace-pointer fallback
  const wsRoot = detectWorkspaceRoot(cwd);
  const ptr = readWorkspacePointer(workspacePointerPath(root, workspaceHash(wsRoot)));
  if (ptr && isPointerFresh(ptr, now)) {
    const meta = join(root, ptr.last_current_name, 'meta.json');
    if (existsSync(meta)) {
      const rel = formatRelativeAge(now - Date.parse(ptr.last_attached_at));
      return { name: ptr.last_current_name, notice: `attached to ${ptr.last_current_name} (from workspace, last used ${rel})` };
    }
  }

  // (c) No restore
  return { name: null, notice: null };
}
```

- [ ] **Wire it into the existing `register` flow** (the lines that previously read the sidecar inline): replace the inline restore block with:

```ts
const restore = tryRestoreCurrentName(root, sessionId, process.cwd(), Date.now());
if (restore.name) {
  currentName = restore.name;
  ctx.ui.notify(restore.notice!, 'info');
}
```

### Step A.14 — Run all Task A tests

Run all three test files:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/coworker-scratchpad/workspace-root.test.ts \
  src/resources/extensions/coworker-scratchpad/workspace-pointer.test.ts \
  src/resources/extensions/coworker-scratchpad/format-age.test.ts \
  src/resources/extensions/coworker-scratchpad/index.test.ts
```

Expected: 3 + 4 + 4 + 4 = **15 passing**.

### Step A.15 — Build + typecheck gates

```bash
npm run build:coworker-scratchpad   # not strictly needed (no lib changes), but confirms no cross-package break
npm run typecheck:extensions
```

Expected: clean.

### Step A.16 — Commit Task A

```bash
git add packages/coworker-scratchpad src/resources/extensions/coworker-scratchpad
git commit -m "$(cat <<'EOF'
feat(coworker-1.5): workspace-pointer restore so day-2 attach works without --resume

Adds a workspace-keyed restore pointer at ~/.otto/scratchpads/_workspaces/<hash>.json
alongside the existing per-session sidecar. Workspace = git toplevel (else cwd at
session start). Pointer fresh for 7 days; sidecar wins with fallback to pointer
when sidecar's scratchpad was deleted.

Closes the spec's canonical day-2 RCA gap: typing 'otto' in a workspace where a
scratchpad was previously attached now restores that scratchpad without --resume.

Issue: #6 (also adds shared format-age helper used by Task D).

EOF
)"
```

---

## Task B: Sidecar naming + stale-sidecar GC (GH #66, #67)

**Files:**
- Modify: `src/resources/extensions/coworker-scratchpad/session-sidecar.ts` (filename change + sweep function)
- Modify: `src/resources/extensions/coworker-scratchpad/session-sidecar.test.ts` (+3 tests)
- Modify: `src/resources/extensions/coworker-scratchpad/index.ts` (call sweep on init)

### Step B.1 — Write failing sweep tests

- [ ] **Append to** `src/resources/extensions/coworker-scratchpad/session-sidecar.test.ts`:

```ts
import { mkdirSync, statSync, utimesSync, existsSync } from 'node:fs';
import { sweepStaleSidecars, SIDECAR_GC_STALE_DAYS } from './session-sidecar.js';

describe('sweepStaleSidecars', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sweep-'));
    mkdirSync(join(root, '_sessions'), { recursive: true });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('deletes orphan when the referenced scratchpad is gone', () => {
    const sessionId = 'sess-OLD';
    writeSessionSidecar(sessionSidecarPath(root, sessionId), {
      schema_version: 1, session_id: sessionId, current_name: 't-gone',
      attached_at: new Date().toISOString(),
    });
    const deleted = sweepStaleSidecars(root, 'sess-CURRENT', Date.now());
    assert.equal(deleted, 1);
    assert.equal(existsSync(sessionSidecarPath(root, sessionId)), false);
  });

  it('deletes old foreign-session sidecar by mtime when scratchpad still exists', () => {
    mkdirSync(join(root, 't-alive'), { recursive: true });
    writeFileSync(join(root, 't-alive', 'meta.json'), '{}');
    const sessionId = 'sess-OLD';
    const path = sessionSidecarPath(root, sessionId);
    writeSessionSidecar(path, {
      schema_version: 1, session_id: sessionId, current_name: 't-alive',
      attached_at: new Date().toISOString(),
    });
    // Backdate mtime past the threshold
    const oldTime = (Date.now() - (SIDECAR_GC_STALE_DAYS + 1) * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(path, oldTime, oldTime);
    const deleted = sweepStaleSidecars(root, 'sess-CURRENT', Date.now());
    assert.equal(deleted, 1);
    assert.equal(existsSync(path), false);
  });

  it('never deletes the current session sidecar, even when backdated', () => {
    const sessionId = 'sess-CURRENT';
    const path = sessionSidecarPath(root, sessionId);
    writeSessionSidecar(path, {
      schema_version: 1, session_id: sessionId, current_name: 't-gone',
      attached_at: new Date().toISOString(),
    });
    const oldTime = (Date.now() - (SIDECAR_GC_STALE_DAYS + 10) * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(path, oldTime, oldTime);
    const deleted = sweepStaleSidecars(root, sessionId, Date.now());
    assert.equal(deleted, 0);
    assert.equal(existsSync(path), true);
  });
});
```

### Step B.2 — Run tests to verify they fail

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/session-sidecar.test.ts`

Expected: 3 new tests FAIL with `sweepStaleSidecars is not a function` and import errors.

### Step B.3 — Modify `session-sidecar.ts`: rename filename + add sweep

- [ ] **Edit** `src/resources/extensions/coworker-scratchpad/session-sidecar.ts`:

Replace the `sessionSidecarPath` function with:

```ts
export function sessionSidecarPath(rootDir: string, sessionId: string): string {
  return join(rootDir, '_sessions', `sidecar_${sessionId}.json`);
}
```

Add (at the bottom of the file):

```ts
import { readdirSync, statSync } from 'node:fs'; // ensure these are in the existing import

export const SIDECAR_GC_STALE_DAYS = 7;

export function sweepStaleSidecars(rootDir: string, currentSessionId: string, now: number): number {
  const dir = join(rootDir, '_sessions');
  if (!existsSync(dir)) return 0;
  let deleted = 0;
  const staleMs = SIDECAR_GC_STALE_DAYS * 24 * 60 * 60 * 1000;
  for (const f of readdirSync(dir)) {
    if (!f.startsWith('sidecar_')) continue; // safety: only touch known-format files
    const path = join(dir, f);
    try {
      const sc = readSessionSidecar(path);
      if (!sc) continue;
      if (sc.session_id === currentSessionId) continue;
      const scratchpadMeta = join(rootDir, sc.current_name, 'meta.json');
      const scratchpadGone = !existsSync(scratchpadMeta);
      const tooOld = (now - statSync(path).mtimeMs) > staleMs;
      if (scratchpadGone || tooOld) {
        rmSync(path, { force: true });
        deleted++;
      }
    } catch { /* per-file isolation */ }
  }
  return deleted;
}
```

Update the top-of-file import to include `readdirSync` and `statSync`:

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
```

### Step B.4 — Run tests to verify they pass

Run the same command from B.2. Expected: all sidecar tests passing (existing + 3 new).

### Step B.5 — Wire sweep into `index.ts` init

- [ ] **In** `src/resources/extensions/coworker-scratchpad/index.ts`, immediately AFTER the `tryRestoreCurrentName` call from Task A, ADD:

```ts
import { sweepStaleSidecars } from './session-sidecar.js'; // add to existing import if not present
// ... inside register, after the restore call:
try { sweepStaleSidecars(root, sessionId, Date.now()); } catch { /* sweep failures are silent */ }
```

### Step B.6 — Build + typecheck gates

```bash
npm run typecheck:extensions
```

Expected: clean.

### Step B.7 — Commit Task B

```bash
git add src/resources/extensions/coworker-scratchpad/session-sidecar.ts \
        src/resources/extensions/coworker-scratchpad/session-sidecar.test.ts \
        src/resources/extensions/coworker-scratchpad/index.ts
git commit -m "$(cat <<'EOF'
feat(coworker-1.5): sidecar 'sidecar_' filename prefix + stale-sidecar GC on init

Renames session sidecars to sidecar_<sessionId>.json for visual scan + glob.
Adds sweepStaleSidecars() that runs once at session_start; deletes any foreign-
session sidecar whose scratchpad is gone OR whose mtime is > 7 days old.

Closes #66 #67.

EOF
)"
```

---

## Task C: `/sp attach` existence guard (Issue #5)

**Files:**
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.ts:145-205` (case 'attach')
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.test.ts` (+2 tests)

### Step C.1 — Write failing tests

- [ ] **Append to** `src/resources/extensions/coworker-scratchpad/sp-command.test.ts`:

```ts
describe('/sp attach existence guard (Task C)', () => {
  // Use the existing test harness pattern (makeCtx + tempRoot + makeDeps).
  // The exact helper names are in the existing file — match them.

  it('errors with a helpful suggestion when scratchpad does not exist on disk', async () => {
    const { ctx, deps, root } = await makeTestEnv();
    const notifications: Array<{ msg: string; level: string }> = [];
    ctx.ui.notify = (msg: string, level: string) => { notifications.push({ msg, level }); };

    await runSpCommand('/sp attach not-a-real-name', ctx, deps);

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]!.level, 'error');
    assert.match(notifications[0]!.msg, /scratchpad not found: not-a-real-name/);
    assert.match(notifications[0]!.msg, /Use \/sp new not-a-real-name to create it/);
    assert.equal(existsSync(join(root, 'not-a-real-name')), false, 'no phantom dir created');
  });

  it('still attaches normally when scratchpad exists', async () => {
    const { ctx, deps, root } = await makeTestEnv();
    await runSpCommand('/sp new real', ctx, deps);
    const notifications: Array<{ msg: string; level: string }> = [];
    ctx.ui.notify = (msg: string, level: string) => { notifications.push({ msg, level }); };

    await runSpCommand('/sp attach real', ctx, deps);

    assert.equal(notifications.filter(n => n.level === 'error').length, 0);
    assert.ok(notifications.some(n => /attached to scratchpad: real/.test(n.msg)));
  });
});
```

> Note: `makeTestEnv` and `runSpCommand` are placeholders — match the actual helper names in the existing `sp-command.test.ts`. Grep the file first; reuse whatever setup pattern is established.

### Step C.2 — Run tests to verify they fail

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/sp-command.test.ts`

Expected: 2 new tests FAIL — first because no error is raised (typo silently creates), second because... actually the second already passes; it's a regression guard.

### Step C.3 — Insert existence guard in `case 'attach':`

- [ ] **In** `src/resources/extensions/coworker-scratchpad/sp-command.ts`, inside `case 'attach':` (around line 145), AFTER `validateName(name)` and BEFORE the force-takeover handling, ADD:

```ts
const metaPath = join(deps.rootDir(), name, 'meta.json');
if (!existsSync(metaPath)) {
  ctx.ui.notify(
    `scratchpad not found: ${name}. Use /sp new ${name} to create it.`,
    'error',
  );
  return;
}
```

The `existsSync` and `join` imports may already exist; if not, add them to the top of the file.

### Step C.4 — Run tests to verify they pass

Run the same command from C.2. Expected: both tests passing.

### Step C.5 — Commit Task C

```bash
git add src/resources/extensions/coworker-scratchpad/sp-command.ts \
        src/resources/extensions/coworker-scratchpad/sp-command.test.ts
git commit -m "$(cat <<'EOF'
feat(coworker-1.5): /sp attach errors on typo instead of silently creating phantom

Slash-command path now verifies on-disk existence before delegating to
manager.getOrAttach. Library + LLM tool path (cw_scratchpad action=exec)
remain permissive — they auto-create as before, which is correct for the
LLM workflow.

Closes Issue #5.

EOF
)"
```

---

## Task E: `meta.json` initial-write ordering (Issue #2)

**Files:**
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts` (`attachUnmanaged` at line 551)
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts` (+1 test)

Doing Task E before Task D because it's a one-line change and the manager test file gets bigger touches in Task D.

### Step E.1 — Write failing test

- [ ] **Append to** `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`:

```ts
describe('ScratchpadManager attach meta freshness (Task E)', () => {
  it('meta.json after /sp new reflects post-spawn disk state (kernel_db.present + size_bytes)', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'sp-ws-'));
    const root = await mkdtemp(join(tmpdir(), 'sp-root-'));
    const mgr = new ScratchpadManager({ workspace, root, sessionId: 's', sweepIntervalMs: 1_000_000 });
    try {
      await mgr.getOrAttach('fresh'); // simulates /sp new path
      const meta = JSON.parse(readFileSync(join(root, 'fresh', 'meta.json'), 'utf8')) as { kernel_db: { present: boolean }, size_bytes: number };
      assert.equal(meta.kernel_db.present, true, 'kernel.db should be reflected after spawn');
      assert.ok(meta.size_bytes > 0, `size_bytes should be > 0; got ${meta.size_bytes}`);
    } finally {
      await mgr.disposeAll();
      await rm(workspace, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

### Step E.2 — Run test to verify it fails

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

Expected: new test FAILS — `meta.kernel_db.present` is false, `meta.size_bytes` is 0.

### Step E.3 — Add second `writeMeta` after `spawnRuntime` in `attachUnmanaged`

- [ ] **Read** `packages/coworker-scratchpad/src/scratchpad-manager.ts:551-580` to confirm the current `attachUnmanaged` body.

- [ ] **In** `attachUnmanaged`, AFTER the line `runtime = await this.spawnRuntime(name);` (around line 562), ADD:

```ts
this.writeMeta(name); // refresh: kernel.db is now on disk; payloadSize + kernel_db.present become accurate
```

### Step E.4 — Run test to verify it passes

Run the same command from E.2. Expected: passing.

### Step E.5 — Run full package gate

```bash
npm run build:coworker-scratchpad
npm run test:packages
```

Expected: all green.

### Step E.6 — Commit Task E

```bash
git add packages/coworker-scratchpad/src/scratchpad-manager.ts \
        packages/coworker-scratchpad/src/scratchpad-manager.test.ts
git commit -m "$(cat <<'EOF'
fix(coworker-1.5): meta.json on fresh attach reflects post-spawn disk state

Adds a second writeMeta() call after spawnRuntime succeeds in attachUnmanaged.
The first write preserves the lock-acquire side-effect; the second write refreshes
size_bytes and kernel_db.present once kernel.db is actually on disk.

Closes Issue #2.

EOF
)"
```

---

## Task D: Pool visibility + `/sp evict [--force]` (Issue #4)

**Files:**
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.ts` (add `hasActiveCell` to `ScratchpadInfo`, add `evict` method)
- Modify: `packages/coworker-scratchpad/src/scratchpad-manager.test.ts` (+5 tests)
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.ts` (`/sp list` formatter + new `evict` case)
- Modify: `src/resources/extensions/coworker-scratchpad/sp-command.test.ts` (+3 tests)

### Step D.1 — Write failing library tests (manager.evict + ScratchpadInfo.hasActiveCell)

- [ ] **Append to** `packages/coworker-scratchpad/src/scratchpad-manager.test.ts`:

```ts
describe('ScratchpadManager.evict (Task D)', () => {
  let workspace: string;
  let root: string;
  let mgr: ScratchpadManager;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'sp-ws-'));
    root = await mkdtemp(join(tmpdir(), 'sp-root-'));
    mgr = new ScratchpadManager({ workspace, root, sessionId: 's', sweepIntervalMs: 1_000_000 });
  });
  afterEach(async () => {
    await mgr.disposeAll();
    await rm(workspace, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  it('evict snapshots + disposes warm entry; dir/meta/cells.jsonl remain', async () => {
    await mgr.runCell('t', 'globalThis.x = 1;');
    const { interrupted } = await mgr.evict('t');
    assert.equal(interrupted, false);
    assert.equal(mgr.list().find(i => i.name === 't')?.warm, false, 'should flip to cold');
    assert.ok(existsSync(join(root, 't', 'kernel.db')), 'kernel.db remains on disk');
    assert.ok(existsSync(join(root, 't', 'meta.json')), 'meta.json remains on disk');
  });

  it('evict refuses without --force when a cell is active', async () => {
    await mgr.getOrAttach('t');
    // Start a long-running cell but don't await it.
    const pending = mgr.runCell('t', 'while (true) {}');
    // Give the kernel a moment to start executing.
    await new Promise((r) => setTimeout(r, 50));
    await assert.rejects(mgr.evict('t'), /cell is running.*--force to interrupt/);
    // Clean up: cancel via --force so afterEach doesn't hang.
    await mgr.evict('t', { force: true });
    await assert.rejects(pending); // cell rejected via cancel
  });

  it('evict --force interrupts an active cell and skips snapshot', async () => {
    await mgr.getOrAttach('t');
    const pending = mgr.runCell('t', 'while (true) {}');
    await new Promise((r) => setTimeout(r, 50));
    const { interrupted } = await mgr.evict('t', { force: true });
    assert.equal(interrupted, true);
    await assert.rejects(pending, /cancelled/);
    // Entry should be gone; dir remains for cold-restart.
    assert.equal(mgr.list().find(i => i.name === 't')?.warm, false);
    assert.ok(existsSync(join(root, 't', 'meta.json')), 'on-disk state preserved');
  });

  it('evict on cold entry throws "not warm"', async () => {
    await mgr.getOrAttach('t');
    await mgr.evict('t'); // first evict makes it cold
    await assert.rejects(mgr.evict('t'), /not warm \(already cold\)/);
  });

  it('list() ScratchpadInfo exposes hasActiveCell', async () => {
    await mgr.runCell('t', 'globalThis.x = 1;');
    const info = mgr.list().find(i => i.name === 't')!;
    assert.equal(info.hasActiveCell, false, 'idle warm entry');
    const pending = mgr.runCell('t', 'while (true) {}');
    await new Promise((r) => setTimeout(r, 50));
    const infoBusy = mgr.list().find(i => i.name === 't')!;
    assert.equal(infoBusy.hasActiveCell, true, 'mid-cell warm entry');
    await mgr.evict('t', { force: true });
    await assert.rejects(pending);
  });
});
```

### Step D.2 — Run tests to verify they fail

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/scratchpad-manager.test.ts`

Expected: 5 new tests fail (`mgr.evict is not a function`, `info.hasActiveCell undefined`).

### Step D.3 — Implement `evict` + extend `ScratchpadInfo`

- [ ] **Read** `packages/coworker-scratchpad/src/scratchpad-manager.ts:36-46` to confirm the current `ScratchpadInfo` shape.

- [ ] **Modify** the `ScratchpadInfo` interface to add `hasActiveCell: boolean`:

```ts
export interface ScratchpadInfo {
  name: string;
  warm: boolean;
  lastUsedAt: number;
  hasActiveCell: boolean; // NEW (Task D)
  // ... preserve any other existing fields
}
```

- [ ] **Modify** `list()` (line 575) to populate the new field:

```ts
list(): ScratchpadInfo[] {
  const out: ScratchpadInfo[] = [];
  // existing scan; add hasActiveCell to each emitted record:
  // hasActiveCell: e.runtime?.hasActiveCell ?? false
  return out;
}
```

Read the actual existing body of `list()` first and add the field in place — do not rewrite.

- [ ] **Add** the `evict` method on `ScratchpadManager` (place it after the existing `runCell`, before `attachUnmanaged`):

```ts
async evict(name: string, opts: { force?: boolean } = {}): Promise<{ interrupted: boolean }> {
  this.assertNotDisposed();
  const entry = this.entries.get(name);
  if (!entry || !entry.runtime) {
    throw new Error(`scratchpad ${name} is not warm (already cold)`);
  }
  if (entry.runtime.hasActiveCell) {
    if (!opts.force) {
      throw new Error(`cannot evict ${name}: cell is running (use --force to interrupt)`);
    }
    // --force: cancel via existing SIGINT → SIGTERM → SIGKILL escalation.
    // After cancel resolves, the runtime is dead; snapshotThenDispose would fail.
    // Skip the snapshot and clean up the entry directly. On-disk state remains
    // intact for cold-restart on next attach.
    await entry.runtime.cancel();
    try { await entry.runtime.dispose(); } catch { /* already dead */ }
    this.entries.delete(name);
    return { interrupted: true };
  }
  await this.snapshotThenDispose(name, entry);
  return { interrupted: false };
}
```

### Step D.4 — Run library tests to verify they pass

Run the same command from D.2. Expected: 5 new tests passing. Existing tests should also still pass (`hasActiveCell` is additive on the info shape).

### Step D.5 — Write failing tests for `/sp list` + `/sp evict` extension

- [ ] **Append to** `src/resources/extensions/coworker-scratchpad/sp-command.test.ts`:

```ts
describe('/sp list idle-age + /sp evict (Task D)', () => {
  it('list shows "active" for an entry whose lastUsedAt is now', async () => {
    const { ctx, deps } = await makeTestEnv();
    await runSpCommand('/sp new t', ctx, deps);
    const notifications: Array<{ msg: string; level: string }> = [];
    ctx.ui.notify = (msg: string) => { notifications.push({ msg, level: 'info' }); };

    await runSpCommand('/sp list', ctx, deps);

    assert.ok(notifications.some(n => /● live\s+t\s+active/.test(n.msg)));
  });

  it('list shows "idle Xm" when entry is idle (mock lastUsedAt back by 4 min)', async () => {
    const { ctx, deps } = await makeTestEnv();
    await runSpCommand('/sp new t', ctx, deps);
    // Reach into the manager to backdate; mirrors how the existing 1g2 tests touch internals.
    const mgr = deps.getManager() as unknown as { entries: Map<string, { lastUsedAt: number }> };
    mgr.entries.get('t')!.lastUsedAt = Date.now() - 4 * 60 * 1000;
    const notifications: string[] = [];
    ctx.ui.notify = (msg: string) => { notifications.push(msg); };

    await runSpCommand('/sp list', ctx, deps);

    assert.ok(notifications.some(n => /● live\s+t\s+idle 4m/.test(n)));
  });

  it('/sp evict t notifies and flips to cold', async () => {
    const { ctx, deps } = await makeTestEnv();
    await runSpCommand('/sp new t', ctx, deps);
    const notifications: Array<{ msg: string; level: string }> = [];
    ctx.ui.notify = (msg: string, level: string) => { notifications.push({ msg, level }); };

    await runSpCommand('/sp evict t', ctx, deps);

    assert.ok(notifications.some(n => /evicted t/.test(n.msg) && n.level === 'info'));
    // Subsequent list should show cold
    notifications.length = 0;
    await runSpCommand('/sp list', ctx, deps);
    assert.ok(notifications.some(n => /○ cold\s+t/.test(n.msg)));
  });
});
```

### Step D.6 — Run extension tests to verify they fail

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/coworker-scratchpad/sp-command.test.ts`

Expected: 3 new tests FAIL (`active` column missing; unknown verb `evict`).

### Step D.7 — Extend `/sp list` formatter + add `evict` case

- [ ] **Read** `src/resources/extensions/coworker-scratchpad/sp-command.ts:111-130` to confirm the current `case 'list':` formatter shape.

- [ ] **Modify** `case 'list':` to add the idle-age column for warm entries. Pseudocode (adapt to the exact formatter style in the file):

```ts
import { formatRelativeAge } from './format-age.js';
// ... inside case 'list':
const now = Date.now();
const lines = infos.map((i) => {
  const symbol = i.warm ? '● live' : '○ cold';
  const age = i.warm
    ? (i.hasActiveCell ? 'active' : formatRelativeAge(now - i.lastUsedAt))
    : ''; // cold entries show no age
  const current = i.name === deps.getCurrentName() ? '(current)' : '';
  return `${symbol}  ${i.name.padEnd(20)} ${age.padEnd(12)} ${current}`.trimEnd();
});
ctx.ui.notify(['scratchpads:', ...lines].join('\n'), 'info');
```

- [ ] **Add a new case** `case 'evict':` to the switch (place it near `case 'remove':`):

```ts
case 'evict': {
  if (!name) { ctx.ui.notify('Usage: /sp evict <name> [--force]', 'error'); return; }
  const force = parts.includes('--force');
  validateName(name);
  try {
    const { interrupted } = await deps.getManager().evict(name, { force });
    const msg = interrupted
      ? `interrupted active cell and evicted ${name}`
      : `evicted ${name} (still on disk; /sp attach ${name} to re-warm)`;
    ctx.ui.notify(msg, 'info');
  } catch (e) {
    ctx.ui.notify((e as Error).message, 'error');
  }
  return;
}
```

### Step D.8 — Run tests to verify they pass

Run both test files:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  packages/coworker-scratchpad/src/scratchpad-manager.test.ts \
  src/resources/extensions/coworker-scratchpad/sp-command.test.ts
```

Expected: all green.

### Step D.9 — Build + typecheck gates

```bash
npm run build:coworker-scratchpad
npm run typecheck:extensions
```

Expected: clean.

### Step D.10 — Commit Task D

```bash
git add packages/coworker-scratchpad src/resources/extensions/coworker-scratchpad
git commit -m "$(cat <<'EOF'
feat(coworker-1.5): /sp list idle age + /sp evict [--force]

ScratchpadInfo gains hasActiveCell so /sp list can render 'active' vs 'idle Xm/h/d'
via the shared formatRelativeAge helper. New /sp evict <name> snapshots + disposes
a warm entry without deleting the scratchpad; --force interrupts an active cell
via the existing runtime.cancel() escalation (skips snapshot, since the kernel
is dead post-cancel — next attach is cold-restart from cells.jsonl).

Closes Issue #4.

EOF
)"
```

---

## Task F: `otto.duckdb.registerDf` helper (Issue #1)

**Files:**
- Modify: `packages/coworker-scratchpad/src/kernel-bindings.ts` (add registerDf + helpers)
- Modify: `packages/coworker-scratchpad/src/kernel-bindings.test.ts` (+5 tests)
- Modify: `src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts` (promptGuidelines bullet)

### Step F.1 — Read existing kernel-bindings.ts to confirm shape

- [ ] **Read** `packages/coworker-scratchpad/src/kernel-bindings.ts` end-to-end to confirm how `otto.duckdb` is currently constructed and where to attach the new method.

- [ ] **Read** `packages/coworker-scratchpad/src/kernel-bindings.test.ts` first 50 lines to confirm test harness patterns (how to load polars, get a kernel handle, run a cell).

### Step F.2 — Write failing tests

- [ ] **Append to** `packages/coworker-scratchpad/src/kernel-bindings.test.ts`:

```ts
describe('otto.duckdb.registerDf (Task F)', () => {
  // Use the existing harness. If the existing harness drives whole cells via the
  // kernel, structure each test as a cell that exercises registerDf and returns
  // a result. Match the existing test idioms in this file rather than the sketch
  // below if they differ.

  it('round-trips an array of records', async () => {
    const result = await runCellViaKernel(`
      await otto.duckdb.registerDf('rec', [{a: 1, b: 'x'}, {a: 2, b: 'y'}]);
      const c = await otto.duckdb.connect();
      return (await c.runAndReadAll('SELECT SUM(a) FROM rec')).getRows();
    `);
    assert.deepEqual(result, [[3]]);
  });

  it('round-trips a polars DataFrame', async () => {
    const result = await runCellViaKernel(`
      const pl = await import('nodejs-polars');
      const df = pl.DataFrame({ a: [1, 2, 3], b: ['x', 'y', 'z'] });
      await otto.duckdb.registerDf('pdf', df);
      const c = await otto.duckdb.connect();
      return (await c.runAndReadAll('SELECT SUM(a) FROM pdf')).getRows();
    `);
    assert.deepEqual(result, [[6]]);
  });

  it('throws TypeError for unsupported input', async () => {
    await assert.rejects(
      runCellViaKernel(`await otto.duckdb.registerDf('bad', 42);`),
      /must be a polars DataFrame, Arrow Table, or array of records/,
    );
  });

  it('opts.schema override skips inference and uses provided types', async () => {
    const result = await runCellViaKernel(`
      await otto.duckdb.registerDf(
        'sized',
        [{n: 1}, {n: 2}, {n: 3}],
        { schema: { n: 'BIGINT' } }
      );
      const c = await otto.duckdb.connect();
      const desc = await c.runAndReadAll('DESCRIBE sized');
      return desc.getRows();
    `);
    // DuckDB DESCRIBE returns rows shaped [column_name, column_type, null, key, default, extra]
    assert.equal(result[0][0], 'n');
    assert.equal(result[0][1], 'BIGINT');
  });

  it('null-walk inference picks the first non-null value type', async () => {
    const result = await runCellViaKernel(`
      const rows = Array(8).fill({ rev: null }).concat([{ rev: 1200 }, { rev: 980 }]);
      await otto.duckdb.registerDf('rev', rows);
      const c = await otto.duckdb.connect();
      const desc = await c.runAndReadAll('DESCRIBE rev');
      return desc.getRows();
    `);
    assert.equal(result[0][0], 'rev');
    assert.equal(result[0][1], 'DOUBLE');
  });
});
```

> `runCellViaKernel` is a placeholder — match the actual cell-execution helper in the existing `kernel-bindings.test.ts`. If no helper exists, follow the pattern in `scratchpad-manager.test.ts` (instantiate a `ScratchpadManager` and use `mgr.runCell(name, code)`).

### Step F.3 — Run tests to verify they fail

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-bindings.test.ts`

Expected: 5 new tests FAIL (`registerDf is not a function`).

### Step F.4 — Implement `registerDf` in `kernel-bindings.ts`

- [ ] **Edit** `packages/coworker-scratchpad/src/kernel-bindings.ts`. Add the registerDf surface where `otto.duckdb` is currently constructed:

```ts
export type DuckDBColumnType = string;

export interface RegisterDfOptions {
  schema?: Record<string, DuckDBColumnType> | Array<[string, DuckDBColumnType]>;
}

function isPolarsDataFrame(x: unknown): x is { toRecords: () => Record<string, unknown>[]; width: number; height: number } {
  return !!x && typeof x === 'object'
    && typeof (x as { toRecords?: unknown }).toRecords === 'function'
    && typeof (x as { width?: unknown }).width === 'number'
    && typeof (x as { height?: unknown }).height === 'number';
}

function isArrowTable(x: unknown): x is { toArray: () => Record<string, unknown>[]; numRows: number; schema: unknown } {
  return !!x && typeof x === 'object'
    && typeof (x as { toArray?: unknown }).toArray === 'function'
    && typeof (x as { numRows?: unknown }).numRows === 'number'
    && 'schema' in (x as object);
}

function coerceToRecords(input: unknown): Record<string, unknown>[] {
  if (isPolarsDataFrame(input)) return input.toRecords();
  if (isArrowTable(input)) return input.toArray();
  if (Array.isArray(input)) return input as Record<string, unknown>[];
  throw new TypeError('registerDf: input must be a polars DataFrame, Arrow Table, or array of records');
}

function inferSchema(records: Record<string, unknown>[]): Record<string, DuckDBColumnType> {
  if (records.length === 0) throw new Error('registerDf: cannot infer schema from empty input. Provide opts.schema or pass at least one row.');
  const cols = Object.keys(records[0]!);
  const out: Record<string, DuckDBColumnType> = {};
  for (const col of cols) {
    out[col] = 'VARCHAR'; // safe default for all-null columns
    for (let i = 0; i < Math.min(10, records.length); i++) {
      const v = records[i]![col];
      if (v === null || v === undefined) continue;
      if (typeof v === 'string') { out[col] = 'VARCHAR'; break; }
      if (typeof v === 'bigint') { out[col] = 'BIGINT'; break; }
      if (typeof v === 'number') { out[col] = 'DOUBLE'; break; }
      if (typeof v === 'boolean') { out[col] = 'BOOLEAN'; break; }
      if (v instanceof Date) { out[col] = 'TIMESTAMP'; break; }
      out[col] = 'VARCHAR'; // unknown object → store as VARCHAR
      break;
    }
  }
  return out;
}

function normalizeSchema(
  schema: Record<string, DuckDBColumnType> | Array<[string, DuckDBColumnType]>,
): Array<[string, DuckDBColumnType]> {
  if (Array.isArray(schema)) return schema;
  return Object.entries(schema);
}

async function registerViaAppender(
  conn: { run: (sql: string) => Promise<unknown>; createAppender: (table: string) => Promise<{ appendRow: (row: unknown[]) => void; close: () => Promise<void> }> },
  name: string,
  records: Record<string, unknown>[],
  schema: Array<[string, DuckDBColumnType]>,
  sourceHint: 'inferred' | 'explicit',
): Promise<void> {
  const ddl = `CREATE TABLE ${name} (${schema.map(([c, t]) => `${c} ${t}`).join(', ')})`;
  await conn.run(ddl);
  const app = await conn.createAppender(name);
  try {
    for (let i = 0; i < records.length; i++) {
      const row = schema.map(([c]) => records[i]![c] ?? null);
      try {
        app.appendRow(row);
      } catch (e) {
        const hint = sourceHint === 'inferred'
          ? ` Pass an explicit schema via the third argument: registerDf(name, df, { schema: { ${schema[0]![0]}: 'VARCHAR' } })`
          : '';
        throw new Error(
          `registerDf row ${i}: append failed for column '${schema.find((_, idx) => idx === row.findIndex(v => v !== null && false))?.[0] ?? 'unknown'}' (${(e as Error).message}).${hint}`,
        );
      }
    }
  } finally {
    await app.close();
  }
}

// Inside the existing otto.duckdb construction (find the object literal or
// builder where .connect is exposed), add registerDf:
otto.duckdb.registerDf = async function(
  name: string,
  input: unknown,
  opts: RegisterDfOptions = {},
): Promise<void> {
  const conn = await otto.duckdb.connect();
  const records = coerceToRecords(input);
  const sourceHint: 'inferred' | 'explicit' = opts.schema ? 'explicit' : 'inferred';
  const schemaObj = opts.schema ?? inferSchema(records);
  const schema = normalizeSchema(schemaObj);
  await registerViaAppender(conn, name, records, schema, sourceHint);
};
```

> Adjust the conn/appender shape to match the actual `@duckdb/node-api` types used elsewhere in `kernel-bindings.ts` — grep for `createAppender` to find the existing signature.

### Step F.5 — Run tests to verify they pass

Run the same command from F.3. Expected: 5 new tests passing.

### Step F.6 — Update `cw_scratchpad` promptGuidelines

- [ ] **Edit** `src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts`. Find the `promptGuidelines` array (grep for `promptGuidelines`). Append one bullet:

```
For polars→DuckDB: prefer `otto.duckdb.registerDf(name, df)` over manual API discovery. If inference picks the wrong column type, pass `{ schema: { col: 'TYPE' } }` as the third argument. Falls back to polars' own SQL (`df.sql(...)`) for one-off aggregations.
```

### Step F.7 — Final gates

```bash
npm run build:coworker-scratchpad
npm run typecheck:extensions
npm run test:packages
npm run test:extensions
```

Expected: all green.

### Step F.8 — Commit Task F

```bash
git add packages/coworker-scratchpad/src/kernel-bindings.ts \
        packages/coworker-scratchpad/src/kernel-bindings.test.ts \
        src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts
git commit -m "$(cat <<'EOF'
feat(coworker-1.5): otto.duckdb.registerDf with optional opts.schema override

Adds otto.duckdb.registerDf(name, input, opts?) so polars→DuckDB drops from
~8 cells of API exploration to 2 cells. Duck-typed input detection covers
polars DataFrames, Arrow Tables, and arrays of records. Schema inferred from
the first 10 rows (null-walk for sparse leading rows); override via
opts.schema when inference picks wrong. Inference-error messages include a
copy-pasteable opts.schema hint.

Updates cw_scratchpad promptGuidelines so the LLM reaches for the helper
instead of the discovery loop.

Closes Issue #1.

EOF
)"
```

---

## Post-task verification

### V.1 — Full test gate

```bash
npm run build
npm run typecheck
npm run test:packages
npm run test:extensions
```

Expected: all green. Test count deltas: ext +23 (A:15 — workspace-root:3, workspace-pointer:4, format-age:4, index:4 / B:3 / C:2 / D:3), lib +11 (D:5, E:1, F:5).

### V.2 — Re-run Phase 1 human-test scenarios

Re-run all 16 scenarios from `docs/superpowers/notes/2026-06-01-coworker-phase-1-human-tests.md`. Expected differences vs. Phase 1:

- **Scenario 3** (polars→DuckDB): drops from 8 cells to ≤ 2 cells.
- **Scenario 9** (day-2 attach): succeeds without `--resume` — fresh `otto` launch in the same workspace restores the previously-attached scratchpad with notification `attached to <name> (from workspace, last used <relative>)`.
- **Scenario 13** (remove non-current): unchanged (still silent — by-design from Phase 1).
- **Scenario 16** (cleanup): `~/.otto/scratchpads/_sessions/` contains only the current session's `sidecar_<sessionId>.json`; prior sessions' sidecars have been swept.
- **New manual check (Issue #4):** `/sp list` shows idle age column for warm entries; `/sp evict <name>` flips to cold without removing the scratchpad; `/sp evict <name> --force` interrupts an active `while(true)` cell.
- **New manual check (Issue #5):** `/sp attach not-a-real-name` errors with `scratchpad not found: not-a-real-name. Use /sp new not-a-real-name to create it.` — no phantom scratchpad created.

### V.3 — Close issues

Once V.1 + V.2 pass and the PR is merged:

```bash
gh issue close 66 --comment "Closed in $(git rev-parse HEAD) (Phase 1.5 Task B)."
gh issue close 67 --comment "Closed in $(git rev-parse HEAD) (Phase 1.5 Task B)."
```

For Issues 1, 2, 4, 5, 6 (doc-only in `2026-06-01-coworker-phase-1-known-issues.md`): edit each issue's status from `open` to `fixed in <commit>` referencing the matching Task A–F commits.

### V.4 — Green-light Phase 2

After Phase 1.5 lands, the branch merges to main and Phase 2 (otto-vault) kicks off via `/gsd-phase` or the equivalent roadmap-advance command.
