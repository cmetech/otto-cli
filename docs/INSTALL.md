# OTTO Install Guide

This is the longer-form install/uninstall/troubleshoot guide. For the quickstart,
see the [README](../README.md).

## Prerequisites

### Required
- **Node.js ≥22** — https://nodejs.org/. Verify with `node -v`.
- **git** — https://git-scm.com/. Verify with `git --version`.
- **POSIX shell** — macOS and Linux ship one. Windows is not supported in v1.

### Optional (per feature)
| Need it for | Tool | Notes |
|---|---|---|
| `/otto build-flow` | **Python 3** | Bundled scripts run via `python3` on PATH. Override with `OTTO_PYTHON_BIN` if your interpreter lives elsewhere. The scripts depend on the `requests` PyPI package — install with `pip install requests`. |
| `/otto build-flow` (full schema validation) | **lfx** CLI | Optional. Without it, `otto__validate_flow` falls back to JSON-syntax-only validation. |
| `/otto <flow-name>` triggers | **LangFlow** | Local LangFlow at `http://127.0.0.1:7860` (override via `LANGFLOW_SERVER_URL`). API key in `LANGFLOW_API_KEY` if your instance requires auth. |
| Compliance routing | **otto-gateway** | Internal Anthropic-shaped proxy. Set `OTTO_GATEWAY_URL` + (optionally) `OTTO_GATEWAY_TOKEN`. |
| LLM access without gateway | **Anthropic API key** | `ANTHROPIC_API_KEY` env var. |

## Install

### Recommended: clone + install script

```bash
cd ~/Projects/repos/local             # or wherever you keep clones
git clone git@github.com:cmetech/otto-cli.git
cd otto-cli
./scripts/install.sh
```

`scripts/install.sh` will:

1. Verify Node ≥22 + git are on PATH.
2. Warn if Python 3 is missing (only needed by `/otto build-flow`).
3. Run `npm install` and `npm run build`.
4. Symlink `dist/loader.js` → `~/.local/bin/otto`.
5. Print PATH advice if `~/.local/bin` isn't on your PATH.
6. Offer to launch `otto config all` so you can point OTTO at your gateway and LangFlow.

The script is **idempotent** — safe to re-run on an existing install. It will rebuild and refresh the symlink.

#### Flags

- `--no-wizard` — skip the post-install config-wizard prompt
- `--bin-dir DIR` — target dir for the symlink (default `~/.local/bin`)
- `-h, --help` — show usage

### Manual install (if you want to know exactly what's happening)

```bash
cd otto-cli
npm install
npm run build
mkdir -p ~/.local/bin
ln -sfn "$PWD/dist/loader.js" ~/.local/bin/otto
```

Then add `~/.local/bin` to your PATH if needed:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc   # or ~/.bashrc
source ~/.zshrc
```

Verify:

```bash
otto --version
```

Then run the first-run wizard:

```bash
otto config all
```

## Update

OTTO has no auto-update yet. To pull the latest:

```bash
cd otto-cli
git pull
./scripts/install.sh --no-wizard
```

(The script rebuilds and refreshes the symlink; config is preserved.)

## Uninstall

Remove the symlink and the workspace:

```bash
rm -f ~/.local/bin/otto
rm -rf ~/Projects/repos/local/otto-cli     # adjust to your clone path
```

To also clear user-scoped state (config, prompt history, agent cache):

```bash
rm -rf ~/.otto
```

## Troubleshooting

### "node is not on PATH"
Install Node 22+ from https://nodejs.org/, then re-run `./scripts/install.sh`. If you use a version manager (nvm, fnm, asdf), make sure your shell rc activates it before the install script runs.

### "Node v20.x is too old"
OTTO requires Node 22+. Switch your default with your version manager:
```bash
nvm install 22 && nvm use 22 && nvm alias default 22
```

### Build fails with TypeScript errors
OTTO builds with `--experimental-strip-types`. If you see strip-types errors, your Node may not support this flag (Node ≥22 should). Verify `node -v` is `v22` or higher.

### "otto: command not found" after install
Check that `~/.local/bin` is on your PATH:
```bash
echo $PATH | tr ':' '\n' | grep .local/bin
```
If empty, add it (see "Manual install" above).

### Banner appears but LLM calls fail with "no API key"
Run `otto config llm` (or `otto config all`) to configure Anthropic credentials or a gateway URL. Env vars also work:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OTTO_GATEWAY_URL=http://127.0.0.1:8080/v1
```

### `/otto build-flow` tools all return "exit 127"
Python 3 is missing on PATH. Install it (`brew install python` on macOS, your distro's `python3` package on Linux) or set `OTTO_PYTHON_BIN` to your interpreter path. The Python scripts also need `requests` — `pip install requests`.

### LangFlow banner says "offline"
Either LangFlow isn't running, or it's at a non-default URL. Start it (`langflow run`), then either set `LANGFLOW_SERVER_URL` or re-run `otto config langflow` to update the saved config.

### Headless mode says "command not found" for `/otto build-flow` or `/otto prompt-engineer`
These commands work in the interactive TUI but are not routed by `otto headless` (pre-existing gap — see OTTO-PATCHES.md Phase 5 architectural limitation). Use the interactive TUI for these specific commands.

## See also

- [`README.md`](../README.md) — overview + quickstart
- [`OTTO-PATCHES.md`](../OTTO-PATCHES.md) — every fork edit + known deferred cleanups
- [`docs/superpowers/specs/2026-05-23-otto-client-design.md`](superpowers/specs/2026-05-23-otto-client-design.md) — full design spec
