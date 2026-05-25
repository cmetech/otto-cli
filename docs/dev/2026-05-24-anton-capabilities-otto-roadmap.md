# Anton Capabilities → OTTO Roadmap

**Date:** 2026-05-24
**Status:** Exploratory — captured for planning, not yet committed
**Author:** review of `../anton` (MindsDB, AGPL-3.0) vs OTTO/pi-dev

## Purpose

Anton (`mindshub.ai/agents/anton`) is a **"doing agent"**: you describe an
outcome — a cleaned inbox, a live dashboard, a working integration — and it
writes whatever code is needed to deliver it. OTTO today is a **coding agent**:
code for a codebase is the product.

We want to move OTTO toward Anton's "doing" capability **once the coding/OS skill
foundation is solid**. This doc captures *what Anton accomplishes* and sketches
how each capability lands on pi-dev. Anton is Python; OTTO is TypeScript — so
these are **concept ports, not code ports** — and the target is a **TypeScript-native**
implementation, not a Python runtime. The data-analysis audience is
**administrators and project managers** (reports, dashboards, operational
metrics), **not** data scientists doing heavy ML — which is exactly the workload
a TS + in-process-SQL stack handles well, so Python is not required (it survives
only as an optional escape hatch; see footnote in #1).

> **Licensing.** Anton is **AGPL-3.0**. Treat everything here as inspiration.
> Reimplement natively in pi-dev. Do **not** vendor or copy Anton source. (This
> also keeps OTTO's attribution clean per the brand stance.)

---

## The structural idea worth stealing

> Anton: *"It doesn't need a huge collection of separate tools for web, DB, files.
> Most work is done through one core harness — the execution scratchpad — which
> dynamically becomes whatever Anton needs."*

OTTO has many discrete tools (`bash`, `edit`, `find`, `grep`, `read`, `write`,
browser, search). Anton funnels most work through **one persistent Python kernel**
plus an **output layer** (artifacts) and a **memory layer** around it. That's the
difference between "ran some commands" and "delivered a dashboard." The roadmap
below adds that harness + output layer *on top of* OTTO's existing tools — it does
not replace them.

---

## Capability inventory

| Capability | OTTO today | Anton | Gap |
|---|---|---|---|
| Multi-provider LLM | ✅ Strong (Anthropic/OpenAI/Bedrock/Gemini/Mistral/OpenRouter/Groq/Ollama) | OpenAI-compat + Anthropic | OTTO ahead |
| MCP client + server | ✅ Strong | ❌ None | OTTO ahead |
| Memory w/ FTS + consolidation | ✅ `memory-store.ts`, consolidation-scanner, captures | Markdown files (rules/lessons/profile/topics) | OTTO ahead on storage |
| Skills / agents / slash-commands | ✅ 40+ skills, subagents, namespaced registry | Skills (declarative+code) | Different shape (see #5) |
| Code/shell execution | ⚠️ `exec-sandbox.ts` — one-shot subprocess | **Persistent stateful kernel** | **Gap (#1)** |
| User-facing artifacts/rendering | ⚠️ `artifact-manager.ts` — session output truncation only | **Typed deliverables + provenance + renderer** | **Gap (#2)** |
| Local data analysis + secret vault | ⚠️ env vars + MCP; no local SQL engine | **`/connect` + registry + vault** | **Gap (#3) — local-first** |
| Self-improving error-learning | ⚠️ memory exists, no exec→lesson loop | **Cerebellum / ACC / consolidator** | **Gap (#4)** |
| Vision-from-disk | ⚠️ image processing utils | `read_image` → vision turn input | Minor (#5b) |

---

## The five capabilities, with TS integration sketches

### 1. Persistent execution scratchpad — the keystone

**What Anton accomplishes.** A notebook-style kernel where **variables, imports,
and data persist across cells**. The model drives it cell-by-cell: scrape prices
in one cell, compute in the next, render in a third — without re-fetching or
re-deriving. Each cell auto-installs its declared packages, and the kernel exposes
embedded helpers so the model can do AI work *inside* the sandbox.

**Anton source (concepts, not to copy):**
- Tool surface: `anton/core/tools/tool_defs.py:27` — actions `exec|view|reset|remove|dump|install`; per-cell `packages[]`, `estimated_execution_time_seconds`, inactivity timeout + `progress()` heartbeat.
- Backend contract: `anton/core/backends/base.py` — `ScratchpadRuntime` ABC, `Cell` dataclass, Local vs Remote backends behind one interface.
- State persistence: `anton/core/backends/scratchpad_boot.py` — `dill`-pickled namespace persisted across cells; `CELL_DELIM`/`RESULT_START/END` wire protocol.
- Embedded helpers: `get_llm()`, `llm.complete()`, `llm.generate_object(Model,...)`, `agentic_loop(tools=, handle_tool=)`, `sample(var)` (type-aware preview).

**Why it's the keystone.** Artifacts (#2) and datasource work (#3) both *ride on*
this. Without persistent state, every "build me a dashboard from this data" turn
re-runs from scratch.

**OTTO integration sketch (TS-native):**
- New tool `createScratchpadTool` following the factory pattern in
  `packages/pi-coding-agent/src/core/tools/index.ts` (alongside `createBashTool`).
- **Runtime = TS-native kernel, not a Python subprocess.** Define a
  `ScratchpadRuntime` interface (mirror Anton's ABC) with a **`LocalTsRuntime`**
  as the default backend, built on **`isolated-vm`** — a persistent V8 isolate
  that survives across cells, enforces memory caps, and is killable on timeout.
  In-process `vm`/`eval` is **not** a security boundary and must not be used.
- **A pure-TS kernel removes the IPC bridge the Python path needed.** The
  embedded helpers (`getLlm()`, `agenticLoop()`, `sample()`) are just OTTO's own
  TS functions injected into the isolate — no wire protocol, no local LLM
  endpoint, one runtime, one deploy, no Python in OTTO's dependency story.
- **Data toolbox** (curated, pre-provisioned in the isolate rather than arbitrary
  runtime `npm install`): **DuckDB** (node addon or wasm) as the in-process
  analytical SQL engine — reads CSV/Parquet/JSON/Excel directly, joins across
  files, handles larger-than-memory; **nodejs-polars**/**arquero** for dataframe
  reshaping; `simple-statistics` for the rest; `fetch` for API pulls. This covers
  the admin/PM reporting workload without Python. Charts are **not** rendered in
  the kernel — the kernel emits JSON and the html-app artifact (#2) renders them
  client-side; PDFs go through the existing Playwright/headless-Chromium.
- TS owns lifecycle (spawn/reset/remove), timeout + heartbeat, output
  capture/truncation (reuse `truncate.ts` + `artifact-manager.ts` for big
  outputs), and reuses `execution-policy.ts` / `custom-execution-policy.ts` so
  scratchpad exec honors the same allow/deny gates as bash.

> **Footnote — optional Python backend.** A `LocalPythonRuntime` can later
> implement the same `ScratchpadRuntime` interface for the rare case someone
> needs a Python-only library (scikit-learn, statsmodels, scipy). It is **not**
> built now and is **not** on the admin/PM path. Designing the interface now just
> keeps that door open without taking a Python dependency.

#### Tying into sessions — resume / `/tree` (this is what makes it feel native)

OTTO sessions are **append-only JSONL** with a versioned `SessionHeader` carrying
a `parentSession` field (`packages/pi-coding-agent/src/core/session-manager.ts`)
— that lineage *is* the `/tree` fork/resume model. The artifact directory is
already **co-located with the session file** (`artifact-manager.ts` derives it
from the session path). The scratchpad inherits all of this **for free**, on one
condition:

- **The live isolate is ephemeral; durable state lives on disk.** Don't try to
  serialize the V8 heap (Anton dill-pickles its Python namespace —
  `scratchpad_boot.py` — but that's fragile). Instead make the **DuckDB database
  file** + the **deliverable folder** (#2) the system of record. The kernel is a
  *recompute* layer over on-disk state, not the state itself.
- **On resume:** pi replays the session JSONL (conversation context, prior tool
  results, the model's reasoning — subject to compaction), and the scratchpad
  reattaches the session's DuckDB file and re-opens the deliverable folder. The
  data and the in-progress report survive a process restart even though the live
  variables don't. Resuming a data-report session, or branching it via `/tree`,
  then works exactly like resuming any coding session — no special-casing.
- **Net:** because the feature stores nothing important in volatile memory, it
  rides OTTO's existing session/resume/tree machinery rather than fighting it.
  That's the "feels native" requirement, satisfied by design.

**Sequencing:** First. Everything else depends on it.

---

### 2. First-class Artifacts system — "render diagrams/spreadsheets/dashboards"

**What Anton accomplishes.** Turns "OTTO wrote some code" into "OTTO delivered a
dashboard." Each deliverable is a **typed, provenance-tracked folder** the user
can open and re-open across conversations.

**Anton source:**
- `anton/core/artifacts/__init__.py` — folder-per-artifact under
  `<workspace>/artifacts/<slug>/` with `metadata.json` + auto-rendered `README.md`.
- `anton/core/artifacts/models.py` — closed type enum: `html-app`, `document`,
  `dataset`, `image`, `mixed`, `fullstack-stateless-app`, `fullstack-stateful-app`;
  `primary` entry-point pointer; **server-managed provenance** (`ProvenanceEntry`
  per conversation, `TurnEntry` per turn that touched a file).
- Tools: `create_artifact`, `open_artifact`, `list_artifacts`,
  `set_artifact_primary` (`tool_defs.py:147+`). Renderer picks preview affordance
  per type — iframe sandbox for html-app, table preview for dataset, "open" for
  document.

**Gap vs OTTO.** `packages/pi-coding-agent/src/core/artifact-manager.ts` is
explicitly *"session-scoped artifact storage for truncated tool outputs"* via
`artifact://` URLs — internal plumbing, not user-facing deliverables. Different
concern; keep it, but build a **new** user-facing layer beside it.

**OTTO integration sketch (TS):**
- New module `packages/pi-coding-agent/src/core/deliverables/` (avoid the
  `artifact` name collision). Pydantic → **zod** schemas for the metadata model;
  type enum as a zod union.
- Four new tools (`createDeliverableTool` etc.) registered via the tools index.
- Provenance is **server/agent-managed, deterministic** — OTTO already tracks
  conversation + turn indices; wire those into `metadata.json` on each file touch
  (snapshot-diff the folder, à la Anton's `snapshot.py`).
- **Rendering:** OTTO's `export-html/` (`tool-renderer.ts`, `template.html`)
  already does ANSI→HTML session export. Extend it with a per-type renderer:
  html-app → iframe sandbox, dataset → table preview, document → open. For the
  TUI, surface deliverables in the existing `dashboard-overlay.ts` widget area.
- The scratchpad (#1) is how the model *writes into* a deliverable folder
  (`open(path,"w")`), so #1 must land first.

**Sequencing:** Second.

---

### 3. Local-first analytical processing + credential vault

**The model that fits OTTO.** KORE (MindsDB, embedded in OSCAR) will **not** run
locally on the laptop — it is an **upstream data *source***, not a local query
engine. The working assumption: data is *obtained* (from KORE/OSCAR, an API pull,
or files a user drops in) and **lands locally**; then OTTO reasons over it
**locally** and produces the report/dashboard. So the local analytical engine is
**DuckDB-in-TS (from #1)**, not KORE.

**What Anton accomplishes (the parts worth keeping).** A `/connect`-style flow,
schema introspection, and an encrypted credential vault that injects secrets as
`DS_*` env vars **so secrets never enter the LLM context**.
- `anton/core/datasources/data_vault.py` — encrypted secret store; `secure_keys`
  schema; secrets injected as `DS_<FIELD>` env vars before any cell runs —
  *"Never embed raw values in code strings."*

**What to skip.** Anton's per-engine connector **registry**
(`datasources.md`: Postgres/MySQL/Snowflake YAML + test snippets). We don't need
a local federated-connector layer — for already-local files DuckDB reads them
directly, and for anything upstream KORE/OSCAR is the source. Don't rebuild a
query engine on the laptop.

**OTTO integration sketch (TS):**
- **Ingest → local store.** A thin `ingest` step lands data into the session's
  **DuckDB file**: read local CSV/Parquet/JSON/Excel directly; pull from an API
  via `fetch`; or import a dump. Once it's in DuckDB, all reasoning/reporting is
  local SQL + the #1 kernel.
- **Credential vault (adopt the pattern).** A `SecretVault` module — secrets at
  rest in the OS keychain or an encrypted file, exposed to the scratchpad runtime
  (#1) **only as injected env vars at spawn time**, never interpolated into code
  the model sees. Needed for the *ingest* step's credentials (API keys, DB creds
  for a one-time pull). Build on OTTO's `get-secrets-from-user.ts` + `aws-auth/`.
- **KORE as a source, when OSCAR lands.** Integration adds KORE as one *origin*
  feeding the ingest step — not as OTTO's local analytics runtime. The local
  engine stays DuckDB regardless.

**Sequencing:** Third. The vault pattern can land with #1; broad ingest sources
(incl. KORE) follow OSCAR integration timing.

---

### 4. Self-improving error-learning loop — the genuinely novel part

**What Anton accomplishes.** When scratchpad code errors, Anton runs a post-mortem,
extracts a *generalizable* lesson, and feeds it into future code generation — so it
makes the same mistake less often. This is a closed loop **execution error →
memory → better next code**, which OTTO's memory has the storage for but not the
loop.

**Anton source:**
- `anton/core/memory/cerebellum.py` — buffers errored/warning cells across a turn,
  runs an LLM post-mortem diff ("expected vs happened"), encodes lessons. Runs in
  parallel; never blocks.
- `anton/core/memory/acc.py` — turn-level: detects *repeated* error patterns within
  a turn. (Note: standalone + tested but **not yet wired into Anton's session** —
  so it's aspirational even for them.)
- `anton/core/memory/consolidator.py` — offline "sleep replay" of a finished
  session into durable lessons.

**Gap vs OTTO.** OTTO has strong memory storage (`memory-store.ts` w/ FTS,
`memory-consolidation-scanner.ts`, `captures.ts`) — arguably a *better* substrate
than Anton's markdown files. What's missing is the **feedback trigger** from
execution failures.

**OTTO integration sketch (TS):**
- Hook the scratchpad runtime's (#1) post-exec path: on cell error, enqueue a
  post-mortem job that calls the LLM and writes a lesson into the **existing**
  `memory-store.ts` (don't port Anton's file layout).
- Inject relevant lessons into scratchpad prompt assembly via the existing
  `context-injector.ts`.
- Reuse `memory-consolidation-scanner.ts` for the offline "sleep replay" role.
- **Adopt the concept, not the files** — OTTO's FTS store + capability-aware model
  routing (ADR-004) is the better home for this.

**Sequencing:** Fourth — needs #1 producing exec errors to learn from.

---

### 5. Skills that carry runnable code (+ vision-from-disk)

**5a. Executable skills.** Anton skills = `declarative.md` + `chunks.md` + `code/`
(runnable helper modules) + `stats.json` (usage counters). `/skill save`
(`anton/commands/skills.py`) distills *successful scratchpad work* into a reusable
procedure automatically (`anton/core/memory/skills.py`).

OTTO skills are instruction-markdown (`SKILL.md`, per `EXTENDING-OTTO.md`). The
evolution: add an **executable stage** (helper modules a skill can ship) and
**auto-distillation** — a `/otto skill save` that reads recent scratchpad cells +
conversation and drafts a skill. Lands naturally on the namespaced skill registry.

**5b. Vision-from-disk.** `read_image` (`tool_defs.py:309`) pulls a PNG/JPG/etc.
from disk into the model's vision context as a turn input — useful for "look at
this chart/screenshot." OTTO has image utils but (per inventory) not a
read-into-vision tool. Small, cheap, high-utility once artifacts (#2) produce
charts the model may want to re-inspect.

**Sequencing:** Fifth — incremental polish after the harness exists.

---

## Packaging & where state lives (works without a coding repo)

This is what makes the capability usable for **project managers / administrators
who have no git repo** — and what makes it feel native rather than bolted on.

**Packaged as a bundled pi-dev extension.** pi-dev's extension contract is the
seam. An extension is a folder under `src/resources/extensions/<name>/` whose
`index.ts` does `export default function (pi: ExtensionAPI)` and registers
capabilities via `pi.registerTool({...})` / `pi.registerCommand(...)`. The
`search-the-web/` extension is a clean template (`index.ts:40`; tools registered
in `tool-search.ts:322`, `tool-fetch-page.ts:361`). So this ships as a **new
bundled extension** — e.g. `src/resources/extensions/analyst/` — registering
`scratchpad`, `create_deliverable`, `ingest`, etc. It's part of OTTO core, loaded
by the same `resource-loader.ts` → `extensions/loader.ts` path as every built-in
tool (the loader *also* picks up user-dropped extensions from
`~/.otto/agent/extensions/`, but a first-class capability belongs bundled).
Because it registers through the standard tool registry and gets session access
(`sessionFile`), it inherits permission gates, persistence, and resume for free.

**State is home-based, not repo-based.** `getSessionsDir()` →
`~/.otto/agent/sessions/` (`config.ts:235`, via `getAgentDir()` at
`config.ts:193`) — resolved from `$HOME`, **independent of `cwd`**. The artifact
dir is derived from the session file path (`artifact-manager.ts:27`). So:
- **Co-locate the working DuckDB file with the session**, under
  `~/.otto/agent/sessions/<id>/`. A PM who runs `otto` from `~` or `~/Reports`
  with no git repo still gets full session + DuckDB + deliverable persistence and
  resume/`/tree`. KORE/OSCAR is not required for any of this.

**Split scratch vs. published output** (decision to confirm):
- **Scratch / intermediate** (the working DuckDB DB, temp tables) → the session
  dir. Global, resume-safe, auto-managed, invisible to the user.
- **Published deliverable** (the report/dashboard the PM opens) → default to
  `cwd` when it's a real working folder, else a discoverable
  `~/.otto/deliverables/<slug>/` surfaced in the TUI with open / reveal-in-Finder
  / export-to affordances. Keeps output findable for non-repo users without
  scattering files.

## How it gets triggered (context-driven, not command-gated)

The goal: a project manager says *"pull last quarter's sales CSV and build me a
dashboard"* and OTTO just does it — **no command to memorize**.

**This is how Anton works.** Every tool is registered and exposed to the model on
**every turn** (`anton/core/tools/registry.py`), and an aggressive system prompt
(`anton/core/llm/prompts.py`: *"if someone needs data analyzed… you figure out
how"*, *"use the scratchpad for data analysis"*) makes reaching for those tools
the **default behavior**. Slash commands (`/connect`, `/skill save`) are optional
accelerators — even datasource connection is triggered by plain language.

**pi-dev replicates this with three surfaces** (`ExtensionAPI`, `types.ts`):

| Surface | API | Trigger | Use for |
|---|---|---|---|
| **Tool** | `registerTool` (`types.ts:1421`) | Model calls it by context, every turn | `scratchpad`, `ingest`, `create_deliverable` |
| **Skill** | `SKILL.md`, advertised by description, invoked via Skill tool | **Auto-pulled when the ask matches** the description | The analyst *workflow* (ingest→DuckDB→compute→deliverable) |
| **Command** | `registerCommand` (`types.ts:1428`) | User types `/…` | Optional `/connect`, `/report` — discoverability + power users |

**Design stance:**
- **Default = context-triggered.** Register the tools always-on; ship a thin
  **analyst skill** whose description (*"retrieve, analyze, and report on
  data; build dashboards"*) is what the model matches to pull in the workflow.
  No command required.
- **Commands are affordances, not gates** — they exist for discovery (so a
  non-technical user learns the capability exists) and speed, never as the only
  entry point.
- **Inline, not a subagent.** Keep the analyst tools + skill in the **main
  session**, not a delegated subagent. Subagents run in isolated context and
  return a summary — that breaks the "resume the session and keep iterating on
  the report" flow. Inline keeps data + deliverable + conversation in one
  resumable session (`/tree`-compatible).
- **Reliability depends on the nudge.** Context-triggering is only as good as the
  tool descriptions + skill/prompt guidance behind it. Without an explicit *"use
  this whenever the user wants to analyze data"* cue, models sometimes answer
  from memory instead of computing. Anton's system prompt earns its
  reliability — OTTO's analyst skill must do the same.
- **Gating (optional).** Use `setActiveTools()` (`types.ts:1523`) if the analyst
  tools should stay dormant in pure-coding sessions and activate when the context
  turns to data work.

## Roadmap sequencing (dependency order)

```
[coding/OS foundation — in progress, OTTO already strong]
        │
        ▼
1. Persistent scratchpad  ──────────────┐  (keystone: TS-native isolated-vm
        │                               │   kernel + DuckDB toolbox; on-disk
        │                               │   state → session resume works)
        ▼                               │
2. Artifacts/deliverables  ◀────────────┘  (model writes into folders via #1;
        │                                    renderer extends export-html/)
        ▼
3. Local analysis + vault  ◀── KORE/OSCAR   (DuckDB-in-TS is the local engine;
        │                       (a source)   KORE is an upstream source feeding
        │                                    ingest; adopt vault env-injection)
        ▼
4. Error-learning loop                       (hook #1 post-exec → memory-store.ts)
        │
        ▼
5. Executable skills + read_image            (polish on namespaced skill registry)
```

**One-line rule:** build the coding/OS skill foundation first, then add
**Scratchpad → Artifacts → local-analysis+vault → error-learning →
executable skills**, each layer gated on the one above.

## What NOT to do

- Don't port Anton's brain-region module names or markdown memory layout — OTTO's
  FTS `memory-store.ts` is a better substrate.
- Don't build a local federated query engine — already-local files go straight
  into DuckDB; KORE/OSCAR is an upstream *source*, not OTTO's local analytics
  runtime.
- Don't take a Python runtime dependency for the admin/PM analytics path — it's
  TS-native (DuckDB + isolated-vm). Python stays an optional, unbuilt backend.
- Don't persist scratchpad state by serializing the kernel heap — keep durable
  state in the on-disk DuckDB file + deliverable folder so session resume/`/tree`
  work without special-casing.
- Don't copy AGPL code; reimplement concepts in TS.
- Don't collide with the existing `ArtifactManager` (truncated-output plumbing) —
  build user-facing deliverables as a separate layer.
