# Commands Reference

## Session Commands

| Command | Description |
|---------|-------------|
| `/otto` | Step mode — execute one unit at a time, pause between each |
| `/otto next` | Explicit step mode (same as `/otto`) |
| `/otto auto` | Autonomous mode — research, plan, execute, commit, repeat |
| `/otto quick` | Execute a quick task with OTTO guarantees (atomic commits, state tracking) without full planning overhead |
| `/otto stop` | Stop auto mode gracefully |
| `/otto pause` | Pause auto-mode (preserves state, `/otto auto` to resume) |
| `/otto steer` | Hard-steer plan documents during execution |
| `/otto discuss` | Discuss architecture and decisions (works alongside auto mode) |
| `/otto status` | Open workflow visualizer |
| `/otto widget` | Cycle dashboard widget: full / small / min / off |
| `/otto queue` | Queue and reorder future milestones (`pending`, `queued`, and legacy `planned`; safe during auto mode) |
| `/otto capture` | Fire-and-forget thought capture (works during auto mode) |
| `/otto triage` | Manually trigger triage of pending captures |
| `/otto debug` | Create and inspect persistent /otto debug sessions |
| `/otto debug list` | List persisted debug sessions |
| `/otto debug status <slug>` | Show status for one debug session slug |
| `/otto debug continue <slug>` | Resume an existing debug session slug |
| `/otto debug --diagnose` | Inspect malformed artifacts and session health (`--diagnose [<slug> | <issue text>]`) |
| `/otto dispatch` | Dispatch a specific phase directly (research, plan, execute, complete, reassess, uat, replan) |
| `/otto history` | View execution history (supports `--cost`, `--phase`, `--model` filters) |
| `/otto forensics` | Full-access OTTO debugger — structured anomaly detection, unit traces, and LLM-guided root-cause analysis for auto-mode failures |
| `/otto cleanup` | Clean up OTTO state files and stale worktrees |
| `/otto worktree` (`/otto wt`) | Manage OTTO worktrees from the TUI |
| `/otto visualize` | Open workflow visualizer (progress, timeline, deps, metrics, health, agent, changes, knowledge, captures, export) |
| `/otto brief <mode> [topic] [--slides]` | Generate a self-contained visual HTML brief. Modes: `diagram`, `plan`, `diff`, `recap`, `table`, `slides`. |
| `/otto report` | Generate HTML reports for all milestones and open the reports index in a browser |
| `/otto report --html` | Generate self-contained HTML report for current or completed milestone |
| `/otto report --html --all` | Generate retrospective reports for all milestones at once |
| `/otto update` | Update OTTO to the latest version in-session |
| `/otto knowledge` | Add persistent project knowledge. Rules remain manually maintained in `KNOWLEDGE.md`; patterns and lessons are memory-backed and projected into the file on the next session start. |
| `/otto eval-review <sliceId>` | Audit a slice's AI evaluation strategy and write a scored `<sliceId>-EVAL-REVIEW.md`. Flags: `--force` overwrites; `--show` prints the existing audit. See [eval-review](eval-review.md). |
| `/otto extract-learnings <MID>` | Extract structured Decisions, Lessons, Patterns, and Surprises from a completed milestone — writes `<MID>-LEARNINGS.md` audit trail, persists durable knowledge through the memory/decision stores, and projects reviewable knowledge into `.otto/workflow/KNOWLEDGE.md` on the next session start. Runs automatically at milestone completion. |
| `/otto fast` | Toggle service tier for supported models (prioritized API routing) |
| `/otto rate` | Rate last unit's model tier (over/ok/under) — improves adaptive routing |
| `/otto changelog` | Show categorized release notes |
| `/otto logs` | Browse activity logs, debug logs, and metrics |
| `/otto remote` | Control remote auto-mode |
| `/otto help` | Categorized command reference with descriptions for all OTTO subcommands |

`/otto discuss` supports optional direct targets: `/otto discuss M014`, `/otto discuss M014/S03`, `/otto discuss --milestone M014`, and `/otto discuss --slice M014/S03`.

## Visual Briefs

`/otto brief` asks the agent to gather evidence and write a single responsive HTML artifact for visual review, planning, recap, or presentation. Usage:

```text
/otto brief <diagram|plan|diff|recap|table|slides> [topic] [--slides]
```

Modes:

| Mode | Use it for |
|------|------------|
| `diagram` | System, architecture, flow, state, data, or process diagrams. If the first argument is not a known mode, OTTO treats the whole request as a diagram topic. |
| `plan` | Visual implementation plans with scope, likely files, edge cases, risks, and tests. |
| `diff` | Visual reviews of current staged and unstaged repository changes. If no topic is supplied, it reviews the current repository changes. |
| `recap` | Context-switching project recaps. If no topic is supplied, it recaps the current project. |
| `table` | Dense comparisons, audits, matrices, and status reports as readable HTML tables. |
| `slides` | A concise visual deck. Passing `--slides` with another mode also requests slide-deck output. |

Artifacts are written under the OTTO agent directory's `diagrams/` folder with a descriptive kebab-case `.html` filename. The generated file is self-contained with embedded CSS and minimal JavaScript; it may use CDN libraries such as Mermaid for diagrams, but must keep useful written context if a CDN fails.

After writing the file, OTTO attempts to open it in a browser using the local platform opener (`open` on macOS, `xdg-open` on Linux, or `cmd /c start` on Windows). If browser opening is unavailable or fails, the command reports the absolute file path.

## Configuration & Diagnostics

| Command | Description |
|---------|-------------|
| `/otto prefs` | Model selection, timeouts, budget ceiling |
| `/otto mode` | Switch workflow mode (solo/team) with coordinated defaults for milestone IDs, git commit behavior, and documentation |
| `/otto config` | Re-run the provider setup wizard (LLM provider + tool keys) |
| `/otto keys` | API key manager — list, add, remove, test, rotate, doctor |
| `/otto doctor` | Runtime health checks with auto-fix — issues surface in real time across widget, visualizer, and HTML reports (v2.40) |
| `/otto inspect` | Show SQLite DB diagnostics |
| `/otto init` | Project init wizard — detect, configure, bootstrap `.otto/workflow/`; if `.otto/workflow/` already exists, opens an "Already Initialized" menu with `Re-configure preferences`, `Suggest & install skills`, or `Cancel` |
| `/otto setup` | Global setup status and configuration |
| `/otto skill-health` | Skill lifecycle dashboard — usage stats, success rates, token trends, staleness warnings |
| `/otto skill-health <name>` | Detailed view for a single skill |
| `/otto skill-health --declining` | Show only skills flagged for declining performance |
| `/otto skill-health --stale N` | Show skills unused for N+ days |
| `/otto hooks` | Show configured post-unit and pre-dispatch hooks |
| `/otto run-hook` | Manually trigger a specific hook |
| `/otto migrate` | Migrate a v1 `.planning` directory to `.otto/workflow` format |
| `/otto recover` | Explicitly reset database hierarchy plus persisted validation and quality-gate state, then reconstruct from rendered markdown after database loss or corruption |

## Milestone Management

| Command | Description |
|---------|-------------|
| `/otto new-project [--deep]` | Bootstrap a new project; `--deep` enables staged project-level discovery |
| `/otto new-milestone [--deep]` | Create a new milestone; `--deep` opts the project into deep planning mode |
| `/otto skip` | Prevent a unit from auto-mode dispatch |
| `/otto undo` | Revert last completed unit |
| `/otto undo-task` | Reset a specific task's completion state (DB + markdown) |
| `/otto reset-slice` | Reset a slice and all its tasks (DB + markdown) |
| `/otto park` | Park a milestone — skip without deleting |
| `/otto unpark` | Reactivate a parked milestone |
| Discard milestone | Available via `/otto` wizard → "Milestone actions" → "Discard" |

Milestone and slice titles created during planning must not contain forward slash (`/`), en dash, or em dash characters. OTTO reserves those characters as state-document delimiters, so `plan-milestone` rejects titles that include them.

## Parallel Orchestration

| Command | Description |
|---------|-------------|
| `/otto parallel start` | Analyze eligibility, confirm, and start workers |
| `/otto parallel status` | Show all workers with state, progress, and cost |
| `/otto parallel stop [MID]` | Stop all workers or a specific milestone's worker |
| `/otto parallel pause [MID]` | Pause all workers or a specific one |
| `/otto parallel resume [MID]` | Resume paused workers |
| `/otto parallel merge [MID]` | Merge completed milestones back to main |

See [Parallel Orchestration](./parallel-orchestration.md) for full documentation.

## Workflow Templates (v2.42)

| Command | Description |
|---------|-------------|
| `/otto start` | Start a workflow template (bugfix, spike, feature, hotfix, refactor, security-audit, dep-upgrade, full-project) |
| `/otto start resume` | Resume an in-progress workflow |
| `/otto templates` | List available workflow templates |
| `/otto templates info <name>` | Show detailed template info |

## Custom Workflows

The unified plugin system. Every workflow — bundled, user-authored, or
remotely installed — is discoverable via `/otto workflow <name>` and declares
one of four execution modes:

| Mode              | What it does                                                                              |
|-------------------|-------------------------------------------------------------------------------------------|
| `oneshot`         | Prompt-only, no state, no branch. For reviews, triage, changelog generation.              |
| `yaml-step`       | Full engine with GRAPH.yaml, iterate, and shell-verify. For fan-out batch work.           |
| `markdown-phase`  | Multi-phase with STATE.json + phase-approval gates. For release, performance audit.       |
| `auto-milestone`  | Hooks into the full `/otto auto` pipeline. Reserved for `full-project`.                    |

### Discovery order (project > global > bundled)

1. `.otto/workflow/workflows/<name>.{yaml,md}` — project-local, checked into the repo.
2. `~/.otto/workflows/<name>.{yaml,md}` — global, private to the machine.
3. Bundled — ships with OTTO (see the full list with `/otto workflow`).

Legacy `.otto/workflow/workflow-defs/` YAML definitions are still picked up for
backwards compatibility.

### Commands

| Command | Description |
|---------|-------------|
| `/otto workflow` | List all discoverable plugins, grouped by mode |
| `/otto workflow <name> [args]` | Run a plugin directly (resolved via precedence chain) |
| `/otto workflow info <name>` | Show plugin metadata — source, mode, phases, path |
| `/otto workflow new` | Create a new workflow definition (via the `create-workflow` skill) |
| `/otto workflow install <source>` | Install a plugin from `https://...`, `gist:<id>`, or `gh:owner/repo/path[@ref]` |
| `/otto workflow uninstall <name>` | Remove an installed plugin and its provenance record |
| `/otto workflow run <name> [k=v]` | Explicit YAML run form (same as `/otto workflow <name>` for yaml-step plugins) |
| `/otto workflow list` | List YAML workflow runs (history) |
| `/otto workflow validate <name>` | Validate a YAML definition |
| `/otto workflow pause` | Pause custom workflow auto-mode |
| `/otto workflow resume` | Resume paused custom workflow auto-mode |

### Bundled plugins

- **Phased (`markdown-phase`)**: `bugfix`, `small-feature`, `spike`, `hotfix`,
  `refactor`, `security-audit`, `dep-upgrade`, `release`, `api-breaking-change`,
  `performance-audit`, `observability-setup`, `ci-bootstrap`.
- **Oneshot**: `pr-review`, `changelog-gen`, `issue-triage`, `pr-triage`,
  `onboarding-check`, `dead-code`, `accessibility-audit`.
- **YAML engine (`yaml-step`)**: `test-backfill`, `docs-sync`, `rename-symbol`,
  `env-audit`.
- **Auto-milestone**: `full-project` (reached via `/otto start full-project` or
  `/otto auto`).

### Authoring a custom plugin

Run `/otto workflow new <name>` to scaffold via the `create-workflow` skill.
Plugins are plain YAML (`.yaml`) or markdown (`.md`) files. See
`src/resources/extensions/workflow/workflow-templates/` for bundled examples.

## Extensions

| Command | Description |
|---------|-------------|
| `/otto extensions list` | List all extensions and their status. User-installed entries show `[user]` plus the install source |
| `/otto extensions enable <id>` | Enable a disabled extension |
| `/otto extensions disable <id>` | Disable an extension |
| `/otto extensions info <id>` | Show extension details |
| `/otto extensions validate <path>` | Validate an extension package directory against the manifest schema before publishing or installing. (v2.78) |

Install sources are managed from the terminal through the package manager:
`otto install <source>`, `otto remove <source>`, `otto list`, and `otto package update [source]`.
Install sources are resolved as `npm:` packages, git URLs, or local paths.
See [OTTO Package Management](./package-management.md) for the manifest format,
source types, install scopes, and sample packages.

## cmux Integration

| Command | Description |
|---------|-------------|
| `/otto cmux status` | Show cmux detection, prefs, and capabilities |
| `/otto cmux on` | Enable cmux integration |
| `/otto cmux off` | Disable cmux integration |
| `/otto cmux notifications on/off` | Toggle cmux desktop notifications |
| `/otto cmux sidebar on/off` | Toggle cmux sidebar metadata |
| `/otto cmux splits on/off` | Toggle cmux visual subagent splits |

## Subagents

| Command | Description |
|---------|-------------|
| `/subagent` | List available user and project subagents. Run records, status checks, and follow-up resume are handled through the `subagent` tool; see [Subagents](./subagents.md). |

## GitHub Sync (v2.39)

| Command | Description |
|---------|-------------|
| `/github-sync bootstrap` | Initial setup — creates GitHub Milestones, Issues, and draft PRs from current `.otto/workflow/` state |
| `/github-sync status` | Show sync mapping counts (milestones, slices, tasks) |

Enable with `github.enabled: true` in preferences. Requires `gh` CLI installed and authenticated. Sync mapping is persisted in `.otto/workflow/.github-sync.json`.

## Git Commands

| Command | Description |
|---------|-------------|
| `/worktree` (`/wt`) | Git worktree lifecycle — create, switch, merge, remove |

## OTTO Worktree Commands

Use `/otto worktree` from an active TUI session to inspect and clean up OTTO-managed worktrees without leaving the conversation. `/otto wt` is an alias.

| Command | Description |
|---------|-------------|
| `/otto worktree list` | Show each worktree, branch, path, clean/unmerged/uncommitted status, diff stats, and commit count. Alias: `/otto worktree ls`. |
| `/otto worktree merge [name]` | Merge a worktree into the detected main branch, then remove the worktree and its branch. The name is optional only when exactly one worktree exists. |
| `/otto worktree clean` | Remove only merged or empty worktrees. Worktrees with unmerged diffs or uncommitted changes are kept. |
| `/otto worktree remove <name> [--force]` | Remove a named worktree and delete its branch. Refuses unmerged or uncommitted work unless `--force` is supplied. Alias: `/otto worktree rm`. |

Safety behavior:

- `merge` auto-commits dirty worktree changes before merging when possible.
- `merge` refuses to continue if the project root is not on the detected main branch; check out the main branch and rerun it.
- `clean` never deletes worktrees with pending file changes.
- `remove` requires `--force` to discard unmerged or uncommitted work.

## Telegram Commands

The following commands are sent directly in your **Telegram chat** to a configured OTTO bot — they are not OTTO CLI commands. Telegram command polling runs every ~5 seconds while auto-mode is active. Each response is prefixed with the project name (e.g., `📁 MyProject`).

| Command | Description |
|---------|-------------|
| `/status` | Current milestone, active unit, and session cost |
| `/progress` | Roadmap overview — completed and open milestones |
| `/budget` | Token usage and cost for the current session |
| `/pause` | Pause auto-mode after the current unit finishes |
| `/resume` | Clear a pause directive and continue auto-mode |
| `/log [n]` | Last `n` activity log entries (default: 5) |
| `/help` | List all available Telegram commands |

**Requirements:** Telegram must be configured as your remote channel (`remote_questions.channel: telegram`). Commands are only processed while auto-mode is running. See [Remote Questions — Telegram Commands](./remote-questions.md#telegram-commands) for setup and details.

## Session Management

| Command | Description |
|---------|-------------|
| `/clear` | Start a new session (alias for `/new`) |
| `/exit` | Graceful shutdown — saves session state before exiting |
| `/kill` | Kill OTTO process immediately |
| `/model` | Switch the active model |
| `/login` | Log in to an LLM provider |
| `/thinking` | Toggle thinking level during sessions |
| `/voice` | Toggle real-time speech-to-text (macOS, Linux) |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+G` | Toggle dashboard overlay |
| `Ctrl+Alt+V` | Toggle voice transcription |
| `Ctrl+Alt+B` | Show background shell processes |
| `Ctrl+V` / `Alt+V` | Paste image from clipboard (screenshot → vision input) |
| `Escape` | Pause auto mode (preserves conversation) |

> **Note:** In terminals without Kitty keyboard protocol support (macOS Terminal.app, JetBrains IDEs), slash-command fallbacks are shown instead of `Ctrl+Alt` shortcuts.
>
> **Tip:** If `Ctrl+V` is intercepted by your terminal (e.g. Warp), use `Alt+V` instead for clipboard image paste.

## CLI Flags

| Flag | Description |
|------|-------------|
| `otto` | Start a new interactive session |
| `otto --continue` (`-c`) | Resume the most recent session for the current directory |
| `otto --model <id>` | Override the default model for this session |
| `otto --print "msg"` (`-p`) | Single-shot prompt mode (no TUI) |
| `otto --mode <text\|json\|rpc\|mcp>` | Output mode for non-interactive use |
| `otto --list-models [search]` | List available models and exit |
| `otto --web [path]` | Start browser-based web interface (optional project path) |
| `otto --worktree` (`-w`) [name] | Start session in a git worktree (auto-generates name if omitted) |
| `otto --no-session` | Disable session persistence |
| `otto --extension <path>` | Load an additional extension (can be repeated) |
| `otto --append-system-prompt <text>` | Append text to the system prompt |
| `otto --tools <list>` | Comma-separated list of tools to enable |
| `otto --version` (`-v`) | Print version and exit |
| `otto --help` (`-h`) | Print help and exit |
| `otto sessions` | Interactive session picker — list all saved sessions for the current directory and choose one to resume |
| `otto --debug` | Enable structured JSONL diagnostic logging for troubleshooting dispatch and state issues |
| `otto config` | Set up global API keys for search and docs tools (saved to `~/.otto/agent/auth.json`, applies to all projects). See [Global API Keys](./configuration.md#global-api-keys-otto-config). |
| `otto update` | Update OTTO to the latest version |
| `otto headless new-milestone` | Create a new milestone from a context file (headless — no TUI required) |

## Headless Mode

`otto headless` runs `/otto` commands without a TUI — designed for CI, cron jobs, and scripted automation. It spawns a child process in RPC mode, auto-responds to interactive prompts, detects completion, and exits with meaningful exit codes.

```bash
# Run auto mode (default)
otto headless

# Run a single unit
otto headless next

# Instant JSON snapshot — no LLM, ~50ms
otto headless query

# With timeout for CI
otto headless --timeout 600000 auto

# Force a specific phase
otto headless dispatch plan

# Create a new milestone from a context file and start auto mode
otto headless new-milestone --context brief.md --auto

# Create a milestone from inline text
otto headless new-milestone --context-text "Build a REST API with auth"

# Pipe context from stdin
echo "Build a CLI tool" | otto headless new-milestone --context -
```

| Flag | Description |
|------|-------------|
| `--timeout N` | Overall timeout in milliseconds (default: 300000 / 5 min) |
| `--max-restarts N` | Auto-restart on crash with exponential backoff (default: 3). Set 0 to disable. Deterministic no-work failures are not restart-eligible. |
| `--json` | Stream all events as JSONL to stdout |
| `--model ID` | Override the model for the headless session |
| `--context <file>` | Context file for `new-milestone` (use `-` for stdin) |
| `--context-text <text>` | Inline context text for `new-milestone` |
| `--auto` | Chain into auto-mode after milestone creation |

**Exit codes:** `0` = complete, `1` = error or timeout, `2` = blocked.

In JSON output summaries, headless can also return `status: "no-work-deterministic"` for repeatable no-progress tails (for example select → input → cancelled). This status exits with code `1` and suppresses automatic restart loops.

Any `/otto` subcommand works as a positional argument — `otto headless status`, `otto headless doctor`, `otto headless dispatch execute`, etc.

### `otto headless recover` (v2.79)

Non-TTY equivalent of `/otto recover` — resets the DB hierarchy plus persisted validation and quality-gate state, then reconstructs from rendered markdown. Designed for CI, cron, and any environment where the interactive recover prompt cannot run.

```bash
otto headless recover
```

Exits non-zero if recovery fails. Pair with `otto headless query` afterwards to verify the rebuilt state.

### `otto headless query`

Returns a single JSON object with the full project snapshot — no LLM session, no RPC child, instant response (~50ms). This is the recommended way for orchestrators and scripts to inspect OTTO state.

```bash
otto headless query | jq '.state.phase'
# "executing"

otto headless query | jq '.next'
# {"action":"dispatch","unitType":"execute-task","unitId":"M001/S01/T03"}

otto headless query | jq '.cost.total'
# 4.25
```

**Output schema:**

```json
{
  "state": {
    "phase": "executing",
    "activeMilestone": { "id": "M001", "title": "..." },
    "activeSlice": { "id": "S01", "title": "..." },
    "activeTask": { "id": "T01", "title": "..." },
    "registry": [{ "id": "M001", "status": "active" }, ...],
    "progress": { "milestones": { "done": 0, "total": 2 }, "slices": { "done": 1, "total": 3 } },
    "blockers": []
  },
  "next": {
    "action": "dispatch",
    "unitType": "execute-task",
    "unitId": "M001/S01/T01"
  },
  "cost": {
    "workers": [{ "milestoneId": "M001", "cost": 1.50, "state": "running", ... }],
    "total": 1.50
  }
}
```

## MCP Server Mode

`otto --mode mcp` runs OTTO as a [Model Context Protocol](https://modelcontextprotocol.io) server over stdin/stdout. This exposes all OTTO tools (read, write, edit, bash, etc.) to external AI clients — Claude Desktop, VS Code Copilot, and any MCP-compatible host.

```bash
# Start OTTO as an MCP server
otto --mode mcp
```

The server registers all tools from the agent session and maps MCP `tools/list` and `tools/call` requests to OTTO tool definitions. It runs until the transport closes.

## In-Session Update

`/otto update` checks npm for a newer version of OTTO and installs it without leaving the session.

```bash
/otto update
# Current version: v2.36.0
# Checking npm registry...
# Updated to v2.37.0. Restart OTTO to use the new version.
```

If already up to date, it reports so and takes no action.

## Report

`/otto report` generates HTML reports for all milestones and opens the reports index in a browser. `/otto export` remains available as an alias.

```bash
# Generate all missing milestone reports and open the reports index
/otto report

# Generate HTML report for the active milestone
/otto report --html

# Generate retrospective reports for ALL milestones at once
/otto report --html --all
```

Reports are saved to `.otto/workflow/reports/` with a browseable `index.html` that links to all generated snapshots.
