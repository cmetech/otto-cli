<!-- LOOP24 — terminal-based developer chat assistant with LangFlow integration -->

# LOOP24

> **Fork attribution.** LOOP24 is a permanent hard fork of [open-gsd/gsd-pi](https://github.com/open-gsd/gsd-pi) by Lex Christopherson, used under the MIT License. See [`LICENSE`](LICENSE).

LOOP24 is a terminal-based chat assistant for developers:

- Optionally routes every LLM token through a gateway URL (`LOOP24_GATEWAY_URL`) — useful in compliance environments where direct provider access is restricted. Falls back to direct Anthropic when no gateway is configured.
- Keeps local tool execution (filesystem, bash, git) on the developer's laptop.
- Adds a `loop24` extension hosting custom commands — LangFlow flow triggers, a flow builder, and a prompt engineer.
- Re-brands the terminal UI with the Loop24 visual identity (yellow primary, brand block banner).

LOOP24 is **not** trying to be a general-purpose AI assistant. It is a developer agent that happens to also trigger non-coding workflows through LangFlow.

## Status

v0.x — early release. Install via npm or clone the repo. The CLI is functional but the public registry presence is new — please file issues if you hit anything.

## Quickstart

Requires **Node ≥22** on PATH.

### Install from npm (recommended)

```bash
npm install -g @ericsson/loop24
loop24
```

### Install from source (contributors)

```bash
git clone <github-repo>/loop24-client.git
cd loop24-client
./scripts/install.sh
```

This installs dependencies, builds the binary, symlinks `loop24` into `~/.local/bin/`, and offers to launch the first-run config wizard so you can point LOOP24 at your gateway and (optionally) LangFlow.

After install (either path):

```bash
loop24            # interactive TUI
loop24 --help     # subcommands
loop24 config     # re-run any part of the config wizard
```

See [`docs/INSTALL.md`](docs/INSTALL.md) for prerequisites, manual install, uninstall, and troubleshooting.

## What's inside

| Command | Purpose |
|---|---|
| `/loop24 build-flow <description>` | Generate a LangFlow flow JSON from a natural-language description |
| `/loop24 prompt-engineer <task>` | Polish a rough task description into a structured prompt for a coding agent |
| `/loop24 <flow-name>` | Trigger any LangFlow flow declared in `extensions/loop24/commands/flow-triggers/*.yaml` |
| `/loop24 plan`, `/loop24 quick`, etc. | Inherited from gsd-pi — multi-step workflow commands for software engineering tasks |

## Documentation

- [`docs/INSTALL.md`](docs/INSTALL.md) — install / uninstall / troubleshoot
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — design specifications
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — implementation plans (one per phase)
- [`LOOP24-PATCHES.md`](LOOP24-PATCHES.md) — every fork edit + known deferred cleanups

## Configuration

LOOP24 reads from `~/.loop24/config.json` (created by the first-run wizard) and env-var overrides:

| Env var | Purpose | Default |
|---|---|---|
| `LOOP24_GATEWAY_URL` | Compliance proxy for all LLM traffic | (none — direct to Anthropic) |
| `LOOP24_GATEWAY_TOKEN` | Optional Bearer auth for the gateway | (none) |
| `LANGFLOW_SERVER_URL` | LangFlow server for flow triggers | `http://127.0.0.1:7860` |
| `LANGFLOW_API_KEY` | LangFlow API key (x-api-key header) | (none) |
| `ANTHROPIC_API_KEY` | Direct Anthropic key when no gateway | (none) |
| `LOOP24_PYTHON_BIN` | Python 3 interpreter for build-flow tools | `python3` on PATH |
| `LOOP24_PROMPT_ENGINEER_MODEL` | Model for `/loop24 prompt-engineer` | `claude-haiku-4-5-20251001` |

Env vars always win over config file. Run `loop24 config` to interactively set any subset (`gateway`, `langflow`, `llm`, or `all`).

## Development

```bash
npm ci
npm run build
npm test
```

Plans live in [`docs/superpowers/plans/`](docs/superpowers/plans/) — one per phase, executed by subagents.

## License

MIT — see [`LICENSE`](LICENSE). Inherited from upstream gsd-pi; copyright Lex Christopherson 2026.
