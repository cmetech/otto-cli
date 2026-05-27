# OTTO LangFlow Control Plane Design

## Goal

Make LangFlow a first-class optional OTTO service that is disabled by default, can be explicitly connected from the TUI, can import/list/run sample and generated flows, and exposes clear health/status signals in the footer and through `/otto langflow ...` commands.

## Current State

OTTO already has a LangFlow foundation under `src/resources/extensions/otto/`:

- `clients/langflow.ts` supports `getVersion()`, `runFlow()`, and `importFlow()`.
- `commands/build-flow/` registers a direct extension command for natural-language flow generation.
- `tools/` registers seven model-callable tools for catalog refresh, component inspection, validation, import, and smoke testing.
- `commands/flow-triggers/` loads declarative YAML triggers and registers direct extension slash commands.
- `otto config langflow` can persist URL, API key, and enabled flag in `~/.otto/config.json`.

The gaps are mostly product-surface gaps:

- LangFlow is enabled by default today.
- `OTTO_LANGFLOW_DISABLED` is persisted, but the runtime extension does not consistently treat it as an actual disconnect state.
- The useful commands are registered as direct slash commands (`/build-flow`) instead of the expected `/otto langflow ...` command family.
- There is no footer status indicator like the gateway indicator.
- There is no list-flows command.
- There is no generic run-flow command.
- There are no bundled sample flow JSON files with e2e coverage for import/list/run.

## Product Contract

LangFlow is opt-in. On a clean OTTO install, LangFlow should show as disabled and OTTO should not probe `http://127.0.0.1:7860` unless the user explicitly connects or config enables it.

The primary user surface is:

```text
/otto langflow status
/otto langflow connect [url]
/otto langflow disconnect
/otto langflow flows
/otto langflow import <file|sample-name>
/otto langflow run <flow-id-or-name> [input text]
/otto langflow samples
/otto langflow build <natural-language description>
```

The existing direct extension command can remain temporarily for compatibility, but the documented, supported path should be `/otto langflow ...`.

## Artifact Layout

LangFlow artifacts should live outside `.otto/workflow/` because they are service assets, not OTTO workflow planning state.

Use this layout:

```text
.otto/langflow/
  config.json                    # project-local overrides, optional
  samples/                       # copied or referenced sample flows
  generated/                     # flows created by /otto langflow build
  imported/                      # local copies of successfully imported flows
  catalog/
    components.raw.json
    components.normalized.json
    component-index.md
  runs/
    YYYY-MM-DDTHH-mm-ss-<flow>.json
```

The builder should create `.otto/langflow/generated/` by default. The previous `flows/generated/` layout may be supported as a legacy fallback or explicit export target, but new OTTO-owned output should go under `.otto/langflow/`.

This directory is project-local and should not be confused with global service config under `~/.otto/config.json`.

## Config Model

Global config lives in `~/.otto/config.json`:

```json
{
  "gateway": {
    "url": "http://127.0.0.1:18080",
    "token": null
  },
  "langflow": {
    "url": "http://127.0.0.1:7860",
    "apiKey": null,
    "enabled": false
  }
}
```

Default:

```json
"enabled": false
```

Environment overrides:

- `LANGFLOW_SERVER_URL`: explicit server URL.
- `LANGFLOW_API_KEY`: optional `x-api-key` auth.
- `OTTO_LANGFLOW_DISABLED=1`: force disabled.
- `OTTO_LANGFLOW_ENABLED=1`: optional test/dev override to force enabled when no config file exists.

Precedence:

```text
OTTO_LANGFLOW_DISABLED=1 > LANGFLOW_SERVER_URL / LANGFLOW_API_KEY > config.json > defaults
```

## Health Model

Introduce a LangFlow health monitor analogous to `GatewayHealthMonitor`.

States:

- `disabled`: LangFlow is intentionally off; no probes.
- `checking`: probe in flight.
- `connected`: `/api/v1/version` succeeds.
- `offline`: probe fails.
- `degraded`: server is reachable but a command failed with a retriable 5xx/timeout.

Footer examples:

```text
LF disabled
LF connected v1.9.3
LF offline 127.0.0.1:7860
LF degraded retrying
```

Probe cadence:

- On connect: immediate probe.
- While connected: every 10 seconds.
- On failure: exponential backoff with jitter, capped at 60 seconds.
- On disconnect: stop monitor and clear live state.

## Command Behavior

### `/otto langflow status`

Prints:

- configured URL
- enabled/disabled
- version if reachable
- API key presence, never value
- artifact root
- flow count if reachable

### `/otto langflow connect [url]`

Sets `langflow.enabled = true`, optionally updates URL, applies config to the current process, probes immediately, and starts the footer monitor.

If no URL is provided, use existing config URL or `http://127.0.0.1:7860`.

### `/otto langflow disconnect`

Sets `langflow.enabled = false`, clears active monitor state, and footer changes to `LF disabled`.

This does not delete URL/API key. Disconnect is an operational toggle, not config erasure.

### `/otto langflow flows`

Calls `GET /api/v1/flows/` and renders a compact table with id, name, updated timestamp if present, and endpoint name if present.

### `/otto langflow import <file|sample-name>`

Imports a JSON flow using `POST /api/v1/flows/` first. If that fails because the server expects multipart upload, fall back to the existing `import_flow.py` wrapper.

On success:

- saves/copies the imported flow JSON under `.otto/langflow/imported/`
- prints returned id/name
- records import metadata in `.otto/langflow/runs/`

### `/otto langflow run <flow-id-or-name> [input text]`

Resolves flow name to id via `flows` when needed, then calls `POST /api/v1/run/<id>`.

Default input:

```text
hello from OTTO
```

The output should render inline as a normal notification/text result and write a run record under `.otto/langflow/runs/`.

### `/otto langflow samples`

Lists bundled sample flow JSON files:

- `echo-basic`
- `uppercase-basic`
- `summarize-text`

Each sample should include a short description and expected test input.

### `/otto langflow build <description>`

Moves the existing `/build-flow` behavior behind `/otto langflow build`. Generated files go to `.otto/langflow/generated/` by default.

## Sample Flows

Bundle small samples under:

```text
src/resources/extensions/otto/samples/langflow/
```

Required samples:

1. `echo-basic.json`
   - accepts text input and returns it.
   - used for import/list/run smoke tests.

2. `uppercase-basic.json`
   - transforms input text to uppercase using simple LangFlow components if available.
   - if unavailable across LangFlow versions, mark it as optional in live tests.

3. `summarize-text.json`
   - demonstrates LLM-backed flow shape using `${OTTO_GATEWAY_URL}` or `${ANTHROPIC_API_KEY}` placeholders.
   - import test only by default; run test is opt-in because it may invoke an LLM.

The e2e suite should prefer `echo-basic` because it should not require provider credentials.

## E2E Testing

Add live e2e tests gated on a running local LangFlow server. These tests should fail clearly when explicitly invoked and LangFlow is not reachable.

Command:

```bash
npm run test:e2e:langflow
```

Behavior:

- Probe `LANGFLOW_SERVER_URL` or `http://127.0.0.1:7860`.
- If not reachable, fail with: `LangFlow is not running at <url>; start it with langflow run or set LANGFLOW_SERVER_URL`.
- Import `echo-basic.json`.
- List flows and assert imported flow is present.
- Run imported flow with `hello from e2e`.
- Assert the response contains `hello from e2e`.
- Run `otto headless langflow status` or equivalent headless command path and assert connected status.

Unit tests should cover all command parsing and client behavior with mock HTTP servers.

## Non-Goals

- Do not make LangFlow part of model routing. It is a separate service, not an LLM provider.
- Do not route normal chat through LangFlow.
- Do not require LangFlow for OTTO startup.
- Do not store LangFlow artifacts in `.otto/workflow/`.
- Do not require API keys for local sample tests.

## Acceptance Criteria

- Fresh OTTO install shows LangFlow disabled by default.
- `/otto langflow connect` enables LangFlow and updates footer status.
- `/otto langflow disconnect` disables probes and footer status.
- `/otto langflow flows` lists server flows.
- `/otto langflow import echo-basic` imports a bundled sample.
- `/otto langflow run <imported-echo> "hello"` returns a response containing `hello`.
- `/otto langflow build "..."` creates flow JSON under `.otto/langflow/generated/`.
- Focused unit tests pass.
- `npm run test:e2e:langflow` passes when local LangFlow is running and fails clearly when it is not.
- `npm run build:core` passes.

