# Harness Compatibility Matrix

OTTO can load skills and agents from other AI coding harnesses (Claude Code, OpenAI Codex, Kiro). This document covers what's compatible out of the box, what gets normalized automatically, and what still won't work without manual edits.

## Discovery

| Resource | Where OTTO looks |
|---|---|
| **Skills** | `~/.claude/skills/`, `~/.codex/skills/`, `~/.kiro/skills/` (auto-seeded into `settings.skills` on launch when the directory exists) |
| **Agents** | `~/.claude/agents/`, `~/.codex/agents/`, `~/.kiro/agents/` (user scope) and `.claude/agents/`, `.codex/agents/`, `.kiro/agents/` (nearest project scope, walking up from cwd) |

Skills carry a colored origin chip in the autocomplete (`[claude] skill:review-pr  …`).

## Tool-name normalization (applied automatically)

Imported agents declare allowed tools in their frontmatter (`tools: [Bash, Read]`). OTTO normalizes these at load time. **You don't need to edit anything** for the names below — they're rewritten automatically by `parseAgentTools` in `src/resources/extensions/subagent/agents.ts`.

| Harness name | OTTO equivalent | Notes |
|---|---|---|
| `Bash` | `bash` | Lowercase the same tool |
| `Read` | `read` | " |
| `Write` | `write` | " |
| `Edit` | `edit` | " |
| `Glob` | `glob` | " |
| `Grep` | `grep` | " |
| `AskUserQuestion` | `ask_user_questions` | Different name, same intent |
| `Task` | `subagent` | Both delegate to subagents |
| `Agent` | `subagent` | " |
| `WebSearch` | `web_search` | `search-the-web` extension |
| `WebFetch` | `fetch_page` | `shared` extension |
| `Skill` | `skill` (stub) | OTTO can't model-invoke skills; the stub returns a redirect message |
| `mcp__server__*` | `mcp__server__*` | MCP namespaces are preserved verbatim |

## What doesn't translate

Tool names with no OTTO equivalent flow through the normalizer as lowercase strings and get silently dropped by the runtime allowlist. **The agent still runs** — it just can't call the missing tools.

| Harness name | Status in OTTO |
|---|---|
| `TodoWrite` | No equivalent; reference becomes a no-op |
| `SlashCommand` | No equivalent; reference becomes a no-op |
| `NotebookEdit` | No equivalent; reference becomes a no-op |

If you find a missing tool you need, add a mapping to `HARNESS_TOOL_NAME_MAP` in `src/resources/extensions/subagent/agents.ts`.

## What still requires manual edits

These aren't tool-name issues — they're content issues in the imported skill/agent body. OTTO can't fix them automatically.

- **References to `CLAUDE.md` as the project conventions file.** OTTO uses `WORKFLOW.md` and `.otto/` configs. Imported skills/agents that say "read `CLAUDE.md`" will just find nothing. Harmless, but suboptimal.
- **References to `~/.claude/` paths** in skill bodies. The file read either succeeds (you have a real Claude install) or finds nothing.
- **`Task(subagent_type="foo", prompt="…")` example syntax in skill bodies.** Documentation only — the actual model invocation goes through OTTO's `subagent` tool (`{ agent, task }`). Capable models translate; weaker ones may not.
- **Claude-specific MCP servers** (e.g. `mcp__context7__*`, `mcp__exa__*`, `mcp__firecrawl__*`). These work only if you've configured those MCP servers via `pi-mcp-adapter` or another route.

## Agent `tools` allowlist behavior

When an agent declares `tools: […]`, OTTO restricts it to that allowlist. The normalizer:

1. Strips whitespace and blanks.
2. Maps via `HARNESS_TOOL_NAME_MAP` (e.g. `Bash` → `bash`).
3. Falls through to `.toLowerCase()` for unmapped names.
4. Dedupes the result (so `Task, Agent` collapses to a single `subagent`).
5. Returns `undefined` if the resulting list is empty (no restriction).

An agent with `tools: [Bash, FakeUnknown, Read]` becomes `["bash", "fakeunknown", "read"]`. The runtime allowlist quietly skips `fakeunknown`, leaving the agent with `bash` and `read`.

## How to test an imported agent

1. Drop a SKILL.md into `~/.claude/agents/<name>.md`.
2. Restart OTTO.
3. From inside OTTO, run `/subagent` to list available agents and confirm yours appears with its tools enumerated.
4. Invoke from another conversation: `subagent({ agent: "<name>", task: "<some task>" })`.

If the agent works in Claude Code but not OTTO, check:

1. Does `tools:` include unknown names that you actually need? Add a mapping in `HARNESS_TOOL_NAME_MAP`.
2. Does the body reference Claude-specific paths or commands? Hand-edit or accept the no-op behavior.
3. Is the agent expecting a Claude-only MCP server? Configure it via OTTO's package layer or remove the dependency.

## Where this is implemented

- **Discovery**: `src/resources/extensions/subagent/agents.ts` (`HARNESS_AGENT_PATHS`, `discoverAgents`)
- **Skill discovery**: `src/seed-defaults.ts` (`HARNESS_SKILL_PATHS`, `reconcileHarnessSkillPaths`)
- **Tool normalization**: `src/resources/extensions/subagent/agents.ts` (`HARNESS_TOOL_NAME_MAP`, `parseAgentTools`)
- **Skill stub tool**: `src/resources/extensions/subagent/skill-tool-stub.ts` and registration in `subagent/index.ts`
- **Origin chip in TUI**: `packages/pi-tui/src/components/select-list.ts` + `packages/pi-coding-agent/src/core/skills.ts::getSource`
