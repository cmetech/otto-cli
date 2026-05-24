# OTTO Branding Step 1 — Display Brand Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the running CLI display the product name "OTTO" everywhere it currently shows "LOOP24" — banner, help header, footer, welcome screen — and flip the `[loop24]` log prefix to `[otto]`. No command names, paths, slash commands, or env vars change.

**Architecture:** The brand layer is already centralized: `src/brand.ts` and `src/help-text.ts` read `piConfig.brandName` into `BRAND_NAME`/`BRAND`, which display surfaces consume. So changing one config value flips most surfaces. Only two things bypass it — the static ASCII banner file and the hardcoded `[loop24]` log prefixes — and they're handled in their own tasks.

**Tech Stack:** TypeScript, Node ≥22, npm workspaces. Brand config in `package.json` `piConfig`, synced across 3 files by `scripts/sync-piconfig.mjs` (runs on `prebuild`).

**Spec:** `docs/superpowers/specs/2026-05-24-otto-branding-step1-display-name.md`

**Repo conventions (carry forward):**
- NEVER `git add -A`; stage explicit paths only.
- `docs/branding/` is the user's working area — hands off.
- Build = `npm run build`; exit 0 required.
- Local commits only (no remote configured).
- Standing 74-test regression set — full invocation in Task 4.

---

### Task 1: Flip `piConfig.brandName` to OTTO

**Files:**
- Modify: `package.json` (root `piConfig.brandName`)
- Auto-synced (do not hand-edit): `packages/pi-coding-agent/package.json`, `pkg/package.json`

- [ ] **Step 1: Edit root `package.json` piConfig.brandName**

In `package.json`, change the `brandName` field inside the `piConfig` block:

```json
  "piConfig": {
    "_comment": "CANONICAL source for piConfig. Auto-synced to packages/pi-coding-agent/package.json and pkg/package.json by scripts/sync-piconfig.mjs (runs on `prebuild`). To rebrand: edit this block, run `npm run build` (or `npm run sync-piconfig`).",
    "name": "loop24",
    "configDir": ".loop24",
    "commandNamespace": "loop24",
    "brandName": "OTTO"
  },
```

Only `brandName` changes: `"LOOP24"` → `"OTTO"`. Leave `name`, `configDir`, and `commandNamespace` exactly as they are (those are steps 2–5).

- [ ] **Step 2: Sync the mirrors**

Run: `npm run sync-piconfig`
Expected output: lines reporting both mirrors updated, e.g.
```
[sync-piconfig] updated packages/pi-coding-agent/package.json
[sync-piconfig] updated pkg/package.json
```

- [ ] **Step 3: Verify mirrors are in sync**

Run: `npm run verify:piconfig-sync`
Expected: `[verify-piconfig-sync] piConfig is in sync across all three package.json files`

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exit 0. (Prebuild re-runs sync-piconfig idempotently — fine.)

- [ ] **Step 5: Verify the help header reads OTTO**

Run: `node dist/loader.js --help | head -1`
Expected: `OTTO v1.0.1 — compliant agent for developers`

Run: `node dist/loader.js --version`
Expected: `1.0.1` (unchanged — sanity check that boot still works)

- [ ] **Step 6: Commit**

```bash
git add package.json packages/pi-coding-agent/package.json pkg/package.json
git commit -m "$(cat <<'EOF'
feat(otto-step1): brandName LOOP24 → OTTO

piConfig.brandName flipped to OTTO and synced to both mirrors. This
drives BRAND_NAME / BRAND (src/brand.ts, src/help-text.ts) so the help
header, TUI footer badge, welcome screen, and transcript rail label now
read OTTO. Command names, slash namespace, config dir, and env vars are
unchanged (deferred to steps 2-5).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Replace the launch banner with OTTO art

**Files:**
- Modify: `src/resources/extensions/loop24/branding/banner.txt`

Note: `src/loader.ts:119` reads this file directly from the `src/` path and renders it only on first launch (when `~/.loop24/` does not yet exist). `copy-resources.cjs` also copies it to `dist/resources/` on build. Editing this one file covers both.

- [ ] **Step 1: Overwrite banner.txt with the ANSI Shadow OTTO art**

Replace the entire contents of `src/resources/extensions/loop24/branding/banner.txt` with exactly (6 lines, no trailing blank line beyond what's shown):

```
 ██████╗ ████████╗████████╗ ██████╗ 
██╔═══██╗╚══██╔══╝╚══██╔══╝██╔═══██╗
██║   ██║   ██║      ██║   ██║   ██║
██║   ██║   ██║      ██║   ██║   ██║
╚██████╔╝   ██║      ██║   ╚██████╔╝
 ╚═════╝    ╚═╝      ╚═╝    ╚═════╝ 
```

- [ ] **Step 2: Verify the file spells OTTO and has 6 lines**

Run: `cat src/resources/extensions/loop24/branding/banner.txt`
Expected: the OTTO block art above (4 glyphs: O, T, T, O).

Run: `wc -l < src/resources/extensions/loop24/branding/banner.txt`
Expected: `6`

- [ ] **Step 3: Build (so dist/resources picks up the new art)**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Verify the banner renders on a fresh first-run**

The banner only prints when the app-root dir is absent. Test against a throwaway home so your real `~/.loop24/` is untouched:

Run:
```bash
HOME=$(mktemp -d) node dist/loader.js --version 2>&1 | head -8
```
Expected: the OTTO ANSI Shadow art prints (in yellow), followed by
`  compliant agent for developers vX.Y.Z` and a `Welcome.` line, then `1.0.1`.

(If the art looks misaligned, the box-drawing glyphs were altered on paste — re-copy Step 1 exactly.)

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/loop24/branding/banner.txt
git commit -m "$(cat <<'EOF'
feat(otto-step1): banner art LOOP24 → OTTO

Replace the first-run launch banner ASCII art with the OTTO wordmark in
the same ANSI Shadow block style. Read by src/loader.ts on first run and
copied to dist/resources on build.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Flip the `[loop24]` log prefix to `[otto]`

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/worktree-cli.ts`
- Modify: `src/worktree-status-banner.ts`
- Modify: `packages/pi-coding-agent/src/main.ts`

The bracketed token `[loop24]` is the log/namespace prefix. Bare `loop24` (command invocations like `loop24 auto`, `loop24 -w`) is NOT bracketed, so replacing the literal `[loop24]` → `[otto]` per file is unambiguous and leaves command refs untouched. The command refs stay `loop24` until step 2 — producing accepted interim lines like `[otto]   loop24 auto`.

- [ ] **Step 1: Replace `[loop24]` → `[otto]` in all four files**

In each file, replace every occurrence of the literal `[loop24]` with `[otto]` (replace-all). Do NOT touch any bare `loop24` (no brackets) — those are command/path references for step 2.

Affected occurrences (for reference — replace-all covers them):
- `src/cli.ts`: the `printNonTtyErrorAndExit` help block (`[loop24] Error…`, `[loop24] Non-interactive alternatives:`, and 7 `[loop24]   loop24 …` lines), plus `[loop24] ${prefix}:` (extension load-error), `[loop24] Extension warning:`, and `[loop24] graph build failed:`
- `src/worktree-cli.ts`: two `chalk.dim('[loop24] ')`
- `src/worktree-status-banner.ts`: two `chalk.dim('[loop24] ')`
- `packages/pi-coding-agent/src/main.ts`: one `console.log("[loop24] All configured models are local …")`

Example (cli.ts help block, before → after — note command refs stay `loop24`):

```
  process.stderr.write('[loop24]   loop24 auto                       Auto-mode (pipeable, no TUI)\n')
```
becomes
```
  process.stderr.write('[otto]   loop24 auto                       Auto-mode (pipeable, no TUI)\n')
```

- [ ] **Step 2: Verify no `[loop24]` prefix remains, and `[otto]` is present**

Run:
```bash
grep -rn "\[loop24\]" src/cli.ts src/worktree-cli.ts src/worktree-status-banner.ts packages/pi-coding-agent/src/main.ts
```
Expected: no output (exit 1 from grep = zero matches).

Run:
```bash
grep -rcn "\[otto\]" src/cli.ts src/worktree-cli.ts src/worktree-status-banner.ts packages/pi-coding-agent/src/main.ts
```
Expected: each file reports ≥1 match (cli.ts the most).

- [ ] **Step 3: Verify command refs were NOT touched**

Run: `grep -c "loop24 auto\|loop24 -w\|loop24 graph build" src/cli.ts src/worktree-cli.ts`
Expected: still present (non-zero) — these stay `loop24` until step 2.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Verify a prefix path at runtime**

Run: `node dist/loader.js < /dev/null 2>&1 | head -2`
Expected (non-TTY error path):
```
[otto] Error: Interactive mode requires a terminal (TTY).
[otto] Non-interactive alternatives:
```
(The subsequent lines will show `[otto]   loop24 auto …` — the accepted interim mix.)

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/worktree-cli.ts src/worktree-status-banner.ts packages/pi-coding-agent/src/main.ts
git commit -m "$(cat <<'EOF'
feat(otto-step1): log prefix [loop24] → [otto]

Flip the bracketed log/namespace prefix in user-visible stderr/stdout
writes. Bare `loop24` command invocations on the same lines stay loop24
(binary rename is step 2), producing accepted interim lines like
`[otto]   loop24 auto`.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Build clean**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 2: Standing 74-test regression**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  packages/pi-coding-agent/src/config.test.ts \
  src/resources/extensions/workflow/tests/update-command.test.ts \
  src/resources/extensions/workflow/tests/extension-bootstrap-isolation.test.ts \
  src/resources/extensions/workflow/tests/autocomplete-regressions-1675.test.ts \
  src/resources/extensions/workflow/tests/help-menu-coverage.test.ts \
  src/resources/extensions/workflow/tests/auto-blocked-remediation-message.test.ts \
  src/resources/extensions/loop24/tests/langflow-client.test.ts \
  src/resources/extensions/loop24/tests/langflow-import-flow.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-schema.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-loader.test.ts \
  src/resources/extensions/loop24/tests/python-runtime.test.ts \
  src/resources/extensions/loop24/tests/tools-loader.test.ts \
  src/resources/extensions/loop24/tests/build-flow-scaffold.test.ts \
  src/resources/extensions/loop24/tests/build-flow-system-context.test.ts \
  src/resources/extensions/loop24/tests/prompt-engineer-template.test.ts \
  src/resources/extensions/loop24/tests/prompt-engineer-storage.test.ts \
  2>&1 | tail -8
```
Expected: `# pass 74` / `# fail 0`.

(If anything fails, the regression spans three small commits — bisect across Task 1/2/3.)

- [ ] **Step 3: Visual smoke — always-visible brand surfaces**

Run: `node dist/loader.js --help | head -1`
Expected: `OTTO v1.0.1 — compliant agent for developers`

Run: `node dist/loader.js sessions 2>&1 | head -1`
Expected: a normal sessions header — boot works, no `[loop24]` noise.

- [ ] **Step 4: Confirm deferred surfaces are intentionally unchanged (not a regression)**

Run: `node dist/loader.js worktree list 2>&1 | tail -1`
Expected: still references `loop24 -w <name>` (command ref — deferred to step 2). Present, not changed.

Run: `grep -c "commandNamespace.*loop24\|configDir.*loop24" package.json`
Expected: non-zero — namespace and config dir intentionally still loop24.

---

## Notes for the executor

- These are display-string changes, not logic — there are no new unit tests to author. Verification is build + grep assertions + runtime smoke + the standing regression.
- If you prefer a single commit, the three implementation commits (Tasks 1–3) can be squashed; they're kept separate here for bisectability.
- Do not update LOOP24-PATCHES.md or create a phase tag as part of this plan — that's a wrap-up decision for after the user confirms the visual result.
