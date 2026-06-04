# Otto Co-worker — Roadmap and Out-of-Scope Reference

**Source of truth:** `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` (§ 8 phasing, § 9 out-of-scope).
**Last updated:** 2026-06-02 (Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 3.1 + Phase 4 + Phase 4.5 complete) + 1.3.0 xlsx-restoration via SheetJS CE.

This document summarizes every phase of the Otto co-worker initiative — what each phase delivers, what's complete, and what each currently-out-of-scope item would bring if implemented later.

---

## The North Star — canonical 3-day P1 RCA scenario

Spec § 4 defines a single end-to-end NOC scenario the whole system is designed to support. Every phase contributes one capability to it:

- **Day 1** — analyst gets paged; attaches a scratchpad; queries ServiceNow + Datadog through `/connect`-configured engines; captures notes via memory; persists state.
- **Day 2** — re-attaches; verbatim recall of yesterday's incident notes; runs more queries; the scratchpad still has yesterday's polars DataFrames in memory; builds on day-1 data.
- **Day 3** — Otto's daily digest fires; analyst curates the lessons learned in <1 minute; hands off a clean markdown RCA artifact with full two-turn provenance.

After Phase 6, a fresh `npm install otto` should drop a user into this scenario without reading any docs — time-to-first-artifact under 5 minutes.

---

## Phase summary

### Phase 0 — Foundations ✅ COMPLETE (1 week)

**Pillar:** infrastructure for everything else.

**What it ships:**
- All four pillar package shells (`@otto/coworker-scratchpad`, `@otto/coworker-memory`, `@otto/coworker-vault`, `@otto/coworker-artifacts`) plus `@otto/coworker-types`, `@otto/coworker-utils`, `@otto/coworker-persona`.
- Migration framework (every package has `migrations/`, version registry, load-time runner).
- NDJSON IPC helpers shipped (`ndjson-channel.ts`).
- Lease helper shipped.
- SecretScanner stub shipped.
- Logger published.
- `PersonaRegistry` with install / activate / switch.
- Built-in `default` persona auto-activates.
- Status-line persona chip wired.
- `/persona` slash commands functional.

**Milestone (achieved):** `npm install` brings four pillar package shells + types + utils + **persona** package; CI green.

---

### Phase 1 — otto-scratchpad ✅ COMPLETE (weeks 2–3)

**Pillar:** persistent JavaScript runtime with cell history.

**What it ships:**
- ScratchpadManager with bounded LRU kernel pool + idle eviction + exclusive locks + force-takeover.
- ChildProcessRuntime with two-tier timeout (total + inactivity), progress heartbeat, cancellation escalation.
- Pre-bound data libraries in every cell: polars, DuckDB (on-disk via `otto.duckdb`), ExcelJS, dateFns, lodash, zod, axios.
- FileCollector + `otto.collectors.{list,open}` facade.
- Append-only `cells.jsonl` cell journal.
- v8-serialized `namespace.json` snapshot/restore.
- `/sp` surface: `list | new | attach | reset | view | remove | tree | fork | save | detach | clear-history | notes`.
- `cw_scratchpad` LLM tool with `exec` + `view` actions and MIME bundle responses.
- Per-session `currentName` sidecar so `/resume` restores attachment across sessions.
- On-attach UX banners: unseen recovery notes + kernel-state divergence + force-takeover prompt.
- Atomic-rename for namespace.json + meta.json (crash-safe writes).
- Fork exit timeout + SIGKILL escalation to prevent hangs.

**Milestone (achieved):** NOC user creates a named scratchpad, loads a CSV via FileCollector, queries with polars/DuckDB, state survives Otto exit; `/sp tree` and `/sp fork` work; bounded pool + LRU eviction + heartbeat + env filter in place.

---

### Phase 2 — otto-vault (week 4) — COMPLETE

**Pillar:** credential storage with safe kernel handoff.

**What it ships:**
- `@otto/coworker-vault` graduates from stub to real implementation.
- `/connect` slash command for entering credentials interactively.
- chmod-600 file storage in `~/.otto/vault/`.
- Engine YAML registry (`engines/servicenow.yaml`, `engines/datadog.yaml`, etc.) seeded with shape definitions for common services.
- Kernel spawn injects vault-resolved values as env vars (so cell code reads `process.env.SERVICENOW_TOKEN` and never sees the secret in chat).
- SecretScanner gate active on cell input/output (prevents secrets from leaking back into the cell journal).

**Milestone:** `/connect jira <name>` stores creds; next `/sp new --use jira:<name>` cell spawns with `OTTO_DS_JIRA_<NAME>__URL` + `OTTO_DS_JIRA_<NAME>__EMAIL` + `OTTO_DS_JIRA_<NAME>__TOKEN` env vars; cell can hit the Jira REST API.

**Note (2026-06-02):** Phase 2 ships JIRA as the only seeded engine. ServiceNow / IMAP / Datadog / SolarWinds / generic-REST seeds deferred to Phase 2.5 / Phase 6 — `EngineRegistry` is structurally ready; only the YAML content awaits.

**Dependencies:** Phase 0 (vault package shell + SecretScanner stub).

---

### Phase 1.5 — Phase 1 polish wave (proposed; ~1 week, between Phase 1 and Phase 2)

**Pillar:** scratchpad ergonomics + UX clarity. NO new pillar; tightens what Phase 1 shipped.

**Why this phase exists:** Phase 1 human testing surfaced three ergonomic gaps that don't fit naturally into Phase 2+ (which adds new pillars). Bundling them into a dedicated polish wave keeps Phase 2's scope clean and prevents users from attributing scratchpad friction to vault/memory/artifacts work that's actually downstream.

**What it ships** (per `docs/superpowers/notes/2026-06-01-coworker-phase-1-known-issues.md`):

- **Issue 1 — polars → DuckDB registerDf helper.** Adds `otto.duckdb.registerDf(name, df)` in `packages/coworker-scratchpad/src/kernel-bindings.ts`. Detects input type (polars DataFrame / Arrow Table / plain array of records) and routes to the appropriate DuckDB load path. Cuts the scenario-3 cell count from 8 → 2.
- **Issue 2 — meta.json write-order fix in `attachUnmanaged`.** Either reorder spawnRuntime BEFORE writeMeta, or add a second writeMeta after spawn. Stops the `kernel_db.present: false` + `size_bytes: 0` staleness on fresh attach.
- **Issue 4 — pool visibility + explicit eviction.** Adds idle-age column to `/sp list` (`● live  t04-tree  idle 4m22s`) plus a new `/sp evict <name>` slash command + `manager.evict(name)` method that snapshots-then-disposes without removing the on-disk artifacts. Lets users see why a kernel is still live and dispose it immediately when desired.
- **Issue 5 — `/sp attach` strict-existence check.** Currently `/sp attach <typo>` silently auto-creates a phantom scratchpad. Add a `existsSync(metaPath)` guard in `case 'attach':` that errors `scratchpad not found: <name>. Use /sp new <name> to create it.` LLM tool path (`cw_scratchpad action=exec`) is unaffected — only the slash command tightens.
- **Issue 6 — workspace-level auto-restore on fresh launch.** Currently `otto` (no `--resume`) doesn't pick up the last-attached scratchpad — the canonical 3-day RCA scenario's day-2 UX ("type `otto`, you're back where you were") doesn't actually work. Add a workspace-keyed sidecar at `~/.otto/scratchpads/_workspaces/<hash>.json` consulted on `session_start` after the per-sessionId sidecar miss. Honors the spec's headline UX without touching Otto's session model. **Highest priority within Phase 1.5** because it directly affects the headline use case.

**Milestone:** scenario 3 completes in ≤ 3 cells; `/sp list` shows idle ages; `/sp evict <name>` works and is reversible; `/sp attach <typo>` errors rather than silently creating; **fresh `otto` launch in a workspace with recent scratchpad activity auto-restores the last-attached scratchpad**.

**Dependencies:** Phase 1 complete (✅).

**Not in scope:** Issue 3 (LLM "ask if unsure" reliability) — accepted as inherent LLM behavior, not a code fix.

**Estimated effort:** ~6 days single-engineer (Issue 1: 1-2d, Issue 2: 0.5d, Issue 4: 1-2d, Issue 5: 0.5d, Issue 6: 1d, plus tests + docs + manual smoke).

**Status:** proposed. If Phase 2 is starting urgently, defer to Phase 6 (NOC persona bundle) where UX polish for analysts gets natural priority. If there's a 1-week gap before Phase 2 begins, this is the highest-leverage way to spend it.

---

### Phase 3 — otto-memory A+B + backend interface (weeks 5–6) — COMPLETE

**Pillar:** read-path memory (verbatim recall).

**What it ships:**
- `@otto/coworker-memory` graduates from stub.
- `MemoryBackend` interface + `LocalSqliteBackend` reference implementation.
- Three scoping modes: workspace / global / session.
- Memory write happens at session_shutdown; read happens via context-injection.
- Config knobs for memory budget, scope defaults, retention.
- SecretScanner gate live on memory writes (no PII / secrets leak in).
- `noEmbeddings: true` (Phase 3 is exact-match recall only; embeddings deferred — see out-of-scope).

**Milestone:** Day-2 verbatim recall — paste a long incident note on Monday, ask Otto on Tuesday "what did the on-call say about the load balancer?" → exact words come back.

**Note (2026-06-02):** Phase 3 ships Layers A + B with the `LocalSqliteBackend` (FTS5/BM25). Layer C entity graph, ACC, Cerebellum, Consolidator, weekly digest, vector embeddings, and `HostedBackend` remain Phase 5. Cross-pillar: scratchpad's `FileCollector` loads land as `kind:'file_load'` drawers; scratchpad exposes `currentScratchpadName` so memory rooms align with active investigations. **Task 20 (auto-retain user-turn wiring) and the production extension activator hop for Task 19 are deferred to Phase 3.1** because the `coworker-memory` extension lacks a production activator (same gap as Phase 2 vault). The seam exists at `pi-coding-agent`'s `before_agent_start` + `agent_start` events; the recorder is complete and unit-tested at the API level.

**Dependencies:** Phase 0 (memory package shell, types).

---

### Phase 3.1 — Production activators (week 7) — COMPLETE

**Branch:** `feat/coworker-phase-3.1-activators` (merged to main as commit `<TBD merge sha>` on 2026-06-DD).
**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-3.1-activators-design.md`.
**Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-3.1-activators.md`.

**Pillar:** wires the three coworker extensions (memory, vault, scratchpad) to Otto's `ExtensionAPI` via three default-export activators with direct cross-imports (no shared bus, no combined entry).

**What it ships:**
- Phase 2's "Phase 2.1+ deferral" closed — `/connect`, `/datasource`, `/audit` slash-command registration now lives in the vault activator.
- Phase 3 Task 20 closure — auto-retain user turns via `before_agent_start` + `agent_start` event pair on `MemoryRecorder.recordTurn`.
- Phase 3 Task 19 production hop — scratchpad `onDataLoad → MemoryRecorder.recordFileLoad` callback now registered at the extension activation layer.
- Pre-existing test-glob gap surfaced in Phase 3 Task 23 — coworker extension test files now in `test:unit:compiled` glob (+198 tests in main suite).

**Locked decisions** (per spec §3): hardcoded `scopeMode: 'per-project-tagged'`; persona seeding helpers stay in place but activator does not invoke them in v1; init failures log + disable that pillar; `recordTurn` failures notify once per Otto process then silent.

**Milestone:** automated activator integration test at `packages/coworker-memory/src/activator-integration.test.ts` proves the wiring at the API layer. Live TUI smoke walkthrough remains pending (both `2026-06-02-phase-2-vault-smoke.md` and `2026-06-02-phase-3-memory-smoke.md` carry explicit PENDING placeholders).

**Dependencies:** Phase 2 (vault activation surface), Phase 3 (memory recorder).

> **Note (2026-06-DD):** Phase 4 (Cerebellum / ACC / Consolidator / weekly digest / Layer C entity graph per parent design spec §17) is the next phase. No Phase 3.2 currently planned.

---

### Phase 4 — otto-artifacts — COMPLETE

**Branch:** `feat/coworker-phase-4-artifacts` (merged to main as commit `<TBD merge sha>` on 2026-06-DD).
**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-4-artifacts-design.md`.
**Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-4-artifacts.md`.

Graduated `@otto/coworker-artifacts` from stub to workspace-scoped store. Ships:
- Markdown-only `report` artifact kind.
- Atomic `ArtifactStore` (slug derivation + collision suffix; tmp+rename writes; 0o700/0o600 modes).
- Pure-function `resolveArtifactUri()` and `renderReadme()` helpers.
- Append-only `provenance.json` with per-turn entries.
- Production activator at first commit — `/artifacts list|show|remove`, `list_artifacts` + `open_artifact` LLM tools, `getArtifactStore()` cross-pillar getter.
- Kernel-side `otto.artifact.create()` + `spillIfLarge()` bindings (RPC over NDJSON stdio).
- Scratchpad manager `onArtifactCreate` fan-out → memory `recordArtifact` drawer.
- Memory migration 002: `'artifact'` added to `DRAWER_KINDS` (CHECK constraint table rebuild).

Locked decisions per spec §3: workbook + dataset kinds deferred; URI resolver is pure function; activator ships with package; spill is explicit (10 KB default threshold); provenance is append-only.

Live TUI smoke walkthrough is pending (`2026-06-02-phase-4-artifacts-smoke.md` PENDING placeholder); automated integration tests at `packages/coworker-artifacts/src/artifacts-integration.test.ts` prove the wiring at the API + disk layer.

> **Note (2026-06-DD):** Phase 5 (Layer C entity graph + ACC + Cerebellum + Consolidator + daily digest) is unblocked — depends on Phase 3 + Phase 4 per roadmap. Phase 4 closes one of the two prereqs.

---

### Phase 4.5 — Subagent-scratchpad scoping — COMPLETE

**Branch:** `feat/coworker-phase-4.5-subagent-scratchpad` (merged to main as `<TBD merge sha>` on 2026-06-DD).
**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-4.5-subagent-scratchpad-design.md`.
**Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-4.5-subagent-scratchpad.md`.

Subagent dispatcher auto-mints a dedicated scratchpad per child process (`subagent-<agent>-<6-hex>`); child `pi` reads `OTTO_SUBAGENT_SCRATCHPAD` env var at `session_start` and force-attaches before any sidecar/pointer restore. Scratchpads persist after subagent exit; parent inspects via `/sp attach <name>`. Run records track `scratchpad_name`. Artifacts + memory drawers flow up to workspace level as before; subagent drawers tagged `room=subagent-<id>` for filtering.

Locked decisions per spec §3: auto-mint (no caller override); persistent lifecycle; env-var discovery; no extra return handoff. ~320 LOC delta, 5 tasks.

Live TUI smoke walkthrough is pending (`2026-06-02-phase-4.5-subagent-scratchpad-smoke.md` PENDING placeholder); automated unit tests at `src/resources/extensions/{subagent,coworker-scratchpad}/*.test.ts` prove the wiring at the unit layer.

---

### Phase 5 — otto-memory C+D + ACC + Cerebellum + Consolidator + digest (weeks 8–9)

**Pillar:** reflective memory — Otto learns from yesterday.

**What it ships:**
- ACC (Associative Content Classifier) — categorizes incoming content into memory buckets.
- Cerebellum — distills repeated tool-use patterns into reusable skills.
- Two-phase Consolidator (lease-guarded) produces:
  - `MEMORY.md` — the curated long-term memory state.
  - `memory_summary.md` — a short rolling summary for fast context injection.
  - Optional `skills/` directory — Cerebellum's distilled skill files.
- Daily digest fires at session_start — "here's what I learned yesterday" — and the user curates lessons / merges entities in <1 minute.
- `memory://` URI resolver live (memory cells become referenceable by URL).

**Milestone:** Day-3 scenario — digest summarizes day 2's incident; user accepts/rejects each lesson with one keystroke; `MEMORY.md` updates.

**Dependencies:** Phase 3 (memory backend), Phase 4 (artifact URIs).

---

### Phase 6 — Integration + ship + NOC persona bundle (week 10)

**Pillar:** the canonical NOC persona, end-to-end.

**What it ships:**
- `@cmetech/otto-persona-noc-ops` package, published to npm and bundled as the default install for the NOC tier.
- Steering files specific to NOC analyst workflows.
- Memory seed (common NOC entities, runbook references).
- Engine seeds for ServiceNow / IMAP / Datadog / SolarWinds.
- RCA + inventory artifact templates.
- NOC-specific skills (incident triage helpers, escalation flows).
- Integration testing across all five preceding phases.
- Clean-install user can run the canonical scenario without reading docs.

**Milestone:** Fresh `npm install otto` → run the canonical 3-day P1 RCA scenario end-to-end with time-to-first-artifact < 5 minutes.

**Dependencies:** ALL prior phases.

---

## Phase calendar (parallel-friendly)

Single-stream is ~10 weeks. With 3 engineers in parallel:

```
Week:   4   5   6   7   8   9   10
        |   |   |   |   |   |   |
        [Phase 2: vault                          ]
            [Phase 3: memory A+B                 ]
                        [Phase 4: artifacts      ]
                            [Phase 5: memory C+D + consolidator]
                                            [Phase 6: integration + persona]
```

Phases 2 + 3 are independent. Phase 4 can overlap the back half of phase 5.

---

## Resolved out-of-scope items

These entries were previously listed under § Out-of-scope but have since been promoted into a real release.

### xlsx capability in scratchpad

**Status:** Resolved on the 1.3.0 release date.

**Shipped:** SheetJS Community Edition bound as `XLSX` in the scratchpad cell sandbox. Vendored at `vendor/xlsx-0.20.3.tgz` so end-user installs do not reach `cdn.sheetjs.com`. CE → Pro upgrade path documented in `vendor/README.md`.

**Spec:** `docs/superpowers/specs/2026-06-03-sheetjs-ce-binding-design.md`
**Plan:** `docs/superpowers/plans/2026-06-03-sheetjs-ce-binding.md`

---

## Out-of-scope reference (§ 9)

These are intentionally deferred from the v1 roadmap. Each entry below describes:
1. **What it is** today (often a stub interface).
2. **What implementing it would bring** if a future phase picks it up.

### Vector embeddings / hybrid recall (LanceDB)

**Today:** `MemoryBackend` interface accepts an `embeddings` field; v1 ships with `noEmbeddings: true`. Recall is exact-match only.

**What it would bring:** semantic recall. Ask Otto "what did the network guy say about throughput?" and find notes that mention "bandwidth" or "latency" even though the literal word "throughput" never appears. Massive improvement on natural-language queries. LanceDB-backed for local-first, no cloud dependency.

**Cost:** non-trivial — adds an embedding-model dependency (local SentenceTransformers or remote API), storage overhead for vectors, and a hybrid scoring layer that blends exact-match with semantic similarity.

### Real API collector implementations (ServiceNow, Datadog, etc.)

**Today:** the collector facade (`FileCollector` + `otto.collectors` binding) ships v1. Real API collectors are stubs — you can write custom cell code to hit those APIs via vault-injected creds, but there's no built-in `otto.collectors.open('servicenow://incident-INC0012345')` that handles auth + pagination + schema introspection automatically.

**What it would bring:** zero-code data ingestion from common NOC sources. `otto.collectors.list()` returns `['file', 'servicenow', 'datadog', 'imap', 'solarwinds']`; `otto.collectors.open('datadog://logs?query=...&from=...')` returns a polars DataFrame ready for analysis. Big productivity win once vault (phase 2) is in place.

### MCP / ACP collectors

**Today:** same facade as the API collectors; no MCP/ACP-specific implementations.

**What it would bring:** any MCP server registered with Otto becomes a first-class data source addressable via `mcp://` URIs. Cell code can pull data from any MCP-compliant tool without bespoke integration. Similar for ACP. Effectively turns the scratchpad into a universal data-analysis frontend for the MCP ecosystem.

### HTML / PDF artifact rendering

**Today:** artifacts ship as markdown only (Phase 4 milestone).

**What it would bring:** polished deliverables for stakeholders outside Otto. The Phase 6 NOC user can hand a CFO a PDF RCA, or attach an HTML report to a ServiceNow ticket. Markdown is fine for the analyst's eyes, but printable formats are the natural escalation path.

**Cost:** pulls in a renderer dependency (Puppeteer / Playwright headless for HTML→PDF, or Pandoc for markdown→PDF). Increases install size meaningfully.

### Publish / share infrastructure

**Today:** artifacts are local-only. The `artifact://` URI resolves to a local-disk path; there's no way to send the artifact to a teammate without manual `cp` + email.

**What it would bring:** `otto artifact share <id> --to <target>` where `<target>` can be Confluence, S3, Slack, GitHub Gist, etc. Closes the loop from "Otto produced an artifact" to "the team has consumed it." Critical for incident communication.

### Multi-channel dispatch (Slack / Telegram inbound)

**Today:** Otto is a terminal application. Sessions only originate from a TTY.

**What it would bring:** the on-call analyst can ask Otto questions from their phone via Slack DM or Telegram. Otto runs the kernel server-side, returns results inline in the chat channel. Removes the "I need to be at my laptop to consult Otto" friction during after-hours pages.

**Cost:** requires Otto to run as a daemon with auth, persistent sessions, and a webhook receiver. Substantial new surface.

### Python subprocess scratchpad

**Today:** scratchpad cells are TypeScript only (node:vm). The kernel-protocol abstraction would allow another language, but no Python kernel is implemented.

**What it would bring:** cells written in Python — numpy / pandas / scipy / sklearn / matplotlib. Some analysts prefer Python; this opens the door without forcing the TS ecosystem. Could share `kernel.db` across kernels of different languages.

**Cost:** new kernel implementation, separate package management (pip), separate sandboxing rules. Roughly the same complexity as the v1 TS kernel.

### OS keychain integration for vault

**Today:** vault uses chmod-600 files at `~/.otto/vault/`. The `VaultBackend` interface accepts other backends but only `FileBackend` is implemented.

**What it would bring:** real OS-level secret storage — macOS Keychain (`security` command), Windows Credential Manager, Linux Secret Service (gnome-keyring / kwallet). Stronger than file perms because the OS handles secret-at-rest encryption. Survives `~/.otto` deletion.

**Cost:** three platform-specific implementations behind one interface. Moderate.

### Cross-workspace memory federation

**Today:** memory is workspace-scoped or global-per-user. There's no "team memory" or "shared incident knowledge base."

**What it would bring:** a NOC team where each analyst's incidents inform a shared "what we've seen before" knowledge base. Otto on analyst A's laptop can recall an incident that analyst B handled last week, with proper attribution. Massive force multiplier for a team.

**Cost:** non-trivial — needs sync protocol, conflict resolution, access control. Probably its own dedicated phase post-v1.

### Process sandboxing beyond CWD + destructive-op approval gates

**Today:** scratchpad cells run in `node:vm` context with full filesystem access (technically restricted by CWD but in practice the process can reach anywhere). Destructive operations are not gated by user approval at the kernel level (though Otto's outer slash-command layer prompts on some operations).

**What it would bring:** harder sandboxing — read-only by default, write requires explicit approval, network egress restricted to vault-known endpoints, resource limits (RAM, CPU time, fd count). Closes the "what if a cell does `rm -rf ~`" risk. Important if Otto is ever run against untrusted prompts or third-party-authored skills.

**Cost:** significant — likely needs a real sandbox (Deno, Bun's permissions, or wasm + WASI). Touches the kernel-protocol contract.

### `blob:sha256:` content-addressed binary storage

**Today:** the contract is designed (cell outputs CAN carry `blob:sha256:<hex>` URIs in their MIME bundle), but the runtime that materializes those blobs is v2.

**What it would bring:** images, screenshots, PDFs, and other binary artifacts get the same first-class treatment as text artifacts. Cells can return images that survive across sessions, get deduped by content, and are reference-counted by the artifact store. Substrate for vegalite/PNG renderers (next item).

### `application/vnd.vegalite+json` and `image/png` cell renderers

**Today:** MIME bundle contract supports these (`scratchpad-tool.ts` emits `mime: { 'application/vnd.vegalite+json': ... }` if a cell returns a vega spec), but the rendering layer is v2.

**What it would bring:** charts and plots from polars / DuckDB cells render inline in Otto chat. A cell that produces a vega-lite line chart of incident counts over time displays as the chart, not JSON. Hugely improves analyst UX — no more "let me copy this to a notebook to see the chart."

**Cost:** depends on Otto's TUI layer — vega-lite-to-PNG via vega-cli, or a markdown-renderer that knows vega-lite, or a terminal-image-protocol (Kitty / iTerm2 / sixel) for inline rendering.

### Magic commands (`%install`, `%cd`, `%%shell`, `!cmd`)

**Today:** the cell parser supports a hook for magic commands but the default magic set is v2.

**What it would bring:** Jupyter-style ergonomics inside a scratchpad cell. `%install zod@latest` installs a package without restart. `%cd /tmp` changes the kernel's CWD. `%%shell` followed by shell text runs the rest of the cell as a shell command. `!ls -la` is shorthand for the same. Closes a meaningful gap with Jupyter/IPython workflows.

**Cost:** needs sandbox decisions (what's allowed in `%%shell`?), package-install integration (npm install in the kernel CWD), and CWD-mutation semantics. Mostly straightforward once the policy is decided.

### Bun migration evaluation

**Today:** Otto runs on Node 22. The kernel subprocess uses `process.execPath` + filtered execArgv.

**What it would bring:** faster startup (~10-50× per kernel spawn), simpler dependency model (Bun bundles many tools), smaller install footprint. Not user-visible per se — same scratchpad surface, less waiting. Especially relevant for the `/sp new` → first-cell cold path.

**Cost:** every native-Node dependency would need a Bun compatibility audit (`@duckdb/node-api` in particular). Bun is still maturing on some npm packages. Probably an in-place evaluation spec, not a migration commitment.

### Additional persona bundles beyond `default` + `noc-ops`

**Today:** v1 ships `default` (built-in) and `@cmetech/otto-persona-noc-ops` (bundled).

**What it would bring:** Otto adapts to different professional contexts out of the box. Candidate bundles:

- **PM** (`@cmetech/otto-persona-pm`) — product manager workflows: PRD authoring, roadmap entity extraction, customer-feedback memory seeds, RICE artifact templates.
- **Founder / CoS** (`@cmetech/otto-persona-founder`) — board prep, investor update artifacts, OKR memory, vendor/legal vault seeds.
- **Ops / SRE** (`@cmetech/otto-persona-sre`) — postmortem templates beyond NOC RCAs, capacity planning skills, terraform/k8s engine seeds.
- **Data analyst** (`@cmetech/otto-persona-analyst`) — DuckDB + polars skill emphasis, dashboard artifact templates, BI tool engine seeds.

Each is its own npm package installable via `otto persona install <source>`. The infrastructure (`PersonaRegistry` + `/persona` commands) shipped in Phase 0 already supports this; only the content packages need to be authored.

**Cost:** content authoring per persona — steering files, memory seeds, engine YAMLs, artifact templates. Each persona is a few thousand lines of curated context.

---

## How to read this document

- If you're planning the next phase: §`Phase N` tells you what's in scope; check the **Dependencies** line for prerequisites.
- If you're asked "can Otto do X?" and X is in §`Out-of-scope`: the answer is "not in v1; here's what implementing it would deliver."
- If you're auditing Phase 1's surface: cross-reference with `docs/superpowers/notes/2026-06-01-coworker-phase-1-human-tests.md` (15-scenario walkthrough of everything 1a–1g3 ships).

This is a living document. When a phase completes, mark it ✅ COMPLETE and add a `**Shipped:**` line with commit refs. When an out-of-scope item is promoted into a phase, move it out of § Out-of-scope and into the relevant phase summary.
