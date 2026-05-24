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
