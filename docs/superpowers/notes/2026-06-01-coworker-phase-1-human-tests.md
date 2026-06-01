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

```
/sp attach t03-datalibs
```

Confirm: ask **"Use cw_scratchpad to return `globalThis` keys"** (or similar) — should return whatever's persisted.

Exit Otto (Ctrl+D or `/exit`). In a new shell, launch Otto from the same workspace. On startup, you should see:

```
attached to t03-datalibs (restored)
```

If there were unseen recovery notes, you'll also see:
```
⚠ N unread recovery notes: ...
```

Then ask: **"Use cw_scratchpad to return the polars DataFrame column names from before"** — should work without re-loading because namespace.json + kernel.db were restored.

**Disk check:**
```bash
cat ~/.otto/scratchpads/_sessions/<your-new-session-id>.json
# Should contain { schema_version: 1, session_id: ..., current_name: "t03-datalibs", attached_at: ... }
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
- **`_sessions/` GC sweep** — sidecars accumulate; not auto-cleaned.

If you find a scenario that needs one of the above, log it for Phase 2 planning.
