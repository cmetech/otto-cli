# Debug Sessions

`/otto debug` creates persistent debug sessions so you can investigate an issue across multiple turns without losing state.

## Quick Start

```bash
# Start a standard debug session (find + fix)
/otto debug checkout returns 500 after login

# List all saved sessions
/otto debug list

# Inspect one session
/otto debug status checkout-returns-500-after-login

# Resume one session
/otto debug continue checkout-returns-500-after-login

# Diagnose store health (all sessions)
/otto debug --diagnose

# Diagnose one known session
/otto debug --diagnose checkout-returns-500-after-login

# Start diagnose-only root-cause mode (no fix dispatch)
/otto debug --diagnose checkout still returns 500 after oauth refresh
```

> **Note:** Debug artifacts are persisted at `.otto/workflow/debug/sessions/<slug>.json`, so sessions survive across turns and can be resumed later.

## How It Works

`/otto debug` parsing is strict for reserved subcommands (`list`, `status`, `continue`, `--diagnose`) and intentionally falls back to issue text when syntax is ambiguous.

- `list` is only treated as a subcommand when used exactly as `/otto debug list`.
  - Example: `/otto debug list flaky checkout retries` starts a new session with that full issue text.
- `status` and `continue` require exactly one valid `<slug>` argument.
  - Missing slug emits warnings:
    - `Missing slug. Usage: /otto debug status <slug>`
    - `Missing slug. Usage: /otto debug continue <slug>`
  - Any non-strict form (extra words, invalid slug shape) falls back to a normal issue-start session.
- `--diagnose` has dedicated modes:
  - `/otto debug --diagnose` → store health diagnostics (malformed artifact counts + remediation hints)
  - `/otto debug --diagnose <slug>` → targeted diagnostics for one session
  - `/otto debug --diagnose <issue text>` (multi-token) → starts a new session in `mode=diagnose` with root-cause-only intent
- `/otto debug --diagnose <single-non-slug-token>` is invalid and returns:
  - `Invalid diagnose target. Usage: /otto debug --diagnose [<slug> | <issue text>]`

Unknown debug flags (for example `/otto debug --wat`) return an explicit warning plus usage text.

## Subcommands

| Command | Behavior |
|---------|----------|
| `/otto debug <issue-text>` | Start a new persistent debug session with `mode=debug` and actionable next steps (`status` / `continue`). |
| `/otto debug list` | List healthy sessions plus malformed artifacts discovered under `.otto/workflow/debug/sessions/`. |
| `/otto debug status <slug>` | Show one session's mode, status, phase, issue, artifact path, log path, update time, and `lastError`. |
| `/otto debug continue <slug>` | Resume an existing session and dispatch the next debug workflow turn unless the session is already resolved. |

## Flags

| Flag syntax | Behavior |
|-------------|----------|
| `/otto debug --diagnose` | Run zero-argument health diagnostics over all debug session artifacts. |
| `/otto debug --diagnose <slug>` | Diagnose one existing session and report targeted metadata. |
| `/otto debug --diagnose <issue text>` | Start a new diagnose-only session (`mode=diagnose`) to find root cause without immediate fix dispatch. |

## Examples

### Start a session

```bash
/otto debug auth token expires after refresh
```

### List sessions

```bash
/otto debug list
```

### Check status

```bash
/otto debug status auth-token-expires-after-refresh
```

### Continue

```bash
/otto debug continue auth-token-expires-after-refresh
```

### Diagnose-only flows

```bash
# Global artifact health
/otto debug --diagnose

# One existing session
/otto debug --diagnose auth-token-expires-after-refresh

# New root-cause-only session (multi-word issue required)
/otto debug --diagnose auth token still expires on safari
```

> **Note:** If a session slug is unknown, status/continue/targeted diagnose commands warn and recommend `/otto debug list`.
