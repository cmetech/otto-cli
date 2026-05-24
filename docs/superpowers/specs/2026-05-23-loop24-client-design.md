# LOOP24 Client — Design Spec

**Date:** 2026-05-23
**Status:** Draft, awaiting review
**Owner:** corey@cmetech.io
**Codename:** LOOP24
**Repository:** `~/Projects/repos/local/loop24-client` (local; will not be hosted externally for v1)

---

## 1. Overview

LOOP24 is a terminal-based chat assistant for developers. It is a **permanent hard fork of gsd-pi** (source repo: `~/Projects/repos/local/gsd-pi`) that:

- Routes all LLM traffic through `loop24-gateway` (an internal proxy) for compliance.
- Keeps local tool execution (filesystem, bash, git) on the developer's laptop.
- Adds an `loop24` extension hosting custom commands — primarily LangFlow workflow triggers and a ported flow-authoring skill.
- Re-brands the terminal UI with the Loop24 visual identity (yellow `#FAD22D` primary, brand-coloured block banner).
- Strips all `gsd` references from user-visible surfaces and makes the command namespace configurable.

LOOP24 is **not** trying to be a general-purpose AI assistant. It is a developer agent that happens to also trigger non-coding workflows through LangFlow.

### Goals

| # | Goal |
|---|------|
| G1 | Every LLM token leaves the laptop through `loop24-gateway`, never directly to a model provider. |
| G2 | Preserve gsd-pi's core developer workflow commands (`/discuss`, `/plan`, `/execute`, `/quick`) and its `.planning/` cross-session memory verbatim. |
| G3 | Make it trivial to add new declarative LangFlow flow-trigger commands (one YAML file per command, no code). |
| G4 | Port the existing `langflow-flow-builder` Claude Code skill to a first-class Pi extension. |
| G5 | Visual rebrand to Loop24 — brand colours, block banner, no "Pi" or "GSD" strings in the user-facing surface. |
| G6 | Distribution Phase 1: clone + install script. Phase 2: `npm install -g @loop24/client` from an internal registry. |

### Non-goals (v1)

- Web UI, VS Code extension, native desktop app, Rust acceleration. All dropped from the fork.
- SSO / OIDC authentication. v1 uses optional static bearer tokens.
- Telemetry from the client. Gateway request logs are the audit trail.
- Tracking upstream gsd-pi. The fork is permanent; we may read upstream commits for inspiration but never merge.
- Multi-provider LLM support. Anthropic only, through the gateway.

---

## 2. Architecture

LOOP24 has three external boundaries:

```
                            ┌──────────────────────────┐
                            │   loop24-gateway         │
              ┌────────────►│   (mandatory, local)     │
              │             │   /v1/messages           │
              │   Anthropic │   proxies → Anthropic    │
              │   SDK shape └──────────────────────────┘
┌─────────────┴──────┐
│                    │      ┌──────────────────────────┐
│   LOOP24 client    │      │   langflow server        │
│   (terminal CLI)   │─────►│   (optional, local)      │
│                    │ HTTP │   :7860, optional API key│
└──────┬─────────────┘      └──────────────────────────┘
       │
       │  local exec (no network)
       ▼
   filesystem, bash, git
```

Three principles make this work:

1. **One LLM seam.** All LLM traffic exits through `packages/pi-ai/src/stream.ts`. Pointing it at the gateway is configuration (`ANTHROPIC_BASE_URL` + optional auth header), not a code change.
2. **Local tools are LLM-agnostic.** The bash/read/write/edit tools execute on the laptop; results flow back to the model as `tool_result` blocks. No coupling to the provider.
3. **LangFlow is a client of LOOP24, not a model provider.** It's an HTTP service that LOOP24's `loop24` extension talks to from inside its own commands and tools. It is never in the LLM dispatch path.

### Compliance model

Every model token leaves through `loop24-gateway`. LangFlow flows that themselves invoke LLMs handle their own compliance (their flow definitions point at the gateway).

The gateway is run locally on the developer's laptop in v1. Auth is optional — if `gateway.token` is configured in `~/.loop24/config.json`, LOOP24 adds an `Authorization: Bearer …` header; otherwise the header is omitted.

---

## 3. Folder layout

```
loop24-client/
├── package.json              # piConfig: name, configDir, commandNamespace, brandName
├── README.md · CHANGELOG.md · LICENSE
├── tsconfig*.json · .gitignore · .npmrc
│
├── src/
│   ├── loader.ts             # LOOP24 banner, gateway env defaults
│   ├── cli.ts
│   └── resources/extensions/
│       ├── workflow/         # ← renamed from gsd/; provides /loop24 discuss|plan|execute|quick
│       ├── async-jobs/ · shared/
│       └── loop24/           # ← NEW — everything LOOP24-specific
│           ├── extension.json
│           ├── clients/
│           │   ├── gateway.ts          # baseURL + auth wrapper around @anthropic-ai/sdk
│           │   └── langflow.ts         # HTTP client: trigger / status / list / cancel
│           ├── commands/
│           │   ├── flow-triggers/
│           │   │   ├── _loader.ts      # scans *.yaml → registers slash commands
│           │   │   └── *.yaml          # one declarative command per file
│           │   ├── flow-status/        # imperative TS: /loop24 flows list|status|cancel
│           │   ├── prompt-engineer/    # imperative TS: refine user input into polished prompt
│           │   └── flow-builder/       # ported skill (see §6.2)
│           ├── tools/
│           │   └── scripts/            # Python scripts bundled from langflow-flow-builder
│           ├── reference/              # markdown reference docs loaded as context
│           │   ├── component-catalog-rules.md
│           │   ├── edge-handle-rules.md
│           │   ├── flow-json-rules.md
│           │   └── workflow.md
│           ├── theme/
│           │   └── loop24.json         # Loop24 Signal palette (see §4)
│           └── branding/
│               ├── banner.txt          # LOOP24 ASCII art (block style)
│               └── strings.ts          # window title, prompts, footer — reads BRAND_NAME
│
├── packages/
│   ├── pi-coding-agent/      # forked; minor edits to read commandNamespace + brand strings
│   ├── pi-ai/                # forked; Anthropic provider reads gateway baseURL from config
│   ├── pi-tui/               # forked as-is
│   ├── pi-agent-core/        # forked as-is
│   ├── contracts/ · daemon/ · mcp-server/ · rpc-client/
│   └── (native/ optional — drop for v1)
│
├── scripts/
│   ├── install.sh            # Phase 1 distribution: clone + install + symlink + wizard
│   └── …
│
├── docs/
│   └── superpowers/specs/    # design docs live here
│
└── tests/

DROPPED from gsd-pi fork:
  web/  ·  vscode-extension/  ·  studio/  ·  native/ (Rust binaries)
```

**Isolation principle:** everything LOOP24-specific lives in `src/resources/extensions/loop24/`. Outside that directory, fork edits are minimized to four files:

- `package.json` (piConfig)
- `src/loader.ts` (banner, env defaults)
- `packages/pi-ai/src/providers/anthropic.ts` (default baseURL fallback)
- `packages/pi-coding-agent/src/config.ts` (exports `COMMAND_NAMESPACE`, `BRAND_NAME`)

A new file `LOOP24-PATCHES.md` at the repo root documents every other edit we make to the fork, so future maintainers can see them at a glance.

---

## 4. Branding & theming

### Visual identity — "Loop24 Signal"

Drawn from the Oscar admin UI brand palette (`oscar_app/oscar-adminui/src/layouts/UserThemeOptions.js`).

| Role | Hex | Brand source |
|---|---|---|
| Background | `#0C0C0C` | `brandBlack` |
| Foreground | `#FAFAFA` | `brandWhite` |
| Primary / accent | `#FAD22D` | brand primary yellow |
| Secondary | `#4D97ED` | `brandSecondary1` |
| Tertiary (`.planning/` paths) | `#AF78D2` | `brandPurple` |
| Success | `#3FCE8E` | `brandGreen1` |
| Warning | `#FF8C0A` | `brandOrange` |
| Error | `#FF5B5B` | `brandRed1` |
| Muted | `#767676` | `brandGray2` |
| Dim | `#A0A0A0` | `brandGray3` |

**Usage conventions:**

- Yellow is the LOOP24 mark, the prompt indicator (`›`), the active cursor, and the leading column on every command line. It is the brand DNA the user sees most often.
- Blue is reserved for file paths, "in-progress" markers, and link-like elements.
- Purple is reserved exclusively for `.planning/`-scoped artifacts (`PHASE.03/PLAN.md`, etc.) so the eye separates "framework state" from "your code".
- Status colours come straight from the brand greens / oranges / reds — no custom shades.

Light theme is deferred. Dark only in v1.

### Banner

ASCII block-style "LOOP24" rendered in primary yellow on background black, followed by a one-line meta strip:

```
██╗      ██████╗  ██████╗ ██████╗ ██████╗ ██╗  ██╗
██║     ██╔═══██╗██╔═══██╗██╔══██╗╚════██╗██║  ██║
██║     ██║   ██║██║   ██║██████╔╝ █████╔╝███████║
██║     ██║   ██║██║   ██║██╔═══╝ ██╔═══╝ ╚════██║
███████╗╚██████╔╝╚██████╔╝██║     ███████╗     ██║
╚══════╝ ╚═════╝  ╚═════╝ ╚═╝     ╚══════╝     ╚═╝

compliant agent for developers · v0.1.0 · gateway: connected · langflow: offline
```

Stored as `src/resources/extensions/loop24/branding/banner.txt`. The meta strip is constructed at runtime from version + connection-check results.

---

## 5. Configurable namespace

### Problem

gsd-pi hard-codes "gsd" throughout the workflow extension: command names (`/gsd auto`, `/gsd status`), prompt templates ("Use the GSD planning system to…"), file names (`.gsd.db`), and the extension directory itself. LOOP24 needs to ship without any "gsd" in user-visible places, and the namespace should be configurable in **one** place so we never repeat this renaming exercise.

### Solution

Extend `package.json`'s `piConfig` block:

```json
{
  "piConfig": {
    "name": "loop24",
    "configDir": ".loop24",
    "commandNamespace": "loop24",
    "brandName": "LOOP24"
  }
}
```

Read in `packages/pi-coding-agent/src/config.ts`, exported as constants:

```typescript
export const APP_NAME: string = pkg.piConfig?.name || "loop24";
export const CONFIG_DIR_NAME: string = pkg.piConfig?.configDir || ".loop24";
export const COMMAND_NAMESPACE: string = pkg.piConfig?.commandNamespace || "loop24";
export const BRAND_NAME: string = pkg.piConfig?.brandName || "LOOP24";
```

### What gets templated

| Surface | Before (gsd-pi) | After (LOOP24) |
|---|---|---|
| Extension directory | `src/resources/extensions/workflow/` | `src/resources/extensions/workflow/` (renamed once, neutral name) |
| Slash command registration | `"gsd-auto"`, `"gsd-status"` | `` `${COMMAND_NAMESPACE}-auto` ``, `` `${COMMAND_NAMESPACE}-status` `` |
| Command shape | `/gsd auto` (space-separated subcommand) | `/loop24 auto` (same pattern, namespace is the top-level command) |
| Prompts referencing "GSD" | hardcoded `"GSD"` strings in prompt files | `${BRAND_NAME}` template variables read from a small `strings.ts` |
| State db filename | `.gsd.db` | `` `.${COMMAND_NAMESPACE}.db` `` → `.loop24.db` |
| User-facing config dir | `~/.gsd/` | `~/.loop24/` (already handled via `CONFIG_DIR_NAME`) |
| Persistent planning dir | `.planning/` | **unchanged** — name is already generic; renaming adds nothing |

### Command shape (chosen)

**Space-separated subcommand** (`/loop24 plan`, `/loop24 status`), matching gsd-pi's current handler-registration pattern. If a user sets `commandNamespace: ""` (empty), routing falls back to bare top-level commands (`/plan`, `/status`).

### Refactor scope

The `workflow/` extension is ~350 files. The namespace refactor touches:

- Command registration sites (`commands-do.ts`, `commands-maintenance.ts`, and friends) — finite, locatable via grep for `"gsd-"` and `"gsd "`.
- Prompt templates that mention "GSD" by name — extracted to `workflow/strings.ts` with `BRAND_NAME` interpolation.
- Auto-mode mentions and onboarding text — same extraction.

This is done **once** in Phase 0, then never again. The work is purely mechanical: grep, replace, extract.

---

## 6. LangFlow integration

LOOP24's `loop24` extension exposes two distinct LangFlow surfaces.

### 6.1 Runtime triggers (declarative YAML)

One YAML file per slash command, dropped into `extensions/loop24/commands/flow-triggers/`. The `_loader.ts` scans the directory at startup and registers each one with Pi's command system.

**Schema:**

```yaml
# extensions/loop24/commands/flow-triggers/analyze-logs.yaml
name: analyze-logs
description: Pipe a log file through the log-triage LangFlow flow
flow:
  id: log-triage-v2              # OR: name: "Log Triage v2"
  server: ${LANGFLOW_SERVER_URL}  # optional override; defaults to global config
inputs:                           # how user args map to flow inputs
  - name: file
    type: file                    # file | string | number | bool
    required: true
    flowField: input_file
  - name: severity
    type: string
    default: warn
    flowField: min_severity
execution:
  mode: stream                    # stream | poll | fire-and-forget
  timeout: 300s
output:
  format: markdown                # markdown | json | raw
  render: inline                  # inline | file (write to .planning/) | both
```

User flow: `/loop24 analyze-logs file=./errors.log severity=error` → loader validates inputs → `clients/langflow.ts` POSTs to `POST /api/v1/run/<flow_id>` → results stream back through the same `AssistantMessageEventStream` that pi-ai uses for LLM responses, so the TUI renders them identically.

**Why declarative:** 95% of flow-trigger commands follow the same shape ("POST to flow X with these params, render result"). YAML keeps them addable without code review, and the schema is small enough to fit in a developer's head.

**Imperative escape hatch:** commands that need conditional logic, multi-step orchestration, or custom UX go in `commands/` as TypeScript modules (`flow-status/`, `prompt-engineer/`).

### 6.2 Authoring — ported `langflow-flow-builder` skill

The Claude Code skill at `~/Projects/repos/gitlab.rosetta.ericssondevops.com/loop_24/.claude/skills/langflow-flow-builder/` ports to a Pi extension feature with three pieces:

1. **Slash command** — `/loop24 build-flow <description>`. Loads `reference/workflow.md` and `reference/*.md` as turn-zero system context for the model.
2. **Tools** — each Python script becomes a typed Pi tool with a JSON schema (so the model gets argument validation, not free-form bash). Wrappers shell out to the bundled scripts.

   | Tool name | Script | Purpose |
   |---|---|---|
   | `refresh_catalog` | `refresh_component_catalog.py` | Pull current LangFlow component catalog |
   | `normalize_catalog` | `normalize_component_catalog.py` | Normalize into searchable JSON |
   | `inspect_component` | `inspect_component.py` | Show fields/edges for one component |
   | `validate_flow` | `validate_flow.sh` | JSON schema + edge validation |
   | `import_flow` | `import_flow.py` | POST flow to local LangFlow |
   | `smoke_test_flow` | `smoke_test_flow.py` | Run a generated flow with a test input |
   | `check_catalog_health` | `check_catalog_health.py` | Diagnose stale/missing catalog |

3. **Repository conventions** — the skill expects `flows/generated/`, `flows/templates/`, `flows/imported/`, `catalog/` in the user's repo. First invocation of `/loop24 build-flow` in a project creates them and adds the catalog cache to `.gitignore`.

### 6.3 Shared infrastructure

- **`clients/langflow.ts`** — single HTTP client used by both surfaces. Handles optional auth (`LANGFLOW_API_KEY`), retries on 5xx, streams SSE responses, surfaces structured errors.
- **Connection state** — banner reports `langflow: connected | offline` based on a `GET /api/v1/version` probe at startup.

### 6.4 The prompt-engineer command

Smallest piece. `/loop24 prompt-engineer <task description>` takes rough user input and produces a polished prompt for a coding task. Pure LLM call against the gateway with a templated system prompt. No LangFlow involved. Implemented as an imperative TS module in `commands/prompt-engineer/`.

---

## 7. Configuration, distribution, and auth

### Configuration file

`~/.loop24/config.json` (mode `0600`):

```json
{
  "gateway": {
    "url": "http://127.0.0.1:8080/v1",
    "token": null
  },
  "langflow": {
    "url": "http://127.0.0.1:7860",
    "apiKey": null,
    "enabled": true
  }
}
```

Both `token` and `apiKey` are nullable. If null, no `Authorization` header is sent. Suitable for local-only dev where neither service has auth configured.

> Note: gateway port `8080` is a placeholder until `loop24-gateway` lands and confirms its default — see Q1 in §10.

### Environment variable overrides

For CI / scripted use, env vars always win over config file:

- `LOOP24_GATEWAY_URL`
- `LOOP24_GATEWAY_TOKEN`
- `LANGFLOW_SERVER_URL`
- `LANGFLOW_API_KEY`

### First-run wizard

Extends gsd-pi's existing onboarding flow:

1. Detect missing `~/.loop24/config.json` → enter wizard.
2. Prompt for gateway URL (default `http://127.0.0.1:8080/v1`).
3. Validate via `GET /health` on the gateway. Soft-warn on failure but allow proceed.
4. Ask whether the gateway requires a token. If yes, prompt for it; otherwise leave null.
5. Ask whether LangFlow is in use (default yes). If yes, prompt for URL (default `http://127.0.0.1:7860`) and optional API key.
6. Validate LangFlow with `GET /api/v1/version`. Soft-warn on failure.
7. Write config. If cwd is a git repo, offer to initialize `.planning/`.

### Distribution

**Phase 1 — clone + install script.**

```bash
cd ~/Projects/repos/local
git clone <internal-repo>/loop24-client.git
cd loop24-client
./scripts/install.sh
```

`install.sh`:

- Verifies Node ≥22 and git
- Runs `npm install` and `npm run build`
- Symlinks `dist/loader.js` to `~/.local/bin/loop24` (prints `PATH` advice if needed)
- Launches the first-run wizard

**Phase 2 — internal npm registry.**

```bash
npm install -g @loop24/client
```

Requires a `.npmrc` pointing at an internal Verdaccio / Nexus instance with auth configured. Same source, same installer logic, packaged.

### Updates

On startup, `loader.ts` does a lightweight `git ls-remote` check against the install repo and notifies the user if a newer tag exists. **Never auto-pulls.** User runs `loop24 update` (or `git pull && npm run build`) when they want to upgrade.

### Telemetry

None. `loop24-gateway` request logs are the only audit trail.

---

## 8. Open dependencies & risks

### Hard dependencies (blocking)

1. **`loop24-gateway` Anthropic-shaped surface.** The gateway is pre-implementation. Its v1 spec exposes OpenAI (`/v1/chat/completions`, SSE) and Ollama (`/api/chat`, NDJSON) shapes only. The Anthropic-shaped `/v1/messages` endpoint is parked in v2 (`SURF-V2-01`). LOOP24 cannot run against the gateway until that surface ships.

   **Action:** track as a sibling project. The LOOP24 install wizard validates the gateway exposes `/v1/messages` and fails closed if not.

2. **Streaming + tool-use fidelity.** The gateway must preserve Anthropic's `tool_use` / `tool_result` block semantics through SSE without buffering, line-wrapping, or chunk munging — gsd-pi's local tool dispatcher depends on chunk-perfect forwarding.

   **Action:** define a contract test (recorded fixture: streaming tool-call interaction) that the gateway must pass before LOOP24 cuts over.

### Soft dependencies (degrade gracefully)

3. **LangFlow.** Optional. If unreachable, the banner shows `langflow: offline`, flow-trigger commands surface a clean error, and the rest of LOOP24 works.
4. **Component catalog freshness** for `langflow-flow-builder`. Requires `catalog/components.normalized.json` to be current. Mitigated by a `/loop24 catalog refresh` command that runs the bundled Python scripts.

### Risks worth naming

5. **The `workflow/` extension is large and tightly woven.** ~350 files inherited from gsd-pi's `gsd/` extension. We own it but don't fully understand it.

   **Mitigation:** treat as black-box for v1. Document every edit we make in `LOOP24-PATCHES.md` at the repo root so future maintainers see them.

6. **Existing workflow semantics may not perfectly fit non-coding work.** `/loop24 plan` and friends were built for software engineering tasks. A user typing `/loop24 plan organize my Downloads folder` may get awkward output.

   **Mitigation:** observe real usage. If we see this happen, add a non-coding workflow variant later (or steer non-coding work toward LangFlow flow-triggers).

7. **No upstream tracking means no free bug fixes.** Once forked, gsd-pi commits do not flow into LOOP24. If gsd-pi fixes a bug we have, we fix it independently.

   **Mitigation:** accepted. The user has explicitly chosen this model. We may read upstream commits for inspiration but do not merge.

### Out-of-scope risks (not addressed in v1)

- Multi-user sessions, shared state between developers
- Cross-laptop sync of `.planning/`
- Multi-tenancy on the gateway
- Light theme

---

## 9. Implementation phasing

Concrete plan emerges in the writing-plans step. This is the rough order.

| Phase | Goal | Definition of done |
|---|---|---|
| **0. Fork & rebrand** | Hard-fork gsd-pi into `loop24-client`. Apply piConfig changes, namespace refactor, theme, banner. Rename `gsd/` extension → `workflow/`. Strip all "gsd"/"GSD" from user-visible surfaces. Drop `web/`, `vscode-extension/`, `studio/`, `native/`. | `loop24` binary launches with LOOP24 banner; `/loop24 plan` works against direct Anthropic; no "gsd" appears in `--help` output or any prompt. |
| **1. Gateway routing** | Wire `ANTHROPIC_BASE_URL` + optional auth header through config. Validate against a mock Anthropic-shaped gateway. | Setting `gateway.url` in config redirects all LLM traffic; setting it to garbage produces a clean error. |
| **2. `loop24` extension scaffold** | Create extension manifest, theme loaded by pi-tui, banner served, first-run wizard. | `~/.loop24/config.json` written by wizard; banner shows actual connection status. |
| **3. LangFlow runtime triggers** | `clients/langflow.ts`, YAML loader, one or two real example commands end-to-end. | A YAML command file → registered slash command → real LangFlow invocation → streaming output in TUI. |
| **4. Port `langflow-flow-builder`** | Slash command, typed Pi tool wrappers around Python scripts, reference docs loaded as context. | `/loop24 build-flow "test"` generates a validated flow JSON in `flows/generated/`. |
| **5. Prompt-engineer command** | Smallest piece. May slot in earlier opportunistically. | `/loop24 prompt-engineer "X"` returns a polished prompt. |
| **6. Install script & docs** | Phase 1 distribution (git clone + install.sh + onboarding doc). | Fresh laptop with Node ≥22 can clone + install + launch in under 5 minutes. |
| **7. npm publish (later)** | Internal Verdaccio / Nexus. Same package, packaged. | `npm install -g @loop24/client` works from a properly-configured `.npmrc`. |

---

## 10. Open questions

These do not block the design but should be answered before the relevant implementation phase.

| # | Question | Owner | Blocks |
|---|---|---|---|
| Q1 | What is the actual default port for `loop24-gateway` once it's implemented? | gateway team | Phase 1 |
| Q2 | What's the wire format of the gateway's eventual Anthropic surface — does it just proxy 1:1, or is there any transformation/redaction? | gateway team | Phase 1 |
| Q3 | Do we want a dedicated `/loop24 catalog refresh` command (UX-driven), or do we leave it to the model to call `refresh_catalog` from `/loop24 build-flow`? | LOOP24 owner | Phase 4 |
| Q4 | Internal npm registry — does one exist, or will Phase 7 require standing one up? | infra | Phase 7 |
| Q5 | Should `/loop24 prompt-engineer` save outputs anywhere persistent, or is it ephemeral chat output only? | LOOP24 owner | Phase 5 |

---

## 11. Appendix — file inventory

### Files created (new)

- `src/resources/extensions/loop24/` and everything under it
- `LOOP24-PATCHES.md` at repo root
- `scripts/install.sh`
- `docs/superpowers/specs/2026-05-23-loop24-client-design.md` (this document)

### Files modified in the fork (outside `extensions/loop24/`)

- `package.json` — `piConfig` block (`name`, `configDir`, `commandNamespace`, `brandName`)
- `src/loader.ts` — banner content, env-var defaults
- `packages/pi-ai/src/providers/anthropic.ts` — read gateway baseURL from config as fallback
- `packages/pi-coding-agent/src/config.ts` — export `COMMAND_NAMESPACE`, `BRAND_NAME`
- All command-registration sites inside the renamed `workflow/` extension — templated with `COMMAND_NAMESPACE`
- All prompt files inside `workflow/` that mention "GSD" by name — extracted to `workflow/strings.ts`

### Directories renamed

- `src/resources/extensions/workflow/` → `src/resources/extensions/workflow/`

### Directories dropped

- `web/`
- `vscode-extension/`
- `studio/`
- `native/` (Rust)
- `packages/native/` (FFI bindings; can revisit if perf demands)

---

*End of design spec.*
