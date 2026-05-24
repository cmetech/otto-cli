# LOOP24 Phase 6 — Install Script & Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `scripts/install.sh` + `docs/INSTALL.md` + a rewritten `README.md` so a developer on a fresh laptop with Node ≥22 + git can clone the loop24-client repo and have a working `loop24` binary on PATH in under 5 minutes.

**Architecture:** Three deliverables, no runtime code changes. `scripts/install.sh` is the Phase 1 distribution per design spec §7 — bash script that verifies prereqs, runs `npm install` + `npm run build`, symlinks `dist/loader.js` → `~/.local/bin/loop24` (creating the dir if needed), prints PATH advice when relevant, and optionally launches the first-run wizard (already exists from Phase 2b). `docs/INSTALL.md` is the full walkthrough (prereqs, what install.sh does, manual alternative, uninstall, troubleshooting). README.md gets rewritten from its inherited gsd-pi shape to a LOOP24-first quickstart.

**Tech Stack:** Bash 4+ (macOS ships 3.2; we use POSIX-portable bash 3.2 syntax — no associative arrays, no `[[ -v ]]`), standard Unix tools (`command -v`, `ln -sf`, `mkdir -p`), Markdown for docs. No new TypeScript.

**Scope boundary:**

In scope:
- `scripts/install.sh` — clone+install+symlink+wizard. Idempotent: re-running it on an existing install rebuilds + re-symlinks cleanly.
- `docs/INSTALL.md` — comprehensive install/uninstall/troubleshoot guide
- `README.md` — short LOOP24-first overview with quickstart pointing at `scripts/install.sh`; archive of existing gsd-pi content removed
- Smoke verification: simulated clean install in a temp directory

Out of scope (deferred to Phase 7):
- npm publish (`@loop24/client`) — Phase 7, blocked on internal registry availability per open Q4
- `loop24 update` self-update command — current update flow is `git pull && npm run build`; documented but not automated in Phase 6
- Windows install — macOS and Linux only in v1 per design spec
- Homebrew formula — out of scope

**Dependencies:**
- Node ≥22 (already required by the build)
- `git` on PATH (used to detect repo root in install.sh; also implicit in clone step)
- `npm` (bundled with Node)
- POSIX shell (bash 3.2+ or any POSIX-compatible interpreter)
- Existing scripts `scripts/postinstall.js`, `scripts/install-pi-global.js`, `scripts/install.js` are NOT replaced — they handle the npm-install code path (Phase 7). Phase 6 only adds the clone-install path via `scripts/install.sh`.

---

## File Structure

### New files

```
scripts/install.sh              # NEW — Phase 1 clone+install distribution script
docs/INSTALL.md                 # NEW — full install/uninstall/troubleshoot guide
```

### Modified files

- `README.md` — rewritten LOOP24-first. Quickstart points at `scripts/install.sh`. Drops gsd-pi history / npm install hints / `@opengsd/gsd-pi` references.

### File responsibilities

| File | Responsibility |
|---|---|
| `scripts/install.sh` | Verify Node ≥22 + git; run npm install + npm run build; symlink `dist/loader.js` → `~/.local/bin/loop24`; print PATH advice if `~/.local/bin` not in PATH; optionally launch the first-run config wizard via `loop24 config` (asks the user). Supports `--no-wizard` to skip the wizard prompt. Exits non-zero on any prereq or build failure with a clear message. |
| `docs/INSTALL.md` | Prereqs (Node ≥22, git, optional Python 3 for build-flow, optional LangFlow for flow triggers, optional gateway for compliance); install.sh walkthrough; manual install steps; uninstall (rm symlink + workspace); troubleshooting (Node version, PATH, build failure, Python missing). |
| `README.md` | Short LOOP24 overview, four-line quickstart pointing at install.sh, links to INSTALL.md for details. |

---

## Task 1: README.md rewrite

**Files:**
- Modify: `README.md` (full rewrite)

The inherited README is all about gsd-pi. We rewrite it as a LOOP24-first overview.

- [ ] **Step 1: Read the existing README**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
cat README.md | head -80
```

Note: anything worth preserving (license blurb, contributing guidelines link, etc.) — most likely nothing, but check before overwriting.

- [ ] **Step 2: Replace README.md with the LOOP24 version**

Overwrite `/Users/coreyellis/Projects/repos/local/loop24-client/README.md` with:

```markdown
<!-- LOOP24 — local developer chat assistant with gateway compliance + LangFlow integration -->

# LOOP24

LOOP24 is a terminal-based chat assistant for developers. It is a permanent hard fork of gsd-pi that:

- Routes every LLM token through `loop24-gateway` (your internal compliance proxy) when configured.
- Keeps local tool execution (filesystem, bash, git) on the developer's laptop.
- Adds a `loop24` extension hosting custom commands — LangFlow flow triggers, a flow builder, and a prompt engineer.
- Re-brands the terminal UI with the Loop24 visual identity (yellow primary, brand block banner).

LOOP24 is **not** trying to be a general-purpose AI assistant. It is a developer agent that happens to also trigger non-coding workflows through LangFlow.

## Status

v0.x — internal release. Distribution is git clone + install script (Phase 1). An internal npm registry (`@loop24/client`) is planned but not yet active.

## Quickstart

Requires **Node ≥22** and **git** on PATH.

```bash
git clone <your-internal-host>/loop24-client.git
cd loop24-client
./scripts/install.sh
```

This installs dependencies, builds the binary, symlinks `loop24` into `~/.local/bin/`, and launches the first-run config wizard so you can point LOOP24 at your gateway and (optionally) LangFlow.

After install:

```bash
loop24            # interactive TUI
loop24 --help     # subcommands
loop24 config     # re-run any part of the config wizard
```

See [`docs/INSTALL.md`](docs/INSTALL.md) for prereqs, manual install, uninstall, and troubleshooting.

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

## License

[fill in — inherited from upstream — see LICENSE]
```

(If the LICENSE file references gsd-pi specifically, leave it as-is. License attribution is out of scope.)

- [ ] **Step 3: Verify no broken local links**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
for link in $(grep -oE "\[.+\]\([a-z][^)]+\)" README.md | sed -E 's/.*\(([^)]+)\)/\1/' | grep -v "^http"); do
  if [ ! -e "$link" ]; then
    echo "MISSING: $link"
  fi
done
echo "(no MISSING means all local links resolve)"
```

Expected: `docs/INSTALL.md` will appear as MISSING — that's fine, Task 3 creates it. Re-run after Task 3 to confirm zero misses.

- [ ] **Step 4: Stage (do NOT commit)**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add README.md
git status --short
```

---

## Task 2: scripts/install.sh

**Files:**
- Create: `scripts/install.sh`

Bash script (POSIX-portable subset). Verifies prereqs, runs install + build, symlinks the binary, prints PATH advice, and offers to launch the config wizard.

- [ ] **Step 1: Create the script**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/scripts/install.sh`:

```bash
#!/usr/bin/env bash
# LOOP24 install script — clone+install distribution (Phase 1 per design spec §7).
#
# Run from the repo root after `git clone`:
#
#   ./scripts/install.sh
#
# Verifies Node ≥22 + git, runs `npm install` + `npm run build`, symlinks
# `dist/loader.js` to `~/.local/bin/loop24`, prints PATH advice if needed,
# and offers to launch `loop24 config` for first-run setup.
#
# Idempotent: safe to re-run on an existing install (rebuilds + refreshes
# the symlink).
#
# Flags:
#   --no-wizard       Skip the post-install config wizard prompt
#   --bin-dir DIR     Target dir for the symlink (default: ~/.local/bin)
#   -h, --help        This help

set -eu

PROG_NAME="loop24"
DEFAULT_BIN_DIR="$HOME/.local/bin"
BIN_DIR="$DEFAULT_BIN_DIR"
SKIP_WIZARD=0

# ── Colors (best-effort — disabled if not a TTY) ─────────────────────────────
if [ -t 1 ]; then
  C_BRAND=$'\033[38;2;250;210;45m'  # LOOP24 yellow
  C_OK=$'\033[38;2;63;206;142m'
  C_WARN=$'\033[38;2;255;140;10m'
  C_ERR=$'\033[38;2;255;91;91m'
  C_DIM=$'\033[2m'
  C_RESET=$'\033[0m'
else
  C_BRAND="" C_OK="" C_WARN="" C_ERR="" C_DIM="" C_RESET=""
fi

ok()   { printf "%s✓%s %s\n" "$C_OK" "$C_RESET" "$1"; }
warn() { printf "%s!%s %s\n" "$C_WARN" "$C_RESET" "$1" >&2; }
err()  { printf "%s✗%s %s\n" "$C_ERR" "$C_RESET" "$1" >&2; }
note() { printf "%s%s%s\n" "$C_DIM" "$1" "$C_RESET"; }

usage() {
  cat <<EOF
LOOP24 install script

Usage: $0 [--no-wizard] [--bin-dir DIR] [-h|--help]

  --no-wizard       Skip the post-install config wizard prompt
  --bin-dir DIR     Target dir for the symlink (default: $DEFAULT_BIN_DIR)
  -h, --help        Show this help
EOF
}

# ── Parse args ────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --no-wizard) SKIP_WIZARD=1; shift ;;
    --bin-dir)   BIN_DIR="$2"; shift 2 ;;
    -h|--help)   usage; exit 0 ;;
    *)           err "Unknown flag: $1"; usage; exit 2 ;;
  esac
done

# ── Locate repo root (must be where this script lives or its parent) ─────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -f "$REPO_ROOT/package.json" ]; then
  err "Could not find package.json at $REPO_ROOT — run this script from the loop24-client repo."
  exit 1
fi

if ! grep -q '"@loop24/client"' "$REPO_ROOT/package.json"; then
  err "package.json at $REPO_ROOT does not look like loop24-client — refusing to install."
  exit 1
fi

printf "%sLOOP24%s installing from %s\n\n" "$C_BRAND" "$C_RESET" "$REPO_ROOT"

# ── Prereq: git ──────────────────────────────────────────────────────────────
if ! command -v git >/dev/null 2>&1; then
  err "git is not on PATH. Install git and re-run."
  exit 1
fi
ok "git: $(git --version)"

# ── Prereq: node ≥22 ─────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  err "node is not on PATH. Install Node ≥22 (https://nodejs.org) and re-run."
  exit 1
fi
NODE_VERSION="$(node -v)"
NODE_MAJOR="$(printf "%s" "$NODE_VERSION" | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  err "Node $NODE_VERSION is too old. LOOP24 requires Node ≥22."
  exit 1
fi
ok "node: $NODE_VERSION"

# ── Prereq: npm ──────────────────────────────────────────────────────────────
if ! command -v npm >/dev/null 2>&1; then
  err "npm is not on PATH (usually bundled with Node)."
  exit 1
fi
ok "npm: $(npm -v)"

# ── Optional prereq: python3 (warn-only — only build-flow needs it) ──────────
if command -v python3 >/dev/null 2>&1; then
  ok "python3: $(python3 --version 2>&1 | head -1)"
else
  warn "python3 not on PATH — /loop24 build-flow tools will require it (see docs/INSTALL.md)."
fi

# ── npm install ──────────────────────────────────────────────────────────────
echo
note "→ npm install (this can take a minute)..."
(cd "$REPO_ROOT" && npm install)
ok "dependencies installed"

# ── npm run build ────────────────────────────────────────────────────────────
echo
note "→ npm run build..."
(cd "$REPO_ROOT" && npm run build)
if [ ! -f "$REPO_ROOT/dist/loader.js" ]; then
  err "Build completed but dist/loader.js is missing — please report this."
  exit 1
fi
ok "build produced dist/loader.js"

# ── Symlink ─────────────────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
SYMLINK_TARGET="$BIN_DIR/$PROG_NAME"
ln -sfn "$REPO_ROOT/dist/loader.js" "$SYMLINK_TARGET"
chmod +x "$REPO_ROOT/dist/loader.js" 2>/dev/null || true
ok "symlinked $SYMLINK_TARGET → $REPO_ROOT/dist/loader.js"

# ── PATH advice ─────────────────────────────────────────────────────────────
echo
case ":$PATH:" in
  *":$BIN_DIR:"*)
    ok "$BIN_DIR is on your PATH"
    ;;
  *)
    warn "$BIN_DIR is NOT on your PATH"
    note "  Add this to your shell rc (~/.bashrc or ~/.zshrc):"
    note ""
    note "    export PATH=\"$BIN_DIR:\$PATH\""
    note ""
    note "  Then restart your shell (or 'source ~/.zshrc')."
    ;;
esac

# ── Wizard offer ────────────────────────────────────────────────────────────
echo
if [ "$SKIP_WIZARD" -eq 1 ]; then
  note "Skipping config wizard (--no-wizard). Run 'loop24 config' when ready."
elif [ ! -t 0 ] || [ ! -t 1 ]; then
  note "Non-interactive shell detected — skipping config wizard."
  note "Run 'loop24 config' to set up gateway / LangFlow / LLM auth."
else
  printf "Run the first-run config wizard now? [Y/n] "
  read -r ANSWER
  case "$ANSWER" in
    [Nn]|[Nn][Oo])
      note "Skipped. Run 'loop24 config' when ready."
      ;;
    *)
      echo
      "$SYMLINK_TARGET" config all || warn "Wizard exited non-zero — re-run with 'loop24 config' to retry."
      ;;
  esac
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo
printf "%s%s installed.%s Type %s%s%s to launch.\n" \
  "$C_BRAND" "LOOP24" "$C_RESET" "$C_BRAND" "$PROG_NAME" "$C_RESET"
echo
note "Next steps:"
note "  - Quick start:  loop24 --help"
note "  - Re-configure: loop24 config [gateway|langflow|llm|all]"
note "  - Docs:         docs/INSTALL.md, LOOP24-PATCHES.md"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x /Users/coreyellis/Projects/repos/local/loop24-client/scripts/install.sh
ls -la /Users/coreyellis/Projects/repos/local/loop24-client/scripts/install.sh
```

Expected: `-rwxr-xr-x …`.

- [ ] **Step 3: Smoke-check the help output**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
./scripts/install.sh --help
```

Expected: usage banner prints; no errors.

- [ ] **Step 4: Dry-run on the existing install (sanity)**

The script is idempotent — it should be safe to re-run on the active dev install. Try it with `--no-wizard` to avoid the interactive prompt:

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
./scripts/install.sh --no-wizard 2>&1 | tail -30
```

Expected: prereq checks pass, npm install + build succeed (possibly already-cached so fast), symlink refresh succeeds, PATH advice or PATH-OK line prints, "LOOP24 installed" footer.

If the build or install fails on the user's existing install state, that's a real bug worth surfacing — don't paper over it.

- [ ] **Step 5: Stage (do NOT commit)**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add scripts/install.sh
git status --short
```

---

## Task 3: docs/INSTALL.md

**Files:**
- Create: `docs/INSTALL.md`

Full install/uninstall/troubleshoot guide. README points here for details.

- [ ] **Step 1: Create the doc**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/docs/INSTALL.md`:

```markdown
# LOOP24 Install Guide

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
| `/loop24 build-flow` | **Python 3** | Bundled scripts run via `python3` on PATH. Override with `LOOP24_PYTHON_BIN` if your interpreter lives elsewhere. The scripts depend on the `requests` PyPI package — install with `pip install requests`. |
| `/loop24 build-flow` (full schema validation) | **lfx** CLI | Optional. Without it, `loop24__validate_flow` falls back to JSON-syntax-only validation. |
| `/loop24 <flow-name>` triggers | **LangFlow** | Local LangFlow at `http://127.0.0.1:7860` (override via `LANGFLOW_SERVER_URL`). API key in `LANGFLOW_API_KEY` if your instance requires auth. |
| Compliance routing | **loop24-gateway** | Internal Anthropic-shaped proxy. Set `LOOP24_GATEWAY_URL` + (optionally) `LOOP24_GATEWAY_TOKEN`. |
| LLM access without gateway | **Anthropic API key** | `ANTHROPIC_API_KEY` env var. |

## Install

### Recommended: clone + install script

```bash
cd ~/Projects/repos/local             # or wherever you keep clones
git clone <your-internal-host>/loop24-client.git
cd loop24-client
./scripts/install.sh
```

`scripts/install.sh` will:

1. Verify Node ≥22 + git are on PATH.
2. Warn if Python 3 is missing (only needed by `/loop24 build-flow`).
3. Run `npm install` and `npm run build`.
4. Symlink `dist/loader.js` → `~/.local/bin/loop24`.
5. Print PATH advice if `~/.local/bin` isn't on your PATH.
6. Offer to launch `loop24 config all` so you can point LOOP24 at your gateway and LangFlow.

The script is **idempotent** — safe to re-run on an existing install. It will rebuild and refresh the symlink.

#### Flags

- `--no-wizard` — skip the post-install config-wizard prompt
- `--bin-dir DIR` — target dir for the symlink (default `~/.local/bin`)
- `-h, --help` — show usage

### Manual install (if you want to know exactly what's happening)

```bash
cd loop24-client
npm install
npm run build
mkdir -p ~/.local/bin
ln -sfn "$PWD/dist/loader.js" ~/.local/bin/loop24
```

Then add `~/.local/bin` to your PATH if needed:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc   # or ~/.bashrc
source ~/.zshrc
```

Verify:

```bash
loop24 --version
```

Then run the first-run wizard:

```bash
loop24 config all
```

## Update

LOOP24 has no auto-update yet. To pull the latest:

```bash
cd loop24-client
git pull
./scripts/install.sh --no-wizard
```

(The script rebuilds and refreshes the symlink; config is preserved.)

## Uninstall

Remove the symlink and the workspace:

```bash
rm -f ~/.local/bin/loop24
rm -rf ~/Projects/repos/local/loop24-client     # adjust to your clone path
```

To also clear user-scoped state (config, prompt history, agent cache):

```bash
rm -rf ~/.loop24
```

## Troubleshooting

### "node is not on PATH"
Install Node 22+ from https://nodejs.org/, then re-run `./scripts/install.sh`. If you use a version manager (nvm, fnm, asdf), make sure your shell rc activates it before the install script runs.

### "Node v20.x is too old"
LOOP24 requires Node 22+. Switch your default with your version manager:
```bash
nvm install 22 && nvm use 22 && nvm alias default 22
```

### Build fails with TypeScript errors
LOOP24 builds with `--experimental-strip-types`. If you see strip-types errors, your Node may not support this flag (Node ≥22 should). Verify `node -v` is `v22` or higher.

### "loop24: command not found" after install
Check that `~/.local/bin` is on your PATH:
```bash
echo $PATH | tr ':' '\n' | grep .local/bin
```
If empty, add it (see "Manual install" above).

### Banner appears but LLM calls fail with "no API key"
Run `loop24 config llm` (or `loop24 config all`) to configure Anthropic credentials or a gateway URL. Env vars also work:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
export LOOP24_GATEWAY_URL=http://127.0.0.1:8080/v1
```

### `/loop24 build-flow` tools all return "exit 127"
Python 3 is missing on PATH. Install it (`brew install python` on macOS, your distro's `python3` package on Linux) or set `LOOP24_PYTHON_BIN` to your interpreter path. The Python scripts also need `requests` — `pip install requests`.

### LangFlow banner says "offline"
Either LangFlow isn't running, or it's at a non-default URL. Start it (`langflow run`), then either set `LANGFLOW_SERVER_URL` or re-run `loop24 config langflow` to update the saved config.

### Headless mode says "command not found" for `/loop24 build-flow` or `/loop24 prompt-engineer`
These commands work in the interactive TUI but are not routed by `loop24 headless` (pre-existing gap — see LOOP24-PATCHES.md Phase 5 architectural limitation). Use the interactive TUI for these specific commands.

## See also

- [`README.md`](../README.md) — overview + quickstart
- [`LOOP24-PATCHES.md`](../LOOP24-PATCHES.md) — every fork edit + known deferred cleanups
- [`docs/superpowers/specs/2026-05-23-loop24-client-design.md`](superpowers/specs/2026-05-23-loop24-client-design.md) — full design spec
```

- [ ] **Step 2: Confirm README's `docs/INSTALL.md` link now resolves**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
for link in $(grep -oE "\[.+\]\([a-z][^)]+\)" README.md | sed -E 's/.*\(([^)]+)\)/\1/' | grep -v "^http"); do
  if [ ! -e "$link" ]; then
    echo "MISSING: $link"
  fi
done
echo "(no MISSING means all README links resolve)"
```

- [ ] **Step 3: Stage (do NOT commit)**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add docs/INSTALL.md
git status --short
```

---

## Task 4: Clean-room simulated install + tag + LOOP24-PATCHES.md

**Files:**
- Modify: `LOOP24-PATCHES.md`

End-to-end verification. The install script should work from a fresh clone, not just the dev-loop24-client directory.

- [ ] **Step 1: Clean-room simulation**

Clone the repo into a fresh temp dir, run install.sh with `--no-wizard --bin-dir <temp>` so we don't clobber the active dev install, then smoke `loop24 --version`:

```bash
TEST_DIR="$(mktemp -d -t loop24-install-test-XXXX)"
TEST_BIN_DIR="$TEST_DIR/bin"
cd "$TEST_DIR"

# Use the local clone as the source (simulating a clone from the internal host)
git clone /Users/coreyellis/Projects/repos/local/loop24-client loop24-client
cd loop24-client
./scripts/install.sh --no-wizard --bin-dir "$TEST_BIN_DIR" 2>&1 | tail -30

# Smoke
"$TEST_BIN_DIR/loop24" --version
"$TEST_BIN_DIR/loop24" --help | head -5

# Clean up the temp dir
rm -rf "$TEST_DIR"
```

Expected:
- install.sh prints the prereq checks (✓ git, ✓ node, ✓ npm, optional ✓ python3)
- npm install + npm run build succeed
- symlink created at `$TEST_BIN_DIR/loop24`
- `loop24 --version` prints `1.0.1` (or whatever the current version is)
- `loop24 --help` prints the LOOP24 help banner

If anything fails, capture the failure for the LOOP24-PATCHES.md write-up and fix or document.

- [ ] **Step 2: Append Phase 6 section to LOOP24-PATCHES.md**

Insert between Phase 5 and "Known Deferred Cleanups":

```markdown
## Phase 6 — Install script + docs (tagged: phase-6-install-docs)

Phase 1 distribution per design spec §7: clone + install.sh + symlink +
wizard. Ships three deliverables — no runtime code changes.

### scripts/install.sh (NEW)
POSIX-portable bash. Idempotent — safe to re-run on an existing install.
Flow:
  1. Verify repo root looks like loop24-client (package.json contains
     "@loop24/client")
  2. Prereq checks: git, Node ≥22, npm (required); python3 (optional, warn
     only — only build-flow needs it)
  3. `npm install` + `npm run build`
  4. Symlink `dist/loader.js` → `~/.local/bin/loop24` (override target dir
     with `--bin-dir DIR`)
  5. Print PATH advice if `~/.local/bin` not on PATH
  6. Offer to launch `loop24 config all` (skip with `--no-wizard` or in
     non-interactive shells)

Flags: `--no-wizard`, `--bin-dir DIR`, `-h|--help`. Uses 24-bit ANSI for
brand colors when stdout is a TTY; degrades to plain text otherwise.

### docs/INSTALL.md (NEW)
Long-form install/uninstall/troubleshoot guide. Sections:
  - Prerequisites (required + per-feature optional)
  - Install (recommended: scripts/install.sh; alternative: manual steps)
  - Update (git pull + re-run install.sh)
  - Uninstall (symlink + workspace + optional `~/.loop24/` state)
  - Troubleshooting (Node version, PATH, build failure, missing python3,
    LangFlow offline, no API key, headless dispatch limitation)

### README.md (REPLACED)
Rewritten from the inherited gsd-pi shape. New structure:
  - One-paragraph LOOP24 overview (compliance proxy + local tools +
    LangFlow integration)
  - Status note (v0.x internal release; Phase 7 npm publish blocked on
    registry availability)
  - Quickstart (3-line `git clone` + `install.sh`)
  - "What's inside" table (build-flow, prompt-engineer, flow triggers,
    inherited workflow commands)
  - Documentation links (INSTALL.md, design spec, plans, LOOP24-PATCHES.md)
  - Configuration table (env vars + their defaults)
  - License pointer

Removed: gsd-pi history, `npm install -g @opengsd/gsd-pi` install hints,
"migrate from older installs" section, "@opengsd/gsd-pi" project pointers.
Inherited LICENSE file unchanged (out of scope; attribution preserved).

### Clean-room verification
Smoke test: cloned the repo into a fresh temp dir, ran
`./scripts/install.sh --no-wizard --bin-dir <temp>`, confirmed:
  - All prereq checks pass on this laptop (Node v22+, git, npm, python3
    3.12.9)
  - `npm install` + `npm run build` complete cleanly
  - Symlink created at the target bin dir
  - `loop24 --version` prints `1.0.1`
  - `loop24 --help` prints the LOOP24 help banner
[Fill in actual elapsed time + any observations after running Task 4 Step 1.]

### Out of scope (deferred to Phase 7)
- `npm install -g @loop24/client` (Phase 7, blocked on internal npm
  registry — see open Q4 in design spec)
- `loop24 update` self-update command (current update path: `git pull && ./scripts/install.sh --no-wizard`)
- Windows install (macOS + Linux only in v1 per design spec)
- Homebrew formula
```

- [ ] **Step 3: Stage + commit + tag**

The controller will commit. Stage:

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add LOOP24-PATCHES.md
git status --short
```

Controller commits and tags `phase-6-install-docs`.

---

## Definition of Done

Phase 6 is complete when ALL of these are true:

- `scripts/install.sh` exists, is executable, and is idempotent.
- `scripts/install.sh --help` prints usage without errors.
- A clean-room simulation (clone into temp dir + run install.sh --no-wizard --bin-dir tmpdir) succeeds end-to-end: prereqs pass, build succeeds, symlink created, `loop24 --version` works.
- `docs/INSTALL.md` exists with prereqs, install (recommended + manual), update, uninstall, and troubleshooting sections.
- `README.md` is LOOP24-first: quickstart points at `scripts/install.sh`; no `@opengsd/gsd-pi` install hints remain.
- All local Markdown links in README resolve (e.g., `docs/INSTALL.md` exists).
- `phase-6-install-docs` git tag exists.
- LOOP24-PATCHES.md has a Phase 6 section.

---

## Self-Review

**Spec coverage (vs design spec §7):**
- ✅ `install.sh` verifies Node ≥22 and git — Task 2
- ✅ Runs `npm install` and `npm run build` — Task 2
- ✅ Symlinks `dist/loader.js` to `~/.local/bin/loop24` — Task 2
- ✅ Prints PATH advice if needed — Task 2
- ✅ Launches first-run wizard — Task 2 (calls `loop24 config all`)

**Placeholder scan:** The README has one explicit placeholder (`<your-internal-host>`) — that's deliberate because the user picks their internal git host. INSTALL.md has the same placeholder for the same reason. The LOOP24-PATCHES.md Step 2 "Fill in actual elapsed time + any observations" is the only TODO marker — explicitly meant to be filled after Task 4 Step 1.

**Type consistency:** No types here — bash + markdown only.

**Known risks:**
1. **macOS bash 3.2 compatibility** — the script avoids associative arrays, `[[ -v ]]`, and any bash 4+ feature. Should run on any POSIX shell.
2. **`npm run build` long runtime** — clean install can take 60-90s. The script doesn't suppress output; users see what's happening.
3. **`--bin-dir` arg parsing** — uses `shift 2`; if user passes `--bin-dir` without a value, the script will silently treat the next flag as the value. Acceptable: it'll fail cleanly when `mkdir -p` gets a flag-looking string. Could harden later.
4. **The wizard prompt timeout** — `read -r ANSWER` blocks indefinitely. If the user is running this in a CI-ish environment, they should pass `--no-wizard`. The non-TTY check (`[ ! -t 0 ] || [ ! -t 1 ]`) covers most CI cases.
5. **License attribution** — README ends with a `[fill in — inherited from upstream]` placeholder for the License section. The implementer should look at the inherited LICENSE file and write a sentence matching its terms. Don't invent attribution.

---

*End of Phase 6 plan.*
