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
