# OTTO Gateway Remote Tool Events Design

## Problem

OTTO can route Anthropic Messages requests through `otto-gateway`, which talks to `kiro-cli` over ACP. Kiro reports its own tool activity through ACP `session/update` notifications. Recent gateway fixes now preserve Kiro's tool input correctly, including ACP `rawInput`.

That surfaced a deeper contract bug: Kiro's internal tool input shape is not OTTO's local tool schema. A Kiro read call may carry:

```json
{
  "operations": [{ "mode": "Line", "path": "/repo/CLAUDE.md" }],
  "__tool_use_purpose": "Read CLAUDE.md to find the # Project section"
}
```

OTTO's local `read` tool expects:

```json
{ "path": "/repo/CLAUDE.md" }
```

Today, the streamed `toolCall` reaches `packages/pi-agent-core/src/agent-loop.ts`, which looks up a local tool by `toolCall.name` and validates `toolCall.arguments` against that local schema. This wrongly treats a Kiro-owned ACP tool event as an OTTO-owned executable tool call.

## Decision

Separate tool execution domains. A remote Kiro/ACP tool event must not be dispatched by name into OTTO's local tool registry.

Tool name equality is not ownership equality:

- `read` from OTTO means the local OTTO `read` tool schema and execution implementation.
- `read` from Kiro ACP means a remote agent event that Kiro owns, executes, and reports.

OTTO should display and persist remote Kiro tool events, but should not locally execute them unless an explicit adapter opts into that behavior.

## Source References

- ACP says tool calls are actions language models request **Agents** to perform, reported to **Clients** through `session/update`; ACP `rawInput` is the raw input sent to that agent-owned tool.
- Kiro's ACP docs describe Kiro as an ACP agent that sends `ToolCall` / `ToolCallUpdate` session updates.
- Anthropic tool use distinguishes client tools executed by the application from server/provider tools executed elsewhere. OTTO must preserve that execution boundary when `otto-gateway` fronts another agent.

## Architecture

### 1. Represent Remote Tool Calls Explicitly

Extend the shared assistant content model with remote tool metadata instead of relying only on local `ToolCall`:

```ts
export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string;
  executionDomain?: "local" | "remote";
  remote?: {
    source: "kiro-acp";
    kind?: string;
    title?: string;
    locations?: Array<{ path?: string; line?: number; column?: number }>;
    rawInput?: Record<string, unknown>;
    purpose?: string;
  };
}
```

Default `executionDomain` is `"local"` for all existing provider tool calls. Gateway/Kiro tool calls set `executionDomain: "remote"` and `remote.source: "kiro-acp"`.

### 2. Agent Loop Renders Remote Calls But Does Not Execute Them

In `packages/pi-agent-core/src/agent-loop.ts`, before local tool lookup and validation:

- If `toolCall.executionDomain === "remote"`, emit `tool_execution_start` and `tool_execution_end` for TUI observability.
- Create a `toolResult` message that explains the call was executed by the remote agent, or contains any provider-supplied remote result.
- Do not call `validateToolArguments`.
- Do not count this as a schema/preparation error.

This keeps the existing TUI tool card behavior without making OTTO responsible for Kiro's schema.

### 3. Gateway/Provider Marks Kiro Calls

The Anthropic gateway provider path must identify Kiro-originated `tool_use` blocks. The preferred wire contract is for `otto-gateway` to namespace or annotate remote tool calls. Acceptable contracts:

1. Preferred: emit tool names as `kiro__read`, `kiro__shell`, etc., plus input metadata.
2. Acceptable: include a stable metadata marker in the input, such as `__otto_remote_tool: { source: "kiro-acp", kind: "read" }`.
3. Temporary client-side compatibility: when the active model is routed through `OTTO_GATEWAY_URL` and the tool input has ACP/Kiro fields such as `operations`, `rawInput`, `locations`, or `__tool_use_purpose`, classify it as remote.

The plan should implement the client classification seam so OTTO stops failing immediately, while documenting the preferred gateway contract.

### 4. Metadata Handling

`__tool_use_purpose` is treated as non-standard metadata.

Rules:

- Preserve it as `remote.purpose`.
- Include it in debug/details output when useful.
- Do not pass it to local tool validators.
- Do not treat it as security evidence.
- If shown to users, label it as "agent stated purpose" or "tool purpose."

### 5. Optional Adapters Are Explicit

Future fallback adapters may translate Kiro input into OTTO local tools:

```ts
normalizeRemoteToolInput({
  source: "kiro-acp",
  kind: "read",
  rawInput
}) -> { localTool: "read", args: { path } } | undefined
```

Adapters must live in a dedicated module and must be opt-in per source/kind. They should not change the public schema of OTTO's local tools.

## Non-Goals

- Do not widen OTTO's local `read` schema to accept Kiro's `operations[]` shape.
- Do not prompt-shape the model as the primary fix.
- Do not skip local OTTO tools globally when the gateway is active.
- Do not rely on `__tool_use_purpose` for permission decisions.

## Acceptance Criteria

- A Kiro-shaped read call from `otto-gateway` does not fail OTTO local `read` schema validation.
- The TUI still shows a visible tool call for the remote Kiro read event.
- The resulting `toolResult` clearly indicates remote execution or remote reporting.
- Existing local OTTO `read` calls with `{ path }` still validate and execute normally.
- Schema-validation retry caps are not incremented for remote tool events.
- Tests cover `__tool_use_purpose` preservation as metadata and exclusion from local validation.

