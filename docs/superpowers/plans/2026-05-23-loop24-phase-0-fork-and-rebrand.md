# LOOP24 Phase 0 — Fork & Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-fork gsd-pi into a working `loop24` binary that launches with LOOP24 branding, registers `/loop24 <subcommand>` instead of `/gsd <subcommand>`, and contains no user-visible "GSD" references — while keeping the existing workflow extension functional against direct Anthropic.

**Architecture:** Selective file copy from `~/Projects/repos/local/gsd-pi` (skipping `web/`, `vscode-extension/`, `studio/`, `native/`, `packages/native/`). One-time templating of the command namespace and brand strings via four piConfig fields (`name`, `configDir`, `commandNamespace`, `brandName`) read into exported constants. Rename the `gsd/` extension directory to `workflow/`. Replace the loader banner. Drop a `loop24` theme into the existing pi-tui theme registry.

**Tech Stack:** TypeScript, Node ≥22, npm workspaces, Node's built-in test runner (`node --test --experimental-strip-types`), pi-tui (custom TUI), `@anthropic-ai/sdk` (unchanged for Phase 0 — direct Anthropic).

**Scope boundary:** This plan changes only **user-visible** "GSD"/"gsd" references — the registered slash command name, the loader banner, `process.title`, and any prompt strings the model surfaces back to the user. **Internal identifiers** (env var names like `GSD_PKG_ROOT`, internal `customType` strings like `"gsd-add-tests"`, the npm workspace prefix `@gsd/`) are kept as-is for Phase 0 — they are not user-visible in normal usage. A follow-up cleanup phase can address these if desired.

**Out of scope for Phase 0:** Gateway routing (Phase 1), the `loop24` extension scaffold and first-run wizard (Phase 2), LangFlow integration (Phases 3-4), prompt-engineer command (Phase 5), distribution (Phases 6-7).

---

## File Structure

### New files

- `loop24-client/.gitignore`
- `loop24-client/LOOP24-PATCHES.md` — running log of every fork-specific change outside `extensions/loop24/`
- `loop24-client/src/resources/extensions/loop24/branding/banner.txt` — block ASCII art
- `loop24-client/src/resources/extensions/loop24/theme/loop24.json` — Loop24 Signal palette
- `loop24-client/src/resources/extensions/workflow/strings.ts` — extracted brand-name strings
- `loop24-client/packages/pi-coding-agent/src/config.test.ts` — unit test for the new constants

### Modified files

- `loop24-client/package.json` — piConfig fields, name, workspace entries
- `loop24-client/src/loader.ts` — banner, process.title, env-var key names where user-visible
- `loop24-client/packages/pi-coding-agent/src/config.ts` — export `COMMAND_NAMESPACE`, `BRAND_NAME`
- `loop24-client/src/resources/extensions/workflow/commands-bootstrap.ts:273` — templated registration
- Prompt files inside `workflow/` that hardcode `"GSD"` — refactored to import from `strings.ts`

### Renamed

- `gsd-pi/src/resources/extensions/gsd/` → `loop24-client/src/resources/extensions/workflow/`

### Dropped (never imported)

- `gsd-pi/web/`
- `gsd-pi/vscode-extension/`
- `gsd-pi/studio/`
- `gsd-pi/native/`
- `gsd-pi/packages/native/`
- `gsd-pi/.git/` (clean break — fresh git history)
- `gsd-pi/node_modules/`
- `gsd-pi/dist/`
- `gsd-pi/.plans/` (gsd-pi's own internal planning dir, irrelevant to LOOP24)

---

## Task 1: Initialize the loop24-client repo

**Files:**
- Create: `loop24-client/.gitignore`
- Create: (git repo metadata via `git init`)

- [ ] **Step 1: Initialize git in the existing directory**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git init -b main
```
Expected: `Initialized empty Git repository in /Users/coreyellis/Projects/repos/local/loop24-client/.git/`

- [ ] **Step 2: Write a minimal .gitignore**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/.gitignore`:
```
node_modules/
dist/
.superpowers/
*.log
.DS_Store
.env
```

- [ ] **Step 3: Initial commit with just the spec and plan**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add .gitignore docs/
git commit -m "chore: initial commit — design spec and Phase 0 plan"
```
Expected: commit succeeds with two files (`.gitignore` and the docs).

---

## Task 2: Import gsd-pi source (selective copy)

**Files:**
- All files under `loop24-client/` except the dropped paths listed above.

- [ ] **Step 1: Copy gsd-pi source selectively**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
rsync -a \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='dist/' \
  --exclude='web/' \
  --exclude='vscode-extension/' \
  --exclude='studio/' \
  --exclude='native/' \
  --exclude='packages/native/' \
  --exclude='.plans/' \
  --exclude='gitbook/' \
  --exclude='mintlify-docs/' \
  /Users/coreyellis/Projects/repos/local/gsd-pi/ \
  /Users/coreyellis/Projects/repos/local/loop24-client/
```
Expected: completes silently. Verify with `ls loop24-client/` — should now show `package.json`, `src/`, `packages/`, `scripts/`, etc.

- [ ] **Step 2: Confirm dropped directories did not get copied**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
ls -d web vscode-extension studio native packages/native 2>&1 | grep -v "No such file" || echo "OK: all dropped directories absent"
```
Expected: `OK: all dropped directories absent`

- [ ] **Step 3: Remove gsd-pi-specific workspace entries from package.json that point at dropped dirs**

Open `loop24-client/package.json` and inspect the `workspaces` array. Remove any entry that points at a dropped path. Currently the only known offender is `packages/native` — verify and remove.

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -A 20 '"workspaces"' package.json | head -25
```
Expected output shows the workspaces array. Edit to remove `packages/native` if present. Also remove from `optionalDependencies` any `@opengsd/engine-*` entries (they are native Rust binaries we dropped).

- [ ] **Step 4: Install dependencies**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm install
```
Expected: completes without errors. If `native` references throw errors, return to Step 3 and ensure all references are removed.

- [ ] **Step 5: Build the project**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build
```
Expected: completes without errors. Produces `dist/loader.js`.

- [ ] **Step 6: Smoke-test the binary (baseline before any branding changes)**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node dist/loader.js --version
```
Expected: prints the version string from `package.json` (e.g., `1.0.1`). This is our baseline — we know the fork is structurally sound before we change anything.

- [ ] **Step 7: Commit the import**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add -A
git commit -m "fork: import gsd-pi source (sans web/vscode/studio/native)"
```
Expected: large commit succeeds. This is the **fork point** — everything after this is LOOP24-specific.

---

## Task 3: Add `commandNamespace` and `brandName` to piConfig

**Files:**
- Modify: `loop24-client/package.json`
- Modify: `loop24-client/packages/pi-coding-agent/src/config.ts`
- Create: `loop24-client/packages/pi-coding-agent/src/config.test.ts`

- [ ] **Step 1: Write the failing test for the new constants**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/packages/pi-coding-agent/src/config.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_NAME, CONFIG_DIR_NAME, COMMAND_NAMESPACE, BRAND_NAME } from "./config.js";

test("APP_NAME reads piConfig.name from package.json", () => {
  assert.equal(APP_NAME, "loop24");
});

test("CONFIG_DIR_NAME reads piConfig.configDir from package.json", () => {
  assert.equal(CONFIG_DIR_NAME, ".loop24");
});

test("COMMAND_NAMESPACE reads piConfig.commandNamespace from package.json", () => {
  assert.equal(COMMAND_NAMESPACE, "loop24");
});

test("BRAND_NAME reads piConfig.brandName from package.json", () => {
  assert.equal(BRAND_NAME, "LOOP24");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-coding-agent/src/config.test.ts
```
Expected: FAIL — either the imports don't exist (`COMMAND_NAMESPACE`, `BRAND_NAME` undefined) or values don't match.

- [ ] **Step 3: Update package.json's piConfig block**

In `/Users/coreyellis/Projects/repos/local/loop24-client/package.json`, change:
```json
"piConfig": {
  "name": "gsd",
  "configDir": ".gsd"
}
```
to:
```json
"piConfig": {
  "name": "loop24",
  "configDir": ".loop24",
  "commandNamespace": "loop24",
  "brandName": "LOOP24"
}
```

Also update the top-level `"name"` field from `"@opengsd/gsd-pi"` to `"@loop24/client"`.

- [ ] **Step 4: Add the two new exported constants to config.ts**

In `/Users/coreyellis/Projects/repos/local/loop24-client/packages/pi-coding-agent/src/config.ts`, find the existing exports (around line 171):
```typescript
export const APP_NAME: string = pkg.piConfig?.name || "pi";
export const CONFIG_DIR_NAME: string = pkg.piConfig?.configDir || ".pi";
```

Add directly below them:
```typescript
export const COMMAND_NAMESPACE: string = pkg.piConfig?.commandNamespace || APP_NAME;
export const BRAND_NAME: string = pkg.piConfig?.brandName || APP_NAME.toUpperCase();
```

The fallback chain means: if `commandNamespace` is omitted, it falls back to `APP_NAME`; if `brandName` is omitted, it falls back to the uppercased `APP_NAME`. This preserves backward compatibility for any other piConfig consumers.

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build
node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-coding-agent/src/config.test.ts
```
Expected: PASS — all four assertions.

- [ ] **Step 6: Smoke-test the binary still launches**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node dist/loader.js --version
```
Expected: prints version. Confirms our piConfig change didn't break anything structurally.

- [ ] **Step 7: Commit**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add package.json packages/pi-coding-agent/src/config.ts packages/pi-coding-agent/src/config.test.ts
git commit -m "feat: add COMMAND_NAMESPACE and BRAND_NAME to piConfig

Adds two new piConfig fields read into exported constants:
- COMMAND_NAMESPACE (default: loop24) — top-level slash command name
- BRAND_NAME (default: LOOP24) — user-visible brand string

Also renames the package to @loop24/client and sets piConfig.name=loop24,
piConfig.configDir=.loop24."
```

---

## Task 4: Rename the `gsd/` extension directory to `workflow/`

**Files:**
- Renamed: `src/resources/extensions/gsd/` → `src/resources/extensions/workflow/`
- Modify: `package.json` (test script paths referencing the old path)
- Modify: any file importing from `extensions/gsd/`

- [ ] **Step 1: Rename the directory**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git mv src/resources/extensions/gsd src/resources/extensions/workflow
```
Expected: rename succeeds. `git status` shows the rename.

- [ ] **Step 2: Find all references to the old path**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -rn "resources/extensions/gsd" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.mjs" --include="*.js" . | grep -v node_modules | grep -v dist
```
Expected: a list of files that still reference the old path. Likely candidates:
- `package.json` (the `test:integration` script path)
- Any import statements in TypeScript files

- [ ] **Step 3: Update package.json test script**

Open `loop24-client/package.json`. The `test:integration` script currently reads:
```
"test:integration": "node --import ./src/resources/extensions/gsd/tests/resolve-ts.mjs ..."
```
Replace `extensions/gsd/` with `extensions/workflow/` everywhere it appears in the scripts section. Also update the test file glob: `src/resources/extensions/gsd/tests/integration/*.test.ts` → `src/resources/extensions/workflow/tests/integration/*.test.ts`.

- [ ] **Step 4: Update all TypeScript imports referencing the old path**

For each file from Step 2's grep that contains `extensions/gsd/` in import statements or string literals, replace with `extensions/workflow/`. Use:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -rl "resources/extensions/gsd" --include="*.ts" --include="*.mjs" . | grep -v node_modules | grep -v dist | xargs sed -i '' 's|resources/extensions/gsd|resources/extensions/workflow|g'
```
Note: `sed -i ''` (with empty quotes) is the macOS form. After running, re-run the grep from Step 2 to verify all matches are gone.

- [ ] **Step 5: Build and confirm**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build
```
Expected: builds successfully. If there are import errors complaining about `extensions/gsd`, find the remaining reference and update it.

- [ ] **Step 6: Smoke-test the binary**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node dist/loader.js --version
```
Expected: prints version.

- [ ] **Step 7: Commit the rename**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add -A
git commit -m "refactor: rename gsd/ extension to workflow/

Neutral directory name. Updates all import paths and test scripts
referencing the old location. No functional change — extension contents
unchanged."
```

---

## Task 5: Template the top-level slash command registration

**Files:**
- Modify: `src/resources/extensions/workflow/commands-bootstrap.ts:273`
- Create: integration smoke test

- [ ] **Step 1: Inspect the current registration**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
sed -n '270,285p' src/resources/extensions/workflow/commands-bootstrap.ts
```
Expected: shows the line `pi.registerCommand("gsd", { ... });` (around line 273). Note the import structure at the top of the file to know how to add a new import.

- [ ] **Step 2: Add the `COMMAND_NAMESPACE` import**

At the top of `src/resources/extensions/workflow/commands-bootstrap.ts`, add the import. The exact import path depends on how the file currently references the pi-coding-agent package — search the file for an existing import from `@gsd/pi-coding-agent` (the workspace alias may have been auto-updated, or may still need updating):
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep "@gsd/pi-coding-agent" src/resources/extensions/workflow/commands-bootstrap.ts
```

If imports use `@gsd/pi-coding-agent`, add:
```typescript
import { COMMAND_NAMESPACE } from "@gsd/pi-coding-agent/config";
```
(Use whatever subpath the existing imports use — e.g. `@gsd/pi-coding-agent/dist/config.js` if that's the pattern.)

- [ ] **Step 3: Replace the literal `"gsd"` with the constant**

At line 273, change:
```typescript
pi.registerCommand("gsd", {
```
to:
```typescript
pi.registerCommand(COMMAND_NAMESPACE, {
```

- [ ] **Step 4: Build**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build
```
Expected: builds successfully.

- [ ] **Step 5: Verify the command registers under the new namespace**

This requires launching the binary in interactive mode and confirming `/loop24` is now the top-level command. From a terminal:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node dist/loader.js
```
Inside the interactive UI, type `/` and verify the command list shows `loop24` (not `gsd`). Exit cleanly with Ctrl-C.

If the command does not register under `loop24`, check the build output for warnings and verify `COMMAND_NAMESPACE` resolves to `"loop24"`.

- [ ] **Step 6: Commit**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/workflow/commands-bootstrap.ts
git commit -m "refactor: template top-level slash command with COMMAND_NAMESPACE

The 'gsd' top-level command is now registered via COMMAND_NAMESPACE
constant. Changing piConfig.commandNamespace in package.json changes
the command name in one place."
```

---

## Task 6: Extract user-facing "GSD" brand strings into workflow/strings.ts

**Files:**
- Create: `src/resources/extensions/workflow/strings.ts`
- Modify: workflow files containing user-visible "GSD" references

- [ ] **Step 1: Inventory user-facing GSD strings in the workflow extension**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -rln '"GSD\|`GSD' --include="*.ts" src/resources/extensions/workflow/ | head -30
```
Expected: a list of files containing literal "GSD" strings. **Not all of these are user-facing** — many are internal error codes, type names, or comments. Focus on strings that appear in:
- Prompt templates passed to the model (the model will repeat them)
- Help text shown to users
- Error messages users will see
- Banner / startup output

Skip strings in error codes like `"MISSING_GSD_MARKER"` (internal), comments, JSDoc, and type/interface names — those are out of scope for Phase 0.

- [ ] **Step 2: Create the strings module**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/workflow/strings.ts`:
```typescript
import { BRAND_NAME, COMMAND_NAMESPACE } from "@gsd/pi-coding-agent/config";

// User-facing brand strings. Centralized so changing piConfig.brandName
// changes them everywhere. Use these instead of hardcoding "GSD" or "LOOP24".

export const BRAND = BRAND_NAME;                          // "LOOP24"
export const CMD = COMMAND_NAMESPACE;                     // "loop24"
export const BRAND_FULL = `${BRAND_NAME} Agent`;          // "LOOP24 Agent"
export const PLANNING_DIR = ".planning";                  // unchanged across brands
export const STATE_DB_NAME = `.${COMMAND_NAMESPACE}.db`;  // ".loop24.db"

// Helpers for building command-name strings in prompts/help text.
export const slashCommand = (sub: string) => `/${COMMAND_NAMESPACE} ${sub}`;
```

(Use whatever import path style matches the file's siblings — same considerations as Task 5 Step 2.)

- [ ] **Step 3: Replace user-facing GSD strings in identified files**

For each file from Step 1 that contained user-facing references, update them to import from `strings.ts` and interpolate `BRAND` / `slashCommand()`. Example transformation:

Before:
```typescript
return `Run \`/gsd plan\` to start the planning workflow. GSD will guide you through it.`;
```

After:
```typescript
import { slashCommand, BRAND } from "./strings.js";
// ...
return `Run \`${slashCommand("plan")}\` to start the planning workflow. ${BRAND} will guide you through it.`;
```

Work through the list from Step 1. Be conservative — when in doubt, leave the string alone and flag it in the commit message. We can do a second pass later.

- [ ] **Step 4: Build and verify**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build
node dist/loader.js --version
```
Expected: builds and launches.

- [ ] **Step 5: Verify --help no longer says "GSD" anywhere user-visible**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node dist/loader.js --help 2>&1 | grep -i 'gsd' || echo "OK: no 'gsd' in --help output"
```
Expected: `OK: no 'gsd' in --help output`. If matches appear, identify the source string and update it.

Note: `--help` content comes from `src/help-text.ts`. Inspect that file separately and replace any "GSD" mentions with `BRAND_NAME` interpolation. The help text isn't part of the workflow extension, so it needs its own edit — log this edit in `LOOP24-PATCHES.md` in Task 9.

- [ ] **Step 6: Commit**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add -A
git commit -m "refactor: extract user-facing brand strings to workflow/strings.ts

Centralizes user-visible 'GSD' references behind BRAND/slashCommand()
helpers that read from piConfig. Internal error codes, type names,
and comments left alone (out of scope for Phase 0)."
```

---

## Task 7: Replace the loader banner with LOOP24 block ASCII

**Files:**
- Create: `src/resources/extensions/loop24/branding/banner.txt`
- Modify: `src/loader.ts`

- [ ] **Step 1: Create the LOOP24 branding directory and banner**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
mkdir -p src/resources/extensions/loop24/branding
```

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/branding/banner.txt`:
```
██╗      ██████╗  ██████╗ ██████╗ ██████╗ ██╗  ██╗
██║     ██╔═══██╗██╔═══██╗██╔══██╗╚════██╗██║  ██║
██║     ██║   ██║██║   ██║██████╔╝ █████╔╝███████║
██║     ██║   ██║██║   ██║██╔═══╝ ██╔═══╝ ╚════██║
███████╗╚██████╔╝╚██████╔╝██║     ███████╗     ██║
╚══════╝ ╚═════╝  ╚═════╝ ╚═╝     ╚══════╝     ╚═╝
```

- [ ] **Step 2: Edit the loader to render the new banner**

Open `/Users/coreyellis/Projects/repos/local/loop24-client/src/loader.ts`. Find the banner-rendering block (roughly lines 91-110 in the original — it calls `renderLogo(colorCyan)` and writes `"Get Shit Done"` text).

Replace the entire banner block with:
```typescript
// Print LOOP24 banner on first launch (before ~/.loop24/ exists).
if (!existsSync(appRoot)) {
  const yellow = '\x1b[38;2;250;210;45m'    // brand primary #FAD22D
  const dim    = '\x1b[2m'
  const green  = '\x1b[38;2;63;206;142m'    // brand green #3FCE8E
  const reset  = '\x1b[0m'

  let banner = ''
  try {
    const bannerPath = join(gsdRoot, 'src/resources/extensions/loop24/branding/banner.txt')
    banner = readFileSync(bannerPath, 'utf-8')
  } catch { /* fall back to text-only */ }

  process.stderr.write(
    `${yellow}${banner}${reset}\n` +
    `  compliant agent for developers ${dim}v${gsdVersion}${reset}\n` +
    `  ${green}Welcome.${reset} Setting up your environment...\n\n`
  )
  process.env.LOOP24_FIRST_RUN_BANNER = '1'  // new env var; the old GSD_FIRST_RUN_BANNER is also kept for any internal readers — see notes
}
```

Notes:
- `gsdRoot` is the existing variable in the loader; keep using it (renaming it to `loop24Root` is internal cleanup we can defer).
- If the existing code references `process.env.GSD_FIRST_RUN_BANNER` elsewhere, also set that var (mirror to both names) until we sweep it. Leave a `// TODO(loop24): collapse to LOOP24_FIRST_RUN_BANNER after sweep` if doing so.

- [ ] **Step 3: Update `process.title`**

Find the line `process.title = 'gsd'` (roughly line 91 of the original loader.ts). Replace with:
```typescript
process.title = 'loop24'
```

Keep `process.title` as a literal — it's set before any imports that would expose `COMMAND_NAMESPACE`, so we hardcode it. Document this in `LOOP24-PATCHES.md`.

- [ ] **Step 4: Delete the old `renderLogo` call site**

The original loader imports `renderLogo` from `./logo.js`. After Step 2's banner block replaces that call, the `renderLogo` import becomes unused. Remove the import line `import { renderLogo } from './logo.js'`. Leave `src/logo.js` itself in place — other code may still reference it; we are not doing a full sweep in Phase 0.

- [ ] **Step 5: Build and verify the banner**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
rm -rf ~/.loop24 ~/.gsd  # ensure first-run path triggers — back up first if either holds anything you care about
npm run build
node dist/loader.js --version
```
Expected: prints version. The banner only shows on interactive mode first-run; verify it next.

Now launch interactive mode briefly:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node dist/loader.js
```
Expected: yellow LOOP24 block-ASCII banner appears, followed by the meta line. Exit with Ctrl-C.

- [ ] **Step 6: Commit**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/loader.ts src/resources/extensions/loop24/branding/banner.txt
git commit -m "feat: LOOP24 banner and process.title

Replaces the gsd-pi 'Get Shit Done' banner with the LOOP24 block ASCII
rendered in brand yellow (#FAD22D). Sets process.title to 'loop24'.
Banner content lives in extensions/loop24/branding/banner.txt for future
themability."
```

---

## Task 8: Add the Loop24 Signal theme

**Files:**
- Create: `src/resources/extensions/loop24/theme/loop24.json`
- Modify: theme registry / default-theme setting (location depends on pi-tui internals)

- [ ] **Step 1: Create the theme JSON**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
mkdir -p src/resources/extensions/loop24/theme
```

Inspect an existing theme to learn the schema:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
ls packages/pi-coding-agent/src/modes/interactive/theme/
cat packages/pi-coding-agent/src/modes/interactive/theme/themes.ts | head -60
```
Expected: shows the slot names used by pi-tui (e.g., `accent`, `border`, `success`, etc.). Note them — the exact slot names are what `loop24.json` must use.

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/theme/loop24.json`. The structure must match the schema from `themes.ts`. Approximate skeleton (adjust slot names to match the actual schema):
```json
{
  "name": "loop24-signal",
  "displayName": "Loop24 Signal",
  "mode": "dark",
  "colors": {
    "background": "#0C0C0C",
    "foreground": "#FAFAFA",
    "accent": "#FAD22D",
    "secondary": "#4D97ED",
    "tertiary": "#AF78D2",
    "success": "#3FCE8E",
    "warning": "#FF8C0A",
    "error": "#FF5B5B",
    "muted": "#767676",
    "dim": "#A0A0A0"
  }
}
```

**Adjust slot keys to match the actual `theme-schema.ts`** (run `cat packages/pi-coding-agent/src/modes/interactive/theme/theme-schema.ts` to see required keys). If a required slot is missing from the proposal above, pick the closest brand color from `oscar-adminui`'s palette and add it.

- [ ] **Step 2: Register the theme as default**

Open `packages/pi-coding-agent/src/modes/interactive/theme/themes.ts`. Find the array/object listing built-in themes. Add an import for the new theme JSON and include it in the registry. Set it as the default-active theme by editing whatever constant determines the default (commonly `DEFAULT_THEME_NAME` or similar — check the file).

The exact code is determined by reading the file. The change is: import `loop24.json`, add it to the registry, set it as the default.

- [ ] **Step 3: Build and verify**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build
node dist/loader.js
```
Expected: interactive mode launches. The accent color (prompt prefix, command listing) should appear yellow `#FAD22D`. File-path elements should be blue `#4D97ED`. Exit with Ctrl-C.

If the theme doesn't apply, verify the theme JSON validates against `theme-schema.ts` and check the registry registration.

- [ ] **Step 4: Commit**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/theme/loop24.json packages/pi-coding-agent/src/modes/interactive/theme/
git commit -m "feat: Loop24 Signal theme as default

Brand-coloured palette derived from oscar-adminui's customColors:
yellow #FAD22D primary, blue #4D97ED secondary, purple #AF78D2 for
.planning/ artifacts, brand greens/oranges/reds for status."
```

---

## Task 9: Document fork-specific edits in LOOP24-PATCHES.md

**Files:**
- Create: `LOOP24-PATCHES.md` at the repo root

- [ ] **Step 1: Create the patches log**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/LOOP24-PATCHES.md`:
```markdown
# LOOP24 Patches

This document lists every fork-specific edit we made outside of
`src/resources/extensions/loop24/`. The goal is to give future maintainers a
single place to understand "what's different from gsd-pi" without combing
through git log.

We do **not** track upstream gsd-pi. This list is for our own situational
awareness only.

## Phase 0 — Fork & Rebrand (2026-05-23)

### package.json
- Renamed `"name"` to `"@loop24/client"`.
- Added `piConfig.commandNamespace` and `piConfig.brandName`.
- Changed `piConfig.name` to `"loop24"` and `piConfig.configDir` to `".loop24"`.
- Removed `packages/native` from workspaces and any `@opengsd/engine-*` optional dependencies.
- Updated `test:integration` script path from `extensions/gsd/` to `extensions/workflow/`.

### packages/pi-coding-agent/src/config.ts
- Added exported constants `COMMAND_NAMESPACE` and `BRAND_NAME`, read from `piConfig` with sensible fallbacks.

### src/loader.ts
- Replaced the 'Get Shit Done' cyan banner with the LOOP24 block-ASCII banner rendered in `#FAD22D` (24-bit ANSI).
- Set `process.title = 'loop24'`.
- Banner content sourced from `src/resources/extensions/loop24/branding/banner.txt`.
- Set `process.env.LOOP24_FIRST_RUN_BANNER` in addition to the legacy `GSD_FIRST_RUN_BANNER` (the old name is read elsewhere; will be swept in a later cleanup).

### src/help-text.ts (if modified in Task 6 Step 5)
- Replaced "GSD" mentions with `BRAND_NAME` interpolation.

### src/resources/extensions/workflow/ (renamed from extensions/gsd/)
- Directory renamed via `git mv`.
- `commands-bootstrap.ts:273` now registers `COMMAND_NAMESPACE` instead of the literal `"gsd"`.
- Created `strings.ts` exporting `BRAND`, `CMD`, `slashCommand()`, `STATE_DB_NAME`.
- Replaced user-facing "GSD" string literals in prompt/help text files with imports from `strings.ts`.
- Internal references — `customType` strings like `"gsd-add-tests"`, error codes like `"MISSING_GSD_MARKER"`, function names like `registerGSDCommand`, comments — are **not** changed. They are not user-visible. Defer to a later cleanup phase.

### packages/pi-coding-agent/src/modes/interactive/theme/
- Added `loop24-signal` theme (JSON in `src/resources/extensions/loop24/theme/loop24.json`).
- Registered as the default theme.

### Dropped directories (never imported)
- `web/`, `vscode-extension/`, `studio/`, `native/`, `packages/native/`, `gitbook/`, `mintlify-docs/`, gsd-pi's `.plans/`, `.git/`, `node_modules/`, `dist/`.
```

- [ ] **Step 2: Commit**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add LOOP24-PATCHES.md
git commit -m "docs: LOOP24-PATCHES.md log of fork-specific edits"
```

---

## Task 10: End-to-end smoke verification

**Files:** none (verification only)

- [ ] **Step 1: Clean build**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
rm -rf dist node_modules
npm install
npm run build
```
Expected: completes without errors.

- [ ] **Step 2: Run the existing unit tests**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run test:unit
```
Expected: all tests pass. If any tests fail because they assert on hardcoded "gsd" strings that we changed, fix the tests (don't unfix the code). Treat any failure as a Phase 0 regression to investigate before moving on.

- [ ] **Step 3: Verify --version, --help, and absence of "gsd"**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node dist/loader.js --version
node dist/loader.js --help | grep -i 'gsd' && echo "FAIL: 'gsd' still appears in --help" || echo "OK: --help is clean"
```
Expected: version prints; help output has no "gsd" mentions.

- [ ] **Step 4: Launch interactive mode and verify branding**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
rm -rf ~/.loop24
node dist/loader.js
```
Inside the TUI, verify:
- Yellow LOOP24 block banner appears on first launch
- Prompt prefix is yellow
- Typing `/` shows `loop24` as a top-level command (not `gsd`)
- `/loop24` followed by a subcommand routes correctly (try `/loop24 help` or `/loop24 plan`)

Exit with Ctrl-C.

- [ ] **Step 5: Confirm Anthropic still works (no gateway yet)**

If you have a real `ANTHROPIC_API_KEY` set, send a trivial message in interactive mode (e.g., `"hello"`) and verify a model response streams back. This confirms we didn't break the LLM path while doing branding work.

If you do not want to spend tokens, skip this step but flag in commit message that real LLM verification is deferred.

- [ ] **Step 6: Final commit (if any cleanups were needed)**

If Steps 2-5 required fixes, commit them with a descriptive message. If not, no commit needed for this task.

---

## Task 11: Tag the Phase 0 release

**Files:** none (git tag)

- [ ] **Step 1: Tag the Phase 0 milestone**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git tag -a phase-0-fork-and-rebrand -m "Phase 0 complete: LOOP24 forks gsd-pi, renames namespace, applies brand theme and banner. Direct Anthropic LLM path verified."
git log --oneline | head -15
```
Expected: tag created; log shows ~9-10 Phase 0 commits.

---

## Definition of Done

Phase 0 is complete when **all** of these are true:

- `loop24` binary builds and launches via `node dist/loader.js`.
- First-launch banner is the yellow LOOP24 block ASCII (not the gsd-pi cyan banner).
- `process.title` is `"loop24"`.
- `node dist/loader.js --help` output contains no "gsd" or "GSD" string.
- In interactive mode, typing `/` lists `loop24` as the top-level command (not `gsd`).
- `/loop24 <subcommand>` routes to the same handlers `/gsd <subcommand>` previously did.
- `npm run test:unit` passes.
- A direct Anthropic message in interactive mode produces a streamed response (or this step is explicitly deferred for token-budget reasons).
- `LOOP24-PATCHES.md` exists at the repo root and lists every edit made outside `extensions/loop24/`.
- `git tag phase-0-fork-and-rebrand` exists.

---

## Self-review (for the plan author)

**Spec coverage:** Every Phase 0 item in §9 of the design spec is covered by a task in this plan: fork (Tasks 1-2), rebrand piConfig (Task 3), namespace refactor (Tasks 4-5), brand strings (Task 6), banner (Task 7), theme (Task 8), patch log (Task 9), end-to-end verification (Task 10).

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in any task. The two places where the plan says "depends on the file" (Task 5 Step 2 import path, Task 8 Step 2 theme registry) are bounded by a concrete grep/inspect command — the engineer reads the file and writes the answer, no judgment call required.

**Type consistency:** `COMMAND_NAMESPACE` and `BRAND_NAME` are introduced in Task 3 and used identically in Tasks 5, 6, and 7. `slashCommand()` and `BRAND` from `strings.ts` are introduced in Task 6 and not referenced before. `loop24-signal` theme name is consistent between Task 8 Steps 1, 2, and 3.

**One known limitation:** Task 6's identification of "user-facing GSD strings" is judgment-driven (the engineer reads each grep hit and decides if it's user-visible). This is deliberate — exhaustive enumeration is impractical for 1,395 files and the wrong call is recoverable. The patch log in Task 9 captures what was changed so a reviewer can sanity-check.
