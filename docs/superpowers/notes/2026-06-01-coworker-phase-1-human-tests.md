# Otto Co-worker Scratchpad — Phase 1 Human Test Plan

**Status:** Phase 1 (1a–1g3) is merged to main as of 2026-06-01. This document walks every user-facing feature shipped in Phase 1, plus a few diagnostic checks for the library-internal hardening from 1g3.

**Not covered (Phase 2+ deferrals):** TUI overlay for `/sp tree` interactive navigation, branch-summary cells on subtree abandon, scratchpad-tool actions `reset/remove/dump/install`, vegalite/PNG MIME renderers, `artifact://` output spill, sql.js fallback engine, `_sessions/` GC sweep.

---

## Setup

Before starting:

```bash
# Make sure dist/ is up to date
npm run build:core

# (Optional) Clear any pre-existing scratchpads so you start from a clean slate
rm -rf ~/.otto/scratchpads/

# Launch Otto in your workspace
# (whatever the standard launch command is — typically the otto binary)
```

**Disk layout reference** — peek here any time:
```
~/.otto/scratchpads/
  <name>/
    kernel.db           DuckDB durable storage
    kernel.db.wal       DuckDB WAL (transient between snapshots)
    namespace.json      v8-serialized globalThis (written on snapshot)
    cells.jsonl         append-only cell journal (schema header + N entries)
    meta.json           name + timestamps + attached_sessions + recovery_notes + pointers
    lock.json           per-process lock with takeover audit trail
  _sessions/
    <sessionId>.json    per-session currentName affinity sidecar
```

---

## Tool-trigger semantics (read before scenarios)

The LLM only auto-uses the `cw_scratchpad` tool when the request fits these criteria:

- **USE FOR:** loading or analyzing files (CSV/Excel/JSON/Parquet), tabular data manipulation via polars or DuckDB, multi-step data exploration where state should persist across turns, anything calling `otto.collectors`.
- **DO NOT USE FOR:** simple arithmetic, lookups answerable from reasoning, prose, code review, pure-explanation tasks.
- **Explicit user request always wins:** "use cw_scratchpad", "run this in the scratchpad", "exec a cell" → tool runs regardless of trigger criteria.
- **If unsure, the LLM should ASK** before deciding.

This means: prompts like *"sum [1,2,3,4,5]"* will NOT auto-trigger the tool (it's trivial arithmetic). To exercise the scratchpad with such requests, prefix with **"use cw_scratchpad"**. Real test data should involve files, polars, or DuckDB to exercise the auto-trigger path.

---

## Scenario 1 — LLM trigger behavior (USE / SKIP / ASK)

**Goal:** Confirm the LLM honors the conservative trigger rules from the updated tool description.

**Phase coverage:** 1e (tool registration), tool description/promptSnippet/promptGuidelines.

```
/sp new t01-triggers
```

Then ask Otto each of the prompts below in turn and note the behavior:

| Prompt | Expected behavior |
|---|---|
| "What's 1024 × 768?" | Answers inline (arithmetic — SKIP rule fires) |
| "Explain how polars handles nulls" | Answers inline (prose) |
| "Use cw_scratchpad to compute the sum of [1,2,3,4,5]" | Calls the tool (explicit request wins) |
| "I have a CSV at /tmp/test.csv — load it and tell me the column count" | Calls the tool (file → USE rule) |
| "Compute the standard deviation of these 50 numbers: …" | Should ASK — borderline |

After all five prompts, `/sp view` should show cells from only the two prompts that actually triggered the tool (the "use cw_scratchpad" one and the CSV one — assuming you have a CSV).

**Pass criterion:** At least 3 of 5 behaviors match the expected column. LLM behavior is statistical, so a 1-of-5 misfire is acceptable; >2 misfires suggests the trigger language needs tuning.

---

## Scenario 2 — Basic exec, persistent globalThis, and `/sp view`

**Goal:** Exercise the most fundamental loop: spawn a kernel, run a cell, persist state via `globalThis`, retrieve it in a later cell.

**Phase coverage:** 1b (kernel subprocess + NDJSON), 1d (cells.jsonl append, runCell funnel), 1e (tool exec/view actions).

```
/sp new t02-basics
```

Then ask Otto (use explicit trigger since these are arithmetic):

> **"Use cw_scratchpad to run: `globalThis.nums = [10, 20, 30, 40, 50]; return globalThis.nums.length;`"**

Then:

> **"In the same scratchpad, return `globalThis.nums.reduce((a,b) => a+b, 0)`"**

Then `/sp view`. Expected: 2 cells, second with `parentId: 1`, sum = 150.

**Disk check:**
```bash
ls -la ~/.otto/scratchpads/t02-basics/
wc -l ~/.otto/scratchpads/t02-basics/cells.jsonl       # expect 3 (header + 2 cells)
cat ~/.otto/scratchpads/t02-basics/meta.json | grep -E 'size_bytes|kernel_at_cell_id|cell_leaf_id'
```

Expected: `size_bytes > 0`, `kernel_at_cell_id: 2`, `cell_leaf_id: 2`.

---

## Scenario 3 — Pre-bound data libs (polars + DuckDB)

**Goal:** Confirm the data libraries from 1d are bound into the kernel sandbox.

**Phase coverage:** 1d (pre-bound libs: polars, DuckDB, ExcelJS, dateFns, lodash, zod, axios), 1d2 (DuckDB on-disk via `otto.duckdb`).

```
/sp new t03-datalibs
```

Drop a small CSV somewhere, e.g.:

```bash
cat > /tmp/sales.csv <<EOF
region,units,revenue
north,42,1200
south,17,580
east,93,2890
west,8,210
EOF
```

Then ask Otto (file mention should auto-trigger):

> **"Load /tmp/sales.csv into a polars DataFrame, then return the column names and row count."**

Then:

> **"Use otto.duckdb to register that DataFrame as a SQL table and return the sum of `revenue`."**

Then `/sp view`. Expected: 2 cells, both ok, no errors. `meta.json` should now show `kernel.db.wal` present (DuckDB wrote).

**Disk check:**
```bash
ls -la ~/.otto/scratchpads/t03-datalibs/
# Expect to see kernel.db, kernel.db.wal, cells.jsonl
du -h ~/.otto/scratchpads/t03-datalibs/kernel.db
# Expect non-trivial size if DuckDB stored a table
```

---

## Scenario 4 — Cell tree + leaf rewind (`/sp tree`)

**Goal:** Exercise the 1f cell-tree projection + leaf-pointer mutation.

**Phase coverage:** 1f (cell-tree projection, `/sp tree`, `setLeaf`).

```
/sp new t04-tree
```

Run 4–5 cells building on each other. Use explicit "in cw_scratchpad" prefixes since these are short snippets:

> **"In cw_scratchpad: `globalThis.a = 1; return globalThis.a;`"**
> **"In cw_scratchpad: `globalThis.b = globalThis.a + 10; return globalThis.b;`"**
> **"In cw_scratchpad: `globalThis.c = globalThis.b * 2; return globalThis.c;`"**
> **"In cw_scratchpad: `globalThis.d = globalThis.c - 5; return globalThis.d;`"**

Then:
```
/sp tree
```

Expected: indented chain `#1 → #2 → #3 → #4` with `*` on cell #4.

Move the leaf back:
```
/sp tree --to 2
```

Otto should notify: `set leaf of t04-tree to cell 2`. Now ask:

> **"In cw_scratchpad: `globalThis.x = 'branched-from-2'; return globalThis.x;`"**

Then `/sp tree` again. Expected: branching tree — `#1 → #2 → {#3 → #4, #5}` with `*` on the new cell #5. Note: the new cell still sees `globalThis.c` and `globalThis.d` from cells #3 and #4 because in-VM state doesn't rewind — only the journal pointer does.

---

## Scenario 5 — Fork a scratchpad (`/sp fork`)

**Goal:** Clone a scratchpad's full state (kernel.db + namespace.json + cells.jsonl) into a new one.

**Phase coverage:** 1f (fork), 1g3 (fork exit timeout + SIGKILL escalation runs but should not be triggered in happy path).

```
/sp fork t02-basics t05-fork-copy
/sp list
```

Expected: both `t02-basics` and `t05-fork-copy` listed.

```
/sp attach t05-fork-copy
```

Ask Otto: **"Use cw_scratchpad to return `globalThis.nums`"** — expect the same array as scenario 2 (state was forked).

Now diverge: **"Use cw_scratchpad to set `globalThis.nums = [999]` and return it."**

Switch back: `/sp attach t02-basics`, then **"Use cw_scratchpad to return `globalThis.nums`"** — expect the original `[10,20,30,40,50]`. Confirms independence.

**Disk check:**
```bash
ls ~/.otto/scratchpads/t05-fork-copy/
# Expect: kernel.db, kernel.db.wal (if t02 had it), namespace.json, cells.jsonl, meta.json, lock.json
diff <(cat ~/.otto/scratchpads/t02-basics/cells.jsonl) <(cat ~/.otto/scratchpads/t05-fork-copy/cells.jsonl)
# After the fork itself (before the divergence cell): identical. After divergence: differ.
```

---

## Scenario 6 — `/sp save` (explicit snapshot, no dispose)

**Goal:** Force a namespace.json flush without disposing the kernel.

**Phase coverage:** 1g (save method), 1d2 (snapshot via runtime).

```
/sp attach t02-basics
```

Ask Otto: **"Use cw_scratchpad to set `globalThis.checkpoint = Date.now()`"**

```
/sp save
```

Expected notify: `saved t02-basics at cell <N>`.

**Disk check:**
```bash
ls -la ~/.otto/scratchpads/t02-basics/namespace.json
# Should now exist with mtime ≈ now
cat ~/.otto/scratchpads/t02-basics/meta.json | grep -E 'last_snapshot_cell_id|last_snapshot_at'
# Both should be non-null; last_snapshot_at near current time
```

Verify the kernel did NOT dispose: ask Otto **"Use cw_scratchpad to return `globalThis.checkpoint`"** — should return the timestamp without re-spawning (instant response, no startup delay).

---

## Scenario 7 — `/sp clear-history` (truncate cells, preserve in-VM state)

**Goal:** Reset the cell journal without losing kernel state.

**Phase coverage:** 1g (clearHistory), 1f (archive.reset).

```
/sp attach t02-basics
/sp clear-history
```

Otto should prompt for confirmation. Answer **yes**. Then:
```
/sp view
```

Expected: `t02-basics: no cells yet`.

Now ask: **"Use cw_scratchpad to return `globalThis.nums`"** — should STILL return `[10,20,30,40,50]` because in-VM globalThis was preserved. The new cell will be id #1 (fresh chain).

**Disk check:**
```bash
wc -l ~/.otto/scratchpads/t02-basics/cells.jsonl
# Right after clear-history: 1 (just the schema header)
# After the next exec: 2 (header + new cell #1)
cat ~/.otto/scratchpads/t02-basics/meta.json | grep -E 'cell_leaf_id|last_snapshot_cell_id|kernel_at_cell_id'
# After clear-history: cell_leaf_id=null, last_snapshot_cell_id=null, kernel_at_cell_id=null
# After the next exec: all three updated to 1
```

---

## Scenario 8 — `/sp detach` (leave without disposing)

**Goal:** Drop the session-affinity link without killing the kernel.

**Phase coverage:** 1g (detach method + sidecar deletion).

```
/sp attach t02-basics
/sp detach
```

Expected: `detached from t02-basics`. `/sp list` should show `t02-basics` still `● live` but no longer marked `(current)`.

**Disk check:**
```bash
cat ~/.otto/scratchpads/t02-basics/meta.json | grep -A 2 attached_sessions
# Your sessionId should NOT be in attached_sessions[]
ls ~/.otto/scratchpads/_sessions/
# Your session's sidecar (if it was there) should be gone
```

---

## Scenario 9 — Cross-session continuity via `/resume`

**Goal:** Verify that closing Otto and reopening restores the currentName attachment.

**Phase coverage:** 1g (sidecar + session_start restore), 1d2 (cold→warm namespace restore).

**IMPORTANT — how Otto's session model works:** the per-session sidecar at `~/.otto/scratchpads/_sessions/<sessionId>.json` is keyed by **sessionId**, NOT by workspace. A fresh `otto` launch creates a new session file → new sessionId → no match against any existing sidecar → no restore. To actually trigger restore you must REUSE the prior session via `/resume` or `--resume`.

### Step 1: Establish attachment and quit

```
/sp attach t03-datalibs
```

Confirm: ask **"Use cw_scratchpad to return `globalThis` keys"** (or similar) — should return whatever's persisted.

Verify sidecar was written:
```bash
ls -la ~/.otto/scratchpads/_sessions/
# Look for a file with mtime ≈ now; its contents should reference t03-datalibs
cat ~/.otto/scratchpads/_sessions/*.json | grep -B 1 -A 1 t03-datalibs
```

Exit Otto: `Ctrl+D`, `/quit`, or `/exit`.

### Step 2: Launch with `--resume` and pick the prior session

In a new shell (same workspace):
```bash
otto --resume
```

(Or short form: `otto -r`.)

A session picker opens. Select the session you just left (most recent, the one you attached t03-datalibs in). On session_start you should see:

```
attached to t03-datalibs (restored)
```

If there were unseen recovery notes, you'll also see:
```
⚠ N unread recovery notes: ...
```

### Step 3: Verify state is intact

Ask: **"Use cw_scratchpad to return the polars DataFrame column names from before"** — should work without re-loading because namespace.json + kernel.db were restored.

### Alternative: `/resume` from inside a running Otto

If you've already launched fresh Otto without `--resume`, you can switch to a prior session via the same picker:
```
/resume
```
Pick the prior session from the TUI. Otto reloads it in place; the session_start handler fires the restore.

### What does NOT trigger restore (and why)

- **Fresh `otto` launch with no flags** → new session file → new sessionId → sidecar miss → no restore. By design: a fresh launch is supposed to be fresh.
- **`/sp attach <name>` in a fresh session, where `<name>` matches a previous session's sidecar** → won't auto-restore because the new session doesn't know about the previous session's sidecar (different sessionId).

If you want fresh launches to auto-restore the last-used scratchpad for the workspace, that's a separate design question — filed as Issue 6 in `2026-06-01-coworker-phase-1-known-issues.md`.

### Disk check

```bash
# After --resume completed:
cat ~/.otto/scratchpads/_sessions/<the-session-id-you-resumed>.json
# Should reflect: { schema_version: 1, session_id: ..., current_name: "t03-datalibs", attached_at: ... }
# The session_id field should match the file basename (same session reused = same id).
```

---

## Scenario 10 — Recovery-notes banner + `/sp notes` re-view

**Goal:** Surface past failures + verify the seen-cutoff behavior.

**Phase coverage:** 1d2 (recovery_notes), 1g2 (recovery-notes banner + `/sp notes` verb + `recovery_notes_seen_at`).

The easiest way to seed a recovery note: try to save while a long cell is running. Or just inspect any scratchpad that already has notes from prior scenarios — `meta.recovery_notes` accumulates `namespace-absent` notes on first attach.

```
/sp attach t02-basics
```

If there are unseen notes, you'll see a `⚠ N unread recovery notes:` banner. Then:
```
/sp notes
```

Expected: prints all notes (seen + unseen), one per line with `[YYYY-MM-DDTHH:MM:SS]` timestamps. Does NOT update `recovery_notes_seen_at`.

Detach + reattach to confirm the banner doesn't re-fire:
```
/sp detach
/sp attach t02-basics
```

Expected: no recovery banner this time (seen-cutoff working).

**Disk check:**
```bash
cat ~/.otto/scratchpads/t02-basics/meta.json | grep -A 2 recovery_notes_seen_at
# Should be a recent ISO timestamp
```

---

## Scenario 11 — Kernel-state divergence banner

**Goal:** Surface the case where `cell_leaf_id !== kernel_at_cell_id` (user rewound the leaf but didn't restart the kernel).

**Phase coverage:** 1g2 (divergence banner + `kernel_at_cell_id` lifecycle).

If you did scenario 4, you already have a divergent t04-tree. Otherwise:

```
/sp attach t04-tree
/sp tree --to 2
/sp detach
/sp attach t04-tree
```

On the second attach, you should see:
```
ℹ kernel state is at cell #N; view is at cell #2 (run /sp tree to inspect)
```

where N is the highest cell id ever run (in scenario 4, that's the branched #5).

**Disk check:**
```bash
cat ~/.otto/scratchpads/t04-tree/meta.json | grep -E 'cell_leaf_id|kernel_at_cell_id'
# Expect cell_leaf_id < kernel_at_cell_id when the banner fires
```

---

## Scenario 12 — Force-takeover prompt

**Goal:** Exercise the multi-process lock + interactive takeover flow.

**Phase coverage:** 1c2 (scratchpad-lock, force-takeover audit), 1g2 (force-takeover prompt + reason capture).

In **terminal A**, attach to a scratchpad:
```
/sp attach t02-basics
```

In **terminal B** (separate Otto session, same workspace), attempt the same:
```
/sp attach t02-basics
```

Expected prompt in terminal B:
```
Force takeover?
t02-basics: lock held by pid <N> on host <H> (acquired ...). Take it?
```

Answer **yes**. Next prompt:
```
Takeover reason: <type any reason>
```

After the reason, terminal B is now attached. If you try to exec a cell from terminal A, you'll see a lock-violation error.

**Non-interactive variant** (in a fresh terminal B):
```
/sp attach t02-basics --force-takeover --reason "scripted takeover"
```

Skips both prompts. Then inspect:
```bash
cat ~/.otto/scratchpads/t02-basics/lock.json
# Expect takeover_from: { pid, host, reason: "scripted takeover" }
```

---

## Scenario 13 — `/sp remove` confirm-on-current + `--yes` bypass

**Goal:** Exercise the remove-confirm safety net.

**Phase coverage:** 1g (remove + confirm + sidecar cleanup).

While attached to `t05-fork-copy`:
```
/sp remove t05-fork-copy
```

Expected prompt:
```
Remove current scratchpad?
t05-fork-copy is your current scratchpad. Remove it? This deletes kernel.db, namespace.json, and the cell journal.
```

Answer **no** first to verify the cancel path:
```
cancelled
```
`/sp list` should still show t05-fork-copy.

Now repeat with `--yes` to bypass the prompt:
```
/sp remove t05-fork-copy --yes
```

Expected: `removed scratchpad: t05-fork-copy`. The scratchpad dir is gone, your session's sidecar is deleted, currentName is cleared.

**Negative case** — removing a non-current scratchpad does NOT prompt:
```
/sp remove t01-triggers
```

(Should remove without confirmation since you're not attached to it.)

---

## Scenario 14 — Library hardening (1g3) — visible artifacts

**Goal:** Verify the 1g3 hardening is in effect via disk artifacts.

**Phase coverage:** 1g3 (atomic rename for namespace.json + meta.json, payload-only size_bytes, fork exit timeout).

After any scenario that triggers a snapshot (e.g., scenario 6 `/sp save` or any `/sp detach` + `/sp attach` cycle):

**Atomic-rename check:** there should be NO leftover `.tmp` files:
```bash
find ~/.otto/scratchpads/ -name "*.tmp"
# Expect: no output
```

**Payload-only size_bytes check:**
```bash
cat ~/.otto/scratchpads/t03-datalibs/meta.json | python3 -c "
import json, sys, os
m = json.load(sys.stdin)
dir = os.path.expanduser('~/.otto/scratchpads/t03-datalibs')
files = ['kernel.db', 'kernel.db.wal', 'namespace.json', 'cells.jsonl']
total = sum(os.path.getsize(os.path.join(dir, f)) for f in files if os.path.exists(os.path.join(dir, f)))
print(f'meta.size_bytes={m[\"size_bytes\"]}, payload_sum={total}')
print('lock.json and meta.json should NOT be counted')
import os
lock = os.path.getsize(os.path.join(dir, 'lock.json'))
meta = os.path.getsize(os.path.join(dir, 'meta.json'))
print(f'lock_size={lock}, meta_size={meta}')
"
```

Expected: `meta.size_bytes ≈ payload_sum`, and excluding lock.json + meta.json. (May lag by one cycle if you check immediately after a runCell — meta.json is written before payload sizes settle. Run another exec and re-check.)

**Fork exit timeout** is exercised every time `/sp fork` runs (scenario 5). In the happy path it completes instantly. To force a real timeout you'd need a stuck kernel; not part of this human test plan — covered by automated tests at `packages/coworker-scratchpad/src/scratchpad-manager.test.ts:716-791`.

---

## Scenario 15 — `/sp reset` (remove + recreate)

**Goal:** Quick way to start fresh on an existing name.

**Phase coverage:** 1e (reset verb).

Pick any scratchpad you've finished with:
```
/sp list
/sp reset t04-tree
```

Expected: `reset scratchpad: t04-tree`. After this, `t04-tree` is a fresh scratchpad with the same name; its kernel.db, cells.jsonl, and namespace.json are gone but the dir exists.

**Disk check:**
```bash
ls ~/.otto/scratchpads/t04-tree/
# Expect: lock.json, meta.json (fresh), kernel.db (newly spawned), maybe kernel.db.wal
# NOT: namespace.json (no snapshot yet), cells.jsonl (no cells yet)
```

---

## Scenario 16 — Cleanup

```
/sp list                  # see what's left
/sp remove t01-triggers --yes
/sp remove t02-basics --yes
/sp remove t03-datalibs --yes
/sp remove t04-tree --yes
ls ~/.otto/scratchpads/   # only _sessions/ should remain
ls ~/.otto/scratchpads/_sessions/   # depending on the order, your current session sidecar may exist
```

To clear everything:
```bash
rm -rf ~/.otto/scratchpads/
```

---

## Phase coverage matrix

| Scenario | 1a (collectors) | 1b (kernel) | 1c (runtime) | 1c2 (lock+pool) | 1d (datalibs+cells) | 1d2 (DuckDB+snapshot) | 1e (ext+tool+/sp) | 1f (tree+fork) | 1g (session+ops) | 1g2 (UX banners) | 1g3 (hardening) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 trigger semantics |  |  |  |  |  |  | ✓ |  |  |  |  |
| 2 basic exec |  | ✓ |  |  | ✓ |  | ✓ |  |  |  |  |
| 3 polars + DuckDB |  | ✓ |  |  | ✓ | ✓ | ✓ |  |  |  |  |
| 4 tree + rewind |  | ✓ |  |  | ✓ |  | ✓ | ✓ |  |  |  |
| 5 fork |  | ✓ |  |  |  | ✓ | ✓ | ✓ |  |  | ✓ |
| 6 save |  | ✓ |  |  |  | ✓ |  |  | ✓ |  | ✓ |
| 7 clear-history |  |  |  |  | ✓ |  |  | ✓ | ✓ |  |  |
| 8 detach |  |  |  | ✓ |  |  |  |  | ✓ |  |  |
| 9 /resume |  |  |  |  |  | ✓ |  |  | ✓ | ✓ |  |
| 10 recovery notes |  |  |  |  |  | ✓ |  |  |  | ✓ |  |
| 11 divergence banner |  |  |  |  |  |  |  | ✓ |  | ✓ |  |
| 12 force-takeover |  |  |  | ✓ |  |  |  |  |  | ✓ |  |
| 13 remove confirm |  |  |  |  |  |  |  |  | ✓ |  |  |
| 14 1g3 artifacts |  |  |  |  |  |  |  |  |  |  | ✓ |
| 15 reset |  |  |  |  |  |  | ✓ |  |  |  |  |

**Notes:**
- Phase 1a (collectors) is exercised whenever you ask Otto to use `otto.collectors.list()` or `otto.collectors.open(uri)` — add that to scenario 3 if you want to cover it explicitly. The CSV path in scenario 3 may or may not go through collectors depending on how the LLM phrases the load.
- Phase 1c (runtime hardening — two-tier timeout, progress, cancellation) is harder to exercise in human tests; it fires only on stuck cells. Covered by automated tests in `packages/coworker-scratchpad/src/child-process-runtime.test.ts`.

---

## What to do if a scenario fails

1. **Capture state immediately.** Don't run more commands.
2. **Inspect on-disk artifacts:**
   ```bash
   ls -la ~/.otto/scratchpads/<name>/
   cat ~/.otto/scratchpads/<name>/meta.json
   cat ~/.otto/scratchpads/<name>/cells.jsonl
   cat ~/.otto/scratchpads/<name>/lock.json
   ```
3. **Check the session sidecar:**
   ```bash
   ls ~/.otto/scratchpads/_sessions/
   ```
4. **Look at Otto's stderr** for `[otto]` tool-collision warnings or kernel-spawn errors.
5. **Match against the automated tests** — every scenario corresponds to one or more unit tests in `packages/coworker-scratchpad/src/scratchpad-manager.test.ts` or `src/resources/extensions/coworker-scratchpad/*.test.ts`. If the unit test passes but the human scenario fails, the gap is likely in the extension wiring or the LLM trigger.

---

## Out of scope (Phase 2+)

These are documented for completeness but are NOT yet implemented:

- **TUI overlay for `/sp tree`** — interactive cell-tree navigation. Today `/sp tree` is text-only.
- **Branch-summary entries in cells.jsonl** on subtree abandon — when you rewind the leaf, the orphaned subtree currently stays in the journal. No summary is written.
- **Scratchpad-tool actions `reset`, `remove`, `dump`, `install`** — currently only `exec` and `view` are wired. The other actions exist in the spec but were deferred.
- **vegalite + PNG MIME renderers** — only text/markdown, text/plain, and application/json are surfaced today.
- **`artifact://` output spill** — large outputs are inline today; spilling to the artifact store requires `@otto/coworker-artifacts` which is a stub package.
- **sql.js fallback** for DuckDB — only `@duckdb/node-api` works today.
- ~~**`_sessions/` GC sweep** — sidecars accumulate; not auto-cleaned.~~ **Added in Phase 1.5** — see scenario 24 below.

---

# Phase 1.5 — Re-verification & New Scenarios

**Status:** Phase 1.5 (the polish wave bundling Issues #1/#2/#4/#5/#6 + GH #66/#67) merges to main as Otto v1.2.0. Re-run the scenarios below on the v1.2.0 build to confirm the visible behavior changes ship intact.

The 16 original Phase 1 scenarios remain valid as a regression baseline. Three of them (3, 9, 16) have **changed expected outcomes**; the rest are unchanged.

## Re-verify (changed expected outcomes)

### Scenario 3 (re-verify) — polars→DuckDB drops from 8 cells to 2

**What changed:** `otto.duckdb.registerDf(name, input, opts?)` shipped (Task F / Issue #1). Duck-typed input detection for polars DataFrames, Arrow Tables, and arrays of records; first-10-rows null-walk schema inference; optional `opts.schema` override. The `cw_scratchpad` promptGuidelines were updated so the LLM reaches for the helper.

**Re-run the original scenario 3 prompts.** Expected outcome:

| Phase 1 | Phase 1.5 |
|---|---|
| LLM burns ~8 cells: 1 load + 1 failed `conn.register` + ~5 API discovery + 1 actual SQL | LLM should burn ~2 cells: 1 load + 1 `registerDf + runAndReadAll` |

**Pass criterion:** `wc -l ~/.otto/scratchpads/tNN/cells.jsonl` returns ≤ 4 lines (1 schema header + ≤ 3 cells) for the polars→DuckDB→SUM(revenue) workflow.

**If the LLM still does API discovery:** the promptGuideline bullet may not be surfacing — verify by asking Otto: *"What does `otto.duckdb.registerDf` do?"* — if it answers with the bullet text, the bullet is reaching the LLM and the discovery loop is a model-behavior misfire (acceptable on rare runs).

**Direct API test (bypasses the LLM):**
```
/sp new tNN
```
Then:
> *"Use cw_scratchpad to run: `await otto.duckdb.registerDf('s', [{a:1,b:'x'},{a:2,b:'y'}]); const c=await otto.duckdb.connect(); return (await c.runAndReadAll('SELECT SUM(a) FROM s')).getRows();`"*

Expected: `[[3]]` (or `[["3"]]` depending on serialization) in 1 cell.

---

### Scenario 9 (re-verify) — fresh `otto` (NO `--resume`) restores yesterday's scratchpad

**What changed:** Workspace-pointer restore shipped (Task A / Issue #6). The spec's canonical day-2 RCA scenario now works without `--resume` — typing `otto` in the same workspace where you last attached a scratchpad auto-restores it.

**Re-run with this twist:**

```
# Day 1
cd /some/git/repo                   # workspace = git toplevel
otto
/sp new t09-workspace
# (run a cell or two)
/quit
```

```
# Day 2 (or any subsequent fresh launch in the same workspace)
cd /some/git/repo
otto                                # NO --resume flag
```

**Expected notification on attach:**
```
attached to t09-workspace (from workspace, last used <relative>)
```

(Compared to Phase 1's expected `attached to t09-workspace (restored)` which fired ONLY via `--resume` + matching sessionId.)

**Disk check:**
```bash
ls ~/.otto/scratchpads/_workspaces/
# Expect one file: <sha256-16>.json
cat ~/.otto/scratchpads/_workspaces/<hash>.json
# Expect: { schema_version: 1, workspace_hash: ..., workspace_root: "/some/git/repo",
#          last_session_id: "<day-1 session>", last_current_name: "t09-workspace",
#          last_attached_at: "<day-1 ISO time>" }
```

**Subdirectory test:** Launch `otto` from a subdir of the same git repo:
```
cd /some/git/repo/src/foo
otto
```
Expected: same restore notification (workspace hash uses git toplevel, not cwd).

**Cross-repo isolation test:** Launch `otto` from a DIFFERENT git repo:
```
cd /some/other/repo
otto
```
Expected: NO restore (different workspace hash).

**Stale pointer test:** If you set the system clock forward by 8 days (or run after a real 8-day gap), the pointer should be ignored and no restore happens.

**The `--resume` path STILL works** — Phase 1's sidecar restore is preserved as the primary precedence; the workspace pointer is the fallback. To re-verify that: launch `otto --resume <prior-session>` and confirm `attached to <name> (restored)` (the legacy phrasing, not the workspace-pointer phrasing).

---

### Scenario 16 (re-verify) — Cleanup; stale sidecars auto-swept on init

**What changed:** `sweepStaleSidecars` shipped (Task B / Issue #67). Filename format changed to `sidecar_<sessionId>.json` (Issue #66). On every `session_start`, foreign-session sidecars are deleted if (a) their referenced scratchpad's `meta.json` is missing, OR (b) the sidecar's mtime is > 7 days old.

**Re-run the original cleanup:**

```
/sp list
/sp remove t01-triggers --yes
/sp remove t02-basics --yes
/sp remove t03-datalibs --yes
/sp remove t04-tree --yes
/quit
otto                                 # fresh launch triggers the sweep
ls ~/.otto/scratchpads/              # _sessions/ + _workspaces/ should remain
ls ~/.otto/scratchpads/_sessions/    # should contain ONLY sidecar_<current-sessionId>.json
```

**Phase 1 vs Phase 1.5:**

| | Phase 1 | Phase 1.5 |
|---|---|---|
| Filename format | `<sessionId>.json` | `sidecar_<sessionId>.json` |
| Old sessions' sidecars after current launch | Accumulate forever (5+ leftovers per user report) | Swept on init (only current session's file remains) |
| Cleanup gesture | `rm -rf ~/.otto/scratchpads/_sessions/` manually | Automatic — no user action needed |

**Pre-rename orphans:** Users upgrading from Phase 1 will have old `<sessionId>.json` files. These become inert orphans (sweep's `startsWith('sidecar_')` guard ignores them). They won't get GC'd and won't break anything, but if you want a clean slate: `rm ~/.otto/scratchpads/_sessions/*.json` ONCE post-upgrade.

**Pass criterion:** `ls ~/.otto/scratchpads/_sessions/ | grep -c '^sidecar_'` returns 1 (your current session); no other `sidecar_` files present (assuming you ran a few days of sessions before the upgrade).

---

## New Phase 1.5 scenarios

### Scenario 17 — `/sp attach <typo>` errors with helpful suggestion

**Goal:** Verify the slash-command typo guard from Task C / Issue #5.

**Phase coverage:** 1.5 Task C.

```
/sp list
  ● live  t02-basics (current)
  ○ cold  t04-tree

/sp attach t02-basix              # typo — meant "t02-basics"
```

**Expected:** Error notification:
```
scratchpad not found: t02-basix. Use /sp new t02-basix to create it.
```

`/sp list` should still show only the original two scratchpads — NO phantom `t02-basix` directory.

**Disk check:**
```bash
ls ~/.otto/scratchpads/t02-basix 2>&1
# Expect: ls: ... No such file or directory
```

**LLM tool path unchanged:** Ask Otto: *"Use cw_scratchpad to exec `return 1` in a scratchpad named `llm-test-phantom`"*. The LLM tool path is permissive and SHOULD auto-create — verify by `/sp list` showing the new `llm-test-phantom` scratchpad. (This distinguishes the slash-command strictness from the LLM-tool permissiveness, both intentional.)

---

### Scenario 18 — `/sp list` idle-age column

**Goal:** Verify the new idle-age display from Task D / Issue #4.

**Phase coverage:** 1.5 Task D.

```
/sp new t18-active
# Ask Otto: "use cw_scratchpad to run while(true) {} in t18-active"
# (DON'T await — let it run, then immediately:)
/sp list
```

**Expected output:**
```
● live  t18-active            active  (current)
```

Now interrupt the runaway cell:
```
/sp evict t18-active --force
/sp new t18-idle
/sp list
```

**Expected:**
```
○ cold  t18-active
● live  t18-idle              active  (current)
```

Wait a few minutes (or backdate the entry — only possible via the test harness), then `/sp list` again:
```
● live  t18-idle              idle Xm  (current)
```

Where `X` is the floored-minutes elapsed. The format bands:
- `active` — cell running OR < 30s since last use
- `idle Xm` — 30s ≤ age < 1h
- `idle Xh` — 1h ≤ age < 24h
- `idle Xd` — 24h+

**Pass criterion:** All three labels (`active`, `idle Xm`, `idle Xh`) render correctly across timing checks.

---

### Scenario 19 — `/sp evict <name>` releases warm kernel; on-disk state preserved

**Goal:** Verify the normal eviction path (no active cell) from Task D / Issue #4.

**Phase coverage:** 1.5 Task D.

```
/sp new t19-evict
# Run a couple of cells to populate state:
# Ask Otto: "use cw_scratchpad to run globalThis.x = 42 in t19-evict"
# Ask Otto: "use cw_scratchpad to run return globalThis.x in t19-evict"
# (should return 42 — state persists)

/sp list
#   ● live  t19-evict   active|idle Xs  (current)

/sp evict t19-evict
```

**Expected notification:**
```
evicted t19-evict (still on disk; /sp attach t19-evict to re-warm)
```

```
/sp list
#   ○ cold  t19-evict          ← flipped to cold
```

**Disk check (state preserved):**
```bash
ls ~/.otto/scratchpads/t19-evict/
# Expect: kernel.db, kernel.db.wal (maybe), namespace.json, cells.jsonl, meta.json
# NOT removed — eviction only releases the kernel, not the data.
```

**Re-warm test:**
```
/sp attach t19-evict
# Ask Otto: "use cw_scratchpad to run return globalThis.x in t19-evict"
# Expected: 42 — state restored from snapshot.
```

**Pass criterion:** state survives evict→attach cycle; `/sp list` reflects warm→cold transition.

---

### Scenario 20 — `/sp evict <name> --force` interrupts active cell

**Goal:** Verify the `--force` escalation path from Task D.

**Phase coverage:** 1.5 Task D (reuses `runtime.cancel()` SIGINT→SIGTERM→SIGKILL escalation).

```
/sp new t20-force
# Ask Otto: "use cw_scratchpad to run while(true) {} in t20-force"
# Wait until the cell is clearly hung (a few seconds).

/sp evict t20-force          # no --force
```

**Expected error:**
```
cannot evict t20-force: cell is running (use --force to interrupt)
```

Now with `--force`:
```
/sp evict t20-force --force
```

**Expected notification:**
```
interrupted active cell and evicted t20-force
```

```
/sp list
#   ○ cold  t20-force          ← flipped to cold
```

**Disk check:** scratchpad dir + meta.json still exist (next attach is a cold-restart from cells.jsonl; no snapshot was taken because the kernel was killed mid-run).

**Pass criterion:** Active cell terminates within a few seconds; entry flips cold; no kernel-still-running zombies (check with `ps aux | grep kernel-entry` — should be no Otto kernel children).

---

### Scenario 21 — `meta.json` on fresh `/sp new` reflects post-spawn disk state

**Goal:** Verify the meta-write-ordering fix from Task E / Issue #2.

**Phase coverage:** 1.5 Task E.

```
/sp new t21-meta
```

Immediately (without running any cell):
```bash
cat ~/.otto/scratchpads/t21-meta/meta.json | jq '.kernel_db, .size_bytes'
```

**Expected:**
```json
{ "present": true, "path": "kernel.db" }
<some number > 0>
```

Phase 1's broken state would have shown `present: false, size_bytes: 0` because the first `writeMeta` fired before `kernel.db` existed on disk.

**Pass criterion:** `kernel_db.present === true` AND `size_bytes > 0` immediately after `/sp new`, before any cell runs.

---

### Scenario 22 — `otto.duckdb.registerDf` direct test (one-liner verification)

**Goal:** Direct exercise of the new helper from Task F / Issue #1, bypassing the LLM-driven path in Scenario 3.

**Phase coverage:** 1.5 Task F.

```
/sp new t22-registerdf
```

> *"Use cw_scratchpad to run: `await otto.duckdb.registerDf('a', [{a:1,b:'x'},{a:2,b:'y'},{a:3,b:'z'}]); const c=await otto.duckdb.connect(); return (await c.runAndReadAll('SELECT SUM(a) FROM a')).getRows();`"*

**Expected:** `[[6]]` or equivalent representation.

**Schema-override test:**
> *"Use cw_scratchpad to run: `await otto.duckdb.registerDf('b', [{n:1},{n:2}], { schema: { n: 'BIGINT' } }); const c=await otto.duckdb.connect(); return (await c.runAndReadAll('DESCRIBE b')).getRows();`"*

**Expected:** A row showing `n` column with `BIGINT` type (instead of the default `DOUBLE` that inference would have picked for JS numbers).

**Null-walk inference test:**
> *"Use cw_scratchpad to run: `const rows = Array(8).fill({rev: null}).concat([{rev: 1200},{rev: 980}]); await otto.duckdb.registerDf('c', rows); const c = await otto.duckdb.connect(); return (await c.runAndReadAll('DESCRIBE c')).getRows();`"*

**Expected:** A row showing `rev` column with `DOUBLE` type (the inference walked past the 8 leading nulls and picked up the number type from row 9).

**Bad-input test:**
> *"Use cw_scratchpad to run: `await otto.duckdb.registerDf('d', 42);`"*

**Expected:** `TypeError: registerDf: input must be a polars DataFrame, Arrow Table, or array of records`

**All-or-nothing on partial-failure test (Task F fixup):**
> *"Use cw_scratchpad to run: `const rows = Array(10).fill({n:1}).concat([{n:'not-a-number'}]); await otto.duckdb.registerDf('e', rows);`"*

**Expected:** Error message naming the failing column (`n`) and the failing row index (10 or 11 depending on 0/1-index), with the `opts.schema` hint. Then re-run with a clean batch using the SAME name:
> *"Use cw_scratchpad to run: `await otto.duckdb.registerDf('e', [{n:1},{n:2},{n:3}]); const c=await otto.duckdb.connect(); return (await c.runAndReadAll('SELECT SUM(n) FROM e')).getRows();`"*

**Expected:** `[[6]]` — proves the failed first attempt's partial table was rolled back (otherwise this would fail with `Table already exists`).

---

### Scenario 23 — Day-2 fresh `otto` restores via workspace pointer (full canonical RCA)

**Goal:** End-to-end exercise of the spec's canonical 3-day RCA scenario, post-1.5.

**Phase coverage:** 1.5 Task A, integration with Phase 1 cold-restart.

**Day 1:**
```
cd /some/git/repo
otto
/sp new p1-1234
# Ask Otto: "use cw_scratchpad to run globalThis.findings = ['issue A','issue B'] in p1-1234"
# Ask Otto: "use cw_scratchpad to run return globalThis.findings in p1-1234"
# (returns the array — state in memory)
/quit
```

**Day 2 (different terminal, same workspace, fresh shell — NO `--resume`):**
```
cd /some/git/repo
otto
```

**Expected restore notification on launch:**
```
attached to p1-1234 (from workspace, last used <relative>)
```

Then verify state survived cold-restart:
> *"Use cw_scratchpad to run `return globalThis.findings` in p1-1234"*

**Expected:** `['issue A', 'issue B']` — state restored from kernel.db + namespace.json on attach (no human re-attach needed; the workspace pointer drove the auto-attach, and Phase 1's cold-restart restored the in-VM state).

**Pass criterion:** Zero manual `/sp attach` between Day 1's `/quit` and Day 2's first cell exec.

---

### Scenario 24 — Stale workspace-pointer behavior (8-day boundary)

**Goal:** Confirm pointers older than 7 days are ignored (workspace-pointer staleness threshold).

**Phase coverage:** 1.5 Task A.

This is hard to test in real time. Two options:

**Option A — touch the file mtime backwards:**
```bash
# After Day 1's session creates the pointer:
HASH=$(ls ~/.otto/scratchpads/_workspaces/ | head -1)
PATH=~/.otto/scratchpads/_workspaces/$HASH
# Edit last_attached_at to 8 days ago:
python -c "
import json, datetime
p = '$PATH'
d = json.load(open(p))
d['last_attached_at'] = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=8)).isoformat().replace('+00:00','Z')
json.dump(d, open(p,'w'))
"
otto                              # fresh launch
```

**Expected:** No restore notification. `/sp list` shows the scratchpad as `○ cold` but does NOT show it as `(current)`.

**Option B — wait 8 real days.** (Not practical for testing but worth noting for production behavior.)

**Pass criterion:** stale pointers (> 7d) are silently ignored; no restore notification fires.

---

## Updated Phase coverage matrix (Phase 1.5)

| Scenario | Issue / Task | Pillar covered |
|---|---|---|
| 3 (re-verify) | #1 / Task F | otto.duckdb.registerDf cell-count drop |
| 9 (re-verify) | #6 / Task A | Workspace-pointer fallback restore |
| 16 (re-verify) | #66/#67 / Task B | Sidecar filename + GC |
| 17 (new) | #5 / Task C | /sp attach existence guard |
| 18 (new) | #4 / Task D | /sp list idle-age column |
| 19 (new) | #4 / Task D | /sp evict normal path |
| 20 (new) | #4 / Task D | /sp evict --force interrupt |
| 21 (new) | #2 / Task E | meta.json freshness |
| 22 (new) | #1 / Task F | registerDf direct API + opts.schema + all-or-nothing |
| 23 (new) | #6 / Task A | End-to-end canonical day-2 RCA |
| 24 (new) | #6 / Task A | Workspace-pointer staleness |

---

## Phase 1.5 sign-off checklist

Re-test these before tagging the v1.2.0 release:

- [ ] Scenario 3 (re-verify): polars→DuckDB completes in ≤ 2 cells
- [ ] Scenario 9 (re-verify): fresh `otto` restores via workspace pointer; cross-workspace isolation works
- [ ] Scenario 16 (re-verify): `_sessions/` swept clean on init
- [ ] Scenario 17 (new): typo errors helpfully; LLM tool path still auto-creates
- [ ] Scenario 18 (new): idle-age column renders `active` / `idle Xm` / `idle Xh` correctly
- [ ] Scenario 19 (new): normal evict cycle preserves on-disk state
- [ ] Scenario 20 (new): `--force` terminates active cells within seconds; no zombies
- [ ] Scenario 21 (new): meta.json reflects post-spawn state immediately
- [ ] Scenario 22 (new): registerDf direct test passes all five sub-tests (roundtrip, override, null-walk, bad input, all-or-nothing)
- [ ] Scenario 23 (new): end-to-end day-2 restore + state survives cold-restart
- [ ] Scenario 24 (new): stale (> 7d) pointers ignored

When all 11 boxes are checked, Phase 1.5 is verified end-to-end.

If you find a scenario that needs one of the above, log it for Phase 2 planning.
