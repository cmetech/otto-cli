# OTTO Branding Step 2 — Command Rename (loop24 → otto) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the command from `loop24` to `otto` everywhere users invoke or see it — the shell binary, its `--help`/usage text, its `/otto` slash commands, and its dynamic log prefixes — while leaving the npm packaging identity, config dir, and env vars as `loop24`.

**Architecture:** Two coupled config values do most of the work: `package.json` `bin` (the shell command) and `piConfig.commandNamespace` (the single knob that drives help-text usage strings, slash-command registration via `pi.registerCommand(COMMAND_NAMESPACE, …)`, slash hints `/${COMMAND_NAMESPACE}`, and dynamic `[${COMMAND_NAMESPACE}]` log prefixes). Beyond those, ~121 hardcoded literal `loop24 <cmd>` / `/loop24 <cmd>` references across 36 files need a mechanical sweep. `commandNamespace` is load-bearing (the Phase 2c "Unknown command" bug came from its three package.json copies drifting), so it is changed only in root and propagated via `scripts/sync-piconfig.mjs`.

**Tech Stack:** TypeScript, Node ≥22, npm workspaces. Brand/command config in `package.json` `piConfig`, synced across 3 files by `scripts/sync-piconfig.mjs` (runs on `prebuild`).

**Spec:** `docs/superpowers/specs/2026-05-24-otto-branding-step2-command-rename.md`

**Repo conventions (carry forward):**
- NEVER `git add -A`; stage explicit paths only.
- `docs/branding/` is the user's working area — hands off.
- Build = `npm run build`; exit 0 required.
- Local commits only (no remote).
- Standing 74-test regression set — full invocation in Task 4.

**Sweep exclusions — these forms MUST NOT change (they are not the command):**
`.loop24` / `~/.loop24` paths · `@loop24/…` scope · `@ericsson/loop24` · `LOOP24_*` env vars · file/module names `loop24-wizard`, `loop24-config`, `extensions/loop24/`, `loop24.json` · `piConfig.name` ("loop24") · `loop24-client` repo/dir name · `customType` strings.

---

### Task 1: Flip the binary name + commandNamespace to otto

**Files:**
- Modify: `package.json` (`bin` key + `piConfig.commandNamespace`)
- Modify: `packages/pi-coding-agent/src/config.test.ts` (assertion)
- Auto-synced (do not hand-edit): `packages/pi-coding-agent/package.json`, `pkg/package.json`

- [ ] **Step 1: Change the `bin` key**

In `package.json`:
```json
  "bin": {
    "otto": "dist/loader.js"
  },
```
(was `"loop24": "dist/loader.js"`)

- [ ] **Step 2: Change `piConfig.commandNamespace`**

In `package.json` `piConfig`, change ONLY `commandNamespace` (leave `name`, `configDir`, `brandName`):
```json
  "piConfig": {
    "_comment": "CANONICAL source for piConfig. Auto-synced to packages/pi-coding-agent/package.json and pkg/package.json by scripts/sync-piconfig.mjs (runs on `prebuild`). To rebrand: edit this block, run `npm run build` (or `npm run sync-piconfig`).",
    "name": "loop24",
    "configDir": ".loop24",
    "commandNamespace": "otto",
    "brandName": "OTTO"
  },
```

- [ ] **Step 3: Update the commandNamespace test assertion**

In `packages/pi-coding-agent/src/config.test.ts`, find the assertion that checks `COMMAND_NAMESPACE` equals `"loop24"` (search `COMMAND_NAMESPACE`). Change the expected value to `"otto"`. Do NOT change the `APP_NAME`/`name` (`"loop24"`) or `CONFIG_DIR_NAME` (`".loop24"`) assertions — those stay.

- [ ] **Step 4: Sync mirrors + verify**

Run: `npm run sync-piconfig` → expect both mirrors updated.
Run: `npm run verify:piconfig-sync` → expect `piConfig is in sync across all three package.json files`.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Verify var-driven surfaces flipped to otto**

Run: `node dist/loader.js --help | grep -i "usage\|otto\|loop24" | head -8`
Expected: usage lines now read `Usage: otto config`, `otto worktree …`, etc. (driven by `${CMD}` = commandNamespace). No `loop24 <cmd>` from the var-driven help.

Run: `node dist/loader.js --version` → expect `1.0.1` (boot still works).

- [ ] **Step 7: Commit**

```bash
git add package.json packages/pi-coding-agent/package.json pkg/package.json packages/pi-coding-agent/src/config.test.ts
git commit -m "$(cat <<'EOF'
feat(otto-step2): rename command loop24 → otto (bin + commandNamespace)

package.json bin key loop24 → otto (the shell command). piConfig.command
Namespace loop24 → otto — the single knob driving help-text usage strings,
slash-command registration (pi.registerCommand(COMMAND_NAMESPACE,…)), slash
hints /${COMMAND_NAMESPACE}, and dynamic [${COMMAND_NAMESPACE}] log prefixes.
Synced to both mirrors. config.test.ts COMMAND_NAMESPACE assertion → otto.
Hardcoded literal loop24/<cmd> refs swept in the next task. configDir/name/
env vars unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Sweep hardcoded literal `loop24 <cmd>` / `/loop24 <cmd>` references

**Files (36):**
`src/cli.ts`, `src/headless.ts`, `src/loop24-wizard.ts`, `src/worktree-cli.ts`, `src/worktree-status-banner.ts`,
`packages/pi-coding-agent/src/modes/interactive/components/footer.ts`,
`packages/pi-coding-agent/src/modes/interactive/controllers/input-controller.ts`,
and under `src/resources/extensions/`:
`loop24/index.ts`, `loop24/tools/_loader.ts`, `loop24/commands/build-flow/_scaffold.ts`, `loop24/commands/build-flow/command.ts`, `loop24/commands/flow-triggers/_schema.ts`, `loop24/commands/prompt-engineer/_storage.ts`, `loop24/commands/prompt-engineer/_template.ts`, `loop24/commands/prompt-engineer/command.ts`,
`workflow/auto.ts`, `workflow/auto-model-selection.ts`, `workflow/auto-post-unit.ts`, `workflow/auto/phases.ts`, `workflow/blocked-models.ts`, `workflow/bootstrap/agent-end-recovery.ts`, `workflow/bootstrap/db-tools.ts`, `workflow/commands-prefs-wizard.ts`, `workflow/commands-workflow-templates.ts`, `workflow/commands-worktree.ts`, `workflow/commands/handlers/auto.ts`, `workflow/commands/handlers/core.ts`, `workflow/commands/handlers/onboarding.ts`, `workflow/config-overlay.ts`, `workflow/guided-flow.ts`, `workflow/guided-flow-queue.ts`, `workflow/parallel-orchestrator.ts`, `workflow/setup-catalog.ts`, `workflow/workflow-dispatch.ts`, `workflow/workflow-plugins.ts`, `workflow/worktree-manager.ts`.

- [ ] **Step 1: Run the scoped replace across the 36 files**

Use a perl regex that matches `loop24` or `/loop24` followed by a known subcommand/flag, with a negative lookbehind so it never touches `.loop24`, `@loop24`, `loop24-`, `LOOP24_`, or word-internal matches. Run from repo root:

```bash
FILES=$(grep -rlE "(^|[^./@A-Za-z0-9_-])/?loop24 (config|auto|worktree|graph|-w|--print|--mode|--web|headless|sessions|setup|install|list|remove|update|upgrade|start|next|templates|help|onboarding|prompt-engineer|build-flow)" src/ packages/pi-coding-agent/src/ | grep -v node_modules | grep -v "/dist/" | grep -v "\.test\.")
perl -i -pe 's{(?<![./@A-Za-z0-9_-])(/?)loop24 (config|auto|worktree|graph|-w|--print|--mode|--web|headless|sessions|setup|install|list|remove|update|upgrade|start|next|templates|help|onboarding|prompt-engineer|build-flow)\b}{$1otto $2}g' $FILES
```

This turns `loop24 config` → `otto config` and `/loop24 auto` → `/otto auto`, leaving the leading `/` intact and never matching the excluded forms.

- [ ] **Step 2: Verify no hardcoded command refs remain**

Run:
```bash
grep -rnE "(^|[^./@A-Za-z0-9_-])/?loop24 (config|auto|worktree|graph|-w|--print|--mode|--web|headless|sessions|setup|install|list|remove|update|upgrade|start|next|templates|help|onboarding|prompt-engineer|build-flow)\b" src/ packages/pi-coding-agent/src/ | grep -v node_modules | grep -v "/dist/" | grep -v "\.test\."
```
Expected: zero output.

- [ ] **Step 3: Verify exclusions were NOT touched**

Run:
```bash
grep -rn "\.loop24\|@loop24/\|LOOP24_\|loop24-wizard\|loop24-config\|extensions/loop24\|loop24\.json\|\"name\": \"loop24\"" src/ packages/pi-coding-agent/src/ package.json | grep -v node_modules | grep -v "/dist/" | head
```
Expected: these forms still present (untouched). Spot-confirm `~/.loop24/` paths and `LOOP24_*` env names are intact.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Spot-check user-facing output now says otto**

Run: `node dist/loader.js worktree list 2>&1 | tail -1`
Expected: hint reads `otto -w <name>` (was `loop24 -w <name>`).
Run: `node dist/loader.js graph status 2>&1 | tail -1`
Expected: `Run: otto graph build`.

- [ ] **Step 6: Commit**

```bash
git add -- $(git diff --name-only)
git commit -m "$(cat <<'EOF'
feat(otto-step2): sweep hardcoded loop24/<cmd> refs → otto / /otto

~121 literal command-reference strings across 36 files (cli, headless,
worktree, wizard, loop24 + workflow extensions, pi-coding-agent footer/
input-controller) flipped: `loop24 <cmd>` → `otto <cmd>`, `/loop24 <cmd>`
→ `/otto <cmd>`. Scoped perl regex with a negative lookbehind left every
exclusion untouched (.loop24 paths, @loop24 scope, LOOP24_ env vars,
loop24-wizard/config module names, piConfig.name, loop24-client repo name).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

> Note for executor: `git diff --name-only` in Step 6 stages exactly the files perl modified. Before committing, run `git status --short` and confirm the list matches the 36 expected files (plus none under `docs/branding/`). If any unexpected file appears, unstage it and investigate.

---

### Task 3: install.sh + docs

**Files:**
- Modify: `scripts/install.sh`
- Modify: `README.md`, `docs/INSTALL.md`

- [ ] **Step 1: Update `scripts/install.sh`**

Make these edits (line numbers approximate — match by content):
- Line ~9 (comment): `~/.local/bin/loop24` → `~/.local/bin/otto`.
- Line ~10 (comment): `loop24 config` → `otto config`.
- Line ~22: `PROG_NAME="loop24"` → `PROG_NAME="otto"`.
- Line ~78 (package guard — **bug fix**): `if ! grep -q '"@loop24/client"' "$REPO_ROOT/package.json"; then` → `if ! grep -q '"@ericsson/loop24"' "$REPO_ROOT/package.json"; then` (the package is `@ericsson/loop24`; the old guard always failed).
- Line ~116: `/loop24 build-flow` → `/otto build-flow`.
- Lines ~161, ~164, ~170, ~174: `loop24 config` → `otto config`.
- Lines ~185, ~186: `loop24 --help` → `otto --help`, `loop24 config …` → `otto config …`.
- LEAVE lines ~74 and ~79 ("loop24-client repo") as-is — that is the repo/directory name, not the command.

- [ ] **Step 2: Verify install.sh**

Run: `grep -n "loop24" scripts/install.sh`
Expected: only the two `loop24-client` repo-name references remain; no `loop24 <cmd>`, no `PROG_NAME="loop24"`, no `@loop24/client` guard.
Run: `bash -n scripts/install.sh` → expect no syntax errors (exit 0).

- [ ] **Step 3: Update docs**

In `README.md` and `docs/INSTALL.md`, change command examples `loop24 <cmd>` → `otto <cmd>` and `/loop24 <cmd>` → `/otto <cmd>`. LEAVE: `npm install -g @ericsson/loop24` lines, `~/.loop24/` path references, `@loop24/*` scope, and the "loop24-client" repo name. (The first-run command `loop24` alone → `otto`.)

Run to find candidates: `grep -nE "/?loop24( |$|\`)" README.md docs/INSTALL.md | grep -v "@ericsson/loop24\|~/.loop24\|@loop24/\|loop24-client"`
Edit each command-reference hit to `otto`.

- [ ] **Step 4: Verify docs**

Run: `grep -nE "(^|[^./@-])/?loop24 (config|auto|worktree|graph|-w|setup|--help|install|list|update)" README.md docs/INSTALL.md`
Expected: zero command-reference hits remain.

- [ ] **Step 5: Commit**

```bash
git add scripts/install.sh README.md docs/INSTALL.md
git commit -m "$(cat <<'EOF'
feat(otto-step2): install.sh + docs command refs loop24 → otto

install.sh: PROG_NAME otto (symlinks ~/.local/bin/otto), all `loop24 config`
/`loop24 --help` messages → otto, and FIX the stale package guard that
grepped for "@loop24/client" (real name is @ericsson/loop24, so the guard
always failed). README + INSTALL.md command examples → otto / /otto.
Kept: @ericsson/loop24 install lines, ~/.loop24/ paths, loop24-client repo
name.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Verification + global reinstall

**Files:** none (verification + a user-run install step)

- [ ] **Step 1: Build clean**

Run: `npm run build` → expect exit 0.

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
Expected: `# pass 74` / `# fail 0`. (config.test.ts now expects COMMAND_NAMESPACE="otto" — Task 1 updated it.)

- [ ] **Step 3: Confirm no command-ref residue + deferred surfaces intact**

Run:
```bash
grep -rnE "(^|[^./@A-Za-z0-9_-])/?loop24 (config|auto|worktree|graph|-w|--print|--mode|--web|headless|sessions|setup|install|list|remove|update|upgrade|start|next|templates|help|onboarding|prompt-engineer|build-flow)\b" src/ packages/pi-coding-agent/src/ scripts/install.sh README.md docs/INSTALL.md | grep -v node_modules | grep -v "/dist/" | grep -v "\.test\."
```
Expected: zero output.
Run: `grep -E "configDir|\"name\"" package.json` → still `".loop24"` / `"loop24"` (deferred — not changed).

- [ ] **Step 4: Global reinstall (USER runs this — mutates global env)**

The npm global bin still has `loop24` → loader. To swap it for `otto`, the user runs the project's global install from the repo root. Document and have the user run:
```bash
npm install -g .
```
Then verify:
```bash
which otto      # expect: resolves to the global bin
which loop24    # expect: not found
otto --version  # expect: 1.0.1
otto --help | head -1   # expect: OTTO v1.0.1 — compliant agent for developers
```

- [ ] **Step 5: Functional dispatch check (USER, guards against Phase 2c failure)**

Launch the TUI and confirm the slash namespace dispatches:
```bash
otto
```
Inside the TUI, type `/otto status` and confirm it runs (does NOT print "Unknown command"). Also confirm `/otto` appears in autocomplete and `/loop24` does not. This is the definition-of-done for the namespace flip — a grep is not sufficient.

- [ ] **Step 6: Report**

Summarize: build, regression (74/74), residue grep (zero), `which otto`/`which loop24` results, and the `/otto status` dispatch result. Do not tag or update LOOP24-PATCHES.md — that is a wrap-up decision after the user confirms the live result (same as step 1).

---

## Notes for the executor
- These are command-string + config changes, not logic — no new unit tests to author beyond the updated `config.test.ts` assertion. Verification = build + grep assertions + the functional `/otto` dispatch check.
- The riskiest change is the `commandNamespace` flip (Task 1). If `/otto status` prints "Unknown command" after reinstall, check that all three `package.json` piConfig copies show `commandNamespace: "otto"` (`npm run verify:piconfig-sync`) and that `pkg/package.json` synced (the Phase 2c failure mode was `pkg/` drifting).
- Steps 4–5 of Task 4 are user-run because they mutate the global environment and require an interactive TTY; the executor prepares everything and hands off these two checks.
