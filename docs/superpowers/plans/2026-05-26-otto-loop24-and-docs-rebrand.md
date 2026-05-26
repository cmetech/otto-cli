# OTTO LOOP24 And Documentation Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove active LOOP24 branding and legacy env fallbacks, and align active developer/user documentation with OTTO conventions.

**Architecture:** Treat OTTO as the only active product identity. Runtime environment variables become `OTTO_*` only, workspace package scopes move from `@loop24/*` and `@loop24-build/*` to OTTO-scoped internal package names, and active docs describe `/otto`, `.otto/workflow`, `OTTO_*`, and OTTO workflow concepts. Historical files under `docs/superpowers/plans/**`, `docs/superpowers/specs/**`, and `docs/superpowers/notes/**` remain archival and are excluded from zero-residue scans.

**Tech Stack:** TypeScript, Node.js workspaces, npm package-lock, Markdown documentation, native Rust addon verification.

---

## Scope And Rules

**In scope:**
- Active runtime code in `src/**`, `packages/**`, `scripts/**`, `native/**`, `docker/**`, root `package.json`, and `package-lock.json`.
- Active documentation in `README.md`, `docs/dev/**`, `docs/user-docs/**`, `docs/extension-sdk/**`, package READMEs, `src/resources/WORKFLOW.md`, and bundled active skill docs under `src/resources/skills/**`.
- Tests that assert env var names, command names, workspace package names, or documentation examples.

**Out of scope:**
- Historical implementation records under:
  - `docs/superpowers/plans/**`
  - `docs/superpowers/specs/**`
  - `docs/superpowers/notes/**`
- Upstream attribution references to `open-gsd/gsd-pi` and `gsd-pi` in license/fork-history prose. These should remain where they explain provenance.
- Rust internal crate/module identifiers under `native/crates/**` unless a test or runtime API exposes them.

**Final scan expectations:**
- Active source/docs scan has no `LOOP24`, `Loop24`, `loop24`, `LOOP24_*`, `@loop24/*`, or `@loop24-build/*`.
- Active source/docs scan has no user-facing `GSD`, `/gsd`, `.gsd`, `GSD_*`, `gsd_*`, or `gsd.db`, except explicit upstream attribution to `open-gsd/gsd-pi`.
- Archival superpowers plans/specs/notes may still contain old names.

## Current Evidence

Initial scan on 2026-05-26 found:
- 612 `LOOP24_*`/`LOOP24` matches in active code/docs when excluding archival `docs/superpowers/**`.
- 118 active Markdown files under developer/user/package docs and bundled skill docs with `GSD`, `.gsd`, `/gsd`, or `gsd_*` references.
- Workspace package names still use `@loop24/*` and `@loop24-build/*`.

Use these commands to reproduce the inventory:

```bash
rg -n 'LOOP24|Loop24|loop24' src packages scripts docs docker Dockerfile native package.json package-lock.json README.md \
  --glob '!docs/superpowers/plans/**' \
  --glob '!docs/superpowers/specs/**' \
  --glob '!docs/superpowers/notes/**' \
  --glob '!**/dist/**' \
  --glob '!**/*.map' \
  --glob '!LOOP24-PATCHES.md'

rg -n '\bGSD\b|\bgsd\b|\.gsd|GSD_|gsd_' docs/dev docs/user-docs docs/extension-sdk packages/mcp-server/README.md README.md src/resources/WORKFLOW.md src/resources/skills --glob '*.md'
```

## File Responsibility Map

| Area | Files | Responsibility |
| --- | --- | --- |
| Env vars | `src/env-normalize.ts`, `src/app-paths.ts`, `src/loop24-config.ts`, `src/brand.js`, `src/rtk*.ts`, `src/headless.ts`, `src/worktree-cli.ts`, workflow extension modules, scripts | Remove `LOOP24_*` reads/writes and use `OTTO_*` only. Rename `loop24-config.ts` if it remains active. |
| Workspace package scope | `packages/*/package.json`, root `package.json`, `package-lock.json`, imports in `src/**`, `packages/**`, `scripts/**`, `docs/extension-sdk/**`, test resolvers | Rename internal packages from `@loop24/*` to `@otto/*` and `@loop24-build/*` to `@otto-build/*`; update all imports and npm scripts. |
| Extension/resource names | `src/resources/extensions/loop24/**`, related tests/docs | Rename active extension directory and symbols to OTTO if still used; remove old command examples. |
| Active developer docs | `docs/dev/**`, `docs/extension-sdk/**`, `src/resources/WORKFLOW.md` | Convert GSD/LOOP24 language to OTTO conventions, update paths to `.otto/workflow`, slash commands to `/otto`, env vars to `OTTO_*`. |
| Active user docs | `docs/user-docs/**`, `README.md`, package READMEs | Same as developer docs, with provenance references preserved. |
| Bundled skills | `src/resources/skills/**` | Update shipped instructions from GSD-specific paths/commands to OTTO paths/commands. |
| Verification | tests in `src/tests/**`, `src/resources/extensions/**/tests/**`, package tests, e2e | Update assertions and add residue-scan tests or commands. |

---

### Task 1: Remove LOOP24 Env Fallbacks From Runtime

**Files:**
- Modify: `src/env-normalize.ts`
- Modify: `src/app-paths.ts`
- Modify: `src/loop24-config.ts` or rename to `src/otto-config.ts`
- Modify: `src/brand.js`
- Modify: `src/rtk.ts`
- Modify: `src/rtk-shared.ts`
- Modify: `src/headless.ts`
- Modify: `src/worktree-cli.ts`
- Modify: `src/claude-cli-check.ts`
- Modify: `src/resources/extensions/**/*.ts`
- Modify: `scripts/*.mjs`, `scripts/*.js`, `scripts/*.cjs`
- Test: `src/tests/env-normalize.test.ts`, `src/resources/extensions/workflow/tests/*env*.test.ts`

- [ ] **Step 1: Write/update env normalization tests**

Update `src/tests/env-normalize.test.ts` so `OTTO_*` values are honored and `LOOP24_*` values are ignored. Add assertions for representative names:

```ts
test("env normalization does not mirror LOOP24_* aliases", () => {
  const env: Record<string, string | undefined> = {
    LOOP24_DEBUG: "1",
    LOOP24_HOME: "/tmp/legacy-loop24",
    OTTO_HOME: "/tmp/otto",
  };
  normalizeEnv(env);
  assert.equal(env.OTTO_HOME, "/tmp/otto");
  assert.equal(env.LOOP24_DEBUG, "1");
  assert.equal(env.OTTO_DEBUG, undefined);
});
```

Run:

```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/env-normalize.test.ts
```

Expected: FAIL before implementation if any old mirroring still exists.

- [ ] **Step 2: Replace env reads and writes**

Mechanically replace read patterns:

```ts
process.env.LOOP24_X ?? process.env.OTTO_X
```

with:

```ts
process.env.OTTO_X
```

Replace dual writes:

```ts
process.env.LOOP24_X = process.env.OTTO_X = value;
```

with:

```ts
process.env.OTTO_X = value;
```

Representative mappings:

| Remove | Keep |
| --- | --- |
| `LOOP24_HOME` | `OTTO_HOME` |
| `LOOP24_BIN_PATH` | `OTTO_BIN_PATH` |
| `LOOP24_VERSION` | `OTTO_VERSION` |
| `LOOP24_DEBUG` | `OTTO_DEBUG` |
| `LOOP24_RTK_DISABLED` | `OTTO_RTK_DISABLED` |
| `LOOP24_SKIP_RTK_INSTALL` | `OTTO_SKIP_RTK_INSTALL` |
| `LOOP24_PROJECT_ROOT` | `OTTO_PROJECT_ROOT` |
| `LOOP24_PARALLEL_WORKER` | `OTTO_PARALLEL_WORKER` |
| `LOOP24_MILESTONE_LOCK` | `OTTO_MILESTONE_LOCK` |
| `LOOP24_SLICE_LOCK` | `OTTO_SLICE_LOCK` |
| `LOOP24_WORKFLOW_EXECUTORS_MODULE` | `OTTO_WORKFLOW_EXECUTORS_MODULE` |
| `LOOP24_WORKFLOW_WRITE_GATE_MODULE` | `OTTO_WORKFLOW_WRITE_GATE_MODULE` |
| `LOOP24_PERSIST_WRITE_GATE_STATE` | `OTTO_PERSIST_WRITE_GATE_STATE` |
| `LOOP24_GATEWAY_URL` | `OTTO_GATEWAY_URL` |
| `LOOP24_GATEWAY_TOKEN` | `OTTO_GATEWAY_TOKEN` |
| `LOOP24_LANGFLOW_DISABLED` | `OTTO_LANGFLOW_DISABLED` |
| `LOOP24_PYTHON_BIN` | `OTTO_PYTHON_BIN` |
| `LOOP24_PROMPT_ENGINEER_MODEL` | `OTTO_PROMPT_ENGINEER_MODEL` |

- [ ] **Step 3: Rename config module symbols**

If `src/loop24-config.ts` is still active, rename it to `src/otto-config.ts` and update exported types:

```ts
export interface OttoConfig { ... }
export const DEFAULT_CONFIG: OttoConfig = { ... };
export function loadConfig(): OttoConfig { ... }
export function saveConfig(cfg: OttoConfig): void { ... }
export function applyConfigToEnv(cfg: OttoConfig): void { ... }
```

Update imports from:

```ts
import { loadConfig } from "./loop24-config.js";
```

to:

```ts
import { loadConfig } from "./otto-config.js";
```

- [ ] **Step 4: Run targeted env tests**

Run:

```bash
npm run typecheck:extensions
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/tests/env-normalize.test.ts src/resources/extensions/workflow/tests/auto-project-root-env.test.ts src/resources/extensions/workflow/tests/workflow-mcp.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 5: Commit**

```bash
git add src scripts packages
git commit -m "refactor(otto): remove LOOP24 env aliases"
```

---

### Task 2: Rename Internal Workspace Package Scope

**Files:**
- Modify: root `package.json`
- Modify: `package-lock.json`
- Modify: `packages/*/package.json`
- Modify: all `@loop24/*` and `@loop24-build/*` imports in `src/**`, `packages/**`, `scripts/**`, tests, and docs examples
- Modify: `scripts/dist-test-resolve.mjs`, `scripts/validate-pack.js`, `scripts/validate-pack.sh`, `scripts/run-package-tests.cjs`

- [ ] **Step 1: Update workspace package names**

Rename package names:

| Old | New |
| --- | --- |
| `@loop24/native` | `@otto/native` |
| `@loop24/pi-agent-core` | `@otto/pi-agent-core` |
| `@loop24/pi-ai` | `@otto/pi-ai` |
| `@loop24/pi-coding-agent` | `@otto/pi-coding-agent` |
| `@loop24/pi-tui` | `@otto/pi-tui` |
| `@loop24-build/contracts` | `@otto-build/contracts` |
| `@loop24-build/daemon` | `@otto-build/daemon` |
| `@loop24-build/mcp-server` | `@otto-build/mcp-server` |
| `@loop24-build/rpc-client` | `@otto-build/rpc-client` |

Update root scripts, for example:

```json
"build:pi-tui": "npm run build -w @otto/pi-tui",
"build:native-pkg": "npm run build -w @otto/native",
"build:contracts": "npm run build -w @otto-build/contracts"
```

- [ ] **Step 2: Update imports and test resolver mappings**

Replace imports:

```ts
import { theme } from "@loop24/pi-tui";
import type { ExtensionAPI } from "@loop24/pi-coding-agent";
```

with:

```ts
import { theme } from "@otto/pi-tui";
import type { ExtensionAPI } from "@otto/pi-coding-agent";
```

Update `scripts/dist-test-resolve.mjs` mappings to the new scopes:

```js
const redirects = {
  "@otto/pi-coding-agent": new URL("../dist-test/packages/pi-coding-agent/src/index.js", import.meta.url).href,
  "@otto/pi-ai": new URL("../dist-test/packages/pi-ai/src/index.js", import.meta.url).href,
  "@otto/pi-agent-core": new URL("../dist-test/packages/pi-agent-core/src/index.js", import.meta.url).href,
  "@otto/pi-tui": new URL("../dist-test/packages/pi-tui/src/index.js", import.meta.url).href,
  "@otto/native": new URL("../dist-test/packages/native/src/index.js", import.meta.url).href,
};
```

- [ ] **Step 3: Regenerate lockfile**

Run:

```bash
npm install --package-lock-only
```

Expected: `package-lock.json` no longer contains `@loop24/*` or `@loop24-build/*`.

- [ ] **Step 4: Verify package builds**

Run:

```bash
npm run build:core
npm run test:packages
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json packages scripts src docs
git commit -m "refactor(otto): rename internal workspace scope"
```

---

### Task 3: Rename Active LOOP24 Extension And Product Surfaces

**Files:**
- Move: `src/resources/extensions/loop24/` to an OTTO-named active extension directory if still shipped
- Modify: extension manifests, imports, tests, command docs
- Modify: `README.md`
- Modify: `docs/user-docs/**`
- Modify: `docs/extension-sdk/**`

- [ ] **Step 1: Inventory extension usage**

Run:

```bash
rg -n 'extensions/loop24|/loop24|loop24 extension|Loop24|LOOP24' src packages scripts docs README.md \
  --glob '!docs/superpowers/plans/**' \
  --glob '!docs/superpowers/specs/**' \
  --glob '!docs/superpowers/notes/**'
```

Expected: output identifies only active extension/product surfaces.

- [ ] **Step 2: Rename active extension folder and manifest references**

If `src/resources/extensions/loop24/` is still active, move it to:

```text
src/resources/extensions/otto/
```

Update manifest name/display strings to OTTO. Replace `/loop24` examples with `/otto` and `extensions/loop24` paths with `extensions/otto`.

- [ ] **Step 3: Update gateway/config naming**

Replace user-facing gateway variables:

```text
LOOP24_GATEWAY_URL
LOOP24_GATEWAY_TOKEN
LOOP24_PYTHON_BIN
LOOP24_PROMPT_ENGINEER_MODEL
```

with:

```text
OTTO_GATEWAY_URL
OTTO_GATEWAY_TOKEN
OTTO_PYTHON_BIN
OTTO_PROMPT_ENGINEER_MODEL
```

Update README tables and command help to describe OTTO, not Loop24/OTTER unless the product decision explicitly keeps OTTER. If OTTER is no longer desired, replace it with OTTO consistently.

- [ ] **Step 4: Run extension-specific tests**

Run:

```bash
npm run test:compile
node --import ./scripts/dist-test-resolve.mjs --experimental-test-isolation=process --test-reporter=./scripts/test-reporter-compact.mjs --test "dist-test/src/resources/extensions/**/tests/*.test.js"
```

Expected: extension tests pass or failures identify stale path/name expectations to update.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions README.md docs
git commit -m "refactor(otto): rename active LOOP24 extension surfaces"
```

---

### Task 4: Update Developer Documentation From GSD To OTTO

**Files:**
- Modify: `docs/dev/**/*.md`
- Modify: `docs/extension-sdk/**/*.md`
- Modify: `src/resources/WORKFLOW.md`
- Modify: `src/resources/skills/**/*.md`

- [ ] **Step 1: Create developer-doc residue report**

Run:

```bash
rg -n '\bGSD\b|\bgsd\b|\.gsd|GSD_|gsd_' docs/dev docs/extension-sdk src/resources/WORKFLOW.md src/resources/skills --glob '*.md' > /tmp/otto-dev-doc-residue.txt
wc -l /tmp/otto-dev-doc-residue.txt
```

Expected: non-zero before edits.

- [ ] **Step 2: Apply terminology rules**

Use these replacements where they describe current OTTO behavior:

| Old | New |
| --- | --- |
| `GSD` | `OTTO` |
| `GSD-2` | `OTTO` or `OTTO workflow engine` |
| `/gsd` | `/otto` |
| `.gsd/` | `.otto/workflow/` |
| `~/.gsd/agent/` | `~/.otto/agent/` |
| `gsd.db` | `otto.db` |
| `gsd_*` workflow tools | `otto_*` workflow tools |
| `mcp__gsd-workflow__...` | `mcp__otto-workflow__...` |
| `extensions/gsd/` | `extensions/workflow/` or current OTTO extension path |

Do not change upstream URLs or provenance like:

```md
open-gsd/gsd-pi
Inherited from upstream gsd-pi
```

- [ ] **Step 3: Update `src/resources/WORKFLOW.md`**

Ensure this file describes current runtime state:

```md
All workflow artifacts live under `.otto/workflow/` at the project root.

1. Read `.otto/workflow/STATE.md`.
2. Read `.otto/workflow/milestones/<active>/M###-ROADMAP.md`.
3. Use `/otto` commands and `otto_*` tools.
```

- [ ] **Step 4: Update bundled skill docs**

For bundled skills under `src/resources/skills/**`, replace current-project examples with OTTO paths and commands. Example:

```md
Save the report under `.otto/workflow/forensics/<slug>.md`.
Run `/otto forensics` before deeper manual investigation.
```

- [ ] **Step 5: Verify developer-doc scan**

Run:

```bash
rg -n '\bGSD\b|\bgsd\b|\.gsd|GSD_|gsd_' docs/dev docs/extension-sdk src/resources/WORKFLOW.md src/resources/skills --glob '*.md'
```

Expected: only upstream provenance references remain. If any result describes current behavior, fix it.

- [ ] **Step 6: Commit**

```bash
git add docs/dev docs/extension-sdk src/resources/WORKFLOW.md src/resources/skills
git commit -m "docs(otto): align developer docs with OTTO workflow"
```

---

### Task 5: Update User Documentation And README

**Files:**
- Modify: `README.md`
- Modify: `docs/user-docs/**/*.md`
- Modify: `packages/mcp-server/README.md`
- Modify: `native/README.md`

- [ ] **Step 1: Create user-doc residue report**

Run:

```bash
rg -n '\bGSD\b|\bgsd\b|\.gsd|GSD_|gsd_|LOOP24|Loop24|loop24' README.md docs/user-docs packages/mcp-server/README.md native/README.md --glob '*.md' > /tmp/otto-user-doc-residue.txt
wc -l /tmp/otto-user-doc-residue.txt
```

Expected: non-zero before edits.

- [ ] **Step 2: Update command and path examples**

Replace current behavior examples:

```md
/gsd auto
/gsd worktree list
.gsd/worktrees/<MID>/
GSD-Task: M001/S01/T01
```

with:

```md
/otto auto
/otto worktree list
.otto/workflow/worktrees/<MID>/
OTTO-Task: M001/S01/T01
```

- [ ] **Step 3: Update MCP README**

Replace examples:

```json
{
  "mcpServers": {
    "gsd": {
      "command": "npx",
      "args": ["gsd-mcp-server"]
    }
  }
}
```

with OTTO examples:

```json
{
  "mcpServers": {
    "otto": {
      "command": "npx",
      "args": ["otto-mcp-server"]
    }
  }
}
```

Update `OTTO_CLI_PATH` docs so the fallback resolves `otto`, not `gsd`.

- [ ] **Step 4: Preserve fork attribution only where appropriate**

Keep attribution like:

```md
OTTO is a permanent hard fork of open-gsd/gsd-pi.
```

Do not keep GSD wording for current commands, paths, env vars, DB names, or workflow tools.

- [ ] **Step 5: Verify user-doc scan**

Run:

```bash
rg -n '\bGSD\b|\bgsd\b|\.gsd|GSD_|gsd_|LOOP24|Loop24|loop24' README.md docs/user-docs packages/mcp-server/README.md native/README.md --glob '*.md'
```

Expected: only explicit upstream provenance references remain.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/user-docs packages/mcp-server/README.md native/README.md
git commit -m "docs(otto): align user docs with OTTO naming"
```

---

### Task 6: Add Residue Guards And Final Verification

**Files:**
- Modify or create: `scripts/branding-residue-check.mjs`
- Modify: `package.json`
- Test: `src/tests/branding-residue.test.ts` or script-level check

- [ ] **Step 1: Add residue script**

Create `scripts/branding-residue-check.mjs`:

```js
import { spawnSync } from "node:child_process";

const patterns = [
  "LOOP24|Loop24|loop24",
  "GSD_[A-Z0-9_]*|GSD_SMOKE_BINARY|\\\\bprocess\\\\.env\\\\.GSD|\\\\bimport\\\\.meta\\\\.env\\\\.GSD",
  "mcp__otto-workflow__gsd_|\\\\bgsd_(plan_milestone|task_complete|task_reopen|replan_slice|slice_complete|complete_slice|exec_search|exec|summary_save|requirement_save|requirement_update|reassess_roadmap|plan_slice|decision_save)|gsd\\\\.db|gsd-fake|gsd-workflow",
];

const paths = [
  "src",
  "tests",
  "packages",
  "scripts",
  "docs/dev",
  "docs/user-docs",
  "docs/extension-sdk",
  "docker",
  "Dockerfile",
  "native",
  "README.md",
  "package.json",
];

const globArgs = [
  "--glob", "!docs/superpowers/plans/**",
  "--glob", "!docs/superpowers/specs/**",
  "--glob", "!docs/superpowers/notes/**",
  "--glob", "!**/dist/**",
  "--glob", "!**/*.map",
  "--glob", "!LOOP24-PATCHES.md",
  "--glob", "!native/crates/**",
];

let failed = false;
for (const pattern of patterns) {
  const result = spawnSync("rg", ["-n", pattern, ...paths, ...globArgs], {
    stdio: "inherit",
    shell: false,
  });
  if (result.status === 0) failed = true;
  if (result.status !== 0 && result.status !== 1) process.exit(result.status ?? 2);
}

if (failed) {
  console.error("Branding residue check failed.");
  process.exit(1);
}
console.log("Branding residue check passed.");
```

- [ ] **Step 2: Add package script**

Add to root `package.json`:

```json
"branding:check": "node scripts/branding-residue-check.mjs"
```

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run branding:check
npm run typecheck:extensions
npm run test:unit
npm run test:native
npm run build:core
OTTO_SMOKE_BINARY="$(pwd)/dist/loader.js" npm run test:e2e
```

Expected:
- Branding check passes.
- Typecheck passes.
- Unit tests pass.
- Native tests pass with only known macOS process-list skip if still present.
- Build passes.
- E2E passes with zero failures and zero skips.

- [ ] **Step 4: Final active-source scans**

Run:

```bash
rg -n 'LOOP24|Loop24|loop24|@loop24|@loop24-build' src tests packages scripts docs docker Dockerfile native package.json package-lock.json README.md \
  --glob '!docs/superpowers/plans/**' \
  --glob '!docs/superpowers/specs/**' \
  --glob '!docs/superpowers/notes/**' \
  --glob '!**/dist/**' \
  --glob '!**/*.map' \
  --glob '!LOOP24-PATCHES.md' \
  --glob '!native/crates/**'

rg -n '\bGSD\b|\bgsd\b|\.gsd|GSD_|gsd_' docs/dev docs/user-docs docs/extension-sdk packages/mcp-server/README.md README.md src/resources/WORKFLOW.md src/resources/skills --glob '*.md'
```

Expected:
- First command exits 1 with no output.
- Second command only outputs accepted upstream provenance references, if any.

- [ ] **Step 5: Commit**

```bash
git add scripts package.json package-lock.json
git commit -m "test(otto): add branding residue guard"
```

---

## Self-Review

**Spec coverage:** Covers active `LOOP24_*` env removal, package-scope rename, active extension/product names, developer docs, user docs, bundled skill docs, residue guard, and full verification. Explicitly excludes archival superpowers plans/specs/notes and preserves upstream provenance references.

**Placeholder scan:** No task contains TBD/TODO/fill-later placeholders. Every task includes exact file families, commands, expected outcomes, and representative code or mapping.

**Type consistency:** The canonical names are consistently `OTTO_*`, `/otto`, `.otto/workflow`, `otto_*`, `@otto/*`, and `@otto-build/*`.

**Risk notes:** Package-scope rename is the highest-risk step because it touches import resolution, lockfile state, and test resolver aliases. Keep it isolated from env-var cleanup so failures point to one cause.
