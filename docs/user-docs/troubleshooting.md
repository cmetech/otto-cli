# Troubleshooting

## `/otto doctor`

The built-in diagnostic tool validates `.otto/workflow/` integrity:

```
/otto doctor
```

It checks:
- File structure and naming conventions
- Roadmap ↔ slice ↔ task referential integrity
- Completion state consistency
- Git worktree health (worktree and branch modes only — skipped in none mode)
- Stale DB-backed runtime records and orphaned runtime files
- Disk-only orphan milestone stub directories

## Common Issues

### Upgrade from older OTTO installs

**Symptoms:** `otto` exits with a version or managed-resource mismatch, or an old global `otto-pi` install still shadows the new package.

**Fix:** Clear stale local update/resource state, then install the scoped package:

macOS / Linux:

```bash
rm -f ~/.otto/.update-check ~/.otto/agent/managed-resources.json
npm install -g @cmetech/otto@latest
```

Windows PowerShell:

```powershell
Remove-Item "$env:USERPROFILE\.otto/workflow\.update-check" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\.otto/workflow\agent\managed-resources.json" -Force -ErrorAction SilentlyContinue
npm install -g @cmetech/otto@latest
```

Windows Command Prompt:

```bat
del "%USERPROFILE%\.otto/workflow\.update-check" 2>nul
del "%USERPROFILE%\.otto/workflow\agent\managed-resources.json" 2>nul
npm install -g @cmetech/otto@latest
```

Or run the installer from the new package on any OS:

```bash
npx @cmetech/otto@latest
```

After that, routine upgrades use `otto upgrade`, `otto update`, or `/otto update` in a session.

### Auto mode loops on the same unit

**Symptoms:** The same unit (e.g., `research-slice` or `plan-slice`) dispatches repeatedly, then auto mode pauses with an "Artifact still missing..." error after 3 artifact verification retries.

**Causes:**
- Stale cache after a crash — the in-memory file listing doesn't reflect new artifacts
- The LLM didn't produce the expected artifact file

**Fix:** Run `/otto doctor` to repair state, then resume with `/otto auto`. If the issue persists, check that the expected artifact file exists on disk.

### Auto mode stops with "Loop detected"

**Cause:** The sliding-window detector found a repeated dispatch pattern that did not recover after the diagnostic retry. Missing expected artifacts usually surface through the bounded 3-attempt artifact verification retry path instead.

**Fix:** Check the task plan for clarity. If the plan is ambiguous, refine it manually, then `/otto auto` to resume.

### Auto mode pauses after repeated `already-active` dispatch claims

**Symptoms:** Auto mode repeatedly skips dispatch with reason `already-active`, then pauses with a message that manual recovery is required.

**Cause:** OTTO treats 3 consecutive `already-active` claim skips for the same unit as a stuck claim path and pauses auto mode instead of retrying forever.

**Fix:** Resolve the underlying active-claim/worker state (usually with `/otto doctor` or `/otto doctor fix`), then run `/otto auto` or `/otto resume`.

### Auto mode pauses after a timeout or finalize failure

**Symptoms:** Auto mode reports a unit hard timeout, a finalize timeout, or a post-unit closeout failure.

**What to inspect:**
- `.otto/workflow/runtime/<unit-type>/<unit-id>.json` shows the latest runtime phase, timeout timestamp, recovery attempts, and progress marker. Timeout recovery uses progress kinds such as `idle-recovery-retry`, `hard-recovery-retry`, `finalize-pre-timeout`, `finalize-post-timeout`, and `finalize-success`.
- `.otto/workflow/journal/` shows the ordered loop events. Look for `unit-end`, then `post-unit-finalize-start`, `post-unit-finalize-end`, and `iteration-end`.
- `post-unit-finalize-end.status` tells you whether closeout completed, retried, stopped, or failed. `iteration-end.status` and `iteration-end.reason` show the final loop outcome that caused auto mode to continue, retry, pause, or stop.
- `.otto/workflow/git-action-failures.log` appends each failed post-unit git action with timestamp and action mode (`commit` or `merge`) so you can inspect the exact git error that paused auto mode.

**Fix:** If the runtime record shows fresh recovery progress, resume with `/otto auto`; the failsafe defers cancellation while recovery is actively producing durable output. If the journal shows a stopped finalize reason such as a git closeout failure or repeated finalize timeout, inspect `.otto/workflow/git-action-failures.log`, resolve the underlying git issue, then resume.

### Wrong files in worktree

**Symptoms:** Planning artifacts or code appear in the wrong directory.

**Cause:** The LLM wrote to the main repo instead of the worktree.

**Fix:** This was fixed in v2.14+. If you're on an older version, update. The dispatch prompt now includes explicit working directory instructions.

### Milestone entry blocked by degraded worktree isolation

**Symptoms:** Auto mode fails milestone entry with an isolation-degraded warning, often after a previous worktree cleanup/create problem on Windows.

**Current behavior:** When isolation is configured as `worktree`, OTTO now attempts a safe fallback to milestone `branch` mode instead of hard-failing immediately. Bootstrap also surfaces a specific isolation-degraded notification so the cause is visible.

**Fix:**
- Close editors, terminals, or antivirus tools that may be locking `.otto/workflow/worktrees/*` paths.
- Retry `/otto auto`; if fallback succeeds, continue in branch mode for that milestone.
- Run `/otto doctor` after recovery to verify overall worktree health.

### Windows `EPERM` / `EBUSY` while removing stale worktree directories

**Symptoms:** Startup or milestone entry fails during stale worktree cleanup with `EPERM` or `EBUSY` from directory removal.

**Cause:** A process still holds a handle under an old worktree path, preventing cleanup.

**Current behavior:** OTTO now fails with a targeted error explaining that file locks blocked cleanup and advising you to close locking tools before retrying.

**Fix:**
- Close apps that might hold file locks (editors, shells in old worktree paths, antivirus/indexers).
- Retry the command after a short delay.

### `command not found: otto` after install

**Symptoms:** `npm install -g @cmetech/otto@latest` succeeds but `otto` isn't found.

**Cause:** npm's global bin directory isn't in your shell's `$PATH`.

**Fix:**

```bash
# Find where npm installed the binary
npm prefix -g
# Output: /opt/homebrew (Apple Silicon) or /usr/local (Intel Mac)

# Add the bin directory to your PATH if missing
echo 'export PATH="$(npm prefix -g)/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Workaround:** Run `npx @cmetech/otto@latest` or `$(npm prefix -g)/bin/otto` directly.

**Common causes:**
- **Homebrew Node** — `/opt/homebrew/bin` should be in PATH but sometimes isn't if Homebrew init is missing from your shell profile
- **Version manager (nvm, fnm, mise)** — global bin is version-specific; ensure your version manager initializes in your shell config
- **oh-my-zsh** — the `gitfast` plugin aliases `otto` to `git svn dcommit`. Check with `alias otto` and unalias if needed

### `npm install -g @cmetech/otto@latest` fails

**Common causes:**
- Missing workspace packages — fixed in v2.10.4+
- `postinstall` hangs on Linux (Playwright `--with-deps` triggering sudo) — fixed in v2.3.6+
- Node.js version too old — requires ≥ 22.0.0

### Provider errors during auto mode

**Symptoms:** Auto mode pauses with a provider error (rate limit, server error, auth failure).

**How OTTO handles it (v2.26):**

| Error type | Auto-resume? | Delay |
|-----------|-------------|-------|
| Rate limit (429, "too many requests") | ✅ Yes | retry-after header or 60s |
| Server error (500, 502, 503, "overloaded") | ✅ Yes | 30s |
| Auth/billing ("unauthorized", "invalid key") | ❌ No | Manual resume |

For transient errors, OTTO pauses briefly and resumes automatically. For permanent errors, configure fallback models:

```yaml
models:
  execution:
    model: claude-sonnet-4-6
    fallbacks:
      - openrouter/minimax/minimax-m2.5
```

**Headless mode:** `otto headless auto` auto-restarts the entire process on crash (default 3 attempts with exponential backoff). Combined with provider error auto-resume, this enables true overnight unattended execution.

For common provider setup issues (role errors, streaming errors, model ID mismatches), see the [Provider Setup Guide — Common Pitfalls](./providers.md#common-pitfalls).

### Budget ceiling reached

**Symptoms:** Auto mode pauses with "Budget ceiling reached."

**Fix:** Increase `budget_ceiling` in preferences, or switch to `budget` token profile to reduce per-unit cost, then resume with `/otto auto`.

### Auto mode says another session is running

**Symptoms:** Auto mode won't start, says another session is running.

**Fix:** OTTO now derives active-session ownership from DB-backed worker and dispatch state, not from `auto.lock` or `runtime/paused-session.json`. In most cases `/otto doctor fix` clears stale runtime rows and the next `/otto auto` re-acquires ownership automatically.

If recovery still fails, repair runtime state instead of manually deleting individual lock files:

```bash
/otto doctor fix
```

### Git merge conflicts

**Symptoms:** Worktree merge fails on `.otto/workflow/` files.

**Fix:** OTTO auto-resolves conflicts on `.otto/workflow/` runtime files. For content conflicts in code files, the LLM is given an opportunity to resolve them via a fix-merge session. If that fails, manual resolution is needed.

### Auto mode stops before merge with preflight conflict/overlap errors

**Symptoms:** Auto mode stops with a pre-merge reason like unresolved Git conflicts or dirty working tree overlap.

**What it means:** Milestone merge preflight now fail-closes before merge when either:
- the repo already has unresolved conflict stages (`git diff --name-only --diff-filter=U` is non-empty), or
- local dirty files overlap files modified by the milestone branch.

In these states OTTO does not auto-stash and does not auto-fix; it stops so you can resolve safely.

**Fix:**
- Resolve conflict markers and stage the resolved files.
- Commit, stash, or discard overlapping local edits outside OTTO.
- Re-run `/otto auto` after `git status` is clean (or at least free of overlapping/conflicted paths).

### Pre-dispatch says the milestone integration branch no longer exists

**Symptoms:** Auto mode or `/otto doctor` reports that a milestone recorded an integration branch that no longer exists in git.

**What it means:** The milestone's `.otto/workflow/milestones/<MID>/<MID>-META.json` still points at the branch that was active when the milestone started, but that branch has since been renamed or deleted.

**Current behavior:**
- If OTTO can deterministically recover to a safe branch, it no longer hard-stops auto mode.
- Safe fallbacks are:
  - explicit `git.main_branch` when configured and present
  - the repo's detected default integration branch (for example `main` or `master`)
- In that case `/otto doctor` reports a warning and `/otto doctor fix` rewrites the stale metadata to the effective branch.
- OTTO still blocks when no safe fallback branch can be determined.

**Fix:**
- Run `/otto doctor fix` to rewrite the stale milestone metadata automatically when the fallback is obvious.
- If OTTO still blocks, recreate the missing branch or update your git preferences so `git.main_branch` points at a real branch.

### `/otto doctor` reports `orphan_milestone_dir`

**Symptoms:** `/otto doctor` shows a warning like `Orphan milestone directory: M003` with issue code `orphan_milestone_dir`.

**What it means:** `.otto/workflow/milestones/<MID>/` exists on disk, but OTTO cannot find a DB milestone row, a matching `.otto/workflow/worktrees/<MID>/` worktree, or any milestone content files. These disk-only stub directories can be left behind by interrupted or stale forward references and can skew the next milestone ID that OTTO generates.

**Fix:** Run `/otto doctor fix` to remove the orphan milestone stub directory automatically. The auto-fix only targets disk-only stubs with no DB row, no worktree, and no content files; populated milestone directories and in-flight worktree-only milestones are not removed.

### Startup warns that memory consolidation is incomplete

**Symptoms:** On startup, OTTO shows a warning like `Memory consolidation: ... not yet in memories table. Run /doctor for details.`

**What it means:** The ADR-013 memory-store consolidation preflight scanner found legacy knowledge that is not yet represented in the canonical `memories` table. It checks active `decisions` rows for matching `structured_fields.sourceDecisionId` markers and `.otto/workflow/KNOWLEDGE.md` table rows for matching `sourceKnowledgeId` markers. The scanner is read-only and is intended to block destructive cutover until migration coverage is visible.

**Fix:** Run `/otto doctor` to inspect the counts and sample rows. Before cutover, complete the decisions or KNOWLEDGE.md backfill so the affected rows exist in `memories`; do not delete legacy `DECISIONS.md`, `KNOWLEDGE.md`, or database rows just to silence the warning.

### Transient `EBUSY` / `EPERM` / `EACCES` while writing `.otto/workflow/` files

**Symptoms:** On Windows, auto mode or doctor occasionally fails while updating `.otto/workflow/` files with errors like `EBUSY`, `EPERM`, or `EACCES`.

**Cause:** Antivirus, indexers, editors, or filesystem watchers can briefly lock the destination or temp file just as OTTO performs the atomic rename.

**Current behavior:** OTTO now retries those transient rename failures with a short bounded backoff before surfacing an error. The retry is intentionally limited so genuine filesystem problems still fail loudly instead of hanging forever.

**Fix:**
- Re-run the operation; most transient lock races clear quickly.
- If the error persists, close tools that may be holding the file open and then retry.
- If repeated failures continue, run `/otto doctor` to confirm the repo state is still healthy and report the exact path + error code.

### Node v24 web boot failure

**Symptoms:** `otto --web` fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` on Node v24.

**Cause:** Node v24 changed type-stripping behavior for `node_modules`, breaking the Next.js web build.

**Fix:** Fixed in v2.42.0+ (#1864). Upgrade to the latest version.

### Orphan web server process

**Symptoms:** `otto --web` fails because port 3000 is already in use, even though no OTTO session is running.

**Cause:** A previous web server process was not cleaned up on exit.

**Fix:** Fixed in v2.42.0+. OTTO now cleans up stale web server processes automatically. If you're on an older version, kill the orphan process manually: `lsof -ti:3000 | xargs kill`.

### Non-JS project blocked by worktree health check

**Symptoms:** Worktree health check fails or blocks auto-mode in projects that don't use Node.js (e.g., Rust, Go, Python).

**Cause:** The worktree health check only recognized JavaScript ecosystems prior to v2.42.0.

**Fix:** Fixed in v2.42.0+ (#1860). The health check now supports 17+ ecosystems. Upgrade to the latest version.

### German/non-English locale git errors

**Symptoms:** Git commands fail or produce unexpected results when the system locale is non-English (e.g., German).

**Cause:** OTTO parsed git output assuming English locale strings.

**Fix:** Fixed in v2.42.0+. All git commands now force `LC_ALL=C` to ensure consistent English output regardless of system locale.

## MCP Client Issues

### `mcp_servers` shows no configured servers

**Symptoms:** `mcp_servers` reports no servers configured.

**Common causes:**
- No `.mcp.json` or `.otto/workflow/mcp.json` file exists in the current project
- The config file is malformed JSON
- The server is configured in a different project directory than the one where you launched OTTO

**Fix:**
- Add the server to `.mcp.json` or `.otto/workflow/mcp.json`
- Verify the file parses as JSON
- Re-run `mcp_servers(refresh=true)`

### `mcp_discover` times out

**Symptoms:** `mcp_discover` fails with a timeout.

**Common causes:**
- The server process starts but never completes the MCP handshake
- The configured command points to a script that hangs on startup
- The server is waiting on an unavailable dependency or backend service

**Fix:**
- Run the configured command directly outside OTTO and confirm the server actually starts
- Check that any backend URLs or required services are reachable
- For local custom servers, verify the implementation is using an MCP SDK or a correct stdio protocol implementation

### `mcp_discover` reports connection closed

**Symptoms:** `mcp_discover` fails immediately with a connection-closed error.

**Common causes:**
- Wrong executable path
- Wrong script path
- Missing runtime dependency
- The server crashes before responding

**Fix:**
- Verify `command` and `args` paths are correct and absolute
- Run the command manually to catch import/runtime errors
- Check that the configured interpreter or runtime exists on the machine

### `mcp_call` fails because required arguments are missing

**Symptoms:** A discovered MCP tool exists, but calling it fails validation because required fields are missing.

**Common causes:**
- The call shape is wrong
- The target server's tool schema changed
- You're calling a stale server definition or stale branch build

**Fix:**
- Re-run `mcp_discover(server="name")` and confirm the exact required argument names
- Call the tool with `mcp_call(server="name", tool="tool_name", args={...})`
- If you're developing OTTO itself, rebuild after schema changes with `npm run build`

### Local stdio server works manually but not in OTTO

**Symptoms:** Running the server command manually seems fine, but OTTO can't connect.

**Common causes:**
- The server depends on shell state that OTTO doesn't inherit
- Relative paths only work from a different working directory
- Required environment variables exist in your shell but not in the MCP config

**Fix:**
- Use absolute paths for `command` and script arguments
- Set required environment variables in the MCP config's `env` block
- If needed, set `cwd` explicitly in the server definition

### Session lock stolen by `/otto` in another terminal

**Symptoms:** Running `/otto` (step mode) in a second terminal causes a running auto-mode session to lose its lock.

**Fix:** Fixed in v2.36.0. Bare `/otto` no longer steals the session lock from a running auto-mode session. Upgrade to the latest version.

### Worktree commits landing on main instead of milestone branch

**Symptoms:** Auto-mode commits in a worktree end up on `main` instead of the `milestone/<MID>` branch.

**Fix:** Fixed in v2.37.1. CWD is now realigned before dispatch and stale merge state is cleaned on failure. Upgrade to the latest version.

### Extension loader fails with subpath export error

**Symptoms:** Extension fails to load with a `Cannot find module` error referencing npm subpath exports.

**Cause:** Dynamic imports in the extension loader didn't resolve npm subpath exports (e.g., `@pkg/foo/bar`).

**Fix:** Fixed in v2.38+. The extension loader now auto-resolves npm subpath exports and creates a `node_modules` symlink for dynamic import resolution. Upgrade to the latest version.

## Recovery Procedures

### Reset auto mode state

```bash
rm .otto/workflow/completed-units.json
```

Then run `/otto doctor` to refresh projections and `/otto auto` to restart from current DB-backed state.

### Reset routing history

If adaptive model routing is producing bad results, clear the routing history:

```bash
rm .otto/workflow/routing-history.json
```

### Refresh rendered state

```
/otto doctor
```

Doctor checks the authoritative database, refreshes `STATE.md` from derived database state, and fixes detected projection or runtime-file inconsistencies.

### Recover database hierarchy from markdown

Use this only when the database is missing, damaged, or known to be stale but the rendered milestone, slice, and task markdown on disk is the best available source:

```
/otto recover
```

`/otto recover` clears the database hierarchy tables plus persisted validation/gate state from prior runs, including quality-gate rows and skipped-validation assessments, then reconstructs the hierarchy from markdown and derives state again to verify the result. Normal runtime does not silently import markdown projections, and worktree markdown is not synced back as authoritative state.

For non-TTY environments (CI, cron, scripted automation), v2.79 adds `otto headless recover` — same semantics, no interactive prompt. Exits non-zero on failure.

## Getting Help

- **GitHub Issues:** [github.com/cmetech/otto-cli/issues](https://github.com/cmetech/otto-cli/issues)
- **Dashboard:** `Ctrl+Alt+G` or `/otto status` for real-time diagnostics
- **Forensics:** `/otto forensics` for structured post-mortem analysis of auto-mode failures
- **Session logs:** `.otto/workflow/activity/` contains JSONL session dumps for crash forensics

## iTerm2-Specific Issues

### Ctrl+Alt shortcuts trigger the wrong action (e.g., Ctrl+Alt+G opens external editor instead of OTTO dashboard)

**Symptoms:** Pressing Ctrl+Alt+G opens the external editor prompt (Ctrl+G) instead of the OTTO dashboard. Other Ctrl+Alt shortcuts behave as their Ctrl-only counterparts.

**Cause:** iTerm2's default Left Option Key setting is "Normal", which swallows the Alt modifier for Ctrl+Alt key combinations. The terminal receives only the Ctrl key, so Ctrl+Alt+G arrives as Ctrl+G.

**Fix:** In iTerm2, go to **Profiles → Keys → General** and set **Left Option Key** to **Esc+**. This makes Alt/Option send an escape prefix that terminal applications can detect, enabling Ctrl+Alt shortcuts to work correctly.

## Windows-Specific Issues

### LSP returns ENOENT on Windows (MSYS2/Git Bash)

**Symptoms:** LSP initialization fails with `ENOENT` or resolves POSIX-style paths like `/c/Users/...` instead of `C:\Users\...`.

**Cause:** The `which` command in MSYS2/Git Bash returns POSIX paths that Node.js `spawn()` can't resolve.

**Fix:** Updated in v2.29+ to use `where.exe` on Windows. Upgrade to the latest version.

### EBUSY errors during WXT/extension builds

**Symptoms:** `EBUSY: resource busy or locked, rmdir .output/chrome-mv3` when building browser extensions.

**Cause:** A Chromium browser has the extension loaded from the build output directory, preventing deletion.

**Fix:** Close the browser extension, or set a different `outDirTemplate` in your WXT config to avoid the locked directory.

## Database Issues

### "OTTO database is not available"

**Symptoms:** `otto_decision_save` (or its alias `otto_save_decision`), `otto_requirement_update` (or `otto_update_requirement`), or `otto_summary_save` (or `otto_save_summary`) fail with this error.

**Cause:** The SQLite database was not initialized or could not be opened. Runtime state derivation will not silently fall back to markdown projections.

**Fix:** Upgrade to the latest version, then run a OTTO command from the project root to initialize or open the database. Use `/otto inspect` for database diagnostics. If the database was lost or corrupted and markdown artifacts are the only usable state, run `/otto recover` after OTTO has opened the database.

## Verification Issues

### Verification gate fails with shell syntax error

**Symptoms:** `stderr: /bin/sh: 1: Syntax error: "(" unexpected` during verification checks.

**Cause:** A description-like string (e.g., `All 10 checks pass (build, lint)`) was treated as a shell command. This can happen when task plans have `verify:` fields with prose instead of actual commands.

**Fix:** Updated in v2.29+ to filter preference commands through `isLikelyCommand()`. Ensure `verification_commands` in preferences contains only valid shell commands, not descriptions.

### Verification command is rejected as unsafe or non-runnable

**Symptoms:** Pre-execution checks fail with `Unsafe or non-runnable Verify command`, often for a command that works in an interactive shell.

**Cause:** OTTO only accepts mechanically executable verification commands. Shell control syntax such as pipes (`|`), redirects (`>` or `<`), semicolons, backticks, and command substitution (`$(...)`) is rejected so verification cannot hide failures by trimming or reshaping output.

**Fix:** Put the direct check in the verify field or `verification_commands`. For example, use `python3 -m pytest tests -q --tb=short` instead of `python3 -m pytest tests -q --tb=short 2>&1 | tail -5`.

## LSP (Language Server Protocol)

### "LSP isn't available in this workspace"

OTTO auto-detects language servers based on project files (e.g. `package.json` → TypeScript, `Cargo.toml` → Rust, `go.mod` → Go). If no servers are detected, the agent skips LSP features.

**Check status:**
```
lsp status
```

This shows which servers are active and, if none are found, diagnoses why — including which project markers were detected but which server commands are missing.

**Common fixes:**

| Project type | Install command |
|-------------|-----------------|
| TypeScript/JavaScript | `npm install -g typescript-language-server typescript` |
| Python | `pip install pyright` or `pip install python-lsp-server` |
| Rust | `rustup component add rust-analyzer` |
| Go | `go install golang.org/x/tools/gopls@latest` |

After installing, run `lsp reload` to restart detection without restarting OTTO.

## Notifications

### Notifications not appearing on macOS

**Symptoms:** `notifications.enabled: true` in preferences, but no desktop notifications appear during auto-mode (no milestone complete alerts, no budget warnings, no error notifications). No error messages logged.

**Cause:** OTTO uses `osascript display notification` as a fallback on macOS. This command is attributed to your terminal app (Ghostty, iTerm2, Alacritty, Kitty, Warp, etc.). If that app doesn't have notification permissions in System Settings → Notifications, macOS silently drops the notification — `osascript` exits 0 with no error.

Most terminal apps don't appear in the Notifications settings panel until they've successfully delivered at least one notification, creating a chicken-and-egg problem.

**Fix (recommended):** Install `terminal-notifier`, which registers as its own Notification Center app:

```bash
brew install terminal-notifier
```

OTTO automatically prefers `terminal-notifier` when available. On first use, macOS will prompt you to allow notifications — this is the expected behavior.

**Fix (alternative):** Go to **System Settings → Notifications** and enable notifications for your terminal app. If your terminal doesn't appear in the list, try sending a test notification from Terminal.app first to register "Script Editor":

```bash
osascript -e 'display notification "test" with title "OTTO"'
```

**Verify:** After applying either fix, test with:

```bash
terminal-notifier -title "OTTO" -message "working!" -sound Glass
```

### Telegram notifications not arriving

**Symptoms:** Auto-mode is running, Telegram is configured as the remote channel, but milestone completions, budget alerts, and other informational notifications are not appearing in the Telegram chat.

**Causes and fixes:**

- **`notifications.enabled` is not set** — ensure `notifications.enabled: true` is present in preferences alongside the `remote_questions` configuration. Informational notifications require both to be set.
- **Bot token is incorrect or expired** — run `/otto remote status` to confirm the configuration is saved, then `/otto remote telegram` to re-run setup and re-validate the token.
- **Bot is not a member of the target chat** — the bot must be added to the group chat (or the configured chat ID must match a private chat with the bot). Send `/help` directly to the bot in Telegram to confirm it is reachable.
- **Wrong `channel_id`** — verify the chat ID in `~/.otto/PREFERENCES.md` matches the chat where you expect notifications. For group chats, the ID is typically a negative number (e.g., `-1001234567890`).
- **Network or firewall issue** — OTTO must be able to reach `api.telegram.org`. Test with `curl https://api.telegram.org` from the machine running OTTO.

### Telegram commands not responding

**Symptoms:** Sending `/status`, `/pause`, or other Telegram commands to the bot produces no response.

**Causes and fixes:**

- **Auto-mode is not running** — background polling only operates while auto-mode is active. Start auto-mode with `/otto auto` and then retry the command.
- **Wrong chat** — commands are only processed from the chat configured in `remote_questions.channel_id`. Confirm you are sending from the correct chat.
- **Bot token mismatch** — the `TELEGRAM_BOT_TOKEN` environment variable or the token in `~/.otto/PREFERENCES.md` may not match the bot you are messaging. Run `/otto remote status` to confirm which bot token is active.
- **Polling not started** — if OTTO was already running when the Telegram configuration was added, restart auto-mode (`/otto stop`, then `/otto auto`) so polling initializes with the new configuration.
- **Send `/help` first** — if the bot responds to `/help`, polling is working correctly. If a specific command like `/pause` does not respond, check for typos (commands are case-sensitive).
