# Otto Co-Worker Phase 1g3 — Library Hardening Design

**Status:** Approved (brainstorm 2026-06-01)
**Date:** 2026-06-01
**Author:** brainstorm session with Corey
**Phase:** 1g3 — third + final sub-phase of the original "1g polish" backlog (1g session affinity DONE, 1g2 on-attach UX DONE, 1g3 library hardening)
**Branch:** `feat/coworker-phase-0` (this closes Phase 1; branch is mergeable to main after 1g3)
**Parent spec:** `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §3.5 (snapshot durability), §6 (kernel protocol)
**Prior plans:** `docs/superpowers/plans/2026-06-01-coworker-phase-1g-session-affinity.md`, `docs/superpowers/plans/2026-06-01-coworker-phase-1g2-on-attach-ux.md`

---

## 1. Goal

Close three latent correctness issues flagged during Phase 1: a `/sp fork` that can hang indefinitely if the source kernel doesn't honor SIGTERM, a `size_bytes` that lags by one write cycle and double-counts overhead files, and `namespace.json` / `meta.json` writes that are not crash-safe.

After 1g3:

- `/sp fork` is bounded: at most ~10s waiting for the source kernel to exit before throwing `ForkKernelHangError`. SIGKILL escalation between two 5s waits.
- `meta.size_bytes` reports only the payload files (kernel.db, kernel.db.wal, namespace.json, cells.jsonl) and is current as of the triggering write.
- `namespace.json` (kernel-side) and `meta.json` (manager-side, 8 sites) use the atomic-rename pattern — power-loss mid-write leaves either the pre- or post-write state on disk, never a torn file.

## 2. Scope

**In scope (1g3):**
- New `ForkKernelHangError` class in `scratchpad-manager.ts` carrying `srcName` + `pid`.
- New module-private `raceWithTimeout<T>(p, ms, label)` helper in `scratchpad-manager.ts`.
- New constant `FORK_EXIT_TIMEOUT_MS = 5000`.
- `fork`'s wait-for-exit gets the 5s timeout → SIGKILL → 5s timeout → throw escalation.
- New private `payloadSize(dir)` method on `ScratchpadManager`, REPLACES the existing private `dirSize(dir)` method. Whitelist of 4 payload files; missing files contribute 0.
- New private `writeMetaAtomic(path, payload)` method on `ScratchpadManager`.
- Replace 8 direct `writeFileSync(<meta>, JSON.stringify(...))` sites with `this.writeMetaAtomic`.
- Kernel-side `namespace.json` snapshot write changes to `writeFileSync(tmp); renameSync(tmp, finalPath)`.

**Out of scope:**
- Configurable `forkExitTimeoutMs` runtime option — literal for now; add later if a real workload needs it.
- Atomic-rename for `cells.jsonl` — `appendFileSync` is already syscall-atomic; `scan()` already tolerates trailing-corrupt-line.
- Atomic-rename for `lock.json` — short-lived sentinel; OS crash mid-write resolves via `isStaleLock` on next acquire.
- Atomic-rename for session sidecar (`<root>/_sessions/<sessionId>.json`) — already atomic-rename from Phase 1g.
- Cross-platform rename atomicity guarantees — POSIX is well-defined; Windows rename-replace semantics differ but Otto is Unix-only.
- Phase 2+ deferrals: TUI overlay, branch-summary cells, scratchpad-tool install/dump/reset, vegalite/PNG renderers, artifact:// spill, sql.js fallback, `_sessions/` GC sweep.

## 3. Locked decisions (brainstorm 2026-06-01)

1. **Fork exit escalation: 5s → SIGKILL → 5s → `ForkKernelHangError`.** No copy attempted on hang — DuckDB handles may still be held. `FORK_EXIT_TIMEOUT_MS = 5000` as a module constant. Configurable later if needed.
2. **`size_bytes` is payload-only via a whitelist.** Files counted: `kernel.db`, `kernel.db.wal`, `namespace.json`, `cells.jsonl`. Excludes `lock.json` (transient), `meta.json` (self-referential during write), and `*.tmp` (atomic-rename artifacts). Missing files contribute 0 without throwing.
3. **`payloadSize` REPLACES `dirSize`.** No co-existence — `dirSize` is removed. Single call site in `writeMeta` switches; `fork`'s `dirSize(dstDir)` call also switches.
4. **Atomic rename for `namespace.json` (kernel-side) + `meta.json` (manager-side, 8 sites).** `cells.jsonl` deliberately NOT atomic-renamed (already safe). `lock.json` deliberately NOT atomic-renamed (acquire path uses `wx` flag for atomicity).
5. **`writeMetaAtomic` is a private method on `ScratchpadManager`.** Not exported. Replaces 8 direct write sites.
6. **`ForkKernelHangError` is exported from `@otto/coworker-scratchpad`.** Lives in `scratchpad-manager.ts` (where `fork` is). Symmetric with `ScratchpadBusyError` living in `scratchpad-lock.ts`.
7. **`raceWithTimeout` is module-private.** Generic over the resolved type, takes a label string for the rejection message. Not a candidate for `@otto/coworker-utils` (that package is for higher-level helpers; this is one-off).
8. **No schema bump.** All changes are behavioral; on-disk shapes identical. meta.json stays at v3.

## 4. Architecture

### 4.1 `ForkKernelHangError`

```ts
// scratchpad-manager.ts
export class ForkKernelHangError extends Error {
  constructor(public readonly srcName: string, public readonly pid: number) {
    super(`fork: source kernel for '${srcName}' (pid ${pid}) did not exit after SIGTERM + SIGKILL. Destination may be partially populated; clean up with /sp remove <dst>.`);
    this.name = 'ForkKernelHangError';
  }
}
```

Exported from the package barrel (`packages/coworker-scratchpad/src/index.ts`) alongside `ScratchpadBusyError`.

### 4.2 `raceWithTimeout` helper

Module-private to `scratchpad-manager.ts`:

```ts
const FORK_EXIT_TIMEOUT_MS = 5000;

function raceWithTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`timeout: ${label}`));
    }, ms);
    timer.unref();
    p.then(
      (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); },
      (e) => { if (settled) return; settled = true; clearTimeout(timer); reject(e); },
    );
  });
}
```

`timer.unref()` is important — without it, the timer prevents the test process from exiting when all tests pass but the timer is still pending.

### 4.3 `fork` exit escalation

Today (`scratchpad-manager.ts:357-364`, post-1g2 numbering):

```ts
const srcEntry = this.entries.get(srcName);
if (srcEntry && srcEntry.runtime) {
  const rawChild = (srcEntry.runtime as unknown as { child: import('node:child_process').ChildProcess | null }).child;
  await this.snapshotThenDispose(srcName, srcEntry);
  if (rawChild && rawChild.exitCode === null) {
    await new Promise<void>((resolve) => rawChild.once('exit', resolve));
  }
}
```

1g3:

```ts
const srcEntry = this.entries.get(srcName);
if (srcEntry && srcEntry.runtime) {
  const rawChild = (srcEntry.runtime as unknown as { child: import('node:child_process').ChildProcess | null }).child;
  await this.snapshotThenDispose(srcName, srcEntry);
  if (rawChild && rawChild.exitCode === null) {
    const exitPromise = new Promise<void>((resolve) => rawChild.once('exit', resolve));
    try {
      await raceWithTimeout(exitPromise, FORK_EXIT_TIMEOUT_MS, 'exit-after-SIGTERM');
    } catch {
      rawChild.kill('SIGKILL');
      const exitPromise2 = new Promise<void>((resolve) => rawChild.once('exit', resolve));
      try {
        await raceWithTimeout(exitPromise2, FORK_EXIT_TIMEOUT_MS, 'exit-after-SIGKILL');
      } catch {
        throw new ForkKernelHangError(srcName, rawChild.pid ?? -1);
      }
    }
  }
}
```

**Important subtlety:** `rawChild.once('exit', resolve)` registers one listener per call. After the first timeout, the original `exitPromise` is abandoned but its listener stays registered until exit eventually fires. Node tolerates this (multiple `once('exit', ...)` listeners are fine; each fires once). Listener leak is bounded — the child WILL exit eventually, even if not within our window.

### 4.4 `payloadSize` (replaces `dirSize`)

Today (`scratchpad-manager.ts:83-97`):

```ts
private dirSize(dir: string): number {
  let total = 0;
  try {
    for (const f of readdirSync(dir)) {
      try { total += statSync(join(dir, f)).size; } catch { /* skipped */ }
    }
  } catch { /* dir missing -> 0 */ }
  return total;
}
```

1g3:

```ts
private payloadSize(dir: string): number {
  let total = 0;
  for (const f of ['kernel.db', 'kernel.db.wal', 'namespace.json', 'cells.jsonl']) {
    try { total += statSync(join(dir, f)).size; } catch { /* not present -> skip */ }
  }
  return total;
}
```

Two call sites swap:
- `writeMeta` line 135 (current numbering): `size_bytes: this.dirSize(dir)` → `size_bytes: this.payloadSize(dir)`
- `fork` dstMeta line 382: `size_bytes: this.dirSize(dstDir)` → `size_bytes: this.payloadSize(dstDir)`

The `readdirSync` import on line 1 becomes unused. Remove it.

### 4.5 `writeMetaAtomic` (8 site swap)

New private method on `ScratchpadManager`:

```ts
private writeMetaAtomic(path: string, payload: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, path);
}
```

`renameSync` is imported from `node:fs`. Currently `node:fs` import line 1 has: `copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync`. After 1g3:

```ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
```

(`readdirSync` removed per §4.4; `renameSync` added.)

**8 site swap:**

| # | Method | Line (post-1g2) | Current statement |
|---|---|---|---|
| 1 | `writeMeta` | 141 | `writeFileSync(path, JSON.stringify(meta, null, 2))` |
| 2 | `appendRecoveryNotes` | 160 | `writeFileSync(path, JSON.stringify(cur, null, 2))` |
| 3 | `applySnapshotToMeta` | 177 | `writeFileSync(path, JSON.stringify(cur, null, 2))` |
| 4 | `setLeaf` | 343 | `writeFileSync(path, JSON.stringify(cur, null, 2))` |
| 5 | `fork` dstMeta | 392 | `writeFileSync(join(dstDir, 'meta.json'), JSON.stringify(dstMeta, null, 2))` |
| 6 | `clearHistory` | 462 | `writeFileSync(path, JSON.stringify(cur, null, 2))` |
| 7 | `detach` | 495 | `writeFileSync(path, JSON.stringify(cur, null, 2))` |
| 8 | `markRecoveryNotesSeen` | 508 | `writeFileSync(path, JSON.stringify(cur, null, 2))` |

Each becomes `this.writeMetaAtomic(path, <payload>)` (for site 5, `this.writeMetaAtomic(join(dstDir, 'meta.json'), dstMeta)`).

Line numbers are approximate (post-1g2). The implementer should grep for `writeFileSync(.*JSON.stringify` inside `scratchpad-manager.ts` to find the exact sites.

### 4.6 Kernel-side `namespace.json` atomic rename

`packages/coworker-scratchpad/src/kernel-entry.ts` handles snapshot requests. The current write (somewhere in the snapshot handler — implementer should grep for `namespace.json` in kernel-entry.ts):

```ts
writeFileSync(nsPath, serialized);
```

becomes:

```ts
const tmp = `${nsPath}.tmp`;
writeFileSync(tmp, serialized);
renameSync(tmp, nsPath);
```

`renameSync` may need to be added to the kernel-entry.ts imports.

## 5. File layout

```
packages/coworker-scratchpad/src/
  scratchpad-manager.ts          ← MODIFY: ForkKernelHangError class +
                                            raceWithTimeout helper +
                                            FORK_EXIT_TIMEOUT_MS;
                                            fork timeout/SIGKILL escalation;
                                            payloadSize REPLACES dirSize
                                            (2 call sites swap, readdirSync
                                            import removed);
                                            writeMetaAtomic helper +
                                            8 manager site swaps (renameSync
                                            import added)
  scratchpad-manager.test.ts     ← MODIFY: +6 tests
  index.ts                       ← MODIFY: export ForkKernelHangError
  kernel-entry.ts                ← MODIFY: namespace.json atomic-rename
                                            (renameSync import if needed)
  kernel-entry.test.ts           ← MODIFY: +1 test (snapshot leaves no .tmp)
```

No extension changes. No spec changes to upper-layer surface.

## 6. Test plan

Four tasks. TDD-per-task, one commit each.

| Task | Subject | Test count delta |
|---|---|---|
| 1 | `ForkKernelHangError` + `raceWithTimeout` + fork timeout/SIGKILL escalation | lib +3 |
| 2 | `payloadSize` whitelist (replaces dirSize) | lib +2 |
| 3 | `writeMetaAtomic` (8 sites) + kernel-entry namespace atomic | lib +2 |
| 4 | Build + full gates (verification-only; build BEFORE typecheck per 1g lesson) | — |

Post-1g3 totals: lib coworker-scratchpad 148 → ~155 tests. Ext unchanged.

## 7. Test design notes

### Task 1 tests

1. **Happy path: fork succeeds when kernel exits cleanly within 5s.** Existing 1f fork test already covers this; add an explicit `assert.ok(true, 'no timeout thrown')` for documentation.
2. **SIGKILL escalation fires after SIGTERM-timeout.** Stub a runtime whose underlying `rawChild` ignores SIGTERM but exits on SIGKILL. The test waits for the SIGTERM timeout (5s) plus the SIGKILL exit (immediate) — total ~5s. Verify fork completes and `kill('SIGKILL')` was called.
3. **ForkKernelHangError thrown on full-hang.** Stub a runtime whose `rawChild` ignores both signals. Test takes ~10s. Verify the error is thrown with the right srcName + pid.

To keep test runtime tolerable, accept that two of these run for ~5-10s each (real-time waits). Mark with `{ timeout: 30_000 }` on the `it(...)` blocks if needed.

**Stub design:** the runtime's `rawChild` is accessed via the unsafe cast `(runtime as unknown as { child: ChildProcess | null }).child`. For testing, replace the runtime's child after spawn with a mock `EventEmitter` that:
- has `exitCode: null` (so the entry guard triggers)
- has `pid: <any number>`
- has `kill(signal)` that records the signal and (for SIGKILL only) emits `'exit'` after a tick

### Task 2 tests

1. **payloadSize counts only the 4 whitelist files; excludes lock.json and meta.json.** Construct a scratchpad dir with all six files (kernel.db, kernel.db.wal, namespace.json, cells.jsonl, lock.json, meta.json) — each a known size. Verify `payloadSize(dir)` equals the sum of only the four whitelisted files.
2. **payloadSize returns 0 for missing dir or no payload files.** Empty dir → 0. Missing dir → 0.

### Task 3 tests

1. **`writeMetaAtomic` writes via tmp + rename; no .tmp leaks.** Direct call to a public test surface or via an existing public method that triggers writeMeta (e.g. `runCell`). After the call, verify `meta.json` exists and `meta.json.tmp` does NOT.
2. **kernel-entry namespace atomic-rename: no .tmp left after a successful snapshot.** Add to `kernel-entry.test.ts`. After a snapshot ack, verify `namespace.json` exists and `namespace.json.tmp` does NOT.

Existing meta-write tests (from 1g and earlier) should continue to pass without modification — `writeMetaAtomic` is observationally identical to the prior `writeFileSync`, just with crash-safety.

## 8. Error handling

| Scenario | Where | Result |
|---|---|---|
| Fork: kernel exits within 5s of SIGTERM | scratchpad-manager.fork | Proceeds to copy normally |
| Fork: kernel ignores SIGTERM, exits on SIGKILL | scratchpad-manager.fork | Escalates to SIGKILL, proceeds after the second exit |
| Fork: kernel ignores both signals | scratchpad-manager.fork | ForkKernelHangError thrown; dst dir + lock remain; user cleans up |
| writeMetaAtomic: rename fails (cross-device, perms) | renameSync throws | Caller's try/catch (where applicable) handles; .tmp may leak (acceptable) |
| writeMetaAtomic: tmp write fails (disk full) | writeFileSync throws | Caller's try/catch; meta.json unchanged on disk; .tmp may exist as empty file |
| Kernel snapshot tmp write fails | inside kernel | Snapshot ack returns failure; manager appends snapshot-failed recovery note (existing 1d2 path) |
| Kernel snapshot rename fails | inside kernel | Same as above |
| payloadSize: a payload file vanishes mid-stat | catch { /* skip */ } | Continues; reported size omits the vanished file |

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | SIGKILL kills DuckDB mid-write → torn kernel.db | snapshotThenDispose already attempted (and acked) the snapshot before fork ever sees the rawChild. The 5s SIGTERM window gives DuckDB time to checkpoint and close. SIGKILL only fires when that window expired. The throw-on-second-timeout means we DON'T copy the (potentially torn) file. |
| 2 | Cross-device rename in writeMetaAtomic | tmp and target are in the same dir (`<root>/<name>/`). POSIX rename within a single dir is atomic. |
| 3 | .tmp leak on rename failure | Documented as acceptable. Next successful write overwrites; payloadSize whitelist excludes `.tmp`. |
| 4 | rename clobbers a concurrent write | All scratchpad meta writes are funneled through ScratchpadManager (single-process). Inter-process races are guarded by the scratchpad lock. |
| 5 | payloadSize undercounts after future payload-file additions | Acknowledged. Whitelist is explicit + grep-able; new payload files require updating this list. Better than silently counting whatever's there. |
| 6 | Test runtime cost from 5-10s real-time waits in Task 1 tests | Two tests cost ~15s combined. Acceptable for a one-off hardening phase. Add `{ timeout: 30_000 }` on the `it(...)` blocks. Future optimization: parameterize FORK_EXIT_TIMEOUT_MS via a constructor option for testability (deferred). |
| 7 | raceWithTimeout pending timer prevents test process exit | `timer.unref()` in the helper — timer doesn't keep the event loop alive. |
| 8 | Listener leak on rawChild after the first timeout | Bounded — child WILL eventually exit; Node tolerates multiple `once('exit', ...)` listeners. |

## 10. Out-of-scope deferred items

- **Configurable forkExitTimeoutMs** — runtime option for test/prod tuning. Deferred until a real workload needs it.
- **Atomic-rename for lock.json** — short-lived, acquired via `wx` flag which is already atomic-create.
- **Atomic-rename for cells.jsonl** — `appendFileSync` is syscall-atomic; `scan()` tolerates trailing partial line.
- **Checksums on cells.jsonl entries** — torn-write detection beyond the trailing-line scan. Overkill.
- **Cross-platform rename guarantees** — Otto is Unix-only. Windows semantics differ but not supported.
- **Phase 2+:** TUI overlay, branch-summary cells, scratchpad-tool install/dump/reset, vegalite/PNG renderers, artifact:// spill, sql.js fallback, `_sessions/` GC sweep.

---

**Next step:** invoke `superpowers:writing-plans` to expand this spec into a task-by-task plan at `docs/superpowers/plans/2026-06-01-coworker-phase-1g3-library-hardening.md`.
