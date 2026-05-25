# OTTO Analyst Capability — Design Spec

**Date:** 2026-05-24
**Status:** Design approved — pending spec review, then implementation plan
**Roadmap context:** `docs/dev/2026-05-24-anton-capabilities-otto-roadmap.md`
**Scope:** First shippable slice of the Anton-inspired "doing agent" capability.

---

## 1. Purpose & scope

Give OTTO the ability to **retrieve, analyze, and report on data locally** —
turning "OTTO wrote some code" into "OTTO delivered a dashboard." The target
audience is **administrators and project managers** (operational reports,
dashboards, metrics), **not** data scientists doing heavy ML.

This spec covers the **thin end-to-end vertical slice** that proves the whole
arc:

> A PM drops a CSV, asks for a dashboard in plain language, gets an interactive
> HTML dashboard saved where they can find it, and can resume the session the
> next day to keep iterating — with no coding repo and no command to memorize.

### In scope (MVP)
- **Persistent scratchpad kernel** — a stateful code-execution runtime (the keystone).
- **Typed deliverables** — `html-app`, `document`, `dataset`, saved to a
  discoverable location with provenance.
- **Local-file ingest** — CSV/Parquet/JSON/Excel → an in-process SQL engine (DuckDB).
- **Context-driven triggering** — always-on tools + an analyst skill; no required commands.
- **Session persistence & resume** — durable state on disk so resume/`/tree` work.
- **Non-blocking UX** — long analyses run in the background; the user keeps querying.

### Out of scope (each is a later spec→plan cycle)
- Credential vault + API/DB datasource pulls (URL/auth-gated ingest).
- KORE/OSCAR integration as a data source.
- Self-improving error-learning loop (cerebellum/ACC analogue).
- Executable skills (skills that carry runnable code) + auto-distillation.
- `image` / `mixed` / `fullstack` deliverable types.

### Non-negotiable invariant
**Durable state lives on disk** — the session's DuckDB file + the deliverable
folder. The execution kernel is a *recompute layer*, never the system of record.
This is what makes session resume and `/tree` work without special-casing.

### Licensing note
Anton (MindsDB) is **AGPL-3.0**. This is a concept port to TypeScript, not a code
port. No Anton source is vendored or copied. Keeps OTTO attribution clean.

---

## 2. Architecture

**Approach A (selected): one bundled extension**, `src/resources/extensions/analyst/`,
internally split into focused modules behind clear interfaces. Matches how OTTO
already bundles capabilities (`workflow`, `async-jobs`, `bg-shell`).

```
analyst/
├── index.ts                  default (pi: ExtensionAPI) → registers tools + skill
├── extension-manifest.json
├── runtime/                  code execution
│   ├── runtime.ts              ScratchpadRuntime interface (subprocess swap lives here later)
│   ├── worker-backend.ts       WorkerRuntime — host side, manages the worker_thread
│   └── worker-entry.ts         runs inside the worker; opens DuckDB, loads toolbox, injects helpers
├── ingest/
│   └── ingest.ts               local file → session DuckDB; schema introspection
├── deliverables/
│   ├── store.ts                metadata.json + provenance (zod-validated); README render
│   └── renderer.ts             extends export-html/ for html-app / document / dataset
├── skill/
│   └── SKILL.md                the analyst workflow (context-triggered)
└── tools/
    └── *.ts                    scratchpad, ingest, create_deliverable, list_deliverables
```

### Reused (not reimplemented)
| Need | Reuses |
|---|---|
| Background jobs + `/jobs` + cancel + notify | `async-jobs/job-manager.ts` (`AsyncJobManager`) |
| Execution safety gates | `execution-policy.ts` / `custom-execution-policy.ts` |
| Config paths + session co-location | `config.ts` (`getSessionsDir`; new `getDeliverablesDir`), `sessionFile` |
| Deliverable rendering base | `export-html/` (`tool-renderer.ts`, `template.*`) |
| Large tool-output truncation | `artifact-manager.ts` (unchanged — separate concern) |
| HTML→PDF | existing Playwright / headless-Chromium |

### Extension surface (`ExtensionAPI`)
- `registerTool` (`types.ts:1421`) — the LLM-callable tools (always-on, context-selected).
- `registerCommand` (`types.ts:1428`) — optional `/deliverables`, `/connect`-style shortcuts.
- `setActiveTools` (`types.ts:1523`) — optional gating so analyst tools stay dormant in pure-coding sessions.

---

## 3. End-to-end data flow

```
PM: "analyze ~/Downloads/q3_sales.csv and build me a dashboard"
        │  (context-triggered — no command typed)
        ▼
[analyst skill auto-loads the workflow guidance]
        ▼
ingest ───► DuckDB table in ~/.otto/agent/sessions/<id>/analysis.duckdb
        │     (reads CSV directly; returns schema + row sample)
        ▼
scratchpad ───► worker runs SQL/TS cells against the open DuckDB connection
        │        long cell? → AsyncJobManager → job ID; user keeps chatting
        │        (durable state = the .duckdb file, NOT worker memory)
        ▼
create_deliverable ───► ~/.otto/deliverables/<slug>/
        │                 dashboard.html (ECharts renders client-side from JSON)
        │                 metadata.json (+ provenance: session/turns)
        ▼
TUI surfaces it: open / reveal-in-Finder / export-to…
        ▼
[next day] otto --resume → DuckDB reattaches, deliverable re-opens,
           conversation replays → keep iterating
```

---

## 4. Component: scratchpad runtime

### Interface (the seam that makes worker-vs-subprocess a non-event)
```ts
interface ScratchpadRuntime {
  exec(cell: Cell, signal: AbortSignal): Promise<CellResult>;  // run code, capture output
  reset(): Promise<void>;     // restart process, clear in-memory state (DuckDB file survives)
  dispose(): Promise<void>;   // kill worker, free resources
  view(): Cell[];             // transcript of cells + outputs this session
}
type Cell = { code: string; lang: "sql" | "ts"; description: string; estMs: number; background?: boolean };
type CellResult = { stdout: string; tables?: TablePreview[]; error?: string };
```
`WorkerRuntime` is the only backend in the MVP. A `SubprocessRuntime` can
implement the same interface later (stronger isolation, IPC cost) without
touching callers.

**Runtime decision (deferred to planning):** default `worker_thread`; the
subprocess alternative lives behind this interface. `worker_thread` is the
documented default because it loads DuckDB/polars **native addons** directly and
keeps the Node event loop unblocked. `isolated-vm` was rejected: it cannot load
native addons inside the isolate, which is fatal given DuckDB is central.

### Cell lifecycle (one `scratchpad exec`)
1. Tool handler validates the cell (zod) and checks `execution-policy` — the same
   gate bash uses (deny dangerous FS/net ops).
2. **Foreground vs. background routing** keyed off `estMs`
   (`estimated_execution_time_seconds`, model-supplied):
   - `estMs ≤ ~5s` → run inline, return `CellResult` in the turn.
   - `estMs > ~5s` or `background: true` → register with `AsyncJobManager`, return
     a **job ID immediately**. User keeps querying; completion fires
     `ctx.ui.notify`; results pulled via the existing `await` / `/jobs` flow.
3. Worker executes against its **persistent context** — SQL cells on the open
   DuckDB connection, TS cells with the toolbox in scope. Variables/connections
   persist across cells within the session.
4. Output captured and truncated via existing helpers (large outputs spill to
   `ArtifactManager`); table results returned as compact `TablePreview`
   (shape + head).

### Worker context (`worker-entry.ts`) — pre-provisioned, no arbitrary runtime install
- **DuckDB** (native node addon), session `analysis.duckdb` opened — primary engine.
- **polars / arquero** (dataframe reshaping), **simple-statistics**, **fetch**.
- **Embedded helpers injected into scope** (the payoff of staying in-TS — no IPC
  bridge): `getLlm()` → OTTO's LLM client, `generateObject(schema, …)`,
  `sample(value)` (type-aware preview).

### Timeout & liveness (ported from Anton)
- Cell timeout `≈ 2 × estMs`. A `progress(msg)` callback resets an inactivity
  timer so long-but-live cells survive; silent cells past the inactivity window
  are aborted via the `AbortSignal`.

---

## 5. Component: ingest

- `ingest` tool — **local file paths only** in MVP. Loads each file into
  `analysis.duckdb` as a table named from the filename. DuckDB reads CSV/Parquet/
  JSON natively; Excel via the DuckDB excel extension.
- Returns **schema (columns + types) + row count + small sample** so the model
  reasons about real structure, not guesses.
- Idempotent: re-ingesting a name replaces the table.
- The kernel retains `fetch` for ad-hoc public/no-auth data, but the *ingest tool*
  stays file-scoped (auth-gated/remote sources need the deferred vault).

---

## 6. Component: deliverables

- `create_deliverable` claims `~/.otto/deliverables/<slug>/` and returns the path
  to write into; `list_deliverables` enumerates existing ones (newest first).
- **Location decision:** always the consistent per-user `~/.otto/deliverables/`
  (predictable for no-repo PMs), surfaced in the TUI. An **export-to…** action
  copies the folder anywhere the user wants — the escape hatch.
- **Types (MVP):** `html-app` (dashboard), `document` (report md, optional PDF),
  `dataset` (cleaned CSV/Parquet).
- **`metadata.json`** (zod-validated): `id, slug, name, description, type,
  primary` entry-point, `files[]`, **`provenance[]`** (session + turns that
  touched it — appended deterministically by snapshot-diffing the folder each
  turn). `README.md` auto-rendered from metadata.
- **Charts render client-side:** kernel writes a data JSON + a self-contained
  `dashboard.html` whose template **inlines ECharts** (default, swappable; inlined
  so the page works offline). No server-side plotting.
- **PDF** (document type): markdown → HTML → PDF via existing Playwright.
- **Renderer** extends `export-html/`: `html-app` → open self-contained page;
  `document` → open md/pdf; `dataset` → table preview + download.
- **TUI:** `/deliverables` command + model-callable `list_deliverables`, each with
  **open / reveal-in-Finder / export-to…**.

---

## 7. Triggering — context-driven, not command-gated

The goal: the PM describes an outcome and OTTO acts — no command to memorize.
This mirrors how Anton works (all tools exposed every turn + a system prompt that
makes reaching for them the default).

| Surface | Mechanism | Trigger | Carries |
|---|---|---|---|
| **Tools** | `registerTool` | Model calls by context, every turn | `scratchpad`, `ingest`, `create_deliverable`, `list_deliverables` |
| **Skill** | `SKILL.md`, advertised by description, invoked via Skill tool | **Auto-pulled when the ask matches** | The analyst *workflow* (ingest→DuckDB→compute→deliverable) |
| **Command** | `registerCommand` | User types `/…` | Optional `/deliverables` — discoverability + power users |

**Stance:**
- **Default = context-triggered.** Tools always-on; the analyst skill's
  description (*"retrieve, analyze, and report on data; build dashboards"*) is
  what the model matches to pull in the workflow. No command required.
- **Inline, not a subagent.** The tools + skill live in the **main session** so
  data + deliverable + conversation stay in one resumable, `/tree`-compatible
  session. A delegated subagent's isolated context would break the "resume and
  keep iterating" flow.
- **Reliability depends on the nudge.** Tool descriptions and the skill must
  explicitly cue *"use this whenever the user wants to analyze data"* — otherwise
  models sometimes answer from memory instead of computing. This is a content
  requirement, not just plumbing.
- **Optional gating** via `setActiveTools()` if analyst tools should stay dormant
  in pure-coding sessions.

---

## 8. Persistence & resume

- **Session JSONL** (existing) persists the conversation + the cell transcript
  (code + truncated output as tool results) → full context on resume.
- **DuckDB file** lives in the session dir → reattaches on resume (data intact).
- **Deliverable folder** in `~/.otto/deliverables/`, referenced by slug → re-opens.
- **On resume the kernel does NOT auto-re-run cells.** It reattaches DuckDB and
  reads the transcript for context. If a transient in-memory TS value is gone, the
  model recomputes that one cell — cheap and deterministic against persisted DuckDB.
- **`/tree` fork:** branching **copies** the session's DuckDB into the new session
  dir (copy-on-fork) so branches can't clobber each other's data. Acceptable for
  PM-scale data.

---

## 9. Error handling & safety

The SQL is **LLM-generated from prompts**, and ingested data can carry
prompt-injection. DuckDB is **not** a sandbox by default (raw SQL can read/write
files, reach the network via `httpfs`, install extensions, `ATTACH` databases),
so defense is at the **engine level**, not the `execution-policy` shell gate
(which understands bash commands, not SQL semantics, and would not catch any of
this):

- **Locked-down session engine:** the DuckDB instance that runs LLM cells is
  created with `enable_external_access=false`, `allow_community_extensions=false`,
  `allow_unsigned_extensions=false`, `lock_configuration=true` (SQL can't
  re-enable), plus `memory_limit`/`threads`/`max_temp_directory_size`. This
  neutralizes file/network/extension/attach at the engine — no blocklist to
  bypass.
- **Isolated privileged ingest:** because `enable_external_access` is fixed at
  instance creation, file reading happens in a **separate short-lived in-memory
  instance** (external access on) that runs **only our fixed reader** on a
  **validated path** — never LLM SQL. Rows are bulk-loaded into the locked
  session instance through JS, so the cell-running engine never touches the
  filesystem.
- **Path policy (both controls):** `classifyIngestPath()` rejects remote-looking
  paths (`://`) and non-files, **allows** files within allowed roots (cwd +
  configured data dirs), and **requires user confirmation** (`ctx.ui.confirm`)
  for files outside them. Fails closed (no UI → declined).
- **Timeout + interrupt:** cells honor an `AbortSignal` and a hard per-cell
  timeout via `connection.interrupt()` (best-effort; hard kill arrives with the
  deferred worker backend). Background jobs cancellable via `cancel_job` / `/jobs`.
- **SQL errors as results:** a failing cell returns `CellResult.error` rather than
  throwing, so the model can self-correct.
- **Deliverable integrity:** `metadata.json` is typebox-validated on read; a
  corrupt record raises on load rather than round-tripping bad data.
- **Secrets:** none required for the MVP (local files only). When the vault lands
  (deferred), adopt Anton's pattern — secrets injected as env vars, never into
  code the model sees.

> **Alignment with Anton:** Anton runs arbitrary Python in a venv with **no**
> capability sandbox (relying on env isolation + an optional OS firewall +
> credential vault). For the SQL MVP, OTTO is **stronger** on capability lockdown.
> Two deferred parity items: the credential vault, and worker-level isolation when
> TS cells arrive (which re-introduce Anton's arbitrary-code threat model).

---

## 10. Testing strategy

- **Runtime unit tests:** cell exec, state persistence across cells, `reset()`
  clears memory but preserves the DuckDB file, timeout/abort, worker-crash
  recovery. Mirror the existing `async-jobs` test style.
- **Foreground/background routing:** `estMs` threshold routes correctly; job ID
  returned immediately; completion notifies; cancel works.
- **Ingest:** CSV/Parquet/JSON/Excel load; schema + sample correct; idempotent
  replace; failure paths.
- **Deliverables:** folder claim + slug collision handling; `metadata.json`
  zod round-trip; provenance appended per touching turn; renderer picks the right
  affordance per type.
- **Persistence/resume (integration):** create session → ingest → compute →
  deliverable → simulate restart → DuckDB reattaches, deliverable re-opens,
  transcript present. Fork copies DuckDB.
- **Triggering (integration):** a plain-language data request selects the analyst
  tools without a command; skill auto-loads on a matching ask.
- **Golden-path manual check:** the canonical PM demo end-to-end in a real TUI,
  launched from a non-repo directory.

---

## 11. Open decisions for planning

1. **Final runtime backend** — confirm `worker_thread` vs. `subprocess`. Default
   documented as `worker_thread`; both sit behind `ScratchpadRuntime`.
2. **DuckDB distribution** — native node addon vs. wasm (addon assumed for the
   worker path; revisit if packaging/portability bites).
3. **Charting library** — ECharts default; confirm vs. Observable Plot/Vega-Lite.
4. **Background routing threshold** — the `~5s` cutoff is a starting value to tune.

## 12. Success criteria

- From a non-repo directory, a PM can ingest a local CSV, request a dashboard in
  plain language (no command), and receive an interactive `html-app` in
  `~/.otto/deliverables/` they can open/reveal/export.
- A long analysis runs in the background; the user issues other queries while it
  runs and is notified on completion.
- Closing and resuming the session preserves the data and the deliverable; the
  user continues iterating.
- The capability registers as a bundled extension and feels native — same tool
  registry, session, and resume machinery as built-in tools.
