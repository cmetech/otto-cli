# Otto Co-Worker Design — Layered Pillars for an Operational Co-Worker

**Status:** Draft for review
**Date:** 2026-05-30
**Author:** brainstorm session with Corey
**Scope:** Full v1 of the Otto co-worker transformation (8–10 weeks)
**Primary persona:** Enterprise NOC / IT-ops analyst working with CMDB extracts, ticket data, alert logs, and operational reports

---

## 1. Goal and positioning

Otto today is a terminal-resident coding/ops assistant with a workflow engine, skills, and extensions. Anton's positioning — *"a chat assistant drafts; Anton ships"* — describes an outcome shift Otto needs: from "agent that responds with code" to "co-worker that ships deliverables, remembers context, and learns from work over time."

This design adopts the structural moves that make Anton feel like a co-worker — a persistent code execution kernel, a credential vault, typed deliverables, and learning memory — and adapts them for Otto's TypeScript-first stack and Otto's NOC/IT-ops primary persona.

### Positioning the persona

Otto's v1 co-worker user is an enterprise NOC / IT-ops analyst whose daily work is:

- Querying CMDB extracts (CSV/Excel) for "what servers run X", "what's the serial number of Y"
- Building inventory reports from CMDB data
- Summarizing root cause from emails + tickets + alert logs (RCA workflow)
- Reviewing alert data, correlating to assets, scoping outage impact
- Producing markdown reports + Excel workbooks as deliverables

This persona is **not** a data scientist. Numerical methods, ML, NLP, geospatial, and statistical modeling are explicitly out of scope. The TS-native ecosystem (polars, DuckDB, ExcelJS, date-fns) covers >95% of the persona's analytical needs and is more familiar to current LLMs than the equivalent Python ecosystem for ops-flavored integration work.

### Non-goals

- Data-science use cases (ML, statistics, forecasting, NLP)
- Vector embeddings for memory recall (BM25-only v1; LanceDB defer)
- HTML/PDF artifact rendering (markdown + Excel only)
- Publish/share infrastructure (`/share`, credential-scrubbing zip uploads)
- Anton's dispatch + multi-channel inbound (Slack/Telegram listeners)
- Python subprocess scratchpad (TS-only via `child_process`)
- Strong process sandboxing (workspace-rooted CWD + destructive-op approval is the v1 posture)
- Anton's identity-extraction-every-5-turns (replaced with user-editable `profile.md` + propose-via-digest)

---

## 2. Architectural shape — four layered packages

Otto gains four new npm packages, all bundled by default in `otto-cli`. Strict dependency layering: vault and memory depend on nothing; artifacts and scratchpad depend on memory; scratchpad depends on vault and artifacts.

```
┌─────────────────────────────────────────────────────────────┐
│ otto-cli (existing — unchanged shape)                       │
│   loads all four below as default extensions                │
│   wires slash commands → package APIs                       │
│   renders TUI panels for cells, artifact tiles, digest      │
└─────────────────────────────────────────────────────────────┘
          ↑                ↑                ↑               ↑
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ otto-        │ │ otto-        │ │ otto-        │ │ otto-        │
│ scratchpad   │ │ artifacts    │ │ vault        │ │ memory       │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
       │                │                ▲               ▲
       │                ▼                │               │
       │         (uses memory.recall)    │               │
       └──── (uses vault.inject) ────────┘               │
       └──── (writes to memory layers B + D) ────────────┘
       └──── (writes to artifacts.store) ────────────────┘
```

### 2.1 `otto-memory` — four-layer memory store with pluggable backend

The most distinctive package. Synthesizes ideas from Anton (behavioral steering, ACC, Cerebellum, Consolidator), MemPalace (verbatim drawer recall, temporal knowledge graph), and oh-my-pi/Mnemosyne (pluggable backend, three scoping modes, granular config knobs) into four layers with deliberately different lifetimes and recall characteristics.

#### Pluggable backend interface

`otto-memory` exposes a `MemoryBackend` interface so storage strategies can evolve without touching consumers. v1 ships exactly one backend; later versions can add hosted or hybrid backends without recompiling scratchpad/artifacts.

```typescript
// See "Layer B structure" subsection below for full interface and type definitions.
interface MemoryBackend { /* ... */ }

// v1 implementation
class LocalSqliteBackend implements MemoryBackend { ... }
// v2+ candidates
class HostedBackend implements MemoryBackend { ... }
class LanceDbHybridBackend implements MemoryBackend { ... }
```

Config:

```yaml
memory:
  backend: local-sqlite                       # 'local-sqlite' | 'hosted' | ...
  scoping: per-project-tagged                 # see scoping modes below
  autoRecall: true
  autoRetain: true
  retainEveryNTurns: 4                        # batch retention; avoids chit-chat noise
  recallLimit: 8                              # max memories injected per turn
  recallContextTurns: 3                       # prior turns included in composed recall query
  injectionTokenLimit: 3000                   # cap on memory block size in system prompt
  noEmbeddings: true                          # v1 BM25-only; v2 may flip to false
```

#### Three scoping modes

Adopted from oh-my-pi's Mnemosyne wrapper. Default is `per-project-tagged` for the NOC persona because investigations belong to projects but cross-customer learnings should still surface.

| Mode | Writes | Recall |
|---|---|---|
| `global` | One shared bank for every workspace | Reads from shared bank |
| `per-project` | Isolated per workspace | Reads only this workspace's bank |
| `per-project-tagged` | Project-local | Reads project + global, tagged so the LLM knows source |

#### Layer B structure — Wings, Rooms, Drawers as contract concepts

The MemPalace metaphors are first-class types in the `MemoryBackend` interface, but **storage layout is the backend's choice**. `LocalSqliteBackend` uses physical wings/rooms/drawers tables; future backends (e.g., `HostedBackend`) can flatten differently as long as they satisfy the contract. This preserves semantic clarity without forcing all backends into one storage model.

**Wing** — top-level grouping, scope-aware. Set automatically by `otto-memory` based on the scoping mode:

| Scope mode | Write wing | Recall reads from |
|---|---|---|
| `global` | `'global'` | `'global'` |
| `per-project` | workspace ID (e.g., `'acme-noc'`) | own workspace |
| `per-project-tagged` | workspace ID | own workspace + `'global'` (results tagged with source) |

Users can also explicitly name wings for cross-cutting groupings (e.g., `'customer-acme'`, `'site-dallas'`) via `/memory wing <name>` for content they want grouped outside the default scope. v1 ships the auto-assigned default; the explicit-wing UX is small but documented.

**Room** — durable session-of-work grouping. The primary key for "what investigation/topic does this drawer belong to":

| Content origin | Room value |
|---|---|
| Cell run in scratchpad `p1-1234` | `'p1-1234'` (auto: room == active scratchpad name) |
| User paste / turn with no scratchpad attached | `'inbox'` (default room for orphan content) |
| User-named via `/memory room <name>` | `<name>` |

The "room == scratchpad name" alignment is intentional and load-bearing — it means recall by room is the same as recall by investigation. Cross-room recall is supported (just omit the room filter).

**Drawer** — atomic content unit. Verbatim storage; never paraphrased. Closed vocabulary for v1 so the index facets stay clean and the `recall` tool's `kind` filter is reliable:

| Kind | Source | Example content |
|---|---|---|
| `turn` | Conversation turn (user or agent text) | "what servers had >5 alerts last night?" |
| `paste` | User-pasted content not classified more specifically | Anything between three backticks the user dropped in |
| `file_load` | Collector data-load event metadata | `{ collector, uri, bytes, rows_loaded, schema }` |
| `ticket` | Explicit ticket body | Verbatim ServiceNow / Jira / GitHub issue content |
| `email` | Explicit email body | Verbatim customer email / Outlook export |
| `rca` | Explicit RCA writeup | Verbatim incident report text |
| `note` | Explicit note | User-authored standalone notes |

Unknown kinds are **rejected at write time** so the recall index stays well-formed. Adding a new kind is a schema migration (matches §6.2).

**Layer C is sibling, not contained.** Entities, edges, and aliases live in their own tables (or backend-equivalent storage), referenced by drawers but not nested inside the wing/room/drawer hierarchy. A drawer with `kind: 'ticket'` may mention five servers; those five servers are Layer C entities, related to the drawer by reference but not stored inside it.

#### Updated `MemoryBackend` interface using these types

```typescript
type Wing = string;          // 'global' | workspace_id | user-defined
type Room = string;          // scratchpad name | 'inbox' | user-defined
type DrawerKind = 'turn' | 'paste' | 'file_load' | 'ticket' | 'email' | 'rca' | 'note';

interface Drawer {
  id: string;
  wing: Wing;
  room: Room;
  kind: DrawerKind;
  content: string;                          // verbatim
  metadata: Record<string, unknown>;
  created_at: string;
  parent_id?: string;                       // for branching support (§3.3)
}

interface RecallQuery {
  query: string;
  wing?: Wing;                              // omit = all wings the scope allows
  room?: Room;                              // omit = all rooms
  kind?: DrawerKind | DrawerKind[];
  days_back?: number;
  max_results?: number;
}

interface MemoryBackend {
  recall(query: RecallQuery): Promise<Drawer[]>;
  retain(drawer: Omit<Drawer, 'id' | 'created_at'>): Promise<Drawer>;
  listRooms(wing?: Wing): Promise<Room[]>;
  listWings(): Promise<Wing[]>;
  entityQuery(query: EntityQuery): Promise<Entity[]>;
  entityAssert(edge: EntityEdge): Promise<void>;
  status(): Promise<BackendStatus>;
  clear(): Promise<void>;
}
```

| Layer | Purpose | Storage | Lifetime |
|---|---|---|---|
| **A — Behavior & rules** (lossy, in-prompt) | "How the agent acts for this user" | Markdown files (`profile.md`, `rules.md`, `lessons.md`) per scope (global + workspace) | Always injected into system prompt; small (~3 KB) |
| **B — Verbatim drawers** (lossless) | "What the user said, word for word" | SQLite + FTS5 (BM25), one DB per workspace; Wing → Room → Drawer hierarchy (see §2.1 Layer B structure) | Never in prompt; searched on demand via `recall` tool |
| **C — Knowledge graph** (entities + temporal edges) | "What Otto knows about things in their world" | SQLite tables: `entity`, `alias`, `edge` with `valid_from` / `valid_to` columns | Small relevant slices pulled in for current-turn entities |
| **D — Cell archive** | "What Otto did in code" | `cells.jsonl` per named scratchpad (Layer-D content lives with the scratchpad, not the memory DB) | Surfaces via `/explain`; feeds ACC + Cerebellum |

#### Write semantics (Layer A — the curated layer)

Different sources have different confidence and review burden. Layer A uses a **4-tier source policy**:

| Source | Auto-write? | Show in weekly digest? | Why |
|---|---|---|---|
| **User explicit `memorize`** | Yes, immediately | No | User authored it; review redundant |
| **Cerebellum cell-error diff** | Yes, immediately | Yes | High signal (concrete failure → fix); generalization may be too broad |
| **ACC high-confidence detectors** | Yes, immediately | Yes | E.g. repeated identical tool call; obvious; interpretation needs human eyes |
| **ACC low-confidence detectors** | Pending-only | Surfaced at next digest | E.g. inferred user frustration; needs review before applying |

#### Weekly digest

Layer A's curation surface. Trigger: 7 days since last review **OR** 50 unreviewed entries, whichever first. Renders inline at session start as a 30-second review where the user keeps/drops each entry. Entity-merge proposals (Layer C) join the same review surface — one curation UX, not two.

#### Layer C entity disambiguation

Hybrid policy: **auto-merge safe normalization axes, propose merges for risky axes.**

| Axis | Example | Auto-merge? |
|---|---|---|
| Case-fold | `Prod-Web-01` ≡ `prod-web-01` | ✅ |
| Interior separator normalize | `prod_web_01` ≡ `prod-web-01` | ✅ |
| Configured domain suffix strip | `prod-web-01.acme.com` ≡ `prod-web-01` (when `.acme.com` is registered) | ✅ |
| Levenshtein ≤ 2 with same numeric suffix | `prod-web-01` ≈ `prod-web-01a` | ⚠️ Propose |
| Prefix / nickname / substring | `pw-01` ≈ `prod-web-01` | ⚠️ Propose |

**Hard rule:** records from the same authoritative CMDB source with different primary keys are never auto-merged, even with byte-identical names. CMDB row identity is authoritative.

**Threshold:** ships conservative (Levenshtein ≤ 2 + same suffix) by default; tunable via `entity.merge_threshold` per workspace.

#### Cross-layer tool surface for the LLM

Five tools, not 50:

- `memorize(text, kind, scope, topic)` → Layer A
- `recall(query, kind?, wing?, room?, days_back?, max_results)` → Layer B verbatim (wing/room/kind per the closed vocabulary in §2.1 Layer B structure)
- `entity_query(entity_type?, name?, predicate?, as_of?)` → Layer C
- `entity_assert(subject, predicate, object, valid_from, valid_to?)` → Layer C
- `explain(turn_id?)` → recent Layer D + ACC events for the turn

#### Consolidator — two-phase background pipeline (back in v1)

Adopted from oh-my-pi's pattern (which is Anton's consolidator done cheaply). Runs in the background at startup or via `/memory enqueue`, distilling long-term memory from past sessions. Complementary to the weekly digest UX: digest curates last week's Layer-A churn; consolidator distills durable patterns across the project's history.

**Pass 1 — per-session extraction.** For each past session changed since last processed, the `default` model role reads session history and extracts durable signal: technical decisions, recurring workflows, resolved failures. Skips sessions that are too recent (`minIdleHours: 12`), too old (`maxAgeDays: 30`), or currently active. Produces a raw memory block + short synopsis per session.

**Pass 2 — consolidation.** A second pass uses the `smol` model role (cheaper model, falls back to `default`) to read all per-session extractions and produce three artifacts:
- `MEMORY.md` — curated long-term memory document
- `memory_summary.md` — compact text injected at session start (capped by `injectionTokenLimit`)
- `skills/<name>/SKILL.md` — optional procedural playbooks distilled from recurring workflows

Both passes run under a lease (sentinel file at `~/.otto/leases/consolidator.lock` with PID + TTL) so multiple Otto processes don't double-run.

Config additions:

```yaml
memory:
  consolidator:
    enabled: true
    maxAgeDays: 30
    minIdleHours: 12
    maxPerStartup: 64
    summaryRole: smol                         # 'smol' | 'default' | 'remote'
```

All consolidator output is scanned for secrets before disk write (see §6.5 and §7 risk #12).

#### What was deliberately dropped

From Anton:
- *Identity extraction every 5 turns* — expensive and noisy. Replaced with: user edits `profile.md` directly; agent proposes additions via Layer-A write that lands in the digest queue.

From MemPalace:
- *AAAK dialect compression* — clever, high complexity; use plain FTS5 for v1
- *ChromaDB / vector embeddings* — heavyweight native dep that doesn't fit Otto's TS-first stack; LanceDB possible v2
- *Local Ollama dependency for refinement* — Otto has the gateway; route memory-refinement LLM calls through it

### 2.2 `otto-vault` — credentials + engines

- `LocalDataVault`: per-entry JSON files at `~/.otto/data_vault/<service>-<name>.json` with `chmod 600`; atomic writes (`.tmp` + rename)
- `EngineRegistry`: declarative YAML engine definitions, seeded with ServiceNow, IMAP/Outlook, Datadog, SolarWinds, generic-REST; user-defined engines override built-ins on slug collision
- `VAULT_KEEP` sentinel pattern for safe UI round-trips (edit forms get sentinel placeholders for secrets; submitting unchanged sentinels preserves stored values)
- Env-var injection at scratchpad spawn: `OTTO_DS_<engine>_<name>__<field>` (namespaced, scoped to subprocess)
- `clearEnv()` purges `OTTO_DS_*` from parent process at shutdown
- `/connect` interactive wizard + `/datasource` CLI subcommands

### 2.3 `otto-artifacts` — typed deliverables

- Two artifact kinds for v1: `report` (markdown) and `workbook` (Excel xlsx)
- `ArtifactStore`: slug derivation, collision suffixing (`-2`, `-3`, …), atomic metadata writes
- `DirSnapshot`: nanosecond mtime + size_bytes per file, used to compute per-turn `files_touched`
- `ProvenanceEntry` + `TurnEntry` records — per-artifact, per-conversation lineage
- Deterministic `README.md` re-render on every save (summarizes metadata + provenance for human review)
- Workspace-scoped: artifacts live at `<workspace>/.otto/artifacts/<slug>/`
- Tools: `list_artifacts`, `open_artifact`; slash: `/artifacts list|show|remove`

### 2.4 `otto-scratchpad` — stateful TypeScript kernel

- `ChildProcessRuntime`: per-named-kernel `node` subprocess; **child_process** (not worker_thread) for native-addon crash isolation
- **NDJSON over stdio** (one JSON object per line, `\n` terminated). Debuggable with `cat`/`jq`. Trace via `OTTO_SCRATCHPAD_IPC_TRACE=1`.
- Persistent `globalThis` namespace across cells within a kernel
- Pre-bound bindings: `polars`, `DuckDB`, `ExcelJS`, `date-fns`, `lodash`, `zod`, `axios`, plus the `otto.*` helpers (`otto.collectors`, `otto.artifact`, `otto.memory`)
- Two-tier timeout (total wall-clock + inactivity); `progress()` heartbeat resets inactivity
- **Cancellation escalation**: SIGINT → in-cell abort error → between-cells `SIG_IGN` (so stray cancels don't tear down the kernel) → SIGTERM if stuck in native code → process restart on next call
- `ScratchpadManager`: Map<name, runtime> with named-kernel CRUD
- **Exclusive lock per kernel** (cross-process via lock file in `meta.json`); concurrent attach blocked with `--force-takeover` escape hatch
- **Bounded live-kernel pool** (default `max_live_kernels: 8`); LRU eviction on overflow with namespace snapshot before evict
- **Heartbeat dead-kernel detection**; auto-restart allowed once; repeated crash = hard failure surfaced to user
- Idle eviction (default 10 min) → namespace.json snapshot + child_process terminate
- DuckDB-backed kernel persistence: the kernel's persistent tables live in `kernel.db` (DuckDB's on-disk format)
- **Environment filtering at kernel spawn**: allowlist core vars (`PATH`, `HOME`, `TERM`, locale vars, `NODE_*`) + `OTTO_DS_*` (vault-injected); allow-prefixes (`LC_`, `XDG_`, `OTTO_`); denylist API keys (`LOOP24_GATEWAY_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.). Vault decides what cells can see; everything else stripped.
- `/sp` slash commands: `new` `attach` `list` `reset` `tree` `fork` `view` `remove` `detach` `save` `clear-history`
- `cells.jsonl` archive (Layer D — append-only with `id`/`parentId`; runtime tree projection — owned here, surfaced via memory's `explain`)

#### Collector facade

The scratchpad consumes data through a `CollectorRegistry` abstraction. v1 ships exactly one collector (`FileCollector`) but the interface is the contract every future collection method targets — API, ACP, MCP, custom. This is a **first-class design decision**: bake the facade in v1 so future collectors plug in without scratchpad-internal rewrites.

```typescript
interface Collector {
  readonly id: string;                    // 'file' | 'servicenow' | 'mcp' | 'acp' | ...
  readonly kind: 'file' | 'api' | 'protocol';
  describe(): CollectorCapabilities;
  list(opts?: ListOpts): AsyncIterable<DataSourceRef>;
  open(ref: DataSourceRef): Promise<DataSource>;
  watch?(ref: DataSourceRef, onChange: (ref: DataSourceRef) => void): Unsubscribe;
}

interface DataSourceRef {
  collector: string;
  uri: string;                            // 'file:///workspace/inputs/cmdb_q4.csv'
  kind: 'csv' | 'xlsx' | 'json' | 'parquet' | 'rest' | 'mcp-resource' | 'acp-stream' | ...;
  bytes?: number;
  modified?: string;
  metadata: Record<string, unknown>;
}

interface DataSource {
  ref: DataSourceRef;
  load(): Promise<Buffer | string | object>;
  stream?(): AsyncIterable<Buffer>;
}

interface CollectorRegistry {
  register(collector: Collector): void;
  list(): Collector[];
  get(id: string): Collector | null;
  resolve(uri: string): Promise<{ collector: Collector; ref: DataSourceRef } | null>;
}
```

The LLM sees one tool (`otto.collectors.open(uri)`) and one method to enumerate (`otto.collectors.list()`). When a new collector registers, it appears in `list()` and the system prompt's "available collectors" section refreshes — no LLM prompt rewrite required.

v1 `FileCollector` watches `<workspace>/inputs/` recursively, supports `csv`/`xlsx`/`json`/`parquet`/`txt`/`md`, and uses chokidar for change notifications. Future collectors (`ServiceNowCollector`, `MCPCollector`, `ACPCollector`) register via the same interface; the existing Otto extension SDK is the registration surface.

When a cell loads via a collector, the scratchpad records a Layer-B drawer documenting `{ kind: 'data_load', collector, uri, bytes, rows_loaded, loaded_at, schema }` — making "where did this data come from?" answerable as part of the audit chain.

### 2.5 Persona infrastructure (new, cross-cutting)

Personas are the primary way users tailor Otto's behavior, vocabulary, and defaults for a specific kind of work (NOC Ops, project management, founder/CoS, etc.). The infrastructure is foundational; the personas themselves are separately installable npm packages — same model as Otto extensions today.

#### Concept

A persona is an installable bundle that provides:

1. **Steering files** — markdown loaded into the system prompt (identity, domain vocabulary, capabilities, constraints)
2. **Memory seed** — initial Layer A content (profile.md, rules.md, lessons.md) applied on first activation
3. **Engine seed** — datasource engines pre-registered in the vault (no credentials; user still connects)
4. **Artifact templates** — Handlebars templates for the persona's typical deliverables
5. **Persona-specific skills** — discoverable when the persona is active
6. **Optional collectors** — TypeScript collectors that register at activation
7. **Status-line metadata** — label, color, icon for the TUI chip

#### Bundle structure

```
~/.otto/personas/<persona-name>/        ← installed location, mirrors otto's extension layout
  manifest.yaml                         ← name, version, capabilities (see schema below)
  steering/                             ← system-prompt context files
    identity.md
    domain.md
    capabilities.md
    constraints.md
  memory-seed/                          ← initial Layer A content
    profile.md
    rules.md
    lessons.md
  engines.yaml                          ← datasource engine pre-registrations
  artifact-templates/                   ← Handlebars templates
    *.hbs
  skills/                               ← persona-specific skills
    <skill-name>/SKILL.md
  collectors/                           ← optional persona-specific collectors (compiled JS)
  digest-config.yaml                    ← persona-specific digest UX defaults
```

#### Manifest schema

```yaml
name: noc-ops
display_name: "NOC / IT Ops Analyst"
version: 1.0.0
description: "Enterprise NOC analyst working CMDB extracts, RCAs, alert triage"
author: "@cmetech"
otto_version_required: ">=2.0.0"

steering:
  - steering/identity.md
  - steering/domain.md
  - steering/capabilities.md
  - steering/constraints.md

memory_seed:
  apply_on_first_activation: true
  scope: per-project-tagged                # overrides the workspace default if set

engines: engines.yaml                       # path within bundle

artifact_kinds:
  - report
  - workbook
  - inventory_report                        # persona-specific kind extension
  - rca_report

skills_path: skills/

status_line:
  label: "NOC"
  color: "#FAD22D"
  icon: "🛡"
```

#### Lifecycle

| Command | Behavior |
|---|---|
| `otto persona install <source>` (or `/persona install`) | Install bundle from npm / git / local; validates manifest; loads into registry |
| `otto persona uninstall <name>` (or `/persona uninstall`) | Remove bundle; refuses if currently active in any workspace |
| `/persona list` | Show installed personas; flag the active one |
| `/persona current` | Show active persona details + manifest excerpt |
| `/persona switch <name>` | Switch active persona for this workspace; reloads steering, re-scopes memory, refreshes skill discovery, updates status line |
| `/persona reset` | Wipe the workspace's active-persona setting back to `default` |

Active persona is recorded per-workspace at `<workspace>/.otto/persona.json`:

```json
{
  "active": "noc-ops",
  "activated_at": "2026-05-31T10:00:00Z",
  "memory_seed_applied": true
}
```

#### Default persona behavior

A generic `default` persona ships built-in (no separate package). It has no domain specialization, no engine seeds, no skills — just minimal steering describing Otto as a general co-worker. If a workspace has no active persona, `default` auto-activates. This keeps friction zero on first run while making personas discoverable via the status line chip.

#### Status-line integration

Otto's TUI status bar gains a persona chip — leftmost element, manifest-defined color and icon:

```
┌─ otto ─────────────────────────────────────────────────────────────────┐
│ 🛡 NOC │ /sp p1-1234 │ 4 cells, 12m │ 📚 digest in 3d │ ServiceNow ●   │
└────────────────────────────────────────────────────────────────────────┘
```

When `default` is active, the chip shows `⚙ default` in muted gray.

#### Pillar-level persona awareness

Pillar interfaces stay unchanged; each pillar gains persona-awareness through small additions:

| Pillar | Persona-aware addition |
|---|---|
| `coworker-memory` | On Layer A load, if `<workspace>/.otto/persona.json` exists and `memory_seed_applied: false`, copy persona's `memory-seed/*.md` into workspace memory dir and flip the flag. Wing derivation may include persona name for cross-workspace persona-level recall. |
| `coworker-vault` | Engine registry merges persona's `engines.yaml` so the persona's engines are pre-registered. Credentials remain user-supplied. |
| `coworker-artifacts` | `ArtifactKind` becomes extensible — manifest declares new kinds. Templates in `artifact-templates/` become available as `template://<persona>/<kind>` URLs. |
| `coworker-scratchpad` | Collector registry registers persona-specific collectors at activation. Cell bindings include `otto.persona` namespace (`otto.persona.name`, `otto.persona.template(name)`). |

#### System-prompt assembly order

Otto's existing system-prompt sources continue to apply. Persona steering loads before project-level overrides so user-specific instructions win:

```
1. Otto base system prompt
2. Persona steering files (in manifest declaration order)
3. Workspace AGENTS.md / CLAUDE.md
4. SYSTEM.md / APPEND_SYSTEM.md (project overrides)
5. Memory section (Layer A injection)
```

This ordering matches Otto's existing precedence rules from `FEATURES.md` and is the natural extension point.

#### What ships in v1

- `coworker-persona` package — registry, manifest parser, activation, install/uninstall (Phase 0)
- Default `default` persona — bundled, no domain specialization (Phase 0)
- Status-line persona chip + `/persona` slash commands (Phase 0)
- Pillar persona-awareness hooks (Phases 1-5, each in its own pillar)
- **`@cmetech/otto-persona-noc-ops`** — NOC Ops reference persona, bundled as default install (Phase 6)

Other personas (PM, Founder/CoS, Ops/SRE, etc.) become separate installable npm packages on the same model — they are not v1 deliverables.

---

### 2.6 Three inter-package contracts

These are the only public APIs across packages. Everything else is internal.

```typescript
interface MemoryRecorder {
  // wing is omitted by callers — otto-memory derives it from the active scoping mode
  recordEpisode(args: { sessionId, room, kind: DrawerKind, content, turnId, metadata? }): Promise<void>;
  recordCell(args: { scratchpadName, cellId, code, stdout, error, durationMs }): Promise<void>;
  observeAccEvent(args: { sessionId, kind, detail, severity }): void;
}

interface CredentialInjector {
  injectEnv(processEnv: NodeJS.ProcessEnv, vaultEntries: string[]): NodeJS.ProcessEnv;
  loadForBinding(serviceName: string): Promise<BoundClient | null>;
}

interface ArtifactStore {
  create(kind: 'report' | 'workbook' | 'dataset', name: string): Promise<ArtifactHandle>;
  update(handle: ArtifactHandle, files: FileWrite[]): Promise<void>;
  recordTurn(handle: ArtifactHandle, turnId: string, prompt: string): Promise<void>;
}
```

---

## 3. Persistence model and session interaction

### 3.1 Named scratchpads, decoupled from sessions

Kernels are first-class user-level objects with names. Sessions *attach* to a named kernel. Investigations get their own kernel that outlives any single chat session — matching how a NOC analyst's RCA spans days and Otto opens/closes many times.

| Otto session action | Scratchpad behavior |
|---|---|
| `/new` (fresh session) | Attach to `default`. User can `/sp new <x>` to override. Kernel state in `default` is whatever was left there. |
| `/resume <session>` | Restore the scratchpad attachment last associated with this session. Kernel state is whatever's currently in that named kernel. |
| `/fork <turn>` | Conversation forks (new session file). **Scratchpad does NOT auto-fork** — both branches share the named kernel. If the user wants independent kernel state, run `/sp fork p1-1234 p1-1234-alt` explicitly. |
| `/tree` (jump to earlier turn) | Conversation rewound (leaf-pointer move in current session file). **Kernel state is NOT rewound** (no deterministic replay guarantee). Banner shows: "kernel state is at turn N+30; this view is at turn N". User can `/sp reset` for fresh state. |
| `/clear` | Same as `/new`. |

**Scratchpad-level analogs of `/tree` and `/fork`** (adopted from oh-my-pi's distinction):

| Command | Behavior | Cost |
|---|---|---|
| `/sp tree` | Navigate cell history within the **current** named scratchpad — moves the cell-leaf pointer in `cells.jsonl`; no new state created; kernel namespace unchanged (banner shows divergence) | O(1) |
| `/sp fork <src> <dst>` | Create a **new** named scratchpad by copying `kernel.db` + `namespace.json` + `cells.jsonl` to `<dst>/`; future cells in `<dst>` diverge from `<src>` | O(state size) |

**Rule:** conversation state and kernel state are different things with different lifetimes. Time-traveling the conversation does not time-travel side effects (API calls, file writes, loaded data). Matches Jupyter mental model.

**Implementation note:** `cells.jsonl` is append-only with `id` and `parentId` per entry; the cell-tree is a runtime projection (`getTree()` style) computed from parent links. Branching never rewrites history; it changes a leaf pointer. Branch-summary entries attach at the new navigation position when `/sp tree` abandons a subtree.

### 3.2 Concurrent attach — exclusive lock

If a user has two Otto windows attached to the same named scratchpad, the second window says *"scratchpad `p1-1234` is busy in another session."* Options: wait, attach elsewhere, or `--force-takeover` (writes a `.takeover-from` field with the prior holder PID + reason for forensics).

### 3.3 On-disk layout

```
~/.otto/                                  ← USER-GLOBAL
  scratchpads/<name>/
    kernel.db                             ← DuckDB file; persistent tables
    namespace.json                        ← serialized JS globalThis
    cells.jsonl                           ← cell history (Layer D)
    meta.json                             ← name, created_at, last_used,
                                            attached_sessions[], lock_holder,
                                            size_bytes
  data_vault/
    <service>-<name>.json                 ← chmod 600
  memory/                                 ← global Layer A only
    profile.md
    rules.md
    lessons.md
    digest-state.json                     ← last digest, unreviewed counts
  personas/                               ← installed persona bundles
    default/                              ← always present, built-in
    noc-ops/                              ← from @cmetech/otto-persona-noc-ops (bundled)
    <other>/                              ← user-installed
  leases/                                 ← lease sentinel files (§6.4)
    consolidator.lock
    digest.lock
    ...

<workspace>/.otto/                        ← PROJECT-SCOPED
  inputs/                                 ← watched by FileCollector
  persona.json                            ← active persona for this workspace
  artifacts/<slug>/
    report.md | workbook.xlsx             ← primary file
    metadata.json
    provenance.json
    README.md
  memory/
    profile.md                            ← workspace Layer A
    rules.md
    lessons.md
    layer-b.db                            ← SQLite + FTS5 for verbatim drawers
    layer-c.db                            ← SQLite for entity graph
  data_vault/                             ← workspace override of global
```

### 3.4 Technology choices per file kind

| Kind | Choice | Why |
|---|---|---|
| Kernel persistent tables | DuckDB file | On-disk format *is* the persistence; restoring loaded tables is pointing the new process at the same file. Zero serialization code. |
| Kernel non-table globals | `structured-clone` JSON | Node's `v8.serialize` covers most JS state. |
| Cell history | JSONL (append-only with `id`/`parentId`) | Crash-resistant, tail-readable; tree is a runtime projection |
| Layer A | Markdown with `schema_version` frontmatter | Human-editable, diffable, version-controllable in workspace. |
| Layer B drawers | SQLite + FTS5 | Ships with Node, BM25 + phrase search out of the box, zero-dep. |
| Layer C entities | SQLite | Schema-on-write with foreign keys; temporal validity is two timestamp columns. |
| Artifact metadata | JSON + atomic write | `.tmp` + rename pattern. |
| Credentials | JSON + `chmod 600` | Filesystem ACL is the security boundary; no app-level encryption (laptop-trust model). |

### 3.4a Internal URL schemes

Adopted from oh-my-pi's protocol-handler pattern. Internal URLs let tools reference large or remote content without inlining it into JSONL/drawers.

| Scheme | Purpose | Resolver | v1? |
|---|---|---|---|
| `artifact://<id>` | Session-scoped tool output spill (large cell stdout, etc.) and named typed artifacts (report/workbook) by slug | `ArtifactProtocolHandler` in otto-artifacts | Yes |
| `memory://root` / `memory://root/MEMORY.md` / `memory://root/skills/<name>/SKILL.md` | Read consolidator-produced memory artifacts directly | `MemoryProtocolHandler` in otto-memory | Yes (with consolidator) |
| `blob:sha256:<hash>` | Content-addressed global blob references for large binary payloads (image base64, future chart PNGs) | `BlobStore.resolve()` in otto-artifacts | **Contract designed v1; implementation v2** |
| `agent://<id>` | Subagent output reference | n/a | Out of scope (not needed for v1 NOC persona) |

### 3.4b Output spill to artifacts

Cell stdout/stderr exceeding `output_spill_threshold` (default 50 KB) is spilled to a session-scoped artifact file with monotonic numeric ID. The cell's `cells.jsonl` entry holds a small reference `artifact://<id>`; the UI shows a truncated tail and offers `open_artifact` to view the full content. Prevents `cells.jsonl` bloat on large CMDB queries.

### 3.4c Schema versioning and migration

Every persisted file kind carries an explicit `schema_version`:
- JSONL entries: first-line header `{ "type": "header", "version": N }`
- SQLite DBs: `PRAGMA user_version = N`
- Markdown files: YAML frontmatter `schema_version: N`
- JSON files: top-level `_schema: N` key

On load, the migration framework (delivered in Phase 0) runs forward migrations to the current version. Migrations are append-only — no rollbacks in v1. The framework is the same pattern oh-my-pi uses for session-file v1→v2→v3 migrations.

### 3.5 Persistence triggers

| Trigger | What writes |
|---|---|
| Cell completes | `cells.jsonl` append; Layer B drawer; Layer D entry |
| Cell creates artifact | `metadata.json` + primary file via atomic write |
| Turn completes | Layer B turn drawer; ACC observed events flushed |
| Scratchpad idle (default 10 min) | `namespace.json` snapshot; child_process terminated; `meta.json.lock_holder` cleared |
| Graceful exit | All attached scratchpads snapshot in parallel |
| Explicit `/sp save` | Same as idle snapshot, on-demand |
| Crash | `cells.jsonl` is source of truth; next attach restores namespace from last snapshot with "N cells since snapshot may have lost state" warning |

### 3.6 Disk budget

Typical NOC investigation (3 days, ~80 cells, 47k-row CMDB):

```
Scratchpad p1-1234:           ~122 MB
Workspace (3 investigations + 6 months memory):
  artifacts/                  ~80 MB
  memory/layer-b.db           ~250 MB
  memory/layer-c.db           ~30 MB
  data_vault/                 ~20 KB
                              ──────
Total workspace               ~360 MB
```

Warning at 5 GB workspace size; nothing auto-deleted (artifacts and memory drawers are user data).

---

## 4. Concrete end-to-end scenario — three-day P1 RCA

Walked through Section 2 of the brainstorm; abbreviated here.

**Day 1 (Monday 10am):** User drops CMDB + alerts + ticket files into `inputs/`. Says "start an RCA for P1-1234." Otto creates `/sp new p1-1234`. Cell 1 loads three files (FileCollector + DuckDB + polars). Layer B drawers capture ticket verbatim. Layer C extracts 47k server entities from CMDB. Cells 2–4 answer "servers with >5 alerts", "of those running kernel 4.18", "exact ticket wording about symptoms" — each crosses memory + scratchpad contracts.

**Day 2 (Tuesday 2pm, different terminal):** User `otto` → attaches to `default` → `/sp attach p1-1234`. Kernel state restored from `kernel.db` + `namespace.json`. User pastes customer email → Layer B drawer (verbatim) + Layer C entity assertion (`Frank Robles → escalation_contact → acme-corp`). "What did the customer say about timeline?" → `recall()` returns exact email text with citation. "Draft the RCA report" → `artifacts.create('report', 'rca-p1-1234')`, markdown lands, provenance turn entry written. Cell 5 includes MTTR because a previously captured Layer A rule says so. Cerebellum notices a polars/pandas mistake in cell 5 → candidate lesson added (auto-write, marked for digest).

**Day 3 (Wednesday):** Digest trigger fires (8 unreviewed lessons + 2 entity proposals). User keeps 4, drops 1, merges 2 entities in under a minute. Memory stays sharp.

This scenario exercises all four packages, all four memory layers, both interactive and digest UX, and demonstrates persistence across sessions, verbatim recall, temporal entity queries, artifact provenance, and the learning loop.

---

## 5. Tool surface (LLM-facing) and command surface (user-facing)

### 5.1 LLM tools

| Tool | Package | Purpose |
|---|---|---|
| `scratchpad` | scratchpad | Execute TS code (actions: `exec`, `view`, `reset`, `remove`, `dump`, `install`). **Concurrency: exclusive within a session.** |
| `memorize` | memory | Write to Layer A (rule/lesson/profile fact) |
| `recall` | memory | Verbatim Layer B BM25 search with filters |
| `entity_query` | memory | Query Layer C with optional `as_of` time travel |
| `entity_assert` | memory | Add edge to Layer C (subject-predicate-object + temporal) |
| `explain` | memory | Surface recent Layer D + ACC events for a turn |
| `list_artifacts` | artifacts | Enumerate workspace artifacts |
| `open_artifact` | artifacts | Open artifact by slug or `artifact://<id>` URL |

Vault is not directly LLM-facing — credentials are injected as env vars at scratchpad spawn; the agent reads them from `process.env.OTTO_DS_*` inside cells.

### 5.1a Scratchpad output as MIME bundle

The `scratchpad` tool's response is a MIME bundle, not a single string. The renderer dispatches on type. Adopted from oh-my-pi's `display`/`result` frame model.

| MIME type | Purpose | v1 renderer |
|---|---|---|
| `text/markdown` | Tables, prose, formatted output | Rendered as markdown in cell panel |
| `text/plain` | Raw stdout / stderr | Code-block monospaced |
| `application/json` | Structured cell result | JSON tree view |
| `application/vnd.vegalite+json` | Chart specs | **Contract v1; renderer v2** |
| `application/x-otto-status` | Streaming status events during long cells | Status line above panel |
| `image/png`, `image/jpeg` | Image payloads | **Contract v1; renderer v2** |
| `artifact://<id>` reference | Spilled large output | Truncated tail + "open artifact" button |

Cell output **precedence** when multiple types are present (matches oh-my-pi's order): `text/markdown` > `text/plain` > `text/html` (converted to markdown).

### 5.2 User slash commands

| Command | Owner | Purpose |
|---|---|---|
| `/sp` (alias `/scratchpad`) | scratchpad | `list|new|attach|detach|reset|fork|remove|view|save|clear-history` |
| `/connect` | vault | Interactive credential wizard |
| `/datasource` | vault | `list|edit|remove|test` |
| `/artifacts` | artifacts | `list|show|remove` |
| `/memory` | memory | `status|digest|recall <query>|edit <layer-a-file>|rooms|wings|wing <name>|room <name>` |
| `/entity` | memory | `list|show|merge|review` |
| `/explain` | memory | Recent turn's tool calls + Layer D events |
| `/persona` | persona | `list|current|switch <name>|install <source>|uninstall <name>|reset` (§2.5) |

---

## 6. Cross-cutting engineering rules and conventions

Adopted largely from oh-my-pi's AGENTS.md, applied to the new packages. These keep the implementation maintainable across the four packages.

### 6.1 Prompts in static `.md` files with Handlebars

**Never build LLM prompts in code.** Inline strings, template literals, concatenation — all forbidden for prompt construction. Every LLM-facing prompt lives in `<package>/prompts/*.md` with Handlebars variables. Examples:

- `otto-memory/prompts/consolidation.md` — `{{raw_memories}}`, `{{rollout_summaries}}`
- `otto-memory/prompts/extract-session.md` — `{{thread_id}}`, `{{response_items_json}}`
- `otto-memory/prompts/cerebellum-diff.md` — `{{before_cell}}`, `{{after_cell}}`, `{{error_text}}`
- `otto-memory/prompts/acc-detector-{name}.md` — per-detector prompt
- `otto-memory/prompts/digest-render.md` — `{{lessons}}`, `{{entity_proposals}}`

Rationale: prompts are diffable in PRs, testable independently, A/B testable without code change, and non-engineers can iterate.

### 6.2 Schema migrations are first-class infrastructure

Established in Phase 0. Every persisted file kind carries a `schema_version`. Every package ships a `migrations/` directory of forward-only migration functions registered to a migration framework. Migrations run on load before any read. No rollback support in v1.

### 6.3 NDJSON over stdio for any subprocess wire protocol

Not just the scratchpad — any subprocess this design adds (consolidator workers, future collector daemons) uses NDJSON. Debug via `OTTO_*_IPC_TRACE=1` flags that dump frames to stderr.

### 6.4 Lease pattern for global background tasks

Multiple Otto processes will eventually run on the same workspace (two terminal windows, an `otto headless` job, etc.). Any background task that mutates global state (consolidator, weekly digest, ACC end-of-turn flush, entity merge proposal computation) acquires a lease via a sentinel file at `~/.otto/leases/<task>.lock` with PID + TTL. Expired leases auto-clear.

### 6.5 Secret scanning on every disk write to memory

`SecretScanner` gate runs before any Layer A or Layer B persist. Strips known API-key patterns (AWS, Anthropic, OpenAI, ServiceNow tokens, GitHub PATs, JWTs, generic high-entropy strings flagged by regex). Detection events are logged (without secret values) for audit. Consolidator output is also scanned before disk write. Prevents LLM-generated lessons from accidentally embedding credentials that were in conversation context.

### 6.6 TUI sanitization for all rendered content

All text displayed in cell panels, artifact tiles, digest UI must be sanitized:
- Tabs → spaces
- Long lines truncated with explicit truncation indicator
- Paths shortened (`~` substitution)
- Use shared sanitization helpers, not ad-hoc per-component

### 6.7 No `console.log` / `console.error` in package code

Use the central logger. Console writes corrupt TUI rendering. Pattern: `import { logger } from '@cmetech/otto-utils'`.

---

## 7. Risks and open questions

| # | Risk | Owner phase | Mitigation |
|---|---|---|---|
| 1 | DuckDB Node bindings (`@duckdb/node-api`) is young and may be flaky | Phase 1 | Fallback to older `duckdb` binding or in-process `sql.js`; benchmark in Phase 1 |
| 2 | Native-addon SIGSEGV inside child_process kills the cell's namespace | Phase 1 | child_process scopes the blast radius; document; recommend `/sp save` before risky native ops |
| 3 | Layer B drawer storage grows past disk budget | Phase 3 + 6 | Surface size in `/memory status`; archive policy at 90 days; row-level compression as a Phase-6 fallback |
| 4 | Cerebellum LLM cost (one LLM diff per cell error) could blow budget | Phase 5 | `max_lessons_per_flush=3`, `OTTO_CEREBELLUM_DISABLED` kill switch, budget tracking + warning |
| 5 | Consolidator LLM cost (per-session extraction + cross-session synthesis) | Phase 5 | smol-role model for Phase 2; age-gating (`maxAgeDays: 30`, `minIdleHours: 12`); `maxPerStartup: 64` cap; `OTTO_CONSOLIDATOR_DISABLED` kill switch |
| 6 | Stale scratchpad locks survive Otto crash | Phase 1 | Lock file includes PID + host; on attach, check `kill(pid, 0)` and offer `--force-takeover` with `.takeover-from` audit field |
| 7 | Memory schema migrations between Otto versions | Phase 0 (first-class) | Migration framework is a Phase-0 deliverable; every package ships a `migrations/` directory; every persisted file kind carries `schema_version`; see §6.2 |
| 8 | Vault on stolen laptop has no app-level encryption | Spec doc | Explicit non-goal documented; user warned in `/connect` wizard; consider OS-keychain integration v2 |
| 9 | Concurrent workspace memory access (two Ottos same workspace) | Phase 3 | SQLite WAL mode + `busy_timeout=5000`; Layer A markdown writes use `proper-lockfile`; background tasks gated by lease pattern (§6.4) |
| 10 | Weekly digest discoverability — users may skip forever | Phase 5 | Snooze tracking; after 3 skips Otto offers "disable digests or do longer review now"; manual `/memory digest` always works |
| 11 | Excel formatting fidelity for pivot-friendly NOC workbooks | Phase 4 | Test with real CMDB / RCA workbooks; budget time for column-width + conditional-format tuning |
| 12 | Secret leakage into memory drawers / Layer A from LLM-generated lessons | Phase 3 + 5 | `SecretScanner` gate on every Layer A and Layer B persist (§6.5); consolidator output also scanned before disk write |
| 13 | Race conditions on background tasks across multiple Otto processes | Phase 3 + 5 | Lease pattern at `~/.otto/leases/<task>.lock` with PID + TTL; expired leases auto-clear (§6.4) |

### Open questions for future iterations

- **v2 vector search for Layer B:** if BM25 relevance turns out to be insufficient for ops-flavored natural-language queries ("anything about the network being slow"), add LanceDB as a TS-native embedded vector store and a hybrid scorer
- **API collector implementations:** when do ServiceNow, Datadog, Splunk, ITRS Geneos collectors land? Probably wave 2; each is a self-contained Collector implementation
- **MCP collector:** the existing `mcp-client` Otto extension is the obvious surface to register an MCPCollector once a real MCP server is being consumed
- **ACP collector for live streams:** "alerts as they fire" is a compelling future capability; needs more design on streaming semantics inside cells (back-pressure, partial materialization)
- **OS keychain integration for vault:** macOS Keychain / Windows Credential Manager / libsecret as alternative storage backends; the Vault contract should accept this swap
- **Cross-workspace memory federation:** sometimes the user wants "search every workspace's memory for this server name" — needs design

---

## 8. 10-week phasing plan

| Phase | Weeks | Pillar | Milestone (user-facing) |
|---|---|---|---|
| **0** | 1 | Foundations | `npm install` brings four pillar package shells + types + utils + **persona** package; CI green; **migration framework operational** (every package has `migrations/`, version registry, load-time runner); NDJSON IPC helpers shipped; lease helper shipped; SecretScanner stub shipped; logger published; **`PersonaRegistry` with install/activate/switch**; **built-in `default` persona auto-activates**; **status-line persona chip wired**; `/persona` slash commands functional |
| **1** | 2–3 | otto-scratchpad | NOC user creates named scratchpad, loads CSV via FileCollector, queries with polars/DuckDB, state survives Otto exit; `/sp tree` and `/sp fork` work; bounded pool + LRU eviction + heartbeat + env filter in place |
| **2** | 4 | otto-vault | `/connect` stores ServiceNow creds with chmod 600; next scratchpad spawn has env vars; engine YAML registry seeded |
| **3** | 5–6 | otto-memory A+B + backend interface | Day-2 verbatim recall scenario works; paste Monday, recall exact words Tuesday; `MemoryBackend` interface + `LocalSqliteBackend` published; three scoping modes; config knobs honored; SecretScanner gate live |
| **4** | 7 | otto-artifacts | Day-2 report scenario works; "draft the RCA" produces markdown artifact with two-turn provenance; `artifact://<id>` resolver; output-spill threshold enforced |
| **5** | 8–9 | otto-memory C+D + ACC + Cerebellum + Consolidator + digest | Day-3 scenario works; digest fires, user curates lessons + entity merges in <1 min; two-phase consolidator produces `MEMORY.md` + `memory_summary.md` (+ optional `skills/`) under lease; `memory://` resolver live |
| **6** | 10 | Integration + ship + NOC persona bundle | Clean-install user runs canonical scenario without docs; time-to-first-artifact <5 min; **`@cmetech/otto-persona-noc-ops` published and bundled as default install** (steering files, memory seed, engine seeds for ServiceNow/IMAP/Datadog/SolarWinds, RCA + inventory artifact templates, NOC-specific skills) |

Phases 2 and 3 are independent and can run in parallel; phases 4 and second half of 5 can overlap. A 3-engineer team can compress to ~7 calendar weeks; single-stream is 10.

---

## 9. Out of scope for this design (lands in later specs)

- Vector embeddings / LanceDB hybrid recall (interface accepts it; v1 ships `noEmbeddings: true`)
- API collector implementations (ServiceNow, Datadog, etc.) — facade is v1; implementations are v2
- MCP / ACP collectors — same facade
- HTML / PDF artifact rendering
- Publish/share infrastructure
- Multi-channel dispatch (Slack/Telegram inbound)
- Python subprocess scratchpad
- OS keychain integration for vault (Vault backend interface accepts it; v2 implementation)
- Cross-workspace memory federation
- Process sandboxing beyond workspace-scoped CWD + destructive-op approval gates
- `blob:sha256:` implementation (contract designed v1; runtime v2 when image artifacts arrive)
- `application/vnd.vegalite+json` and `image/png` cell renderers (MIME bundle contract v1; renderers v2)
- Magic commands (`%install`, `%cd`, `%%shell`, `!cmd`) — cell-parser hook supports them; default magic set ships v2
- Bun migration evaluation (separate spec)
- **Additional persona bundles** (PM, Founder/CoS, Ops/SRE, etc.) — infrastructure ships v1; bundles are separate npm packages on the community/team roadmap. Each is `@<scope>/otto-persona-<name>` and installable via `otto persona install <source>`. Only `default` (built-in) and `@cmetech/otto-persona-noc-ops` (bundled) ship in v1.
