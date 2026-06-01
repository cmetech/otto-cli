# Otto Co-worker Scratchpad — Phase 1 Known Issues

Issues observed during Phase 1 human testing that are NOT regressions and NOT blocking but worth capturing for future-phase discussion + resolution.

Each issue follows the same template so it can be triaged later.

---

## Issue 1 — polars → DuckDB registration is non-ergonomic

**Status:** open
**Severity:** medium (work completes correctly, but with painful cell-count blow-up)
**Date observed:** 2026-06-01
**Reporter:** scenario 3 of `2026-06-01-coworker-phase-1-human-tests.md`

### Reproduction

```
/sp new tNN
```

Then ask Otto:

1. "Load /tmp/sales.csv into a polars DataFrame, then return the column names and row count."
2. "Use otto.duckdb to register that DataFrame as a SQL table and return the sum of revenue."

Sample CSV:
```
region,units,revenue
north,42,1200
south,17,580
east,93,2890
west,8,210
```

### Symptoms

- The final answer (sum = 4880) is correct.
- BUT: the LLM burns **8 cells** to get there:
  1. Load CSV → polars DataFrame (1 cell, fine).
  2. Try `conn.register(df)` → **`TypeError: conn.register is not a function`**.
  3-7. Five cells of API discovery: inspecting `DuckDBConnection` prototype, the `otto.duckdb` wrapper, the polars DataFrame's keys, the column Arrow buffers, the Series prototype for iteration helpers.
  8. Finally: actual SQL aggregation.
- Total: 6 cells of API exploration + 1 cell of actual work + 1 cell that errored. For a one-line SQL aggregation.

### Root cause

`@duckdb/node-api` (the package pre-bound at `otto.duckdb` per Phase 1d2) has a different `DuckDBConnection` surface than the more popular DuckDB bindings:

- **What the LLM expected**, based on training data heavily weighted toward `duckdb-wasm` / `node-duckdb` / Python `duckdb`:
  ```ts
  conn.register('sales', df)
  await conn.query('SELECT SUM(revenue) FROM sales')
  ```
- **What `@duckdb/node-api` actually offers**: `run`, `runAndRead`, `runAndReadAll`, `stream`, `prepare`, `createAppender`, `getTableNames`, `registerScalarFunction`. No `register(name, df)`.

The result: LLM's first attempt always fails, then it has to discover the API empirically. Even after discovery, the only way to get a polars DataFrame into DuckDB is `createAppender` row-by-row, OR write to a temp file and `read_csv_auto`, OR extract Arrow buffers and reconstruct via SQL. None of these are 1-line solutions.

### Workarounds (today)

1. **polars-native SQL** — polars itself has SQL support via `df.sql('SELECT SUM(revenue) FROM self')`. Avoids DuckDB entirely for this case.
2. **Write to temp file** — `df.writeCSV('/tmp/x.csv')` then `CREATE TABLE x AS SELECT * FROM read_csv_auto('/tmp/x.csv')`.
3. **Explicit appender** — create the table with `CREATE TABLE x (region VARCHAR, units INT, revenue DOUBLE)`, then `createAppender('x')` and append rows.

None are obvious to the LLM without documentation or trial-and-error.

### Proposed fixes (for Phase 2+ discussion)

1. **Add an `otto.duckdb.registerDf(name, df)` helper** in `packages/coworker-scratchpad/src/kernel-bindings.ts`. Detect input type (polars DataFrame / Arrow Table / plain object / array of records) and route to the appropriate DuckDB load path. Most ergonomic; matches conventional bindings.

2. **Document the constraint in `cw_scratchpad`'s `promptGuidelines`.** Add a bullet like:
   > "`otto.duckdb`'s connection (from @duckdb/node-api) does NOT have a `register(df)` method. To query a polars DataFrame in SQL, use polars's own SQL via `df.sql('SELECT SUM(revenue) FROM self')`, OR write to a temp CSV and `read_csv_auto`."

   Lowest-risk fix. Wouldn't help if the user wants a real DuckDB table (with indexes, persistence across cells), but would prevent the 8-cell exploration for the common case.

3. **Evaluate switching to the `duckdb` npm package** (the older, conventional binding) which has `register()`. Tradeoff: that binding is slower, less actively maintained, and uses a different async model. May regress other things.

4. **Combination: fix #2 now + fix #1 later.** Document the constraint as a stopgap; add `registerDf` helper in a Phase 2+ polish wave.

### Phase placement

Not blocking Phase 1 (the system works, just verbosely). Candidate for:
- **Phase 1.5 polish** — small `kernel-bindings.ts` enhancement, 1–2 days of work.
- **Phase 2** — could ride alongside the vault work if the same engineer is in that area.
- **Phase 3+** — if the analyst persona authoring (Phase 6) needs cleaner polars↔DuckDB ergonomics, it gets prioritized then.

### Test that would lock the fix

Once `otto.duckdb.registerDf(name, df)` exists, scenario 3 should resolve in **2 cells**:
1. Load CSV → DataFrame.
2. `otto.duckdb.registerDf('sales', df); const c = await otto.duckdb.connect(); return (await c.runAndReadAll('SELECT SUM(revenue) FROM sales')).getRows();`

Verified by: rerunning scenario 3 and checking `wc -l cells.jsonl` returns 3 (header + 2 cells).

---

## Issue 2 — `meta.json` lags the runtime on fresh attach (kernel_db.present, size_bytes both stale)

**Status:** open
**Severity:** low (self-correcting on first cell exec; cosmetic until then)
**Date observed:** 2026-06-01 (scenario 1 disk inspection)
**Reporter:** Phase 1g3 testing

### Reproduction

```
/sp new tNN
```

Without running any cell:
```bash
cat ~/.otto/scratchpads/tNN/meta.json
ls -la ~/.otto/scratchpads/tNN/
```

### Symptoms

- `meta.json` shows:
  ```json
  "size_bytes": 0,
  "kernel_db": { "present": false, "path": "kernel.db" }
  ```
- BUT `ls` shows `kernel.db` IS on disk (~12k).

### Root cause

`attachUnmanaged` in `scratchpad-manager.ts` calls `this.writeMeta(name)` BEFORE `this.spawnRuntime(name)`. At write time, the kernel hasn't started yet → `kernel.db` doesn't exist → `existsSync` returns false → `payloadSize` returns 0.

The next call to `writeMeta` (which happens on the first `runCell`) re-evaluates both fields and they become correct.

### Workaround

Run any cell. Meta heals on the next write.

### Proposed fix (for Phase 2+ discussion)

Reorder `attachUnmanaged` to `spawnRuntime` BEFORE `writeMeta`, so the initial meta reflects post-spawn disk state. Subtle gotcha: `writeMeta` is also called for the LOCK side-effect early in the flow. Restructuring may require splitting "create dir + acquire lock" from "snapshot disk state for meta."

Alternative: add a final `writeMeta` call at the end of `attachUnmanaged` after `spawnRuntime` succeeds. Two writes instead of one; cheap (meta is small).

### Phase placement

Phase 1.5 polish; non-blocking.

---

## Issue 3 — LLM "ask if unsure" path is not reliable

**Status:** known + accepted as inherent LLM behavior
**Severity:** low (acceptable in current trigger model; documented)
**Date observed:** 2026-06-01 (scenario 1 of human tests)

### Reproduction

Ask Otto a borderline-data prompt that doesn't clearly fit USE or SKIP criteria, e.g.: *"Compute the standard deviation of these 50 numbers: …"*

### Symptoms

The `cw_scratchpad` tool description and promptGuidelines tell the LLM to ASK the user before deciding when unsure. In practice, the LLM tends to pick a side (answer inline OR call the tool) confidently rather than asking, ~60-70% of the time.

### Root cause

LLMs are heavily trained to be helpful *immediately*. The "ask before acting" pattern competes against both "just answer" and "just call the tool" instincts. A single guideline bullet saying "ASK if unsure" lands somewhere between 30-40% of the time.

This is not a bug — it's an inherent statistical property of LLM behavior. The escape hatches in the design (explicit "use cw_scratchpad" or "answer inline" from the user) cover the cases where the LLM picks wrong.

### Workaround (today)

If the LLM picks wrong, the user redirects with explicit phrasing:
- "Use cw_scratchpad to compute that" → forces tool use
- "Just answer in chat, don't use the scratchpad" → forces inline

### Proposed fixes (for Phase 2+ discussion, if desired)

1. **Drop the ASK pattern.** Accept the binary "auto-trigger or inline" outcome; rely on the escape hatches. Simpler doc; matches behavior.
2. **Lower the bar for "unsure"** — make MORE requests trigger the ASK path (e.g. any request with >5 data values). More predictable but adds friction.
3. **Make ASK the default for any data-shaped prompt** — flip the convention; aggressive but predictable.

### Phase placement

Not a Phase 2 fix. Either accept as-is or revisit in Phase 6 (persona polish) when curating NOC user UX expectations.

---

## Issue 4 — Pool eviction is invisible; no explicit eviction control

**Status:** open
**Severity:** medium (UX clarity; functional behavior is correct)
**Date observed:** 2026-06-01 (scenario 5 of human tests)
**Reporter:** Phase 1g3 testing

### Reproduction

```
/sp new t04-tree
# ... run a cell ...
/sp new t05-fork-copy   (or /sp attach t05-fork-copy)
/sp list
```

### Symptoms

`/sp list` shows TWO scratchpads as `● live`:
```
○ cold  t01-triggers
● live  t04-tree
● live  t05-fork-copy (current)
```

Only `t05-fork-copy` has `(current)`, but t04-tree's `● live` marker is visually surprising — users expect `/sp attach <new>` to release the previous kernel.

### Root cause

The 1c2 design has a kernel pool with two dimensions:
- **`currentName`** (slash-command pointer) — moves on every `/sp attach`.
- **Pool warmth** — kernels stay live until LRU eviction (`maxLiveKernels = 8`) or idle eviction (`idleMs = 600_000` = 10min, swept every `sweepIntervalMs = 30_000` = 30s).

`/sp attach <new>` only moves the pointer; the previous kernel sits warm in the pool. `/sp detach` is also affinity-only — does not dispose the runtime (1g locked decision 4).

**This is by design** (see spec § 3 — "switch-back speed", "multi-session safety", "memory bounded"). But two gaps:

1. **No visibility into eviction timing.** Users can't tell if a `● live` kernel is about to evict (idle 9m59s) or just attached (idle 0s). Looks the same in `/sp list`.
2. **No explicit-eviction control.** Users who WANT to dispose a warm kernel immediately (free RAM, release lock for another session) have no command. Only options are: wait 10 minutes, kill all 8 by attaching to a 9th (LRU pressure), or `/sp remove` (destructive — deletes the dir).

### Workaround (today)

- Wait. After 10 minutes of idleness, the kernel auto-evicts; `/sp list` shows it as `○ cold`.
- If you want to "free" t04-tree NOW: nothing user-facing works without losing data. The kernel will eventually evict on its own.

### Proposed fixes

**Both fixes together** — they're the same conceptual feature (make pool state visible + controllable):

1. **Show idle age in `/sp list`** for live entries:
   ```
   ○ cold  t01-triggers
   ● live  t04-tree            idle 4m22s
   ● live  t05-fork-copy       active  (current)
   ```
   - `active` = entry has been used in the last 30s (or has an active cell).
   - `idle 4m22s` = time since `lastUsedAt`; previews how close to the 10min eviction threshold.

   Implementation: extend the slash-command's `case 'list':` formatter in `src/resources/extensions/coworker-scratchpad/sp-command.ts` to format `(now - entry.lastUsedAt)` relatively. Manager already exposes `lastUsedAt` via the `ScratchpadInfo` return from `manager.list()`.

2. **Add `/sp evict <name>`** slash command + matching `manager.evict(name)` method:
   - Refuses to evict if entry has an active cell (error: "cannot evict while a cell is running").
   - Otherwise reuses the existing `snapshotThenDispose` path — snapshots namespace.json, disposes the runtime, but **keeps the lock + meta + cells.jsonl intact** (so re-attach works).
   - Does NOT remove the dir (that's `/sp remove`'s job).
   - Output: `evicted t04-tree (still on disk; /sp attach t04-tree to re-warm)`.

   Implementation: ~30 lines in `scratchpad-manager.ts` (new `evict()` method wrapping `snapshotThenDispose`), one new verb in sp-command.ts, ~3 tests in `scratchpad-manager.test.ts` + sp-command tests.

### Test that would lock the fix

After the fix:
1. Run scenario 5 as-is. Verify `/sp list` shows `idle 0s` (or `active`) on t05-fork-copy, and a small idle time (depending on test pacing) on t04-tree.
2. Run `/sp evict t04-tree`. Verify `/sp list` flips t04-tree to `○ cold` immediately. Verify `~/.otto/scratchpads/t04-tree/kernel.db` still exists.
3. `/sp attach t04-tree` should warm-restart from namespace.json + cells.jsonl with full state intact (already covered by 1d2 cold→warm tests).

### Phase placement

**Recommended: a dedicated "Phase 1.5 — polish" wave** bundling all currently-open Phase 1 known issues into one focused PR before Phase 2 starts.

Rationale:
- None of these issues fit naturally into Phases 2–6 (which add new pillars: vault / memory / artifacts / persona). Forcing them into a pillar phase would create thematic drift.
- Phase 1 is the foundation everything else builds on; rough edges compound — if Phase 2 builds vault and a NOC user hits Issue 4 alongside a vault prompt, they'll attribute the friction to vault.
- Bundling these together is ~3-5 days of work for a single engineer:
  - **Issue 1** (polars→DuckDB ergonomics — registerDf helper): ~1-2 days
  - **Issue 2** (meta.json write-order fix): ~half day
  - **Issue 4** (idle-age display + /sp evict): ~1-2 days
  - Plus tests + docs update: ~half day
- Phase 1.5 keeps Phase 2's scope clean.

**Alternative:** if a Phase 1.5 isn't formed, defer Issue 4 specifically to Phase 6 (NOC persona bundle) where UX clarity for analysts is the focus — the visible idle-age in `/sp list` is exactly the kind of thing a NOC analyst cares about during a long incident.

**NOT recommended:** spreading these across Phases 2-5. The engineer doing vault shouldn't have to context-switch into scratchpad internals; it's coherent work but not coherent ownership.

---

## Issue 5 — `/sp attach <name>` silently auto-creates non-existent scratchpads

**Status:** open
**Severity:** medium (silent foot-gun on typos)
**Date observed:** 2026-06-01
**Reporter:** Phase 1 user testing

### Reproduction

```
/sp list
  ● live  t02-basics (current)
  ○ cold  t04-tree

/sp attach t02-basix       # typo — meant "basics"
attached to scratchpad: t02-basix

/sp list
  ○ cold  t02-basics
  ○ cold  t04-tree
  ● live  t02-basix (current)   ← phantom scratchpad created silently
```

### Symptoms

`/sp attach <name>` where `<name>` doesn't exist on disk does NOT error. Instead it silently:
1. Creates the scratchpad directory `~/.otto/scratchpads/<name>/`.
2. Acquires the lock.
3. Writes meta.json.
4. Spawns a fresh kernel.
5. Marks the new scratchpad as `(current)`.

The user gets a green "attached" notification with no signal that they just created a new empty scratchpad instead of attaching to the one they intended.

### Root cause

`case 'attach':` in `src/resources/extensions/coworker-scratchpad/sp-command.ts` calls `manager.getOrAttach(name)` directly. The library method is intentionally permissive — when the name is unknown, it falls through to `attachUnmanaged` which creates the dir + lock + meta + kernel from scratch.

The library's permissive behavior is **correct** for the LLM tool path (`cw_scratchpad action=exec`) — when the LLM passes `name: 'p1'` referring to a scratchpad it expects to exist, we want it to "just work" rather than error.

But the slash command was wired to the same library method without adding a stricter mode. The result: `/sp attach` and `/sp new` are functionally equivalent when the name doesn't exist; they only differ when it does (`/sp new` errors, `/sp attach` succeeds).

### Why it matters

This is exactly the kind of bug a tired NOC analyst hits at 2am during an incident: they type the wrong scratchpad name (`t02-basix` instead of `t02-basics`), silently land in a fresh empty kernel, and can't figure out why yesterday's polars DataFrames aren't there. The fix is to discover their typo via `/sp list` — but by then they've spawned a phantom scratchpad they have to clean up.

The spec is silent on this (§5 just says "switch the user-current attachment to <name>"). The canonical 3-day RCA scenario always shows a scratchpad being `/sp new`'d on day 1 before being `/sp attach`'d on later days — the spec assumes attach-existing semantics.

### Workaround (today)

- Always run `/sp list` before `/sp attach` to confirm the name is what you think.
- If you do typo-attach a phantom scratchpad, clean up with `/sp remove <name> --yes`.

### Proposed fix

Tighten `case 'attach':` in `sp-command.ts` to verify on-disk existence first, error with a helpful suggestion if missing:

```ts
case 'attach': {
  if (!name) {
    ctx.ui.notify('Usage: /sp attach <name> [--force-takeover] [--reason "<text>"]', 'error');
    return;
  }
  validateName(name);
  const metaPath = join(deps.rootDir(), name, 'meta.json');
  if (!existsSync(metaPath)) {
    ctx.ui.notify(
      `scratchpad not found: ${name}. Use /sp new ${name} to create it.`,
      'error',
    );
    return;
  }
  // ... existing force-takeover + getOrAttach + sidecar flow (unchanged)
}
```

Semantics after the fix:

| Verb | Behavior |
|---|---|
| `/sp new <name>` | Error if exists; create otherwise. ← unchanged |
| `/sp attach <name>` | **Error if NOT exists** with helpful suggestion; attach otherwise. ← NEW |
| LLM tool `cw_scratchpad` exec | Auto-create — `getOrAttach` permissive. ← unchanged |

The LLM tool path is unaffected because it bypasses the slash command and calls `manager.getOrAttach` directly via `scratchpad-tool.ts`.

### Test that would lock the fix

1. `/sp attach not-a-real-name` → notifies error "scratchpad not found: not-a-real-name. Use /sp new not-a-real-name to create it." No dir created on disk; no kernel spawned.
2. `/sp new foo` then `/sp attach foo` → still works (foo exists on disk).
3. `cw_scratchpad action=exec name=phantom code='return 1'` (via LLM tool path) → still auto-creates `phantom` because the library is unchanged.

### Phase placement

**Phase 1.5 polish wave.** Tiny fix (~4 lines + 2 tests). Bundles naturally with Issues 1, 2, 4 — all are scratchpad UX/ergonomics fixes that share an engineer's focus.

Estimated effort: ~0.5 days including tests.

---

## Issue 6 — Fresh Otto launch doesn't auto-restore workspace's last-attached scratchpad

**Status:** open (design question — not a bug)
**Severity:** medium (real UX gap for the canonical 3-day RCA scenario)
**Date observed:** 2026-06-01 (scenario 9 of human tests)
**Reporter:** Phase 1g testing

### Reproduction

```
# Terminal A
otto                              # fresh launch
/sp attach t03-datalibs
# do some work, persist state
/quit

# Terminal B (same workspace, some time later)
otto                              # fresh launch — NOT --resume
# Expected (per spec's day-2 scenario):
#   "attached to t03-datalibs (restored)"
# Actual:
#   no restore notification
/sp list
#   ○ cold  t03-datalibs           ← exists but not current
#   ○ cold  ...                    ← nothing marked (current)
```

### Symptoms

Each `otto` launch creates a new session file (e.g. `2026-06-01T19-27-55-414Z_<uuid>.jsonl`), which becomes the sessionId. The 1g sidecar at `~/.otto/scratchpads/_sessions/<sessionId>.json` is keyed by that sessionId. A fresh launch produces a fresh sessionId → no sidecar matches → no restore.

To trigger restore today, the user must:
- Launch with `otto --resume` (TUI picker) and select the prior session, OR
- Run `/resume` inside a running Otto and pick.

### Why it matters

The canonical 3-day RCA scenario in the spec (§ 4) describes the user as:

> "Day 2 (Tuesday 2pm, different terminal): User `otto` → attaches to `default` → `/sp attach p1-1234`. Kernel state restored from `kernel.db` + `namespace.json`."

The spec's UX expectation is: typing `otto` in the morning brings you back to yesterday's work. The current implementation requires the user to know about `--resume` and use the picker. NOC analysts who type `otto` from muscle memory don't get continuity unless they remember to type `otto --resume` instead — and the canonical scenario doesn't tell them to.

This is a foot-gun specifically for the headline use case the entire roadmap is designed around.

### Root cause

Two design decisions compound:
1. **Otto's session model** generates a fresh session file on every launch unless `--resume` is passed. (Outside the coworker spec; pre-existing behavior.)
2. **The 1g sidecar** is keyed by sessionId, not by workspace. Each session gets its own affinity record.

Neither is wrong on its own. The gap is between them: the user's mental model is "the scratchpad is for this workspace, I should pick up where I left off" but the implementation says "each session is independent, attach is per-session."

### Workaround (today)

- Always launch with `otto --resume` if you want continuity.
- Or after fresh launch, type `/resume` and pick.

### Proposed fixes (for design discussion)

**Option A — Add a workspace-level sidecar.** Alongside the per-sessionId sidecar, write a workspace-keyed pointer: `~/.otto/scratchpads/_workspaces/<workspace-hash>.json` with `{ last_session_id, last_current_name, last_attached_at }`. On `session_start` for any new session, check the workspace pointer FIRST; if recent (e.g. within 24h) and the named scratchpad still exists, restore it with a notification like `attached to t03-datalibs (from workspace, last used 14h ago)`.

Tradeoffs:
- ✅ Matches the spec's UX expectation (typing `otto` resumes you).
- ✅ Decouples coworker affinity from Otto's session model (no Otto-core changes needed).
- ✅ Stale-cleanup is easy: a workspace pointer older than N days just doesn't fire.
- ❌ Adds another file format. Per-session sidecars still exist for the explicit `/resume` path.
- ❌ Disambiguation: which workspace? Hashing workspace CWD is straightforward but cross-machine workspaces (e.g. via cloud sync) could collide.

**Option B — Otto-core change: persist the "last session" in a workspace-anchored pointer that fresh launches consult.** Same idea as A but at the Otto framework level, generalizing beyond just coworker affinity. Bigger blast radius, but resumes more than just scratchpad state.

**Option C — Document the gap, don't fix.** Educate users to type `otto --resume` (or `otto -r`) routinely. Eventually update the canonical scenario in the spec to reflect this. Cheapest but the spec's UX expectation goes unmet for the headline workflow.

**Option D — Add a `--continue` / `-c` shortcut.** Same as `--resume` but auto-picks the most recent session in the workspace, no picker. Compromise between "fresh launch" and "explicit resume." Doesn't help users who type just `otto`.

### Recommendation

**Option A — workspace-level sidecar.** Cleanest fit:
- Scoped to coworker (no Otto-core changes).
- Honors the spec's day-2 UX expectation.
- Per-session sidecars still cover the explicit `/resume` flow (multi-session, explicit history).
- ~1 day of work: write helper + read-at-session_start logic + 2-3 tests.

The new pointer at `~/.otto/scratchpads/_workspaces/<hash>.json` (where `<hash>` = first 16 chars of `sha256(absolute-workspace-path)`) records `{ last_session_id, last_current_name, last_attached_at }` on every `/sp attach` / `/sp new` (alongside the existing per-session sidecar write). On session_start, the new restore order is:

1. Per-session sidecar match (existing behavior, for `--resume` path).
2. **NEW:** workspace pointer match (if no per-session match and pointer is within e.g. 7 days).
3. No restore (fresh start).

### Phase placement

**Phase 1.5 polish wave.** Higher priority than the other Phase 1.5 issues because it directly affects the headline use case. Estimated effort: ~1 day including tests + docs.

Updated Phase 1.5 bundle (with Issue 6): ~6 days single-engineer total (Issues 1, 2, 4, 5, 6).

If Phase 1.5 isn't formed, this should be the FIRST polish item picked up at the earliest opportunity — every day this is open is a day the canonical scenario doesn't actually work as the spec describes.

---

## Template for new issues

When you hit something during testing, append a new section with this shape:

```markdown
## Issue N — <short title>

**Status:** open | accepted | fixed in <commit>
**Severity:** low | medium | high
**Date observed:** YYYY-MM-DD
**Reporter:** <scenario / context>

### Reproduction
<steps>

### Symptoms
<what you saw>

### Root cause
<technical analysis>

### Workaround
<how to work around it today>

### Proposed fixes
1. <option 1>
2. <option 2>
3. <option 3>

### Phase placement
<which future phase this belongs in, or "polish backlog">
```

When the parent spec gets revised or Phase 2 planning starts, walk this file end-to-end and either:
- Promote the issue into a phase scope, OR
- Close it as "accepted as-is" with a rationale, OR
- Reclassify severity.
