# OTTO — Features

A user's guide to what OTTO can do. OTTO (**O**rchestrated **T**ask & **T**ooling **O**perator) is a terminal-resident coding, research, and operations assistant. You open it in a terminal, talk to it in plain language, and it plans, edits code, runs tools, and drives multi-step workflows — keeping execution on your machine and routing every model call through a governable gateway.

This document is task-oriented: it walks through everything you can actually *do* once OTTO is installed. For install/uninstall mechanics see [`docs/INSTALL.md`](docs/INSTALL.md); for the architecture story see [`README.md`](README.md).

---

## Table of contents

1. [Quick start](#quick-start)
2. [Launching OTTO](#launching-otto)
3. [The four kinds of work](#the-four-kinds-of-work)
4. [The workflow engine — `/otto`](#the-workflow-engine--otto)
5. [In-session commands](#in-session-commands)
6. [Gateway, Langflow & flow automation](#gateway-langflow--flow-automation)
7. [Built-in capabilities (tools)](#built-in-capabilities-tools)
8. [Subagents](#subagents)
9. [Skills](#skills)
10. [Authoring your own commands, skills & extensions](#authoring-your-own-commands-skills--extensions)
11. [Custom workflows](#custom-workflows)
12. [Configuration & providers](#configuration--providers)
13. [Running OTTO without the TUI](#running-otto-without-the-tui)
14. [The web interface](#the-web-interface)
15. [Keyboard shortcuts](#keyboard-shortcuts)

---

## Quick start

Requires **Node ≥ 22** on your PATH.

```bash
npm install -g @ericsson/loop24
otto                 # launch the interactive terminal UI
```

First run:

```bash
otto config          # interactive setup wizard (provider, gateway, Langflow, tool keys)
```

Then just start talking — describe what you want and OTTO takes it from there. For a guided first task:

```text
/otto quick "Update the README with local setup instructions"
```

OTTO stores its global settings in `~/.otto/` and per-project state in a `.otto/` directory inside each repository you work in.

---

## Launching OTTO

`otto` with no arguments starts an interactive session in the current directory. Useful flags and subcommands:

| Invocation | What it does |
|---|---|
| `otto` | Start a new interactive session |
| `otto --continue` (`-c`) | Resume the most recent session for this directory |
| `otto sessions` | Browse and pick a past session to resume |
| `otto --model <id>` | Override the model for this session |
| `otto --print "msg"` (`-p`) | Single-shot prompt, no TUI — prints the answer and exits |
| `otto --worktree [name]` (`-w`) | Start inside an isolated git worktree (auto-named if omitted) |
| `otto --no-session` | Don't persist the session |
| `otto --extension <path>` | Load an extra extension (repeatable) |
| `otto --tools <a,b,c>` | Restrict the session to a specific set of tools |
| `otto --list-models [search]` | List available models and exit |
| `otto --mode <text\|json\|rpc\|mcp>` | Non-interactive output mode |
| `otto --version` (`-v`) / `--help` (`-h`) | Version / help |

Subcommands (run `otto <subcommand> --help` for detail):

| Subcommand | Purpose |
|---|---|
| `otto config [subject]` | Configure services — `gateway`, `langflow`, `llm`, `all`, or an interactive menu |
| `otto install <source>` | Install an extension/package from npm, git, a URL, or a local path |
| `otto remove <source>` | Remove an installed package |
| `otto list` | List installed package sources |
| `otto update` (alias `upgrade`) | Update OTTO to the latest published version |
| `otto worktree <cmd>` | Manage worktrees — `list`, `merge`, `clean`, `remove` |
| `otto headless [cmd]` | Run workflow commands without a TUI (CI, cron, scripting) |
| `otto graph <subcommand>` | Build/query the project knowledge graph |

---

## The four kinds of work

OTTO classifies each request into one of four task types and routes it accordingly:

| Type | Examples | Where it runs |
|---|---|---|
| **Code** | Refactor, generate, run tests, fix bugs | Locally, with model calls through the gateway |
| **Research** | Investigate, explain, summarize, cite sources | Locally + web/doc tools, model calls through the gateway |
| **Ops** | Pull live data from production, labs, ticket systems, knowledge bases | Through the gateway to the remote operations agent (OSCAR) |
| **Automate** | Trigger or build a multi-step Langflow flow | REST to your local Langflow server |

You never have to declare the type — OTTO infers it from what you ask.

---

## The workflow engine — `/otto`

The `/otto` command family is OTTO's structured project engine. Instead of one-off prompts, it organizes work into **milestones → slices → tasks**, researches and plans before it implements, makes atomic git commits, and tracks state in `.otto/` so it survives restarts.

### Step vs. auto mode

| Command | Behavior |
|---|---|
| `/otto` (or `/otto next`) | **Step mode** — run one unit of work, then pause for you |
| `/otto auto` | **Auto mode** — research, plan, execute, commit, repeat, until it needs you or finishes |
| `/otto quick "<task>"` | Run a small task with full guarantees (atomic commits, state tracking) but no heavy planning |
| `/otto fast` | Toggle prioritized API routing for supported models |
| `/otto stop` / `/otto pause` | Stop gracefully / pause and preserve state (`/otto auto` resumes) |
| `/otto steer` | Adjust plan documents mid-execution |
| `/otto discuss [target]` | Talk through architecture and decisions (works alongside auto mode) |

Auto mode is best when the task is clearly described, the repo has a clean git state, and you're comfortable letting OTTO create isolated worktrees and commits. Press `Escape` at any time to pause it without losing the conversation.

### Planning & milestones

| Command | Purpose |
|---|---|
| `/otto new-project [--deep]` | Bootstrap a new project; `--deep` adds staged project-level discovery |
| `/otto new-milestone [--deep]` | Create a milestone |
| `/otto dispatch <phase>` | Run a specific phase directly (research, plan, execute, complete, reassess, uat, replan) |
| `/otto queue` | Queue and reorder future milestones |
| `/otto park` / `/otto unpark` | Skip a milestone without deleting it / reactivate it |
| `/otto skip` | Keep a unit out of auto-mode dispatch |
| `/otto undo` / `/otto undo-task` / `/otto reset-slice` | Revert the last unit / reset a task / reset a slice (DB + markdown) |
| `/otto start <template>` | Start from a workflow template (bugfix, spike, feature, hotfix, refactor, security-audit, dep-upgrade, full-project) |
| `/otto templates [info <name>]` | List or inspect workflow templates |

### Visibility & reporting

| Command | Purpose |
|---|---|
| `/otto status` / `/otto visualize` | Open the workflow visualizer (progress, timeline, deps, metrics, health, changes, knowledge) |
| `/otto widget` | Cycle the in-TUI dashboard widget: full / small / min / off |
| `/otto history` | Execution history, with `--cost`, `--phase`, `--model` filters |
| `/otto brief <mode> [topic]` | Generate a self-contained HTML brief — `diagram`, `plan`, `diff`, `recap`, `table`, `slides` |
| `/otto report [--html] [--all]` | Generate browsable HTML milestone reports |
| `/otto logs` | Browse activity logs, debug logs, and metrics |

### Knowledge & learning

| Command | Purpose |
|---|---|
| `/otto knowledge` | Add persistent project knowledge (rules, patterns, lessons) |
| `/otto extract-learnings <MID>` | Pull structured decisions, lessons, patterns, and surprises out of a finished milestone (also runs automatically at completion) |
| `/otto graph build\|query\|status\|diff` | Build and query a knowledge graph of milestones, tasks, rules, and patterns |

### Parallel orchestration

Run multiple milestones at once, each in its own isolated worker:

| Command | Purpose |
|---|---|
| `/otto parallel start` | Analyze eligibility, confirm, and start workers |
| `/otto parallel status` | Show every worker's state, progress, and cost |
| `/otto parallel pause\|resume\|stop [MID]` | Control all workers or one |
| `/otto parallel merge [MID]` | Merge completed milestones back to main |

### Worktrees

OTTO can keep each work stream on its own git worktree so your base checkout stays clean.

| Command | Purpose |
|---|---|
| `/otto worktree list` | Show each worktree, branch, status, and diff stats |
| `/otto worktree merge [name]` | Squash-merge into main and clean up |
| `/otto worktree clean` | Remove merged or empty worktrees (never touches pending work) |
| `/otto worktree remove <name> [--force]` | Remove a named worktree |
| `/worktree` (`/wt`) | Plain git worktree lifecycle, independent of the workflow engine |

### Debugging & health

| Command | Purpose |
|---|---|
| `/otto debug [list\|status\|continue <slug>]` | Persistent debugging sessions that survive context resets |
| `/otto forensics` | Deep post-mortem of auto-mode failures — anomaly detection, unit traces, root-cause analysis |
| `/otto doctor` | Runtime health checks with auto-fix |
| `/otto recover` | Rebuild project state from rendered markdown after corruption |
| `/otto cleanup` | Clean up stale state files and worktrees |

### Integrations

| Integration | What it does |
|---|---|
| **GitHub sync** | `/github-sync bootstrap` turns your local project state into GitHub Milestones, Issues, and draft PRs; `/github-sync status` shows the mapping. Requires the `gh` CLI. |
| **cmux** | When you run inside the cmux terminal multiplexer, OTTO surfaces desktop notifications, sidebar metadata, and visual subagent splits. Controlled with `/otto cmux on\|off` and friends. |

> The workflow engine has many more subcommands (preferences, keys, migration, skill health, and more). Run `/otto help` inside a session for the full categorized reference.

---

## In-session commands

These work in any interactive session, independent of the workflow engine.

**Session & history:**

| Command | Purpose |
|---|---|
| `/new` (alias `/clear`) | Start a fresh session |
| `/resume` / `/session` | Resume or pick a past session |
| `/tree` | Navigate the branching session tree — jump back to any earlier point |
| `/fork` | Branch the conversation from an earlier entry |
| `/name` | Name or bookmark the current session |
| `/compact` | Manually compact context (OTTO also auto-compacts as it nears the limit) |
| `/copy` | Copy session content to the clipboard |
| `/export` | Export the session to a self-contained HTML file |
| `/share` | Upload the session and get a shareable link |
| `/exit` | Graceful shutdown (saves state) |
| `/kill` | Immediate shutdown |

**Model & provider:**

| Command | Purpose |
|---|---|
| `/model` | Switch the active model (also `Ctrl+L`) |
| `/provider` | Switch or configure the model provider |
| `/scoped-models` | Manage the per-scope model set |
| `/login` / `/logout` | Log in to / out of a model provider |
| `/thinking` | Toggle the model's reasoning depth |

**Environment & UI:**

| Command | Purpose |
|---|---|
| `/settings` | Open the settings UI |
| `/hotkeys` | Show and customize keyboard shortcuts |
| `/edit-mode` | Switch the editor input mode |
| `/tui` / `/terminal` | TUI and terminal controls |
| `/reload` | Hot-reload extensions, skills, prompts, and themes without restarting |
| `/changelog` | Show release notes |
| `/voice` | Toggle real-time speech-to-text input (macOS, Linux) |
| `/search-provider` | Choose your web-search provider |
| `/remote` | Configure routing questions to Slack, Discord, or Telegram |
| `/bg` | Run and monitor background shell processes |
| `/configs` | Discover AI-tool configs across your machine |
| `/subagent` | List available subagents |

Any custom prompt template you add (see below) also becomes a `/<template-name>` command.

### Agent steering

You don't have to wait for OTTO to finish. Type while it's working and:

- **Enter** sends a steering message — it interrupts after the current tool and redirects.
- **Alt+Enter** sends a follow-up — it waits for OTTO to finish the current turn, then delivers.
- **Escape** pauses an auto-mode run without losing the conversation.

---

## Customizing context & the system prompt

OTTO reads project and system instructions from files, so you can shape its behavior per-repo without touching config:

| File | Effect |
|---|---|
| `AGENTS.md` / `CLAUDE.md` | Project-level instructions, picked up by walking up from the working directory |
| `SYSTEM.md` | Replace the system prompt for this project |
| `APPEND_SYSTEM.md` | Append to the system prompt for this project |
| Prompt templates (Markdown) | Reusable prompts that expand into a `/<name>` command |
| Themes | Custom TUI color themes |

CLI controls:

- `otto --append-system-prompt "<text>"` — append to the system prompt for one session.
- `otto --bare` — start with minimal context: skip `AGENTS.md`/`CLAUDE.md`, user skills, prompt templates, themes, and project preferences (useful for clean CI/ecosystem runs).

Prompt templates, themes, skills, and extensions can all be packaged together and installed from npm or a git repo with `otto install`, so a team can share one bundle.

---

## Gateway, Langflow & flow automation

OTTO is built to keep tooling local while sending model traffic through one governed egress point.

**Gateway routing.** When `LOOP24_GATEWAY_URL` is set, every LLM token routes through that gateway, so audit, rate limiting, content moderation, and schema validation all live in one place. With no gateway configured, OTTO talks directly to Anthropic. On session start OTTO probes the gateway and reports whether it's reachable.

**Langflow flow triggers.** OTTO connects to a local Langflow server (default `http://127.0.0.1:7860`) and turns any flow into a slash command. Drop a YAML file describing a flow into `extensions/loop24/commands/flow-triggers/`, and OTTO registers a `/<flow-name>` command that takes typed inputs, runs the flow, and renders the result inline:

```yaml
name: example-echo
description: Run the example Langflow echo flow with a single message
flow:
  id: YOUR-FLOW-ID
inputs:
  - name: msg
    type: string
    required: true
    flowField: input_value
execution:
  mode: poll
  timeoutMs: 30000
output:
  format: markdown
  render: inline
```

**`/build-flow <description>`** generates a Langflow flow JSON from a plain-language description. OTTO also exposes tools for catalog refresh/normalization/health checks, component inspection, flow validation, flow import, and smoke testing — so it can build a flow, validate it, import it, and test it end to end.

**`/prompt-engineer <task>`** polishes a rough task description into a structured, high-quality prompt for a coding agent.

---

## Built-in capabilities (tools)

Beyond reading and writing files and running shell commands, OTTO ships a broad tool set the model can call autonomously when a task needs it:

| Capability | What you get |
|---|---|
| **Browser automation** | Full Playwright-driven web control — navigate, click, type, scroll, fill forms, screenshot, read the accessibility tree, capture console/network logs, record traces, export HAR, emulate devices, mock routes, run visual diffs, and even generate tests. Ask OTTO to "open this page and tell me why the form fails" and it drives a real browser. |
| **Web search & reading** | Search the web (Brave) and extract clean page text (Jina Reader), with a combined search-and-read tool for research tasks. |
| **Up-to-date library docs** | Pull current documentation and code examples for a library on demand (Context7), so answers track the version you actually use. |
| **macOS automation** | Drive native macOS apps via the Accessibility API — list/launch/quit apps, inspect windows and UI trees, screenshot, click, type, and read. |
| **Background shells** | Launch long-running processes in the background and monitor them without blocking your session (`/bg`). |
| **MCP client** | Connect to external Model Context Protocol servers and use their tools inside OTTO. |
| **Remote questions** | When OTTO needs a decision while you're away, it can ask you over Slack, Discord, or Telegram and continue when you reply. |
| **Config discovery** | Find and read AI-tool configs (Claude Code, Cursor, Windsurf, Gemini CLI, and more) across your machine. |
| **Streaming guardrails** | Zero-context-cost monitors watch streaming output against rules and intervene without spending tokens. |
| **Async jobs** | Kick off long operations and await their results without holding up the conversation. |

You can always restrict the active tool set with `otto --tools <list>` or at runtime.

---

## Subagents

OTTO can delegate isolated chunks of work to specialized **subagents** running in their own context, then fold the results back in. This protects your main session from noisy intermediate output and lets independent work run in parallel.

- Run subagents **single**, in **parallel**, or **chained**.
- `/subagent` lists the user- and project-defined subagents available.
- Each subagent gets a focused brief and a constrained tool set, so it stays on task.

OTTO ships a roster of specialist subagents you can delegate to out of the box:

| Subagent | Specialty |
|---|---|
| `planner` | Break work into milestones, slices, and tasks |
| `researcher` | Investigate and gather context |
| `scout` | Fast read-only codebase exploration |
| `worker` | General execution of a scoped task |
| `refactorer` | Restructure code without behavior change |
| `reviewer` | Code review |
| `tester` | Write and run tests |
| `debugger` | Systematic root-cause debugging |
| `security` | Security review and threat checks |
| `git-ops` | Branch, commit, and worktree operations |
| `doc-writer` | Documentation |
| `typescript-pro` / `javascript-pro` | Language-specialist implementation |

Use subagents when a job splits cleanly — "research these three libraries," "review this diff," "find every caller of X" — and you don't want the digging to crowd your main conversation.

---

## Skills

Skills are specialized instruction sets OTTO loads when a task matches them — coding patterns, framework idioms, testing strategies, tool usage. They follow the open [Agent Skills standard](https://agentskills.io/), so the same skills work across many agents, not just OTTO.

### Skills that ship with OTTO

OTTO bundles a curated skill library so the agent has expert guidance from day one — no install needed:

- **Process & discipline** — `tdd`, `debug-like-expert`, `verify-before-complete`, `review`, `security-review`, `forensics`, `best-practices`, `lint`, `observability`, `code-optimizer`, `dependency-upgrade`, `api-design`
- **Planning & workflow** — `decompose-into-slices`, `write-milestone-brief`, `spike-wrap-up`, `create-workflow`, `handoff`
- **Frontend & UX** — `frontend-design`, `design-an-interface`, `make-interfaces-feel-better`, `web-design-guidelines`, `react-best-practices`, `accessibility`, `core-web-vitals`, `web-quality-audit`, `userinterface-wiki`, `agent-browser`
- **Docs & authoring** — `write-docs`, `create-skill`, `create-extension`, `create-mcp-server`, `github-workflows`
- **Utility** — `grill-me` (stress-test an idea), `btw`, `test`

### Where skills live

| Location | Scope |
|---|---|
| `~/.agents/skills/` | Global — shared across all your projects |
| `.agents/skills/` (in a repo) | Project-specific — commit to share with your team |

Global skills win when names collide.

### Using and installing skills

OTTO discovers skills automatically. The `skill_discovery` preference controls how aggressive it is: `auto` (apply automatically), `suggest` (identify but confirm — the default), or `off`.

Install skills with the [skills.sh](https://skills.sh) CLI:

```bash
npx skills add owner/repo                # interactive
npx skills add owner/repo --all          # everything in a repo
npx skills check && npx skills update    # keep them current
```

During project init, OTTO detects your tech stack and recommends relevant skill packs (Swift/iOS, React & web, Rust, Python, Go, document handling, and more).

### Steering which skills apply

In your preferences you can force, prefer, or avoid skills, and write conditional rules:

```yaml
always_use_skills: [debug-like-expert]
prefer_skills: [frontend-design]
avoid_skills: [security-docker]
skill_rules:
  - when: task involves Clerk authentication
    use: [clerk]
```

### Skill health

OTTO tracks how each skill performs across auto-mode runs:

```text
/otto skill-health              # overview: uses, success %, token trend, last used
/otto skill-health <name>       # detail for one skill
/otto skill-health --stale 30   # skills unused for 30+ days
/otto skill-health --declining  # skills with falling success rates
```

Skills are never auto-modified — when OTTO detects drift, it writes proposed fixes to a review queue for you to approve, because curated skills consistently outperform auto-generated ones.

---

## Authoring your own commands, skills & extensions

OTTO is extension-first: new capabilities go into skills, slash commands, or extensions rather than into the core.

### Custom skills

Create a directory with a `SKILL.md` file:

```text
~/.agents/skills/my-skill/
  SKILL.md          # instructions the model follows when the skill is active
  references/       # optional supporting files
```

Put it under a repo's `.agents/skills/` instead to make it project-local and committable.

### Scaffolding commands and extensions

OTTO ships generators so you don't start from a blank file:

| Command | What it creates |
|---|---|
| `/create-slash-command` | A new `/command` boilerplate |
| `/create-extension` | A full extension skeleton |
| `/audit` | An audit-tool scaffold |

### The extension SDK

An extension exports one default function that receives the `pi` API and registers everything at load time:

```typescript
import type { ExtensionAPI } from "@loop24/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Give the model a new ability
  pi.registerTool({ name: "my_tool", /* ... */ });

  // Add a user-facing slash command
  pi.registerCommand("deploy", {
    description: "Deploy to environment: /deploy dev|staging|prod",
    handler: async (args, ctx) => ctx.ui.notify(`Deploying to ${args}`, "info"),
  });

  // Hook the agent lifecycle
  pi.on("tool_call", async (event) => {
    if (event.input.command?.includes("rm -rf /")) {
      return { block: true, reason: "Blocked dangerous command" };
    }
  });
}
```

Extensions can register tools, commands, keyboard shortcuts, CLI flags, custom message renderers, and model providers; subscribe to lifecycle events (and block or modify tool calls, results, and the system prompt); render custom TUI components and widgets; manage state across session branches; and communicate with other extensions over a shared event bus. The full guide is in [`docs/extension-sdk/`](docs/extension-sdk/) — start with [`building-extensions.md`](docs/extension-sdk/building-extensions.md).

### Installing & managing extensions

```bash
otto install npm:@scope/name        # from npm
otto install git:github.com/u/repo  # from git
otto install ./local/path           # from disk
otto list                           # what's installed
otto remove <source>                # uninstall
```

From inside a session, `/otto extensions list|enable|disable|info|install|uninstall|update|validate` manages the same registry.

---

## Custom workflows

Beyond ad-hoc tasks, you can package repeatable processes as **workflow plugins**. Every workflow — bundled or your own — is discoverable via `/otto workflow <name>` and declares one of four execution modes:

| Mode | Use it for |
|---|---|
| `oneshot` | Prompt-only, no state, no branch — reviews, triage, changelog generation |
| `yaml-step` | A full step engine with fan-out batch work and shell verification |
| `markdown-phase` | Multi-phase work with state and phase-approval gates — releases, audits |
| `auto-milestone` | Hooks into the full auto pipeline — full project builds |

Discovery follows precedence: project (`.otto/workflows/`) → global (`~/.otto/workflows/`) → bundled. Bundled plugins include `bugfix`, `spike`, `hotfix`, `refactor`, `security-audit`, `dep-upgrade`, `release`, `performance-audit`, `pr-review`, `changelog-gen`, `issue-triage`, `dead-code`, `accessibility-audit`, `test-backfill`, `docs-sync`, `rename-symbol`, `env-audit`, and more.

```text
/otto workflow                 # list everything, grouped by mode
/otto workflow <name> [args]   # run one
/otto workflow new <name>      # scaffold a new workflow
/otto workflow install <src>   # install from a URL, gist, or gh repo
```

---

## Configuration & providers

Run `otto config` (or `/otto config`) for the interactive wizard. It covers:

- **Model provider** — a dozen-plus providers including Anthropic (and Bedrock / Vertex), OpenAI (and Azure), Google Gemini, Mistral, Groq, Cerebras, xAI, Hugging Face, MiniMax, GitHub Copilot, OpenRouter, Ollama, LM Studio, vLLM, and other OpenAI-compatible endpoints. Switch models or providers mid-session with `/model`, `/provider`, `Ctrl+L`, or `Ctrl+P`.

Provider conveniences:

- **Local models, zero config** — OTTO auto-detects a running Ollama instance, discovers your pulled models, and registers them as a first-class provider.
- **Claude Code as a provider** — if you have the Claude Code CLI installed, OTTO can delegate inference to it.
- **AWS auto-refresh** — when a Bedrock request fails on an expired token, OTTO refreshes AWS credentials and retries automatically.
- **Web-search provider** — Brave, Tavily, or built-in
- **Remote questions** — Discord, Slack, Telegram
- **Tool API keys** — Context7, Jina, Groq, and others

Global settings live in `~/.otto/config.json`. Environment variables always override the config file:

| Env var | Purpose | Default |
|---|---|---|
| `LOOP24_GATEWAY_URL` | Route all LLM traffic through the gateway | (none — direct to Anthropic) |
| `LOOP24_GATEWAY_TOKEN` | Optional Bearer auth for the gateway | (none) |
| `LANGFLOW_SERVER_URL` | Local Langflow server for flow triggers | `http://127.0.0.1:7860` |
| `LANGFLOW_API_KEY` | Langflow API key (`x-api-key` header) | (none) |
| `ANTHROPIC_API_KEY` | Direct Anthropic key when no gateway is set | (none) |
| `LOOP24_PROMPT_ENGINEER_MODEL` | Model for `/prompt-engineer` | `claude-haiku-4-5-20251001` |

See [`docs/user-docs/providers.md`](docs/user-docs/providers.md) for provider-specific setup and [`docs/user-docs/configuration.md`](docs/user-docs/configuration.md) for the full settings reference.

---

## Running OTTO without the TUI

For CI, cron jobs, and scripting, `otto headless` runs workflow commands with no interactive UI. It auto-responds to prompts, detects completion, and exits with meaningful codes.

```bash
otto headless                              # run auto mode (default)
otto headless next                         # run one unit
otto headless query                        # instant JSON state snapshot (~50ms, no LLM)
otto headless --timeout 600000 auto        # with a CI timeout
otto headless new-milestone --context spec.md --auto   # create from a file, then run
echo "Build a CLI tool" | otto headless new-milestone --context -   # from stdin
```

Output formats: `text` (human-readable, default), `json` (a single structured result at exit), and `stream-json` (live JSONL events). Exit codes signal success, error/timeout, blocked, and cancelled so orchestrators can branch on them. `otto headless query` is the recommended way for scripts to inspect project state.

**Output modes.** `otto --mode <text|json|rpc|mcp>` selects how OTTO talks to the outside world:

- `text` / `json` — human-readable or structured single-shot output for scripts.
- `rpc` — a JSON-RPC protocol over stdin/stdout, so non-Node programs can drive OTTO turn by turn.
- `mcp` — runs OTTO as a [Model Context Protocol](https://modelcontextprotocol.io) server, exposing its tools to external hosts like Claude Desktop or VS Code.

**Embedding.** OTTO's agent runtime is also consumable as a library, so you can embed the same engine — tool calling, session state, multi-provider model access — inside your own application rather than shelling out to the CLI.

---

## The web interface

Prefer a browser? Launch the web surface:

```bash
otto --web [project-path]
```

It gives you the same project view — progress, plans, and history — in a browser instead of the terminal. See [`docs/user-docs/web-interface.md`](docs/user-docs/web-interface.md).

---

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Enter` | Send a steering message while OTTO is working (interrupts after the current tool) |
| `Alt+Enter` | Send a follow-up (waits for the current turn to finish) |
| `Ctrl+L` | Switch model |
| `Ctrl+P` | Cycle favorite models |
| `Ctrl+Alt+G` | Toggle the dashboard overlay |
| `Ctrl+Alt+V` | Toggle voice transcription |
| `Ctrl+Alt+B` | Show background shell processes |
| `Ctrl+V` / `Alt+V` | Paste an image from the clipboard (screenshot → vision input) |
| `Escape` | Pause auto mode (keeps the conversation) |

> In terminals without Kitty keyboard-protocol support (macOS Terminal.app, some JetBrains IDEs), OTTO shows slash-command fallbacks instead of the `Ctrl+Alt` shortcuts. If your terminal intercepts `Ctrl+V`, use `Alt+V` for image paste.

---

## Where to go next

- [`README.md`](README.md) — what OTTO is and how it fits the stack
- [`docs/INSTALL.md`](docs/INSTALL.md) — install, uninstall, troubleshoot
- [`docs/user-docs/`](docs/user-docs/) — deep dives on auto mode, providers, cost management, teams, and more
- [`docs/extension-sdk/`](docs/extension-sdk/) — build your own tools, commands, and extensions
