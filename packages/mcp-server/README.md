# @otto-build/mcp-server

MCP server exposing OTTO orchestration tools for Claude Code, Cursor, and other MCP-compatible clients.

Start auto-mode sessions, poll progress, resolve blockers, and retrieve results — all through the [Model Context Protocol](https://modelcontextprotocol.io/).

This package now exposes two tool surfaces:

- session/read tools for starting and inspecting workflow sessions
- MCP-native interactive tools for structured user input
- headless-safe workflow tools for planning, completion, validation, reassessment, metadata persistence, and journal reads

## Installation

```bash
npm install @otto-build/mcp-server
```

Or with the monorepo workspace:

```bash
# Already available as a workspace package
npx otto-mcp-server
```

## Configuration

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "otto": {
      "command": "npx",
      "args": ["otto-mcp-server"],
      "env": {
        "OTTO_CLI_PATH": "/path/to/otto"
      }
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "otto": {
      "command": "otto-mcp-server"
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "otto": {
      "command": "npx",
      "args": ["otto-mcp-server"],
      "env": {
        "OTTO_CLI_PATH": "/path/to/otto"
      }
    }
  }
}
```

## Tools

### Workflow tools

The workflow MCP surface includes:

- `otto_decision_save`
- `otto_requirement_update`
- `otto_requirement_save`
- `otto_milestone_generate_id`
- `otto_plan_milestone`
- `otto_plan_slice`
- `otto_plan_task`
- `otto_replan_slice`
- `otto_slice_complete`
- `otto_skip_slice`
- `otto_complete_milestone`
- `otto_validate_milestone`
- `otto_reassess_roadmap`
- `otto_save_gate_result`
- `otto_summary_save`
- `otto_task_complete`
- `otto_task_reopen`
- `otto_slice_reopen`
- `otto_milestone_reopen`
- `otto_milestone_status`
- `otto_journal_query`
- `otto_exec`
- `otto_exec_search`
- `otto_resume`
- `otto_capture_thought`
- `otto_memory_query`
- `otto_memory_graph`

**Aliases (kept for backwards compatibility — prefer the canonical name above):** `otto_save_decision`, `otto_update_requirement`, `otto_save_requirement`, `otto_generate_milestone_id`, `otto_task_plan`, `otto_slice_replan`, `otto_complete_task`, `otto_complete_slice`, `otto_milestone_validate`, `otto_milestone_complete`, `otto_roadmap_reassess`, `otto_reopen_task`, `otto_reopen_slice`, `otto_reopen_milestone`.

These tools use the same OTTO workflow handlers as the native in-process tool path wherever a shared handler exists.

`otto_decision_save` and its `otto_save_decision` alias persist new decisions to the ADR-013 memory store, not to the legacy `decisions` table. The assigned `D###` ID is recorded in `memories.structured_fields.sourceDecisionId`, and `.otto/workflow/DECISIONS.md` is refreshed as a projection from memory-backed decisions. The legacy table may still be read by compatibility and inspection paths during the cutover window, but it is no longer a write target.

`otto_summary_save` computes artifact paths from the supplied IDs. `milestone_id` is required for milestone-, slice-, and task-scoped artifact types (`SUMMARY`, `RESEARCH`, `CONTEXT`, `ASSESSMENT`, `CONTEXT-DRAFT`) and should be omitted only for root-level `PROJECT`, `PROJECT-DRAFT`, `REQUIREMENTS`, and `REQUIREMENTS-DRAFT` artifacts. For final `REQUIREMENTS` saves, the tool renders content from active database requirement rows; callers must create those rows with `otto_requirement_save` first.

### Interactive tools

The packaged server exposes `ask_user_questions` through MCP form elicitation. This keeps the existing OTTO answer payload shape while allowing Claude Code CLI and other elicitation-capable clients to surface structured user choices.

The packaged server also exposes `secure_env_collect` through MCP form elicitation. Secret values are written directly to the selected destination and are not included in tool output. For dotenv writes, `envFilePath` must resolve inside the validated project directory; parent traversal and symlink escapes are rejected.

`secure_env_collect` refuses to set variables that control the MCP server runtime itself, including `OTTO_WORKFLOW_EXECUTORS_MODULE`, `OTTO_WORKFLOW_WRITE_GATE_MODULE`, `OTTO_WORKFLOW_PROJECT_ROOT`, `OTTO_CLI_PATH`, `NODE_OPTIONS`, `NODE_PATH`, `PATH`, `LD_PRELOAD`, and `DYLD_INSERT_LIBRARIES`. These values must be configured by the operator in the MCP server environment, not collected from an MCP tool call.

Secret handling differs by destination:

- `dotenv`: accepted values are written to the project env file and hydrated into the current MCP server process so the active session can use them.
- `vercel` and `convex`: accepted values are pushed to the remote destination but are not added to `process.env`; restart or configure the consuming runtime normally if the current process needs that value.

Current support boundary:

- when running inside the OTTO monorepo checkout, the MCP server auto-discovers the shared workflow executor module
- outside the monorepo, set `OTTO_WORKFLOW_EXECUTORS_MODULE` to an importable `workflow-tool-executors` module path if you want the mutation tools enabled
- `ask_user_questions` and `secure_env_collect` require an MCP client that supports form elicitation
- session/read tools do not depend on this bridge

If the executor bridge cannot be loaded, workflow mutation calls will fail with a precise configuration error instead of silently degrading.

### `otto_execute`

Start a auto-mode session for a project directory.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectDir` | `string` | ✅ | Absolute path to the project directory |
| `command` | `string` | | Command to send (default: `"/otto auto"`) |
| `model` | `string` | | Model ID override |
| `bare` | `boolean` | | Run in bare mode (skip user config) |

**Returns:** `{ sessionId, status: "started" }`

### `otto_status`

Poll the current status of a running OTTO session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | `string` | ✅ | Session ID from `otto_execute` |

**Returns:**

```json
{
  "status": "running",
  "progress": { "eventCount": 42, "toolCalls": 15 },
  "recentEvents": [ ... ],
  "pendingBlocker": null,
  "cost": { "totalCost": 0.12, "tokens": { "input": 5000, "output": 2000, "cacheRead": 1000, "cacheWrite": 500 } },
  "durationMs": 45000
}
```

### `otto_result`

Get the accumulated result of a session. Works for both running (partial) and completed sessions.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | `string` | ✅ | Session ID from `otto_execute` |

**Returns:**

```json
{
  "sessionId": "abc-123",
  "projectDir": "/path/to/project",
  "status": "completed",
  "durationMs": 120000,
  "cost": { ... },
  "recentEvents": [ ... ],
  "pendingBlocker": null,
  "error": null
}
```

### `otto_cancel`

Cancel a running session. Aborts the current operation and stops the agent process.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | `string` | ✅ | Session ID from `otto_execute` |

**Returns:** `{ cancelled: true }`

### `otto_query`

Query OTTO project state from the filesystem without an active session. Returns STATE.md, PROJECT.md, requirements, and milestone listing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectDir` | `string` | ✅ | Absolute path to the project directory |
| `query` | `string` | ✅ | What to query (e.g. `"status"`, `"milestones"`) |

**Returns:**

```json
{
  "projectDir": "/path/to/project",
  "state": "...",
  "project": "...",
  "requirements": "...",
  "milestones": [
    { "id": "M001", "hasRoadmap": true, "hasSummary": false }
  ]
}
```

### `otto_resolve_blocker`

Resolve a pending blocker in a session by sending a response to the blocked UI request.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | `string` | ✅ | Session ID from `otto_execute` |
| `response` | `string` | ✅ | Response to send for the pending blocker |

**Returns:** `{ resolved: true }`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OTTO_CLI_PATH` | Absolute path to the OTTO CLI binary. If not set, the server resolves `otto` via `which`. |
| `OTTO_WORKFLOW_EXECUTORS_MODULE` | Optional absolute path or `file:` URL for the shared OTTO workflow executor module used by workflow mutation tools. |

The server also hydrates supported model-provider and tool credentials from `~/.otto/agent/auth.json` on startup. Keys saved through `/otto config` or `/otto keys` become available to the MCP server process automatically, and any explicitly-set environment variable still wins.

Remote secrets pushed by `secure_env_collect` to Vercel or Convex are not hydrated into the MCP server process after the push. Use explicit MCP `env` configuration or a process restart when an operator-level value must be visible to the running server.

## Architecture

```
┌─────────────────┐     stdio      ┌──────────────────┐
│  MCP Client     │ ◄────────────► │  @otto-build/mcp-server │
│  (Claude Code,  │    JSON-RPC    │                  │
│   Cursor, etc.) │                │  SessionManager  │
└─────────────────┘                │       │          │
                                   │       ▼          │
                                   │  @otto-build/rpc-client │
                                   │       │          │
                                   │       ▼          │
                                   │  OTTO CLI (child  │
                                   │  process via RPC)│
                                   └──────────────────┘
```

- **@otto-build/mcp-server** — MCP protocol adapter. Translates MCP tool calls into SessionManager operations.
- **SessionManager** — Manages RpcClient lifecycle. One session per project directory. Tracks events in a ring buffer (last 50), detects blockers, accumulates cost.
- **@otto-build/rpc-client** — Low-level RPC client that spawns and communicates with the OTTO CLI process via JSON-RPC over stdio.

## License

MIT
