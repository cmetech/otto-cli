#!/bin/bash
set -e

# ──────────────────────────────────────────────
# OTTO Container Entrypoint
#
# Responsibilities:
#   1. UID/GID remapping — match host user via PUID/PGID
#   2. Pre-create critical files — prevent Docker bind-mount
#      from creating directories where files are expected
#   3. Sentinel-based bootstrap — one-time first-boot setup
#   4. Signal forwarding — exec into the final process
# ──────────────────────────────────────────────

OTTO_USER="otto"
OTTO_HOME="/home/${OTTO_USER}"
OTTO_DIR="${OTTO_HOME}/.otto"

# ── 1. UID/GID Remapping ────────────────────────────────
# Accept PUID/PGID from the environment so the container
# can run with the same UID/GID as the host user, avoiding
# permission headaches on bind-mounted volumes.

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

CURRENT_UID=$(id -u "${OTTO_USER}")
CURRENT_GID=$(id -g "${OTTO_USER}")

REMAPPED=0

if [ "${PGID}" != "${CURRENT_GID}" ]; then
    groupmod -o -g "${PGID}" "${OTTO_USER}"
    REMAPPED=1
fi

if [ "${PUID}" != "${CURRENT_UID}" ]; then
    usermod -o -u "${PUID}" "${OTTO_USER}"
    REMAPPED=1
fi

# Fix ownership only when UID/GID actually changed
if [ "${REMAPPED}" -eq 1 ]; then
    chown -R "${PUID}:${PGID}" "${OTTO_HOME}"
    chown "${PUID}:${PGID}" /workspace
fi

# ── 2. Pre-create Critical Files ────────────────────────
# Docker bind-mounts will create a *directory* if the target
# path doesn't exist. We need these to be files, so touch
# them before Docker gets a chance to mangle things.

mkdir -p "${OTTO_DIR}"

if [ ! -f "${OTTO_DIR}/settings.json" ]; then
    echo '{}' > "${OTTO_DIR}/settings.json"
fi

chown "${PUID}:${PGID}" "${OTTO_DIR}" "${OTTO_DIR}/settings.json"

# ── 3. Sentinel-based Bootstrap ─────────────────────────
# Run first-boot setup exactly once. Subsequent container
# starts (or restarts) skip this entirely.

SENTINEL="${OTTO_DIR}/.bootstrapped"

if [ ! -f "${SENTINEL}" ]; then
    if [ -x /usr/local/bin/bootstrap.sh ]; then
        # Run bootstrap as the otto user so files get correct ownership
        gosu "${OTTO_USER}" /usr/local/bin/bootstrap.sh
    fi
    touch "${SENTINEL}"
    chown "${PUID}:${PGID}" "${SENTINEL}"
fi

# ── 4. Drop Privileges & Exec ──────────────────────────
# Replace this shell process with the final command running
# as the otto user. exec + gosu = proper PID 1 = proper
# signal forwarding (SIGTERM, SIGINT, etc.).

exec gosu "${OTTO_USER}" "$@"
