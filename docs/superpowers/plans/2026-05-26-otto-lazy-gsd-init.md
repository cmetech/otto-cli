# Otto — Lazy `.gsd` Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make otto boot cleanly from any directory (including `$HOME`) without requiring a `.gsd/` project directory. Add `/gsd init` for explicit project bootstrap. Detection supports both legacy `.gsd/` and future `.otto/workflow/` markers.

**Architecture:** Surgical fix. (1) Make `loadProjectGSDPreferences()` swallow the `assertNotGlobalWorkflowHome` throw and return null. (2) Move RTK opt-in from project-scoped preferences to user-scoped `~/.otto/settings.json`. (3) Add a non-throwing `workflowRootOrNull()` with dual-marker detection. (4) Add `requireProject()` guard used by `/gsd` subcommand handlers that need a project. (5) Reconcile with the existing `/gsd init` subcommand (currently a catalog entry pointing at the workflow's init wizard).

**Tech Stack:** TypeScript 5.9 (strict), Node ≥22, Node test runner (`node --test`), `@loop24/pi-coding-agent` extension API.

**Spec:** `docs/superpowers/specs/2026-05-25-otto-lazy-gsd-init-design.md`

---

## File Structure

**Files modified:**
- `src/cli.ts` (around lines 188-225, function `doRtkBootstrap`) — switch RTK preference source from project to user-scoped settings
- `src/resources/extensions/workflow/paths.ts` — add `workflowRootOrNull()` with dual-marker detection
- `src/resources/extensions/workflow/preferences.ts` — make `loadProjectGSDPreferences()` swallow throws from `workflowRoot()`; add new `loadRtkPreference()` exported from a new module to avoid circular imports
- `src/resources/extensions/workflow/commands/dispatcher.ts` — wire `/gsd init` to call our new `runInit()` (existing init handler will be reconciled)
- 0–N existing handler files under `src/resources/extensions/workflow/commands/handlers/*.ts` — add `requireProject()` guard (one line) to handlers that currently assume `.gsd/` exists. Discover the actual list in Task 7.

**Files created:**
- `src/resources/extensions/workflow/user-settings.ts` — thin reader for `~/.otto/settings.json`. Avoids circular imports because it doesn't depend on paths.ts.
- `src/resources/extensions/workflow/commands/handlers/init.ts` — implements `runInit()`. (Path uses the existing `commands/handlers/` directory naming pattern observed in `commands-handlers.ts` patterns.)
- `src/resources/extensions/workflow/commands/handlers/require-project.ts` — exports `requireProject()` helper.

**Test files created (Node test runner, `*.test.ts`):**
- `src/resources/extensions/workflow/user-settings.test.ts`
- `src/resources/extensions/workflow/paths.workflowRootOrNull.test.ts`
- `src/resources/extensions/workflow/preferences.safe-defaults.test.ts`
- `src/resources/extensions/workflow/commands/handlers/init.test.ts`
- `src/resources/extensions/workflow/commands/handlers/require-project.test.ts`
- `src/tests/integration/boot-without-gsd.test.ts`
- `src/tests/integration/boot-inside-project.test.ts`
- `src/tests/integration/gsd-init-end-to-end.test.ts`

---

## Task 0: Recon — confirm existing `/gsd init` semantics

**Files:**
- Read: `src/resources/extensions/workflow/commands/dispatcher.ts`
- Read: `src/resources/extensions/workflow/commands/catalog.ts` (lines around "init" entry)
- Read: any existing `init` handler file under `src/resources/extensions/workflow/commands/handlers/`

- [ ] **Step 1: Locate existing init handler**

Run:
```bash
cd ~/code/github.com/cmetech/otto_app/otto-cli
grep -rnE '"init"|case "init"|handleInit' src/resources/extensions/workflow/commands/ | head -20
```

Expected: zero or more references. Note the file(s) and line numbers of the current `init` handler (if any), and read it to understand current behavior.

- [ ] **Step 2: Determine reconciliation strategy**

If `/gsd init` currently does a "new-project wizard" or similar that REQUIRES an existing `.gsd/`, our new `runInit()` will REPLACE it for the case where no `.gsd/` exists. The old wizard's logic moves under a different name (e.g. `runProjectWizard()`).

If `/gsd init` does not exist yet as a handler (catalog entry but no dispatch), our `runInit()` is the first implementation — straightforward.

Write a one-paragraph note in the PR description after this task documenting which case applies and the reconciliation chosen.

- [ ] **Step 3: Commit recon notes**

No code changes in this task. Move on to Task 1.

---

## Task 1: Add `~/.otto/settings.json` reader (`user-settings.ts`)

**Files:**
- Create: `src/resources/extensions/workflow/user-settings.ts`
- Test: `src/resources/extensions/workflow/user-settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/resources/extensions/workflow/user-settings.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readUserSetting } from "./user-settings.ts";

function makeFakeHome(contents?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "otto-user-settings-"));
  mkdirSync(join(dir, ".otto"), { recursive: true });
  if (contents !== undefined) {
    writeFileSync(join(dir, ".otto", "settings.json"), contents, "utf-8");
  }
  return dir;
}

test("returns null when ~/.otto/settings.json is missing", () => {
  const home = makeFakeHome();
  try {
    assert.equal(readUserSetting<boolean>("experimental.rtk", { homeOverride: home }), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("returns the value when key is present", () => {
  const home = makeFakeHome(JSON.stringify({ experimental: { rtk: true } }));
  try {
    assert.equal(readUserSetting<boolean>("experimental.rtk", { homeOverride: home }), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("returns null when key path is not present", () => {
  const home = makeFakeHome(JSON.stringify({ defaultProvider: "claude-code" }));
  try {
    assert.equal(readUserSetting<boolean>("experimental.rtk", { homeOverride: home }), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("returns null on malformed JSON (does not throw)", () => {
  const home = makeFakeHome("not json {{");
  try {
    assert.equal(readUserSetting<boolean>("experimental.rtk", { homeOverride: home }), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/workflow/user-settings.test.ts
```

Expected: FAIL — `Cannot find module '.../user-settings.ts'`.

- [ ] **Step 3: Implement `user-settings.ts`**

Create `src/resources/extensions/workflow/user-settings.ts`:

```ts
/**
 * Reader for ~/.otto/settings.json — user-scoped, non-project settings.
 *
 * Never throws. Returns null on missing file, malformed JSON, missing key, or
 * any I/O error. Callers fall back to env vars / project prefs / defaults.
 *
 * The home directory is resolvable via the homeOverride option for tests.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ReadUserSettingOptions {
  /** Override homedir() for tests. */
  homeOverride?: string;
}

export function readUserSetting<T>(
  keyPath: string,
  opts: ReadUserSettingOptions = {},
): T | null {
  const home = opts.homeOverride ?? homedir();
  const file = join(home, ".otto", "settings.json");
  if (!existsSync(file)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }

  const segments = keyPath.split(".");
  let cursor: unknown = parsed;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[segment];
    if (cursor === undefined) return null;
  }
  return cursor as T;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run the same command from Step 2.
Expected: PASS for all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/workflow/user-settings.ts src/resources/extensions/workflow/user-settings.test.ts
git commit -m "feat(workflow): add ~/.otto/settings.json reader for user-scoped prefs"
```

---

## Task 2: Add `workflowRootOrNull()` with dual-marker detection

**Files:**
- Modify: `src/resources/extensions/workflow/paths.ts` (add new export after the existing `workflowRoot()` definition near line 427)
- Test: `src/resources/extensions/workflow/paths.workflowRootOrNull.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/resources/extensions/workflow/paths.workflowRootOrNull.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { workflowRootOrNull, _clearWorkflowRootCache } from "./paths.ts";

function tmpScratch(): string {
  return mkdtempSync(join(tmpdir(), "otto-wf-root-null-"));
}

test("returns null for cwd in $HOME when no .gsd/ or .otto/workflow/ exists", () => {
  _clearWorkflowRootCache();
  const home = homedir();
  // Don't mutate ~/.gsd or ~/.otto/workflow — just assert that detection of
  // a pre-existing project there is opt-in only via real markers.
  // (If the developer's home actually has one of these, this test is skipped.)
  const hasMarker = (() => {
    try {
      const { existsSync } = require("node:fs");
      return existsSync(join(home, ".gsd")) || existsSync(join(home, ".otto", "workflow"));
    } catch { return false; }
  })();
  if (hasMarker) return; // can't meaningfully assert in this env
  assert.equal(workflowRootOrNull(home), null);
});

test("returns null in a fresh tmpdir with no project markers", () => {
  _clearWorkflowRootCache();
  const dir = tmpScratch();
  try {
    assert.equal(workflowRootOrNull(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns path when .gsd/ exists in cwd", () => {
  _clearWorkflowRootCache();
  const dir = tmpScratch();
  mkdirSync(join(dir, ".gsd"), { recursive: true });
  try {
    const result = workflowRootOrNull(dir);
    assert.ok(result, "should return a path, not null");
    assert.match(result, /\.gsd$/, "should end with .gsd");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns path when .otto/workflow/ exists in cwd", () => {
  _clearWorkflowRootCache();
  const dir = tmpScratch();
  mkdirSync(join(dir, ".otto", "workflow"), { recursive: true });
  try {
    const result = workflowRootOrNull(dir);
    assert.ok(result, "should return a path, not null");
    assert.match(result, /\.otto\/workflow$/, "should end with .otto/workflow");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prefers .otto/workflow/ when both exist", () => {
  _clearWorkflowRootCache();
  const dir = tmpScratch();
  mkdirSync(join(dir, ".gsd"), { recursive: true });
  mkdirSync(join(dir, ".otto", "workflow"), { recursive: true });
  try {
    const result = workflowRootOrNull(dir);
    assert.match(result!, /\.otto\/workflow$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("walks past a .otto/ that has only user-config (no workflow/ subdir)", () => {
  _clearWorkflowRootCache();
  const dir = tmpScratch();
  mkdirSync(join(dir, ".otto"), { recursive: true });
  // .otto/ exists but no workflow/ subdir — should still be "no project"
  try {
    assert.equal(workflowRootOrNull(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/workflow/paths.workflowRootOrNull.test.ts
```

Expected: FAIL — `workflowRootOrNull is not a function` or similar import error.

- [ ] **Step 3: Implement `workflowRootOrNull()`**

Open `src/resources/extensions/workflow/paths.ts`. Find the existing `export function workflowRoot(basePath: string): string {` (around line 408). Immediately AFTER its closing brace (around line 427), add this new export:

```ts
/**
 * Like `workflowRoot()` but returns null instead of throwing or falling back to
 * a creation-default path. Use this everywhere a "project may not exist" check
 * is appropriate (boot path, /gsd command guards).
 *
 * Detection order at each ancestor level walked:
 *   1. <dir>/.otto/workflow/    (post-rebrand canonical)
 *   2. <dir>/.gsd/              (legacy)
 *
 * Returns null when no marker is found anywhere in the ancestor walk (bounded
 * by git root if inside a git repo, or by filesystem root otherwise). A
 * directory whose only .otto/ content is user-config (no workflow/ subdir) is
 * NOT treated as a project — the walk continues upward.
 */
export function workflowRootOrNull(basePath: string): string | null {
  // Walk upward from basePath looking for project markers. Stop at git root if
  // present, otherwise at filesystem root. This mirrors workflowRoot's git-
  // anchored behavior but never fabricates a creation-fallback path.
  let cursor: string;
  try {
    cursor = realpathSync.native(basePath);
  } catch {
    cursor = resolve(basePath);
  }

  // Determine the upward boundary (git root or "/")
  let boundary = "/";
  try {
    const out = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: cursor,
      encoding: "utf-8",
    });
    if (out.status === 0) {
      const r = out.stdout.trim();
      if (r) {
        try { boundary = realpathSync.native(r); }
        catch { boundary = resolve(r); }
      }
    }
  } catch { /* git not available — walk to FS root */ }

  // Walk loop
  while (true) {
    const ottoWorkflow = join(cursor, ".otto", "workflow");
    if (existsSync(ottoWorkflow)) return normalizeRealPath(ottoWorkflow);

    const gsd = join(cursor, ".gsd");
    if (existsSync(gsd)) return normalizeRealPath(gsd);

    if (cursor === boundary) return null;
    const parent = dirname(cursor);
    if (parent === cursor) return null; // hit FS root
    cursor = parent;
  }
}
```

Confirm the file already imports `existsSync`, `realpathSync`, `resolve`, `dirname`, `spawnSync`, `join`, and `normalizeRealPath`. If any are missing, add to the existing import statements at the top of `paths.ts`. (Most are already imported; double-check `dirname` and `spawnSync`.)

- [ ] **Step 4: Run tests to verify pass**

Run the same command from Step 2.
Expected: PASS for all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/workflow/paths.ts src/resources/extensions/workflow/paths.workflowRootOrNull.test.ts
git commit -m "feat(workflow): add workflowRootOrNull() with .otto/workflow + .gsd dual-marker detection"
```

---

## Task 3: Make `loadProjectGSDPreferences()` safe (never throws)

**Files:**
- Modify: `src/resources/extensions/workflow/preferences.ts` (lines 117-126 + 179-182)
- Test: `src/resources/extensions/workflow/preferences.safe-defaults.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/resources/extensions/workflow/preferences.safe-defaults.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadProjectGSDPreferences,
  loadEffectiveGSDPreferences,
} from "./preferences.ts";

test("loadProjectGSDPreferences returns null in $HOME without throwing", () => {
  // Reproduces the boot crash scenario: cwd === homedir(), no project .gsd
  const result = loadProjectGSDPreferences(homedir());
  // Must be null, must not throw
  assert.equal(result, null);
});

test("loadProjectGSDPreferences returns null in a fresh tmpdir without throwing", () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-prefs-safe-"));
  try {
    assert.equal(loadProjectGSDPreferences(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadEffectiveGSDPreferences returns null in $HOME without throwing", () => {
  const result = loadEffectiveGSDPreferences(homedir());
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/workflow/preferences.safe-defaults.test.ts
```

Expected: FAIL — at least the first/third tests throw `Refusing to use ~/.gsd as a project .gsd directory`.

- [ ] **Step 3: Wrap the throw in `projectPreferencesPath` callers**

Open `src/resources/extensions/workflow/preferences.ts`. Replace the existing `projectPreferencesPath` function (around lines 117-119) and `loadProjectGSDPreferences` function (around lines 179-182) with these safe variants.

Replace:
```ts
function projectPreferencesPath(basePath: string = process.cwd()): string {
  return join(workflowRoot(basePath), "PREFERENCES.md");
}
```
with:
```ts
function projectPreferencesPath(basePath: string = process.cwd()): string | null {
  // Use workflowRootOrNull so we never throw on $HOME or any dir without a
  // project marker. Returning null tells loadProjectGSDPreferences to skip
  // disk reads entirely.
  const root = workflowRootOrNull(basePath);
  return root === null ? null : join(root, "PREFERENCES.md");
}
```

Replace:
```ts
function legacyProjectPreferencesPathLowercase(basePath: string = process.cwd()): string {
  return join(workflowRoot(basePath), "preferences.md");
}
```
with:
```ts
function legacyProjectPreferencesPathLowercase(basePath: string = process.cwd()): string | null {
  const root = workflowRootOrNull(basePath);
  return root === null ? null : join(root, "preferences.md");
}
```

Update the import line at the top of `preferences.ts` (line 17) to add `workflowRootOrNull`:
```ts
import { workflowRoot, workflowRootOrNull } from "./paths.js";
```

Replace `loadProjectGSDPreferences` (around lines 179-182):
```ts
export function loadProjectGSDPreferences(basePath?: string): LoadedGSDPreferences | null {
  return loadPreferencesFile(projectPreferencesPath(basePath), "project")
    ?? loadPreferencesFile(legacyProjectPreferencesPathLowercase(basePath), "project");
}
```
with:
```ts
export function loadProjectGSDPreferences(basePath?: string): LoadedGSDPreferences | null {
  const primary = projectPreferencesPath(basePath);
  const legacy = legacyProjectPreferencesPathLowercase(basePath);
  // Either path may be null (no project marker found). loadPreferencesFile
  // already null-checks its argument; we just need to be sure to pass null
  // rather than calling join() on a missing root.
  return (primary && loadPreferencesFile(primary, "project"))
    ?? (legacy && loadPreferencesFile(legacy, "project"))
    ?? null;
}
```

Also update the signature of `loadPreferencesFile` (around line 257). Today it is:
```ts
function loadPreferencesFile(path: string, scope: "global" | "project"): LoadedGSDPreferences | null {
```
Change to:
```ts
function loadPreferencesFile(path: string | null, scope: "global" | "project"): LoadedGSDPreferences | null {
  if (!path) return null;
```
The rest of the function body stays the same.

Also update `getProjectGSDPreferencesPath` (around line 137) — it must still return a string for downstream callers that expect one. Use the strict `workflowRoot()` so the legacy behavior is unchanged when callers explicitly ask:
```ts
export function getProjectGSDPreferencesPath(basePath?: string): string {
  // This is the strict variant. Callers like the prefs editor need a path even
  // for new projects. For "may not be a project" detection, use loadProjectGSDPreferences.
  return projectPreferencesPath(basePath) ?? join(workflowRoot(basePath ?? process.cwd()), "PREFERENCES.md");
}
```

- [ ] **Step 4: Run tests to verify pass**

Run the safe-defaults test:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/workflow/preferences.safe-defaults.test.ts
```
Expected: PASS for all 3 tests.

Then run the broader preferences test suite to verify nothing regressed:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test 'src/resources/extensions/workflow/preferences*.test.ts'
```
Expected: PASS for all existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/workflow/preferences.ts src/resources/extensions/workflow/preferences.safe-defaults.test.ts
git commit -m "fix(workflow): loadProjectGSDPreferences returns null instead of throwing outside a project"
```

---

## Task 4: Switch `doRtkBootstrap` to user-scoped RTK preference

**Files:**
- Modify: `src/cli.ts` (lines 188-225, `doRtkBootstrap`)

- [ ] **Step 1: Update the RTK preference lookup**

Open `src/cli.ts`. Find the existing `doRtkBootstrap` function (around line 189). Replace the preference-loading block (currently lines 196-205) with:

```ts
  // RTK is opt-in. Resolution order (highest precedence first):
  //   1. Env var LOOP24_RTK_DISABLED / OTTO_RTK_DISABLED (handled above)
  //   2. ~/.otto/settings.json experimental.rtk
  //   3. Project preferences experimental.rtk (only if cwd is inside a project)
  //   4. Default: disabled
  if (!rtkDisabled) {
    const { readUserSetting } = await import('./resources/extensions/workflow/user-settings.js')
    const userRtk = readUserSetting<boolean>('experimental.rtk')
    let rtkEnabled = userRtk === true

    if (!rtkEnabled) {
      // Fall through to project preferences. This is now safe — preferences.ts
      // returns null instead of throwing when no project .gsd is found.
      const { loadEffectiveGSDPreferences } = await import('./resources/extensions/workflow/preferences.js')
      const prefs = loadEffectiveGSDPreferences()
      rtkEnabled = prefs?.preferences.experimental?.rtk === true
    }

    if (!rtkEnabled) {
      process.env[LOOP24_RTK_DISABLED_ENV] = '1'
      process.env[OTTO_RTK_DISABLED_ENV] = '1'
      rtkDisabled = true
    }
  }
```

- [ ] **Step 2: Build the dist to verify TypeScript compiles**

Run:
```bash
npm run build:core
```
Expected: clean build, no TS errors.

- [ ] **Step 3: Smoke-test from $HOME**

Run:
```bash
cd ~ && node ~/code/github.com/cmetech/otto_app/otto-cli/dist/loader.js --version
```
Expected: prints `1.0.1` (or current version) with exit 0 and no stack trace.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "fix(cli): read RTK opt-in from ~/.otto/settings.json before falling back to project prefs"
```

---

## Task 5: Add `requireProject()` helper

**Files:**
- Create: `src/resources/extensions/workflow/commands/handlers/require-project.ts`
- Test: `src/resources/extensions/workflow/commands/handlers/require-project.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/resources/extensions/workflow/commands/handlers/require-project.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { _clearWorkflowRootCache } from "../../paths.ts";
import { requireProject } from "./require-project.ts";

function makeCtx() {
  const notifications: { message: string; level: string }[] = [];
  return {
    notifications,
    ui: {
      notify(message: string, level: string) { notifications.push({ message, level }); },
    },
  };
}

test("returns null and notifies when cwd is not in a project", () => {
  _clearWorkflowRootCache();
  const dir = mkdtempSync(join(tmpdir(), "otto-req-proj-"));
  const ctx = makeCtx();
  try {
    const result = requireProject(ctx as any, dir);
    assert.equal(result, null);
    assert.equal(ctx.notifications.length, 1);
    assert.match(ctx.notifications[0].message, /No GSD project here/);
    assert.match(ctx.notifications[0].message, /\/gsd init/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns the project root when cwd is inside a .gsd/ project", () => {
  _clearWorkflowRootCache();
  const dir = mkdtempSync(join(tmpdir(), "otto-req-proj-yes-"));
  mkdirSync(join(dir, ".gsd"), { recursive: true });
  const ctx = makeCtx();
  try {
    const result = requireProject(ctx as any, dir);
    assert.ok(result, "should return project path");
    assert.match(result!, /\.gsd$/);
    assert.equal(ctx.notifications.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns null and notifies when cwd is $HOME without a project", () => {
  _clearWorkflowRootCache();
  const ctx = makeCtx();
  const result = requireProject(ctx as any, homedir());
  // If developer's $HOME has a real project marker, skip
  if (result !== null) return;
  assert.equal(result, null);
  assert.equal(ctx.notifications.length, 1);
  assert.match(ctx.notifications[0].message, /No GSD project here/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/workflow/commands/handlers/require-project.test.ts
```
Expected: FAIL — `Cannot find module '.../require-project.ts'`.

- [ ] **Step 3: Implement `requireProject()`**

Create `src/resources/extensions/workflow/commands/handlers/require-project.ts`:

```ts
/**
 * Guard used at the entry of /gsd subcommand handlers that require an
 * initialized project. Returns the project root path, or null after notifying
 * the user that no project is bound and how to fix it.
 *
 * Callers should early-return on null:
 *
 *   export async function handleSomeCommand(ctx) {
 *     const root = requireProject(ctx);
 *     if (!root) return;
 *     // ... use root
 *   }
 */
import { workflowRootOrNull } from "../../paths.js";
import type { ExtensionCommandContext } from "@loop24/pi-coding-agent";

const NO_PROJECT_MESSAGE =
  "No GSD project here. Run /gsd init in a project directory.";

export function requireProject(
  ctx: ExtensionCommandContext,
  basePath: string = process.cwd(),
): string | null {
  const root = workflowRootOrNull(basePath);
  if (root === null) {
    ctx.ui.notify(NO_PROJECT_MESSAGE, "warning");
    return null;
  }
  return root;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run the same command from Step 2.
Expected: PASS for all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/workflow/commands/handlers/require-project.ts src/resources/extensions/workflow/commands/handlers/require-project.test.ts
git commit -m "feat(workflow): add requireProject() guard for /gsd subcommand handlers"
```

---

## Task 6: Implement `/gsd init` handler

**Files:**
- Create: `src/resources/extensions/workflow/commands/handlers/init.ts`
- Test: `src/resources/extensions/workflow/commands/handlers/init.test.ts`
- Modify: `src/resources/extensions/workflow/commands/dispatcher.ts` — wire the handler

- [ ] **Step 1: Write the failing tests**

Create `src/resources/extensions/workflow/commands/handlers/init.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { _clearWorkflowRootCache } from "../../paths.ts";
import { runInit } from "./init.ts";

function makeCtx() {
  const notifications: { message: string; level: string }[] = [];
  return {
    notifications,
    ui: {
      notify(message: string, level: string) { notifications.push({ message, level }); },
    },
  };
}

test("creates .gsd/ in a fresh dir", async () => {
  _clearWorkflowRootCache();
  const dir = mkdtempSync(join(tmpdir(), "otto-init-fresh-"));
  const ctx = makeCtx();
  try {
    await runInit(ctx as any, dir);
    assert.ok(existsSync(join(dir, ".gsd")), ".gsd/ must exist");
    assert.ok(existsSync(join(dir, ".gsd", "manifest.json")), "manifest.json must exist");
    assert.ok(existsSync(join(dir, ".gsd", "STATE.md")), "STATE.md must exist");
    const manifest = JSON.parse(readFileSync(join(dir, ".gsd", "manifest.json"), "utf-8"));
    assert.equal(typeof manifest.version, "string");
    assert.equal(typeof manifest.createdAt, "string");
    assert.equal(typeof manifest.otto, "string");
    assert.ok(ctx.notifications.some(n => /initialized at/i.test(n.message)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses when .gsd/ already exists", async () => {
  _clearWorkflowRootCache();
  const dir = mkdtempSync(join(tmpdir(), "otto-init-existing-"));
  mkdirSync(join(dir, ".gsd"), { recursive: true });
  const ctx = makeCtx();
  try {
    await runInit(ctx as any, dir);
    assert.ok(ctx.notifications.some(n => /already initialized/i.test(n.message)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses when .otto/workflow/ already exists", async () => {
  _clearWorkflowRootCache();
  const dir = mkdtempSync(join(tmpdir(), "otto-init-otto-existing-"));
  mkdirSync(join(dir, ".otto", "workflow"), { recursive: true });
  const ctx = makeCtx();
  try {
    await runInit(ctx as any, dir);
    assert.ok(ctx.notifications.some(n => /already initialized/i.test(n.message)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses when cwd === $HOME (legacy .gsd era safety)", async () => {
  _clearWorkflowRootCache();
  const ctx = makeCtx();
  await runInit(ctx as any, homedir());
  // Either the user actually has ~/.gsd (in which case "already initialized"
  // is the refusal reason) or no marker exists (in which case the $HOME guard
  // fires). Both are acceptable refusals — we only assert "did not create".
  assert.equal(existsSync(join(homedir(), ".gsd", "manifest.json")), false,
    "must not have created ~/.gsd/manifest.json");
  assert.ok(ctx.notifications.some(n => /refus|already|home/i.test(n.message)));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/workflow/commands/handlers/init.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runInit()`**

Create `src/resources/extensions/workflow/commands/handlers/init.ts`:

```ts
/**
 * /gsd init — bootstrap a new GSD project in cwd.
 *
 * Preflight refusals (in order):
 *   1. cwd === $HOME (legacy .gsd era — prevents accidental ~/.gsd creation).
 *      Post-rebrand this becomes a soft confirmation; for now hard refusal.
 *   2. cwd/.gsd or cwd/.otto/workflow already exists — refuse, idempotent.
 *   3. cwd is not writable — refuse with OS error.
 *
 * On success: create cwd/.gsd/, write manifest.json + STATE.md, notify user.
 *
 * Note: this creates `.gsd/` (not `.otto/workflow/`) during the legacy era.
 * When the broader .otto/ rebrand lands, change the directory name here.
 * Detection in workflowRootOrNull already handles both.
 */
import { existsSync, mkdirSync, writeFileSync, accessSync, constants as fsConstants } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { _clearWorkflowRootCache } from "../../paths.js";
import type { ExtensionCommandContext } from "@loop24/pi-coding-agent";

const PROJECT_MARKER_GSD = ".gsd";
const PROJECT_MARKER_OTTO = join(".otto", "workflow");

function normHome(): string {
  return resolve(homedir());
}

function manifestContents(version: string): string {
  return JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    otto: version,
  }, null, 2) + "\n";
}

function stateMdContents(): string {
  return [
    "# Workflow State",
    "",
    "_New project. Run `/gsd new-project` to start your first milestone._",
    "",
  ].join("\n");
}

export async function runInit(
  ctx: ExtensionCommandContext,
  basePath: string = process.cwd(),
): Promise<void> {
  const cwd = resolve(basePath);

  // Preflight 1: refuse $HOME during legacy .gsd era
  if (cwd === normHome()) {
    ctx.ui.notify(
      "Refusing to create .gsd/ in your home directory. cd into a project dir first.",
      "warning",
    );
    return;
  }

  // Preflight 2: refuse if already initialized
  const existingGsd = join(cwd, PROJECT_MARKER_GSD);
  const existingOtto = join(cwd, PROJECT_MARKER_OTTO);
  if (existsSync(existingGsd)) {
    ctx.ui.notify(`Project already initialized at ${existingGsd}. Nothing to do.`, "info");
    return;
  }
  if (existsSync(existingOtto)) {
    ctx.ui.notify(`Project already initialized at ${existingOtto}. Nothing to do.`, "info");
    return;
  }

  // Preflight 3: writability
  try {
    accessSync(cwd, fsConstants.W_OK);
  } catch (err) {
    ctx.ui.notify(
      `Cannot create .gsd/ in ${cwd}: ${(err as Error).message}`,
      "error",
    );
    return;
  }

  // Create the project marker
  const version = process.env.LOOP24_VERSION ?? process.env.OTTO_VERSION ?? "0.0.0";
  const target = existingGsd;

  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "manifest.json"), manifestContents(version), "utf-8");
    writeFileSync(join(target, "STATE.md"), stateMdContents(), "utf-8");
  } catch (err) {
    ctx.ui.notify(
      `Failed to create .gsd/: ${(err as Error).message}`,
      "error",
    );
    return;
  }

  // Invalidate the workflow-root cache so subsequent /gsd commands find the new project.
  _clearWorkflowRootCache();

  ctx.ui.notify(`GSD project initialized at ${target}`, "success");
}
```

- [ ] **Step 4: Run tests to verify pass**

Run the same command from Step 2.
Expected: PASS for all 4 tests.

- [ ] **Step 5: Wire `runInit` into the dispatcher**

From Task 0 recon, you know whether `init` is already a dispatched case. Two scenarios:

**Scenario A — `init` already dispatched to an existing handler:**
Open `src/resources/extensions/workflow/commands/dispatcher.ts`. Find the existing `case "init":` branch. Wrap or replace the call so when no `.gsd/` exists, our new `runInit()` runs; when a `.gsd/` already exists, the existing wizard runs (or both call `runInit` first as a no-op for that case).

Concrete wrapper:
```ts
case "init": {
  const { workflowRootOrNull } = await import("../paths.js");
  const { runInit } = await import("./handlers/init.js");
  if (workflowRootOrNull(process.cwd()) === null) {
    await runInit(ctx);
    return true;
  }
  // Existing path-when-project-exists (e.g. the project wizard).
  // ... existing code unchanged ...
}
```

**Scenario B — `init` is in the catalog but not dispatched yet:**
Open `src/resources/extensions/workflow/commands/dispatcher.ts`. Add a new case in the existing switch:
```ts
case "init": {
  const { runInit } = await import("./handlers/init.js");
  await runInit(ctx);
  return true;
}
```

- [ ] **Step 6: Build dist + manual smoke**

```bash
npm run build:core
cd /tmp && mkdir -p otto-init-smoke && cd otto-init-smoke
node ~/code/github.com/cmetech/otto_app/otto-cli/dist/loader.js --help 2>&1 | head -5
```
Expected: prints help, no crash.

Then exercise init manually inside the otto TUI: `cd /tmp/otto-init-smoke && otto` → type `/gsd init` → confirm `.gsd/` created.

- [ ] **Step 7: Commit**

```bash
git add src/resources/extensions/workflow/commands/handlers/init.ts \
        src/resources/extensions/workflow/commands/handlers/init.test.ts \
        src/resources/extensions/workflow/commands/dispatcher.ts
git commit -m "feat(workflow): /gsd init creates .gsd/ lazily, refuses in \$HOME and on existing project"
```

---

## Task 7: Add `requireProject()` guards to existing `/gsd` handlers

**Files:**
- Modify: every existing handler under `src/resources/extensions/workflow/commands/handlers/` that calls `workflowRoot()` or `loadEffectiveGSDPreferences()` or otherwise assumes a project exists.

- [ ] **Step 1: Identify handlers needing the guard**

Run:
```bash
cd ~/code/github.com/cmetech/otto_app/otto-cli
grep -rnE 'workflowRoot\(|workflowRoot\b' src/resources/extensions/workflow/commands/handlers/ | grep -v '\.test\.ts' | head -30
```

Expected: list of files and lines. For each unique file, note whether its top-level handler entry expects a project to be present. Skip files where workflowRoot is called inside a "already-known-to-have-project" code path.

If the recon shows that handlers don't directly call `workflowRoot` (they call into helpers that do), then add the guard at the dispatcher level instead — but ONLY for subcommands that semantically require a project. The `help`, `changelog`, `update`, `upgrade`, `keys`, and similar subcommands should NOT be gated.

- [ ] **Step 2: Add the guard to project-requiring subcommand dispatch**

Recommended approach: gate at the dispatcher level rather than amending each handler. Open `src/resources/extensions/workflow/commands/dispatcher.ts`. Identify the set of subcommands that require a project (likely: `next`, `auto`, `stop`, `pause`, `status`, `discuss`, `dispatch`, `history`, `undo`, `verdict`, `parallel`, `worktree`, `closeout`, `cleanup`, `new-milestone`, `new-project`, `quick`, `backlog`, `report`, `export`, `do`, `inspect`, `rate`, `skip`, `migrate`, `session-report`, `pr-branch`, `add-tests`, `eval-review`, `scan`, `mode`, `prefs`).

Add a single guard near the top of the dispatch function, after parsing the subcommand but before the switch:

```ts
// Subcommands that require an initialized project. Everything else (help,
// init, changelog, update, etc.) runs without one.
const REQUIRES_PROJECT = new Set([
  "next", "auto", "stop", "pause", "status", "discuss", "dispatch", "history",
  "undo", "undo-task", "reset-slice", "verdict", "parallel", "worktree",
  "closeout", "cleanup", "new-milestone", "new-project", "quick", "backlog",
  "report", "export", "do", "inspect", "rate", "skip", "migrate",
  "session-report", "pr-branch", "add-tests", "eval-review", "scan",
  "mode", "prefs", "visualize", "widget", "brief", "queue", "triage",
  "capture", "knowledge", "park", "unpark", "ship", "language", "rethink",
  "codebase", "fast", "mcp", "logs", "debug", "forensics", "hooks", "run-hook",
  "skill-health", "notifications", "doctor", "workflow", "steer",
]);

if (REQUIRES_PROJECT.has(subcommand)) {
  const { requireProject } = await import("./handlers/require-project.js");
  if (requireProject(ctx) === null) return true;
}
```

Adjust the set based on what your repo actually dispatches today. The principle: anything that reads/writes `.gsd/` artifacts is in the set; anything purely meta (help, init, changelog, update, key management) is not.

- [ ] **Step 3: Build and manual-smoke**

```bash
npm run build:core
cd ~ && node ~/code/github.com/cmetech/otto_app/otto-cli/dist/loader.js --help 2>&1 | head -3
```
Expected: no crash.

Then exercise inside otto from `$HOME`: type a project-requiring subcommand like `/gsd status` → expect the "No GSD project here" message, not a stack trace.

- [ ] **Step 4: Run the existing dispatcher test suite to catch regressions**

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test 'src/resources/extensions/workflow/commands/**/*.test.ts'
```
Expected: PASS. If any pre-existing tests now fail because they invoke a project-requiring subcommand without setting up `.gsd/` in their fixture, update those tests to create a fixture `.gsd/`.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/workflow/commands/dispatcher.ts
git commit -m "feat(workflow): guard project-requiring /gsd subcommands behind requireProject()"
```

---

## Task 8: Integration test — boot from `$HOME`

**Files:**
- Test: `src/tests/integration/boot-without-gsd.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/integration/boot-without-gsd.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";

const projectRoot = process.cwd();
const loader = join(projectRoot, "dist", "loader.js");

if (!existsSync(loader)) {
  throw new Error("dist/loader.js not found — run: npm run build");
}

function spawnOtto(cwd: string) {
  return spawnSync(process.execPath, [loader, "--version"], {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
  });
}

test("otto --version exits 0 when run from $HOME", () => {
  const result = spawnOtto(homedir());
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr: ${result.stderr}`);
  assert.doesNotMatch(result.stderr ?? "", /Refusing to use|Run GSD from inside a project/);
});

test("otto --version exits 0 when run from a fresh tmpdir", () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-boot-tmp-"));
  try {
    const result = spawnOtto(dir);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("running otto from $HOME does not create a .gsd directory anywhere it shouldn't", () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-boot-no-gsd-"));
  try {
    spawnOtto(dir);
    assert.equal(existsSync(join(dir, ".gsd")), false, "must not have created .gsd/ in cwd");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the integration test**

```bash
npm run build:core
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/integration/boot-without-gsd.test.ts
```
Expected: PASS for all 3 tests.

- [ ] **Step 3: Commit**

```bash
git add src/tests/integration/boot-without-gsd.test.ts
git commit -m "test(integration): otto boots cleanly from \$HOME and fresh tmpdirs"
```

---

## Task 9: Integration test — `/gsd init` end-to-end + boot inside project

**Files:**
- Test: `src/tests/integration/gsd-init-end-to-end.test.ts`
- Test: `src/tests/integration/boot-inside-project.test.ts`

- [ ] **Step 1: Write the e2e init test**

Create `src/tests/integration/gsd-init-end-to-end.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _clearWorkflowRootCache } from "../../resources/extensions/workflow/paths.ts";
import { runInit } from "../../resources/extensions/workflow/commands/handlers/init.ts";

// Lighter than spawning the binary: invoke runInit directly with a fake ctx.
// Boot integration is covered by boot-without-gsd / boot-inside-project tests.
function makeCtx() {
  const notifications: { message: string; level: string }[] = [];
  return {
    notifications,
    ui: { notify(message: string, level: string) { notifications.push({ message, level }); } },
  };
}

test("end-to-end: runInit in a fresh dir produces a valid project", async () => {
  _clearWorkflowRootCache();
  const dir = mkdtempSync(join(tmpdir(), "otto-init-e2e-"));
  const ctx = makeCtx();
  try {
    await runInit(ctx as any, dir);
    assert.ok(existsSync(join(dir, ".gsd")));
    const manifest = JSON.parse(readFileSync(join(dir, ".gsd", "manifest.json"), "utf-8"));
    assert.equal(manifest.version, 1);
    assert.ok(manifest.createdAt);
    assert.ok(manifest.otto);
    assert.equal(typeof readFileSync(join(dir, ".gsd", "STATE.md"), "utf-8"), "string");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Write the boot-inside-project regression test**

Create `src/tests/integration/boot-inside-project.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = process.cwd();
const loader = join(projectRoot, "dist", "loader.js");

if (!existsSync(loader)) {
  throw new Error("dist/loader.js not found — run: npm run build");
}

test("otto --version exits 0 when run inside an existing .gsd/ project", () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-boot-in-project-"));
  mkdirSync(join(dir, ".gsd"), { recursive: true });
  writeFileSync(join(dir, ".gsd", "manifest.json"),
    JSON.stringify({ version: 1, createdAt: new Date().toISOString(), otto: "test" }), "utf-8");
  try {
    const result = spawnSync(process.execPath, [loader, "--version"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("otto --version exits 0 when run inside an .otto/workflow/ project (forward-compat)", () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-boot-in-otto-project-"));
  mkdirSync(join(dir, ".otto", "workflow"), { recursive: true });
  writeFileSync(join(dir, ".otto", "workflow", "manifest.json"),
    JSON.stringify({ version: 1, createdAt: new Date().toISOString(), otto: "test" }), "utf-8");
  try {
    const result = spawnSync(process.execPath, [loader, "--version"], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 30_000,
    });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}; stderr: ${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run both tests**

```bash
npm run build:core
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test 'src/tests/integration/gsd-init-end-to-end.test.ts' 'src/tests/integration/boot-inside-project.test.ts'
```
Expected: PASS for all tests.

- [ ] **Step 4: Commit**

```bash
git add src/tests/integration/gsd-init-end-to-end.test.ts src/tests/integration/boot-inside-project.test.ts
git commit -m "test(integration): /gsd init e2e + boot inside .gsd and .otto/workflow projects"
```

---

## Task 10: Full verification — type-check, all tests, manual smoke

- [ ] **Step 1: Full type-check**

```bash
cd ~/code/github.com/cmetech/otto_app/otto-cli
npm run typecheck:extensions
```
Expected: zero errors.

- [ ] **Step 2: Run all unit tests**

```bash
npm run test:unit
```
Expected: all pre-existing tests still pass; all new tests pass.

- [ ] **Step 3: Run integration tests**

```bash
npm run test:integration
```
Expected: PASS for all integration tests including the 3 we added.

- [ ] **Step 4: Manual smoke checklist**

Run each of these manually and confirm the expected outcome:

| # | Command | Expected |
|---|---|---|
| 1 | `cd ~ && otto --version` | prints `1.0.1` (or current) and exits 0; no stack trace |
| 2 | `cd /tmp && otto --version` | same |
| 3 | `cd ~/code/github.com/cmetech/otto_app/otto-cli && otto --version` | same; project auto-detected |
| 4 | `mkdir -p /tmp/otto-scratch && cd /tmp/otto-scratch && otto` then `/gsd init` | `.gsd/` created at `/tmp/otto-scratch/.gsd/` |
| 5 | `cd ~ && otto` then `/gsd init` | refuses with "Refusing to create .gsd/ in your home directory" |
| 6 | `cd /tmp/otto-scratch && otto` then `/gsd status` | works (project bound) |
| 7 | `cd /tmp && otto` then `/gsd status` | prints "No GSD project here. Run /gsd init in a project directory." |

- [ ] **Step 5: Final commit (if any docs need updating)**

If any user-facing docs (`README.md`, `docs/INSTALL.md`) reference "must be inside a project directory" or similar, update them to reflect the new behavior. Commit:

```bash
git add <updated docs>
git commit -m "docs: otto now boots from any directory; /gsd init creates new projects"
```

If no docs need updating, skip this step.

---

## Self-Review Notes (filled out by author)

**Spec coverage:**
- Spec §3 goal "Otto boots cleanly from any directory" → Tasks 3, 4, 8.
- Spec §3 goal "/gsd init is the single, explicit user gesture" → Tasks 6, 9.
- Spec §3 goal "Workflow features remain unchanged for users in existing .gsd projects" → Task 7 (guard set excludes meta commands), Task 9 (regression test).
- Spec §3 goal "RTK opt-in moves to a user-scoped setting" → Tasks 1, 4.
- Spec §3 goal "Project detection supports both .gsd/ and .otto/workflow/" → Task 2.
- Spec §3 goal "`~/.otto/` can hold user config AND project workflow side-by-side" → Task 2 (walks past `.otto/` without `workflow/` subdir); Task 9 (boot-inside-`.otto/workflow/` integration test).
- Spec §7 error handling → Tasks 5, 6 (preflight refusals + standard message format).
- Spec §9.1 forward-compat → Task 6 documents the single call-site change required for the future rebrand.

**Type consistency check:**
- `workflowRootOrNull(basePath: string): string | null` — used identically in Tasks 2, 3, 5, 6, 7. ✓
- `requireProject(ctx, basePath?)` — defined Task 5, called Task 7. ✓
- `runInit(ctx, basePath?)` — defined Task 6, dispatched in same task. ✓
- `readUserSetting<T>(keyPath, opts)` — defined Task 1, called Task 4. ✓

**Placeholder scan:** no TBDs, no "implement later", no "similar to Task N", no vague error handling. All commands are concrete and copy-pasteable.

**Open risks:**
- Task 7's `REQUIRES_PROJECT` set is best-effort; the actual list depends on what the repo's `dispatcher.ts` switches over. The recon in Task 0 + Step 1 of Task 7 must produce the real list. If a subcommand is mis-classified, the worst case is either a no-op refusal (false positive) or a stack trace (false negative). Both are recoverable.
- Task 6's dispatcher wiring (Scenario A vs B) depends on Task 0 recon. The plan covers both.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-26-otto-lazy-gsd-init.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
