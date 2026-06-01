# Otto Co-Worker Phase 1g2 — On-Attach UX Banners Design

**Status:** Approved (brainstorm 2026-06-01)
**Date:** 2026-06-01
**Author:** brainstorm session with Corey
**Phase:** 1g2 — second of the three-way split of the original "1g polish" backlog (1g session affinity DONE, 1g2 on-attach UX, 1g3 library hardening)
**Branch:** `feat/coworker-phase-0` (continues until 1g3 closes Phase 1)
**Parent spec:** `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §3.5 (snapshot triggers + recovery), §5 (TUI banner UX)
**Prior plan:** `docs/superpowers/plans/2026-06-01-coworker-phase-1g-session-affinity.md` (1g, completed)

---

## 1. Goal

Surface post-attach context to the user via three on-attach banners and an interactive force-takeover prompt. Closes the deferred UX backlog from 1c2 (force-takeover prompt + reason), 1d2 (recovery-notes banner), and 1f (kernel-state divergence banner).

After 1g2:

- `/sp attach <name>` surfaces unseen recovery notes via a `warning`-level notify with a per-scratchpad "seen-at" cutoff so the user isn't re-nagged on every attach.
- `/sp attach <name>` surfaces kernel-vs-view divergence via an `info`-level notify when `cell_leaf_id !== kernel_at_cell_id`.
- `/sp attach <name>` against a busy lock prompts the user to confirm a force-takeover and capture a reason; the reason is persisted into `lock.json` as the takeover audit trail. Flags `--force-takeover` and `--reason "<text>"` support non-interactive use.
- A new `/sp notes [<name>]` verb prints the full recovery-notes history (seen + unseen) without changing the seen-at cutoff.

## 2. Scope

**In scope (1g2):**
- New disk fields in `meta.json`: `recovery_notes_seen_at: string | null`, `kernel_at_cell_id: number | null`. Both additive; schema stays v3.
- New `lock.json` field: `takeover_reason: string | null`. Additive.
- `ScratchpadBusyError` enrichment with `holderSessionId`, `holderPid`, `holderHost` (read from the existing stale `lock.json` at throw time).
- `ScratchpadManager.markRecoveryNotesSeen(name)` — direct meta read-modify-write.
- `ScratchpadManager` Entry gains `kernelAtCellId: number | null`; lifecycle wired into `attachUnmanaged`, `getOrAttach` cold→warm, `runCell`, `clearHistory`, `fork`. `writeMeta` pulls from `entry.kernelAtCellId`.
- `scratchpad-lock.ts:acquireLock` threads `takeoverReason` from `AcquireOptions` into the written `lock.json` (the option already exists; it's just not persisted today).
- Extension verbs: new `/sp notes`. Existing `/sp attach` gains `--force-takeover` and `--reason "<text>"` flags + the banner trigger calls.
- Banner helpers in `sp-command.ts` (or a sibling `attach-banners.ts` if it cleans things up): `showRecoveryNotesBanner`, `showDivergenceBanner`. Plus `joinQuotedArg` helper.

**Out of scope (deferred to 1g3 or later):**
- `fork`'s `rawChild.once('exit')` timeout + SIGKILL fallback — 1g3.
- `size_bytes` post-write recompute (exclude lock.json + meta.json) — 1g3.
- Broader atomic-rename for `namespace.json` writes — 1g3.
- TUI overlay for `/sp tree` interactive navigation — Phase 2+.
- Branch-summary entries in cells.jsonl on subtree abandon — Phase 2+.
- `_sessions/` GC sweep — Phase 2+.
- Schema-bump (v3 → v4) for the new meta fields — not needed; 1g already showed additive fields work without a bump.

## 3. Locked decisions (brainstorm 2026-06-01)

1. **Banner surface = `ctx.ui.notify`.** Three separate notify calls render inline in the chat scrollback. Severity: `info` for the existing "attached to <name>" line, `warning` for unseen recovery notes, `info` for divergence. No `setWidget` overlay, no `setStatus` footer. Matches the rest of the `/sp` surface.
2. **Recovery-notes seen tracking via timestamp cutoff.** `meta.recovery_notes_seen_at: string | null`. Banner shows notes with `at > seen_at` (or all if `null`). After display, write `seen_at = nowIso`. Banner truncates to last 5 with `+ N more (run /sp notes)` footer.
3. **New `/sp notes` verb to re-view.** Prints ALL recovery notes (seen + unseen). Does NOT change `seen_at`. Pure re-inspection path.
4. **Force-takeover auto-prompts on busy.** `/sp attach <name>` on `ScratchpadBusyError` prompts `ctx.ui.confirm` with holder details, then `ctx.ui.input` for the reason. `--force-takeover` skips confirm; `--reason "<text>"` skips reason prompt; both together = fully non-interactive.
5. **`lock.json` gains `takeover_reason`.** The `takeoverReason` option on `acquireLock` already exists but is never written. 1g2 actually persists it. Additive; existing v1 lock readers tolerate the new field.
6. **`ScratchpadBusyError` carries holder details.** The lock read at throw time already has `prev.sessionId`, `prev.pid`, `prev.host`; attach them to the thrown error so the extension can format the confirm prompt.
7. **`meta.kernel_at_cell_id` tracks live kernel state.** Updates: `runCell` success → `archive.lastId`; cold→warm restore → `last_snapshot_cell_id`; `clearHistory` → null; `fork` inherits from src. Save/detach/attach don't mutate.
8. **Divergence banner fires only when both ids are set and differ.** No noisy edge cases — null on either side means "no divergence to surface."
9. **Banners fire only from the `/sp attach` slash command.** NOT from `getOrAttach` (used by the LLM tool's `/sp exec` path). NOT from `session_start`'s sidecar restore notify ("attached to X (restored)" stays clean). Banners are explicitly user-facing.
10. **No schema bump.** All new persisted state is additive in meta.json + lock.json. Schema stays at v3.

## 4. Architecture

### 4.1 `ScratchpadBusyError` enrichment

Today (`packages/coworker-scratchpad/src/scratchpad-lock.ts`):

```ts
export class ScratchpadBusyError extends Error {
  constructor(public readonly path: string) {
    super(`scratchpad busy: ${path}`);
    this.name = 'ScratchpadBusyError';
  }
}
```

1g2:

```ts
export interface BusyHolderInfo {
  sessionId: string | null;
  pid: number | null;
  host: string | null;
}

export class ScratchpadBusyError extends Error {
  constructor(public readonly path: string, public readonly holder: BusyHolderInfo) {
    super(`scratchpad busy: ${path}`);
    this.name = 'ScratchpadBusyError';
  }
}
```

`acquireLock` already reads `prev` (the existing-on-disk lock) before deciding stale-or-busy. Pass the relevant fields when throwing:

```ts
throw new ScratchpadBusyError(dir, {
  sessionId: typeof prev.sessionId === 'string' ? prev.sessionId : null,
  pid: typeof prev.pid === 'number' ? prev.pid : null,
  host: typeof prev.host === 'string' ? prev.host : null,
});
```

### 4.2 `lock.json` `takeover_reason` persistence

`AcquireOptions` already has `takeoverReason?: string` but the function ignores it when writing. 1g2 plumbs it through:

```ts
const lockPayload = {
  schema_version: 1,
  sessionId: opts.sessionId ?? null,
  pid: process.pid,
  host: hostname(),
  acquired_at: new Date(opts.now?.() ?? Date.now()).toISOString(),
  ...(opts.forceTakeover ? {
    takeover_from: prev.sessionId ?? null,
    takeover_reason: opts.takeoverReason ?? null,   // NEW
  } : {}),
};
```

Existing lock readers (`scratchpad-lock.test.ts`, recovery checks) tolerate unknown fields because they only read specific keys.

### 4.3 `Entry.kernelAtCellId` lifecycle

```ts
interface Entry {
  runtime: ChildProcessRuntime | null;
  lock: LockInfo;
  lastUsedAt: number;
  archive: CellArchive;
  kernelAtCellId: number | null;   // NEW (1g2)
}
```

**`attachUnmanaged` (fresh attach):** after the existing `restoreLeafOnAttach`, seed:

```ts
const meta = readMetaSafe(this.metaPath(name));
entry.kernelAtCellId = typeof meta?.last_snapshot_cell_id === 'number' ? meta.last_snapshot_cell_id : null;
```

(Cold restore means the kernel was hydrated from `namespace.json`, which was written at `last_snapshot_cell_id`. That's where the in-VM state lives.)

**`getOrAttach` cold→warm transition:** same seeding as above, applied to the existing `existing` Entry whose runtime was just respawned.

**`runCell` success path:** after `entry.archive.append(...)`, update before `writeMeta`:

```ts
entry.kernelAtCellId = entry.archive.lastId;
this.writeMeta(name);
```

**`runCell` failure path:** the archive still records the failure with a new id, but the kernel's in-VM state did NOT mutate (the cell threw before any side effects we trust). Conservative choice: also update `entry.kernelAtCellId = entry.archive.lastId` so kernel-vs-view stays in lockstep on the linear-chain happy path. The divergence banner is for `/sp tree --to` rewind, not for in-cell exceptions.

**`clearHistory`:** in the warm branch, also `entry.kernelAtCellId = null`. The cold branch already nulls via direct meta write.

**`fork`:** dstEntry gets `kernelAtCellId = srcMeta.kernel_at_cell_id ?? srcMeta.last_snapshot_cell_id ?? null`. Add to the existing `dstMeta` write.

### 4.4 `writeMeta` extension

Today `writeMeta` pulls `cell_leaf_id` from the live archive (`archive.leafId`). 1g2 adds a parallel pull for `kernel_at_cell_id`:

```ts
const entry = this.entries.get(name);
const liveLeaf = entry?.archive?.leafId ?? null;
const liveKernel = entry?.kernelAtCellId ?? null;
const cell_leaf_id = liveLeaf !== null ? liveLeaf : (prevExtras.cell_leaf_id ?? null);
const kernel_at_cell_id = liveKernel !== null ? liveKernel : (prevExtras.kernel_at_cell_id ?? null);
```

Both fields land in the meta object alongside the existing v2/v3 fields. Cold paths (no live entry) preserve via `prevExtras`.

`prevExtras` preservation loop adds `kernel_at_cell_id` and `recovery_notes_seen_at` to its include list:

```ts
for (const k of [
  'last_snapshot_cell_id', 'last_snapshot_at', 'namespace_skipped', 'recovery_notes',
  'cell_leaf_id', 'kernel_at_cell_id', 'recovery_notes_seen_at',
]) {
  if (k in prev) prevExtras[k] = prev[k];
}
```

### 4.5 `ScratchpadManager.markRecoveryNotesSeen(name)`

```ts
async markRecoveryNotesSeen(name: string): Promise<void> {
  this.assertNotDisposed();
  const path = this.metaPath(name);
  if (!existsSync(path)) return;
  let cur: Record<string, unknown> = {};
  try { cur = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>; } catch { return; }
  cur.recovery_notes_seen_at = new Date(this.now()).toISOString();
  writeFileSync(path, JSON.stringify(cur, null, 2));
}
```

Same direct-meta read-modify-write idiom as 1g's `clearHistory` and `detach`. Silent on missing/corrupt.

### 4.6 Extension banner helpers

New module `src/resources/extensions/coworker-scratchpad/attach-banners.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RecoveryNote } from '@otto/coworker-scratchpad';

type RecoveryNoteEntry = RecoveryNote & { at: string };

interface UiNotify { notify: (msg: string, level: 'info' | 'warning' | 'error') => void }

export function showRecoveryNotesBanner(
  name: string,
  rootDir: string,
  ui: UiNotify,
): { unseenCount: number; markSeen: boolean } {
  const metaPath = join(rootDir, name, 'meta.json');
  if (!existsSync(metaPath)) return { unseenCount: 0, markSeen: false };
  let meta: Record<string, unknown>;
  try { meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>; }
  catch { return { unseenCount: 0, markSeen: false }; }
  const notes = Array.isArray(meta.recovery_notes) ? (meta.recovery_notes as RecoveryNoteEntry[]) : [];
  if (notes.length === 0) return { unseenCount: 0, markSeen: false };
  const seenAt = typeof meta.recovery_notes_seen_at === 'string' ? meta.recovery_notes_seen_at : null;
  const unseen = notes.filter(n => seenAt === null || n.at > seenAt);
  if (unseen.length === 0) return { unseenCount: 0, markSeen: false };
  const head = unseen.slice(0, 5).map(formatNoteLine).join('\n');
  const tail = unseen.length > 5 ? `\n+ ${unseen.length - 5} more (run /sp notes)` : '';
  ui.notify(`⚠ ${unseen.length} unread recovery notes:\n${head}${tail}`, 'warning');
  return { unseenCount: unseen.length, markSeen: true };
}

export function showDivergenceBanner(
  name: string,
  rootDir: string,
  ui: UiNotify,
): { diverged: boolean } {
  const metaPath = join(rootDir, name, 'meta.json');
  if (!existsSync(metaPath)) return { diverged: false };
  let meta: Record<string, unknown>;
  try { meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>; }
  catch { return { diverged: false }; }
  const leaf = typeof meta.cell_leaf_id === 'number' ? meta.cell_leaf_id : null;
  const kernel = typeof meta.kernel_at_cell_id === 'number' ? meta.kernel_at_cell_id : null;
  if (leaf === null || kernel === null || leaf === kernel) return { diverged: false };
  ui.notify(
    `ℹ kernel state is at cell #${kernel}; view is at cell #${leaf} (run /sp tree to inspect)`,
    'info',
  );
  return { diverged: true };
}

function formatNoteLine(n: RecoveryNoteEntry): string {
  const ts = n.at.slice(0, 19);
  switch (n.kind) {
    case 'snapshot-failed':       return `  • [${ts}] snapshot-failed: ${n.message}`;
    case 'cells-since-snapshot':  return `  • [${ts}] ${n.n} cells since last snapshot`;
    case 'namespace-corrupt':     return `  • [${ts}] namespace-corrupt: ${n.message}`;
    default:                      return `  • [${ts}] ${(n as { kind: string }).kind}`;
  }
}
```

Pure module. No coupling to manager or runtime — just disk reads + ui callback.

### 4.7 `sp-command.ts` `case 'attach'` rewrite

The full new case body is in §3 of the brainstorm conversation. Key shape:

```
1. parse flags: forceFlag, reasonArg (via joinQuotedArg)
2. try manager.getOrAttach(name) — happy path attaches normally
3. on ScratchpadBusyError:
   - confirm = forceFlag || await ctx.ui.confirm(<holder details>)
   - if !confirm: cancelled; return
   - reason = reasonArg ?? await ctx.ui.input('Takeover reason', ...)
   - if reason undefined (user escaped input): cancelled; return
   - retry with { forceTakeover: true, takeoverReason: reason || '(no reason given)' }
4. on non-busy error: notify error; return
5. setCurrentName + writeSessionSidecar (existing 1g writes)
6. notify "attached to <name>"
7. const { markSeen } = showRecoveryNotesBanner(name, rootDir, ctx.ui)
   if (markSeen) await deps.getManager().markRecoveryNotesSeen(name)
8. showDivergenceBanner(name, rootDir, ctx.ui)
```

### 4.8 `joinQuotedArg(parts, startIdx)` helper

```ts
function joinQuotedArg(parts: string[], startIdx: number): string | null {
  if (startIdx >= parts.length) return null;
  const first = parts[startIdx];
  if (!first) return null;
  if (!first.startsWith('"')) return first;        // unquoted single-word reason
  // quoted: walk until we find a part ending with " (handling the first part being just `"`)
  const collected: string[] = [first.slice(1)];   // strip opening quote
  if (first.length > 1 && first.endsWith('"')) {
    return first.slice(1, -1);                     // single-token quoted reason
  }
  for (let i = startIdx + 1; i < parts.length; i++) {
    const p = parts[i] ?? '';
    if (p.endsWith('"')) {
      collected.push(p.slice(0, -1));
      return collected.join(' ');
    }
    collected.push(p);
  }
  return collected.join(' ');                      // no closing quote — take rest
}
```

Lives in `sp-command.ts` (file-private). Tested via the attach unit tests.

### 4.9 `/sp notes [<name>]` verb

```ts
case 'notes': {
  const target = name ?? deps.getCurrentName();
  if (!target) { ctx.ui.notify('Usage: /sp notes [<name>] (no current scratchpad)', 'error'); return; }
  validateName(target);
  const metaPath = join(deps.rootDir(), target, 'meta.json');
  if (!existsSync(metaPath)) { ctx.ui.notify(`scratchpad not found: ${target}`, 'error'); return; }
  let meta: Record<string, unknown>;
  try { meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>; }
  catch { ctx.ui.notify(`${target}: meta.json unreadable`, 'error'); return; }
  const notes = Array.isArray(meta.recovery_notes) ? (meta.recovery_notes as RecoveryNoteEntry[]) : [];
  if (notes.length === 0) { ctx.ui.notify(`${target}: no recovery notes`, 'info'); return; }
  const lines = notes.map(formatNoteLine);
  ctx.ui.notify(`${target} recovery notes (${notes.length}):\n${lines.join('\n')}`, 'info');
  // Note: deliberately does NOT update recovery_notes_seen_at — re-view path is read-only.
  return;
}
```

`'notes'` added to `SpVerb` + `VERBS`. Argument-completion handler extended like other name-completing verbs.

## 5. Slash command surface (summary)

| Verb | Args | New in 1g2? | Side effects |
|---|---|---|---|
| `/sp attach` | `<name> [--force-takeover] [--reason "<text>"]` | enhanced | + busy-prompt path + reason capture + banner triggers on success |
| `/sp notes` | `[<name>]` (defaults to current) | NEW | read-only re-view; does NOT update seen_at |
| (other verbs) | — | unchanged | — |

## 6. Error handling

| Scenario | Where | Result |
|---|---|---|
| `/sp attach <busy>` with no flags | sp-command attach catch | confirm prompt; reason prompt; retry — or info "cancelled" |
| `/sp attach <busy> --force-takeover` | sp-command | skip confirm; reason prompt if missing; retry |
| `/sp attach <busy> --force-takeover --reason "..."` | sp-command | fully non-interactive retry |
| `/sp attach` confirm declined | sp-command | info "cancelled"; nothing attached; nothing written |
| `/sp attach` reason input escaped (undefined) | sp-command | info "cancelled"; nothing attached |
| `/sp attach` reason input empty string | sp-command | reason = "(no reason given)"; retry proceeds |
| `/sp attach` after takeover but spawn fails | manager.attachUnmanaged | lock release; error rethrown; sp-command notifies error |
| `/sp notes` no current + no arg | sp-command | usage error |
| `/sp notes` on scratchpad with no recovery_notes | sp-command | info "no recovery notes for <name>" |
| `/sp notes` with corrupt meta.json | sp-command | error "<name>: meta.json unreadable" |
| Recovery banner: all notes seen | helper returns `markSeen=false` | no notify; no meta write |
| Divergence banner: leaf null OR kernel null OR equal | helper returns `diverged=false` | no notify |
| Divergence after `clearHistory` | both nulled | no banner (correct) |
| Quoted `--reason "..."` missing closing quote | joinQuotedArg | takes rest of parts as reason (lenient) |

## 7. File layout

```
packages/coworker-scratchpad/src/
  scratchpad-lock.ts             ← MODIFY: ScratchpadBusyError adds holder info;
                                            acquireLock writes takeover_reason
  scratchpad-lock.test.ts        ← MODIFY: +3 tests (busy with holder details,
                                            takeover_reason persisted, no-takeover
                                            doesn't write reason)
  scratchpad-manager.ts          ← MODIFY: Entry.kernelAtCellId; writeMeta pulls new
                                            fields; lifecycle wiring across attach/
                                            runCell/clearHistory/fork; new method
                                            markRecoveryNotesSeen()
  scratchpad-manager.test.ts     ← MODIFY: +6 tests (kernelAtCellId lifecycle across
                                            attach/runCell/clearHistory/fork; markSeen)

src/resources/extensions/coworker-scratchpad/
  attach-banners.ts              ← NEW: showRecoveryNotesBanner + showDivergenceBanner
                                          + formatNoteLine
  attach-banners.test.ts         ← NEW: ~6 tests (unseen present, all-seen, truncation,
                                          divergence yes/no, corrupt meta tolerant)
  sp-command.ts                  ← MODIFY: attach case rewrite (force-takeover prompt +
                                            reason + banner triggers); new 'notes' verb;
                                            joinQuotedArg helper; VERBS list update
  sp-command.test.ts             ← MODIFY: +8 tests (busy auto-prompt accept/decline,
                                            --force-takeover skip-confirm,
                                            --reason skip-input, both flags fully
                                            non-interactive, notes happy/empty/corrupt)
```

`index.ts`, `session-sidecar.ts`, `helpers.ts`, `cell-archive.ts`, `cell-tree.ts` — unchanged.

## 8. Test plan

Six tasks. TDD-per-task, one commit each.

| Task | Subject | Test count delta |
|---|---|---|
| 1 | `ScratchpadBusyError` enrichment + `acquireLock` writes `takeover_reason` | lib +3 |
| 2 | `Entry.kernelAtCellId` lifecycle + `writeMeta` extension | lib +4 |
| 3 | `ScratchpadManager.markRecoveryNotesSeen` + 2 supporting fork/clearHistory follow-up tests | lib +2 |
| 4 | `attach-banners.ts` — pure helpers | ext +6 |
| 5 | `sp-command.ts` attach rewrite + `/sp notes` verb + joinQuotedArg | ext +8 |
| 6 | Build + full gates (test:packages + typecheck + build) | — |

**Note on gate order (1g lesson):** Task 6 runs `npm run build:coworker-scratchpad` BEFORE `npm run typecheck:extensions` — typecheck reads the package's `dist/*.d.ts` which is stale until the lib is rebuilt.

Post-1g2 totals: library 141 → ~150 tests; extension 58 → ~72 tests.

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Recovery notes truncated to 5 hides important context | `+ N more (run /sp notes)` footer + new `/sp notes` verb to re-inspect anytime. |
| 2 | `recovery_notes_seen_at` rewrite races with `appendRecoveryNotes` (e.g. a snapshot failure mid-attach) | Both code paths do read-modify-write of meta.json. Last-write-wins. A racing append after seen_at stamp may be re-shown next attach — acceptable; the alternative (locking meta.json) is far heavier than the cost. |
| 3 | Divergence banner false positive after `/sp clear-history` | Both fields are nulled by clearHistory; banner won't fire. Tested. |
| 4 | Force-takeover prompt blocks the user when no UI is available (e.g. non-interactive mode) | `ctx.ui.confirm` in non-interactive modes returns a default (per pi-coding-agent's runner). If that default is `false`, the user sees "cancelled" — fine. If they intended scripted takeover, they should pass `--force-takeover` + `--reason`. |
| 5 | `joinQuotedArg` mishandles edge cases (e.g. `--reason ""` for empty) | Empty string → reason = "(no reason given)" via the empty-trim fallback in the attach case. Tested. |
| 6 | `kernel_at_cell_id` not updated on cold scratchpads (only on live Entry) | `writeMeta`'s prevExtras preservation loop carries the existing value through cold meta writes. New cold writes (e.g. `/sp tree --to`) don't update it; that's correct (no kernel state changed). |
| 7 | Pre-1g2 scratchpads on disk have neither new field | Both nullable; missing field reads as null; banner/divergence helpers tolerate. No migration needed. |
| 8 | `formatNoteLine` falls behind future `RecoveryNote` kinds | Switch has a `default` branch that prints the kind verbatim. New kinds render with their kind name + no message — readable but ugly. Acceptable until a new kind ships. |
| 9 | `sp-command.ts` keeps growing (was ~250 lines post-1g; 1g2 adds ~80) | Acknowledged. Stays under the 400-line threshold. Post-Phase-1 split refactor will pick this up alongside `scratchpad-manager.ts`. |

## 10. Out-of-scope deferred items

- **1g3:** `fork` `rawChild.once('exit')` timeout + SIGKILL fallback; `size_bytes` post-write recompute; broader atomic-rename for `namespace.json`.
- **Phase 2+:** TUI overlay for `/sp tree` interactive navigation; branch-summary entries in cells.jsonl on subtree abandon; scratchpad-tool actions reset/remove/dump/install; vegalite + PNG renderers; `artifact://` output spill; sql.js fallback engine; `_sessions/` GC sweep.

---

**Next step:** invoke `superpowers:writing-plans` to expand this spec into a task-by-task plan at `docs/superpowers/plans/2026-06-01-coworker-phase-1g2-on-attach-ux.md`.
