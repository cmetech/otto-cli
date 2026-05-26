# LOOP24 Phase 2c — GSD Residue Sweep + Registration Diagnostic

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sweep remaining hardcoded "GSD" / "Get Shit Done" / "~/.gsd/agent/extensions/gsd/" residue out of user-visible surfaces AND add a debug toggle so we can verify what slash commands actually register at TUI startup.

**Why:** The user reports `/gsd` appearing in the TUI autocomplete (but failing to dispatch) and `/loop24` not appearing. The compiled code's `pi.registerCommand(COMMAND_NAMESPACE, ...)` correctly resolves COMMAND_NAMESPACE to `"loop24"` in every test I can run from outside the process. Either there's a code path still registering the literal `"gsd"` that I'm not finding, or the user's TUI is running stale state. A small diagnostic toggle will let us see what's actually happening live. While we're in there, sweep the visible residue (footer "GSD" text, "GSD Project Initialized" greeting, extension manifest `commands` array, exit/kill command descriptions, hardcoded `~/.gsd/agent/extensions/gsd/` paths in workflow modules and `bundled-resource-path.ts`).

**Architecture:** Two parallel workstreams in one phase:
1. **Mechanical sweep** — find/replace literal `"GSD"` / `"gsd"` / `extensions/gsd` strings in user-visible spots; replace with `BRAND_NAME` / `COMMAND_NAMESPACE` / `extensions/workflow`. Mirrors what Phase 0.5 did for the workflow extension, extends to the residue files Phase 0.5 deferred plus a few new ones surfaced during Phase 2b debugging.
2. **Diagnostic toggle** — when `LOOP24_DEBUG_EXTENSIONS=1` is set, the extension loader emits one stderr line per `pi.registerCommand` call: `[loop24-debug] registered command 'X' from <extension-path>`. Lets the user verify directly what's actually being registered in their TUI.

**Tech Stack:** TypeScript (same TS-strip-types constraints as Phase 2b). No new dependencies. Edits land in `packages/pi-coding-agent/src/core/extensions/loader.ts` and various workflow files.

**Scope boundary:**

In scope:
- `src/resources/extensions/workflow/extension-manifest.json` — `provides.commands: ["gsd", ...]` → `["loop24", ...]`. This is the autocomplete-facing declaration. (Verify after change that it doesn't break manifest parsing.)
- Display-string residue:
  - `src/resources/extensions/workflow/health-widget-core.ts:73` — `"  GSD  Project Initialized"`
  - `src/resources/extensions/workflow/init-wizard.ts:421` — `"GSD — Already Initialized"`
  - `src/resources/extensions/workflow/exit-command.ts` — `"Exit GSD gracefully"` / `"Exit GSD immediately (no cleanup)"`
  - `src/resources/extensions/workflow/commands/catalog.ts` — `OTTO_COMMAND_DESCRIPTION` content `"GSD — Get Shit Done: ..."`
- Hardcoded `~/.gsd/agent/extensions/gsd/` paths:
  - `src/resources/extensions/workflow/prompt-loader.ts:67`
  - `src/resources/extensions/workflow/workflow-plugins.ts:61`
  - `src/resources/extensions/workflow/forensics.ts:248`
  - `src/resources/extensions/workflow/workflow-templates.ts:24`
  - `src/bundled-resource-path.ts:53` — `extensions/gsd/` → `extensions/workflow/` (literal path in `resolveBundledGsdExtensionModule`)
  - `src/bundled-resource-path.ts:59` — same path in the function's src fallback
- Phase 0.5 residue files (each needs templating):
  - `src/resources/extensions/workflow/auto.ts` — `/gsd next`, `/gsd auto`, etc. in `commands:` arrays
  - `src/resources/extensions/workflow/state.ts` — `/gsd status`, `/gsd validate-milestone`, `/gsd verdict pass`, `/gsd park`, `/gsd auto` remediation strings
  - `src/resources/extensions/workflow/auto-verification.ts` — verdict-override hint
  - `src/resources/extensions/workflow/auto-dispatch.ts` — milestone-completion blocker reason
  - `src/resources/extensions/workflow/undo.ts` — `sendDesktopNotification("GSD", ...)`
  - `src/resources/extensions/workflow/commands-handlers.ts` — `GSD-WORKFLOW.md` filename + doctor titles
  - `src/resources/extensions/workflow/commands-workflow-templates.ts` — start/init guidance
  - `src/resources/extensions/workflow/commands-codebase.ts` — `"GSD also refreshes CODEBASE.md…"`
  - `src/resources/extensions/workflow/dev-workflow-engine.ts` — `engineLabel: "GSD Dev"`
  - `src/resources/extensions/workflow/doctor-format.ts` — `"GSD doctor found blocking issues."` titles
  - `src/resources/extensions/workflow/commands-inspect.ts` — `"/gsd inspect failed: …"`
- Debug toggle:
  - `packages/pi-coding-agent/src/core/extensions/loader.ts` — wrap `extension.commands.set(name, ...)` to emit a stderr line when `process.env.LOOP24_DEBUG_EXTENSIONS` is truthy
- Update LOOP24-PATCHES.md with a Phase 2c section
- Existing 93 tests still pass + add one new test for the debug toggle (capture stderr, set env var, run a fake extension load, assert log line appears)

Out of scope (deferred, document in LOOP24-PATCHES.md but don't touch):
- `mcp-client/manager.ts:349` etc. — MCP client identifier `name: "gsd"` is sent to MCP servers as our client name; changing it would re-handshake against any servers tracking us by that name. Internal identifier, not user-visible. Leave for a coordinated change later.
- Internal type names (`GSDState`, `GSDConfig`, function names like `registerGSDCommand`) — per Phase 0 Known Deferred Cleanup item 7. Massive refactor for zero user-visible impact.
- `~/.gsd/crash/` log directory in `crash-log.ts` — affects only forensic dumps after an extension crash. Internal; can move when something else triggers a sweep.
- `commands-extensions.ts` "MISSING_OTTO_MARKER" — internal error code for third-party extension `package.json` validation. Not user-facing in the failure path most users hit.
- `PROTECTED_EXTENSION_COMMANDS = new Set(["gsd"])` in `packages/pi-coding-agent/src/core/extensions/runner.ts:119` — this protects the literal name `"gsd"` from being hijacked. After our rename, NOTHING registers the literal `"gsd"` anymore, so the protection list is effectively dead. Tempting to remove or rename, but it doesn't affect runtime correctness and removing it is the kind of change that could break some sibling tool's expectations. Leave for now.

**Dependencies:**
- Requires Phases 0, 0.5, 1, 2b, 2b.1, 3 complete (current state at tag `phase-2b.1-unified-config`).
- The debug toggle requires the pi-coding-agent workspace package to be rebuildable — straightforward, no new deps.

---

## File Structure

### Modified files

```
packages/pi-coding-agent/src/core/extensions/loader.ts
                                  # Add LOOP24_DEBUG_EXTENSIONS env-var-gated log
                                  # inside the registerCommand closure (one extra
                                  # `if (process.env...) process.stderr.write(...)` line).

src/bundled-resource-path.ts      # Two `extensions/gsd/` literals → `extensions/workflow/`

src/resources/extensions/workflow/
├── extension-manifest.json       # provides.commands array updated
├── health-widget-core.ts         # "GSD Project Initialized" → BRAND_NAME
├── init-wizard.ts                # "GSD — Already Initialized" → BRAND_NAME
├── exit-command.ts               # descriptions → BRAND_NAME
├── commands/catalog.ts           # OTTO_COMMAND_DESCRIPTION content → BRAND_NAME + slashCommand
├── prompt-loader.ts              # path string
├── workflow-plugins.ts           # path string
├── forensics.ts                  # path string
├── workflow-templates.ts         # path string
├── auto.ts                       # commands: arrays + comment
├── state.ts                      # remediation guidance strings
├── auto-verification.ts          # verdict-override hint
├── auto-dispatch.ts              # blocker reason
├── undo.ts                       # sendDesktopNotification title
├── commands-handlers.ts          # doctor/audit titles + filename
├── commands-workflow-templates.ts # start/init guidance
├── commands-codebase.ts          # description string
├── dev-workflow-engine.ts        # engineLabel
├── doctor-format.ts              # doctor titles
└── commands-inspect.ts           # warning prefix

LOOP24-PATCHES.md                 # Phase 2c section appended
```

### New files

```
packages/pi-coding-agent/src/core/extensions/loader.debug.test.ts
                                  # One test for the LOOP24_DEBUG_EXTENSIONS toggle.
```

---

## Task 1: Add the LOOP24_DEBUG_EXTENSIONS toggle (TDD)

**Files:**
- Modify: `packages/pi-coding-agent/src/core/extensions/loader.ts`
- Create: `packages/pi-coding-agent/src/core/extensions/loader.debug.test.ts`

The toggle gives us a way to verify what the live TUI actually registers. It also gives the user a self-service diagnostic when something looks off.

- [ ] **Step 1: Locate `registerCommand` in `loader.ts`**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -n "registerCommand(name: string" packages/pi-coding-agent/src/core/extensions/loader.ts
```
Expected: a line around 476 showing `registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void {`.

- [ ] **Step 2: Write the test**

Create `packages/pi-coding-agent/src/core/extensions/loader.debug.test.ts`:

```typescript
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"

const ORIGINAL_ENV = process.env.LOOP24_DEBUG_EXTENSIONS
const ORIGINAL_STDERR_WRITE = process.stderr.write.bind(process.stderr)

let captured: string[] = []

beforeEach(() => {
  captured = []
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"))
    return true
  }) as typeof process.stderr.write
})

afterEach(() => {
  process.stderr.write = ORIGINAL_STDERR_WRITE
  if (ORIGINAL_ENV === undefined) delete process.env.LOOP24_DEBUG_EXTENSIONS
  else process.env.LOOP24_DEBUG_EXTENSIONS = ORIGINAL_ENV
})

test("LOOP24_DEBUG_EXTENSIONS=1 emits a registration line per pi.registerCommand call", async () => {
  process.env.LOOP24_DEBUG_EXTENSIONS = "1"

  // Import the loader fresh (after env var is set). Use a dynamic import to
  // get a clean reference and call createExtensionAPI directly.
  const loaderModule = await import("./loader.js")
  // We exercise this by constructing an extension + api the same way loadExtension does.
  // The loader doesn't export createExtensionAPI by default — see Step 3 for the export.
  const { createExtensionAPI, createExtension } = loaderModule as unknown as {
    createExtensionAPI: (ext: unknown, runtime: unknown, cwd: string, eventBus: unknown) => { registerCommand: (n: string, o: { handler: () => void }) => void }
    createExtension: (path: string, resolved: string) => unknown
  }

  const fakeRuntime = {
    refreshTools: () => {},
    pendingProviderRegistrations: [],
  }
  const fakeEventBus = { emit: () => {}, on: () => {} }
  const extension = createExtension("/fake/ext.js", "/fake/ext.js")
  const api = createExtensionAPI(extension, fakeRuntime, "/tmp", fakeEventBus)

  api.registerCommand("loop24", { handler: () => {} })

  const text = captured.join("")
  assert.match(text, /\[loop24-debug\] registered command 'loop24'/)
  assert.match(text, /\/fake\/ext\.js/)
})

test("LOOP24_DEBUG_EXTENSIONS unset → no debug output", async () => {
  delete process.env.LOOP24_DEBUG_EXTENSIONS

  const loaderModule = await import("./loader.js")
  const { createExtensionAPI, createExtension } = loaderModule as unknown as {
    createExtensionAPI: (ext: unknown, runtime: unknown, cwd: string, eventBus: unknown) => { registerCommand: (n: string, o: { handler: () => void }) => void }
    createExtension: (path: string, resolved: string) => unknown
  }
  const fakeRuntime = { refreshTools: () => {}, pendingProviderRegistrations: [] }
  const fakeEventBus = { emit: () => {}, on: () => {} }
  const extension = createExtension("/fake/ext2.js", "/fake/ext2.js")
  const api = createExtensionAPI(extension, fakeRuntime, "/tmp", fakeEventBus)

  api.registerCommand("test", { handler: () => {} })

  const text = captured.join("")
  assert.equal(text, "", "no debug output should appear when env var is unset")
})
```

Note: `createExtensionAPI` and `createExtension` are currently NOT exported from `loader.ts`. Step 3 exports them.

- [ ] **Step 3: Export the two helpers + add the debug log**

Edit `packages/pi-coding-agent/src/core/extensions/loader.ts`:

a) Find `function createExtensionAPI(` and `function createExtension(` — both are top-level helpers in the file. Add `export` to each:

```typescript
export function createExtensionAPI(...) { ... }
export function createExtension(...) { ... }
```

b) Find the `registerCommand` closure (around line 476):

```typescript
registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void {
    extension.commands.set(name, { name, ...options });
},
```

Replace with:

```typescript
registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void {
    extension.commands.set(name, { name, ...options });
    if (process.env.LOOP24_DEBUG_EXTENSIONS) {
        process.stderr.write(`[loop24-debug] registered command '${name}' from ${extension.path}\n`);
    }
},
```

- [ ] **Step 4: Run the test**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test packages/pi-coding-agent/src/core/extensions/loader.debug.test.ts 2>&1 | tail -10
```
Expected: 2/2 pass.

- [ ] **Step 5: Live smoke**

```bash
cd /tmp
LOOP24_DEBUG_EXTENSIONS=1 perl -e 'alarm 6; exec @ARGV' loop24 --print "hi" 2>&1 | grep "\[loop24-debug\]" | head -20
```
Expected: a series of lines listing every `registerCommand` call from every loaded extension. Most usefully: a line like `[loop24-debug] registered command 'loop24' from /Users/coreyellis/.loop24/agent/extensions/workflow/index.js`.

If you instead see `[loop24-debug] registered command 'gsd' from ...workflow...`, then COMMAND_NAMESPACE is somehow resolving to `"gsd"` in the live process — which would be a real bug in the piConfig resolution. If you see `'loop24'` registered but the TUI still says "Unknown", the bug is in the TUI's command lookup path, not registration.

- [ ] **Step 6: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add packages/pi-coding-agent/src/core/extensions/loader.ts \
        packages/pi-coding-agent/src/core/extensions/loader.debug.test.ts
git commit -m "feat(loader): LOOP24_DEBUG_EXTENSIONS env-var-gated diagnostic

When LOOP24_DEBUG_EXTENSIONS is set (truthy), the extension loader's
pi.registerCommand closure emits one stderr line per registration:
  [loop24-debug] registered command 'NAME' from /path/to/extension

Used to verify in-process what commands actually get registered in a
running TUI — needed for diagnosing 'Unknown command /loop24' reports
where the static analysis suggests registration should succeed but the
live process disagrees.

Exports createExtensionAPI + createExtension so unit tests can exercise
the closure directly. Two tests cover the toggle on/off paths."
```

---

## Task 2: Sweep the user-visible "GSD" strings

**Files:**
- Modify: `src/resources/extensions/workflow/health-widget-core.ts`
- Modify: `src/resources/extensions/workflow/init-wizard.ts`
- Modify: `src/resources/extensions/workflow/exit-command.ts`
- Modify: `src/resources/extensions/workflow/commands/catalog.ts`

Each file has one or two literal "GSD" / "Get Shit Done" strings that show up in the TUI. Replace with `BRAND_NAME` from `strings.ts` (or import from `@gsd/pi-coding-agent`).

- [ ] **Step 1: Inspect current strings**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -n '"GSD\|"Get Shit Done"' src/resources/extensions/workflow/health-widget-core.ts \
   src/resources/extensions/workflow/init-wizard.ts \
   src/resources/extensions/workflow/exit-command.ts \
   src/resources/extensions/workflow/commands/catalog.ts
```

- [ ] **Step 2: Update `health-widget-core.ts`**

Find `return ["  GSD  Project Initialized"];` (around line 73). Look for the existing `BRAND` import from `./strings.js`. If absent, add it:

```typescript
import { BRAND } from "./strings.js"  // OR adjust path if catalog is in commands/
```

Then change the return to:
```typescript
return [`  ${BRAND}  Project Initialized`];
```

- [ ] **Step 3: Update `init-wizard.ts`**

Find `title: "GSD — Already Initialized",` (around line 421). Replace with:
```typescript
title: `${BRAND} — Already Initialized`,
```

Ensure `BRAND` is imported from `./strings.js` at the top.

- [ ] **Step 4: Update `exit-command.ts`**

This is the entry that produces `/exit` and `/kill`. Find the descriptions:

```typescript
description: "Exit GSD gracefully",   // /exit
description: "Exit GSD immediately (no cleanup)",  // /kill
```

Replace with:
```typescript
description: `Exit ${BRAND} gracefully`,
description: `Exit ${BRAND} immediately (no cleanup)`,
```

Add `import { BRAND } from "./strings.js"` if not present.

- [ ] **Step 5: Update `commands/catalog.ts`**

Find the `OTTO_COMMAND_DESCRIPTION` export. It currently reads something like:
```typescript
export const OTTO_COMMAND_DESCRIPTION = "GSD — Get Shit Done: /gsd help|start|templates|next|auto|status|..."
```

Replace with templated form (path to strings.js is `../strings.js` from inside `commands/`):
```typescript
import { BRAND, slashCommand } from "../strings.js"

export const OTTO_COMMAND_DESCRIPTION = `${BRAND} workflow: ${slashCommand("help")}|${slashCommand("start")}|${slashCommand("templates")}|${slashCommand("next")}|${slashCommand("auto")}|${slashCommand("status")}|...`
```

Keep the same subcommand list — only the prose changes. Drop "Get Shit Done" (the LOOP24 brand is not the GSD brand).

- [ ] **Step 6: Build + verify**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | grep -E "(error|fail)" | head -3 || echo "build clean"
# Verify the strings updated in compiled output
grep -n "Project Initialized" dist/resources/extensions/workflow/health-widget-core.js
grep -n "Exit.*gracefully" dist/resources/extensions/workflow/exit-command.js
```
Expected: build clean, compiled output shows `LOOP24` (or the BRAND value) where `GSD` used to be.

- [ ] **Step 7: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/workflow/health-widget-core.ts \
        src/resources/extensions/workflow/init-wizard.ts \
        src/resources/extensions/workflow/exit-command.ts \
        src/resources/extensions/workflow/commands/catalog.ts
git commit -m "refactor(workflow): user-visible GSD strings → BRAND template

Four files where 'GSD' / 'Get Shit Done' was still literal in
user-visible surfaces:
- health-widget-core.ts: 'GSD Project Initialized' → \`\${BRAND} Project Initialized\`
- init-wizard.ts: title 'GSD — Already Initialized' → \`\${BRAND} — Already Initialized\`
- exit-command.ts: /exit + /kill descriptions
- commands/catalog.ts: OTTO_COMMAND_DESCRIPTION drops 'Get Shit Done',
  templates the slash-command prefix via slashCommand() helper

The internal constant name OTTO_COMMAND_DESCRIPTION is kept (per Phase 0
Known Deferred Cleanups item 7 — internal identifiers stay)."
```

---

## Task 3: Manifest `provides.commands` array

**Files:**
- Modify: `src/resources/extensions/workflow/extension-manifest.json`

The manifest declares which commands the extension provides. It still says `["gsd", ...]`. The runtime registration uses COMMAND_NAMESPACE (resolves to `"loop24"`), so there's a mismatch between declared and actual. Some autocomplete / discovery layers may key off the manifest.

- [ ] **Step 1: Update the manifest**

Edit `src/resources/extensions/workflow/extension-manifest.json`. Change:
```json
"commands": ["gsd", "kill", "worktree", "exit"],
```
to:
```json
"commands": ["loop24", "kill", "worktree", "exit"],
```

Keep `"id": "gsd"` unchanged — that's the extension's identity, used by the registry to track enable/disable state across upgrades. Renaming the id would break the existing enable record.

- [ ] **Step 2: Build + verify**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
diff <(cat src/resources/extensions/workflow/extension-manifest.json) <(cat dist/resources/extensions/workflow/extension-manifest.json)
```
Expected: build clean, diff is empty (the manifest is copied verbatim during `copy-resources`).

- [ ] **Step 3: Wipe agent dir so the next launch resyncs**

```bash
rm -rf ~/.loop24/agent
node dist/loader.js --version  # triggers resync
grep -n "commands" ~/.loop24/agent/extensions/workflow/extension-manifest.json
```
Expected: synced manifest's `commands` now reads `["loop24", "kill", "worktree", "exit"]`.

- [ ] **Step 4: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/workflow/extension-manifest.json
git commit -m "refactor(workflow): extension manifest 'commands' lists loop24 not gsd

The runtime pi.registerCommand call uses COMMAND_NAMESPACE (resolves to
'loop24'); the manifest's provides.commands array was still ['gsd', ...].
Align them so any autocomplete/discovery layer that keys off the manifest
sees the same name the runtime registers.

The extension id 'gsd' is kept — that's the identity the registry uses
to track enable/disable state across upgrades."
```

---

## Task 4: Hardcoded `extensions/gsd/` paths in source

**Files:**
- Modify: `src/bundled-resource-path.ts`
- Modify: `src/resources/extensions/workflow/prompt-loader.ts`
- Modify: `src/resources/extensions/workflow/workflow-plugins.ts`
- Modify: `src/resources/extensions/workflow/forensics.ts`
- Modify: `src/resources/extensions/workflow/workflow-templates.ts`

These files reference `~/.gsd/agent/extensions/gsd/` (after Phase 0, the synced path is `~/.loop24/agent/extensions/workflow/`). The `~/.gsd/` part is handled by `gsdHome()` (or `appRoot` from `app-paths.ts`), but the trailing `extensions/gsd/` is hardcoded. After our directory rename, it should be `extensions/workflow/`.

- [ ] **Step 1: Inspect each call site**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -n "extensions.*gsd" src/bundled-resource-path.ts \
   src/resources/extensions/workflow/prompt-loader.ts \
   src/resources/extensions/workflow/workflow-plugins.ts \
   src/resources/extensions/workflow/forensics.ts \
   src/resources/extensions/workflow/workflow-templates.ts
```

- [ ] **Step 2: Replace each `extensions/gsd/` → `extensions/workflow/`**

For each file, change every `join(..., "extensions", "gsd", ...)` to `join(..., "extensions", "workflow", ...)`. Both string literal forms (`"extensions/gsd"`) and `join` arg forms (`, "extensions", "gsd",`) need updating.

`src/bundled-resource-path.ts:53`:
```typescript
const distModule = join(distResources, "extensions", "gsd", jsFile);
```
→
```typescript
const distModule = join(distResources, "extensions", "workflow", jsFile);
```

Same change at line 59 (the `src/resources/...` fallback).

For the workflow source files, the `agentGsdDir`/`fallback` variable name is fine (internal name, not user-visible); just update the path argument.

- [ ] **Step 3: Build + verify nothing broke**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
# Make sure the dist no longer has these literal paths in those files
grep -n "extensions.*gsd" dist/resources/extensions/workflow/prompt-loader.js \
   dist/resources/extensions/workflow/workflow-plugins.js \
   dist/resources/extensions/workflow/forensics.js \
   dist/resources/extensions/workflow/workflow-templates.js \
   dist/bundled-resource-path.js 2>/dev/null
```
Expected: build clean, no matches in the listed files.

- [ ] **Step 4: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/bundled-resource-path.ts \
        src/resources/extensions/workflow/prompt-loader.ts \
        src/resources/extensions/workflow/workflow-plugins.ts \
        src/resources/extensions/workflow/forensics.ts \
        src/resources/extensions/workflow/workflow-templates.ts
git commit -m "fix(paths): extensions/gsd → extensions/workflow in source paths

After Phase 0 renamed the directory, several files still constructed
join(.., 'extensions', 'gsd', ..) paths to look up workflow assets:
- bundled-resource-path.ts: resolveBundledGsdExtensionModule (2 sites)
- workflow/prompt-loader.ts: agentGsdDir for prompt resolution
- workflow/workflow-plugins.ts: agentGsdDir for plugin templates
- workflow/forensics.ts: fallback path for post-mortem inspection
- workflow/workflow-templates.ts: agentGsdDir for workflow scaffolds

All five now read from extensions/workflow/. The internal variable name
agentGsdDir / fallback is left alone — internal identifier, not visible
to users."
```

---

## Task 5: Phase 0.5 residue files

**Files:**
- Modify: `src/resources/extensions/workflow/auto.ts`
- Modify: `src/resources/extensions/workflow/state.ts`
- Modify: `src/resources/extensions/workflow/auto-verification.ts`
- Modify: `src/resources/extensions/workflow/auto-dispatch.ts`
- Modify: `src/resources/extensions/workflow/undo.ts`
- Modify: `src/resources/extensions/workflow/commands-handlers.ts`
- Modify: `src/resources/extensions/workflow/commands-workflow-templates.ts`
- Modify: `src/resources/extensions/workflow/commands-codebase.ts`
- Modify: `src/resources/extensions/workflow/dev-workflow-engine.ts`
- Modify: `src/resources/extensions/workflow/doctor-format.ts`
- Modify: `src/resources/extensions/workflow/commands-inspect.ts`

The Phase 0.5 cleanup explicitly deferred these. Sweep them now using the same `BRAND` / `CMD` / `slashCommand()` helpers from `workflow/strings.ts`.

- [ ] **Step 1: Identify each residue line**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
for f in auto.ts state.ts auto-verification.ts auto-dispatch.ts undo.ts commands-handlers.ts commands-workflow-templates.ts commands-codebase.ts dev-workflow-engine.ts doctor-format.ts commands-inspect.ts; do
  echo "--- $f ---"
  grep -n '"GSD\|"gsd\|/gsd\|GSD-WORKFLOW\.md' "src/resources/extensions/workflow/$f" 2>/dev/null | head -10
done
```

- [ ] **Step 2: For each file — add `BRAND, slashCommand` import (if not present) and template every user-visible literal**

The pattern is consistent across files:
- `"/gsd <sub>"` → `slashCommand("sub")` (which returns `` `/${CMD} sub` ``)
- `"GSD"` in title/notification text → `BRAND`
- `sendDesktopNotification("GSD", ...)` → `sendDesktopNotification(BRAND, ...)` (the notifications.ts shim from Phase 0.5 still accepts both, but writing BRAND keeps callers consistent)
- `"GSD-WORKFLOW.md"` filename in `commands-handlers.ts` — leave the filename itself (referenced by external tools), but if there's a display-string version, template that

For files with many lines (`auto.ts`, `state.ts`) — work through each match systematically. The shape of the change is mechanical.

Specific notes:
- `dev-workflow-engine.ts`: `engineLabel: "GSD Dev"` → `engineLabel: \`${BRAND} Dev\``
- `commands-inspect.ts`: `"/gsd inspect failed: "` prefix → `\`${slashCommand("inspect")} failed: \``
- `commands-codebase.ts`: `"GSD also refreshes CODEBASE.md…"` → `\`${BRAND} also refreshes CODEBASE.md…\``
- `auto.ts` `commands:` arrays: each `/gsd next` etc. → `slashCommand("next")` etc. (these are array literals, so the call returns the string at construction time)

- [ ] **Step 3: Build + verify**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
# Sweep check: any remaining literal "GSD" in those files?
for f in auto.ts state.ts auto-verification.ts auto-dispatch.ts undo.ts commands-handlers.ts commands-workflow-templates.ts commands-codebase.ts dev-workflow-engine.ts doctor-format.ts commands-inspect.ts; do
  matches=$(grep -c '"GSD\|"gsd\|/gsd' "src/resources/extensions/workflow/$f" 2>/dev/null || echo 0)
  echo "$f: $matches remaining"
done
```
Expected: build clean, all counts at 0 (or near 0 — internal references like `MISSING_OTTO_MARKER` will still match because we're keeping those per scope).

- [ ] **Step 4: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/workflow/auto.ts \
        src/resources/extensions/workflow/state.ts \
        src/resources/extensions/workflow/auto-verification.ts \
        src/resources/extensions/workflow/auto-dispatch.ts \
        src/resources/extensions/workflow/undo.ts \
        src/resources/extensions/workflow/commands-handlers.ts \
        src/resources/extensions/workflow/commands-workflow-templates.ts \
        src/resources/extensions/workflow/commands-codebase.ts \
        src/resources/extensions/workflow/dev-workflow-engine.ts \
        src/resources/extensions/workflow/doctor-format.ts \
        src/resources/extensions/workflow/commands-inspect.ts
git commit -m "refactor(workflow): sweep Phase 0.5 residue — GSD strings + /gsd refs

Eleven files swept for user-visible 'GSD' / '/gsd <sub>' literals. Each
file templates the relevant strings via BRAND + slashCommand() from
strings.ts. Phase 0.5 listed these explicitly as deferred residue —
Phase 2c finishes the job.

Internal identifiers (MISSING_OTTO_MARKER error code, type names,
function names, GsdState interface) are kept per Phase 0 Known
Deferred Cleanups item 7."
```

---

## Task 6: Full regression + live verification

**Files:** none (verify, then commit only docs)

- [ ] **Step 1: Build clean**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
```

- [ ] **Step 2: Run full regression suite**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  packages/pi-coding-agent/src/config.test.ts \
  packages/pi-coding-agent/src/core/extensions/loader.debug.test.ts \
  packages/pi-ai/src/providers/anthropic-auth.test.ts \
  packages/pi-ai/src/providers/anthropic-bearer-auth.test.ts \
  packages/pi-ai/src/providers/anthropic-shared.test.ts \
  packages/pi-ai/src/providers/anthropic.gateway.test.ts \
  src/resources/extensions/workflow/tests/update-command.test.ts \
  src/resources/extensions/workflow/tests/autocomplete-regressions-1675.test.ts \
  src/resources/extensions/workflow/tests/help-menu-coverage.test.ts \
  src/resources/extensions/workflow/tests/extension-bootstrap-isolation.test.ts \
  src/resources/extensions/workflow/tests/auto-blocked-remediation-message.test.ts \
  src/resources/extensions/loop24/tests/langflow-client.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-schema.test.ts \
  src/resources/extensions/loop24/tests/flow-trigger-loader.test.ts \
  src/tests/integration/loop24-gateway.test.ts \
  src/tests/loop24-config.test.ts \
  2>&1 | tail -8
```
Expected: 95/95 pass (93 prior + 2 new debug toggle tests).

If any of the Phase 0.5 residue commits broke a test — the most likely culprit is `auto-blocked-remediation-message.test.ts` which was already updated in Phase 0.5 to use `CMD`. Re-read that test and see whether the prior code matched something we removed. Fix the test (don't revert the source) — the test should mirror what the user actually sees.

- [ ] **Step 3: Wipe agent dir + live verify the debug toggle**

```bash
rm -rf ~/.loop24/agent
cd /tmp
LOOP24_DEBUG_EXTENSIONS=1 perl -e 'alarm 8; exec @ARGV' loop24 --print "hi" 2>/tmp/loop24-debug.txt >/dev/null
grep "loop24-debug" /tmp/loop24-debug.txt | head -20
```
Expected: lines like `[loop24-debug] registered command 'loop24' from .../workflow/index.js`. THIS is the diagnostic that tells us what's actually registered. If the user reports `/gsd` showing up in their TUI, they should see `'gsd'` in their own debug output — at which point the bug is concrete and findable.

- [ ] **Step 4: Update LOOP24-PATCHES.md**

Append a Phase 2c section AFTER Phase 2b.1, BEFORE "Known Deferred Cleanups":

```markdown
## Phase 2c — GSD residue sweep + debug toggle (tagged: phase-2c-residue-sweep)

### packages/pi-coding-agent/src/core/extensions/loader.ts (MODIFIED)
- `pi.registerCommand` closure emits a stderr line when
  `LOOP24_DEBUG_EXTENSIONS` is set:
  `[loop24-debug] registered command 'NAME' from /path/to/extension`.
- Exports `createExtensionAPI` and `createExtension` so the test can
  exercise the closure directly without spinning up a full extension load.

### packages/pi-coding-agent/src/core/extensions/loader.debug.test.ts (NEW)
- 2 tests: env var on → log line appears; env var unset → no output.

### src/resources/extensions/workflow/extension-manifest.json (MODIFIED)
- `provides.commands` changed from `["gsd", ...]` to `["loop24", ...]`
  to match what the runtime actually registers. The extension `id` is
  kept as `"gsd"` because the registry tracks enable/disable state by id.

### src/bundled-resource-path.ts (MODIFIED)
- `resolveBundledGsdExtensionModule()` now reads from
  `extensions/workflow/` (both dist and src fallback paths), aligning
  with the Phase 0 directory rename.

### src/resources/extensions/workflow/*.ts (MODIFIED — 15 files)
- Display strings: `health-widget-core.ts`, `init-wizard.ts`,
  `exit-command.ts`, `commands/catalog.ts`.
- Hardcoded `extensions/gsd/` paths: `prompt-loader.ts`,
  `workflow-plugins.ts`, `forensics.ts`, `workflow-templates.ts`.
- Phase 0.5 residue files: `auto.ts`, `state.ts`, `auto-verification.ts`,
  `auto-dispatch.ts`, `undo.ts`, `commands-handlers.ts`,
  `commands-workflow-templates.ts`, `commands-codebase.ts`,
  `dev-workflow-engine.ts`, `doctor-format.ts`, `commands-inspect.ts`.

All user-visible `GSD` / `Get Shit Done` / `/gsd <sub>` literals now flow
through `BRAND` / `CMD` / `slashCommand()` from `workflow/strings.ts`.
Internal identifiers (function names, type names, error codes,
`MISSING_OTTO_MARKER`, etc.) are kept per Phase 0 Known Deferred Cleanups
item 7.

### Out of scope (still residue, will be addressed when something triggers a sweep)
- `mcp-client/manager.ts:349`, `mcp-client/index.ts:147`,
  `mcp-client/auth.ts:89`: MCP client identifier `name: "gsd"` sent to
  remote MCP servers. Changing it requires re-handshake with any tracking
  server. Internal protocol field, not user-facing.
- `~/.gsd/crash/` log directory in `crash-log.ts`. Only matters after an
  extension crash; can move when something else changes there.
- `commands-extensions.ts:215+`: `MISSING_OTTO_MARKER` validation messages
  for third-party-extension `package.json` schema. Internal error code.
- `runner.ts:119`: `PROTECTED_EXTENSION_COMMANDS = new Set(["gsd"])`.
  After our rename, nothing registers `"gsd"` literally anymore, so the
  protection list is effectively dead. Leave for now — removing it is
  the kind of cleanup that might break a sibling tool's expectations.
```

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add LOOP24-PATCHES.md
git commit -m "docs: LOOP24-PATCHES.md — Phase 2c residue sweep + debug toggle"
```

- [ ] **Step 5: Tag**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git tag -a phase-2c-residue-sweep -m "Phase 2c: sweeps Phase 0/0.5 GSD residue out of user-visible surfaces (health widget, init wizard, exit/kill descriptions, command catalog, footer-relevant strings, hardcoded extensions/gsd/ paths in src). Adds LOOP24_DEBUG_EXTENSIONS env-var toggle to the extension loader so anyone can verify what commands actually register at TUI startup — diagnostic for 'Unknown command' reports."
git tag -l | grep phase-2
git log --oneline | head -10
```

---

## Definition of Done

Phase 2c is complete when ALL of these are true:

- The `LOOP24_DEBUG_EXTENSIONS=1 loop24 --print "..."` command emits per-registration lines on stderr.
- 95/95 regression tests pass (93 prior + 2 new debug-toggle tests).
- Build is clean.
- `dist/resources/extensions/workflow/extension-manifest.json` lists `loop24` in `provides.commands`, not `gsd`.
- A fresh `~/.loop24/agent/` (after `rm -rf`) re-syncs the updated manifest.
- `grep -rn '"GSD' src/resources/extensions/workflow/` returns only internal references (type names, error codes from the explicitly-kept list).
- `grep -rn 'extensions.*gsd' src/` returns only comments or items in the documented out-of-scope list.
- `phase-2c-residue-sweep` git tag exists.
- `LOOP24-PATCHES.md` has a Phase 2c section.

---

## Self-Review (for plan author)

**Spec coverage** — every item in the user's bug report plus the Phase 0.5 residue list:
- ✅ "GSD Project Initialized" — `health-widget-core.ts` in Task 2
- ✅ "footer says GSD" — likely `dev-workflow-engine.ts engineLabel` and similar, swept in Task 5
- ✅ "responses say GSD" — broadly addressed by Tasks 2 + 5
- ✅ "/gsd in autocomplete" — Task 3 (manifest) + Task 1 (diagnostic to find the real registration site if it persists)
- ✅ "extensions/gsd hardcoded paths" — Task 4

**Diagnostic angle (the why):**
- The user reports `/gsd` in the autocomplete that doesn't dispatch. I couldn't reproduce it from outside the live process — every static-analysis and simulated-load test shows `loop24` registered correctly.
- Task 1's `LOOP24_DEBUG_EXTENSIONS` toggle gives the user (and us) a self-service way to see what's actually being registered at TUI startup, which is the missing piece of evidence.
- If after Phase 2c the user STILL sees `/gsd` in autocomplete but the debug output shows `'loop24' registered` (and nothing for `'gsd'`), the bug is in the autocomplete-build path, not the registration path — and we'll have isolated it.

**Scope discipline:**
- Six tasks, mostly mechanical. Largest is Task 5 (11 files) — each file is a small edit using the established `BRAND`/`slashCommand()` helpers from `strings.ts`. No new patterns introduced.
- Explicitly OUT-OF-SCOPE items are listed in LOOP24-PATCHES.md so future maintainers see what was deliberately left.
- No new dependencies. No new modules. No architectural changes.

**Risks:**
- Task 5 touches files with subtle text-matching tests (`auto-blocked-remediation-message.test.ts`). Tests may fail if the prior text the test asserted no longer matches. Fix the TEST, not the source — the test should reflect what the user sees.
- The `extensions/gsd/` → `extensions/workflow/` path change in Task 4 could break a code path that's path-keyed. The build + regression run in Task 6 catches it; the live smoke after agent-dir wipe confirms users land correctly.
- The manifest `commands` array change in Task 3 — if anything keys off the manifest's commands array AND expects the literal `"gsd"` (rather than the registered name), this would surface immediately in the live smoke (Task 6 Step 3).

---

*End of Phase 2c plan.*
