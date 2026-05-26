# LOOP24 Phase 9 — npm workspace scope rename

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

> **NEVER `git add -A` in this repo.** Always stage explicit file paths. `docs/branding/` is the user's active working area — keep hands off.

**Goal:** Rename the `@gsd/*` and `@gsd-build/*` npm workspace scopes to `@loop24/*` and `@loop24-build/*` respectively. Fix stale `@opengsd/gsd-pi` update-check references to point at `@ericsson/loop24` (the actual published package).

**Architecture:** Single coordinated phase because npm workspaces are link-resolved at install time — a half-renamed scope breaks ALL workspace consumers, not just the renamed package. We rename `name` fields and dependency declarations in one atomic commit, then sweep imports separately.

**Tech Stack:** TypeScript, npm workspaces, package.json edits.

## Mapping

| Old | New | Type |
|---|---|---|
| `@gsd/native` | `@loop24/native` | workspace |
| `@gsd/pi-coding-agent` | `@loop24/pi-coding-agent` | workspace |
| `@gsd/pi-ai` | `@loop24/pi-ai` | workspace |
| `@gsd/pi-tui` | `@loop24/pi-tui` | workspace |
| `@gsd/pi-agent-core` | `@loop24/pi-agent-core` | workspace |
| `@gsd-build/contracts` | `@loop24-build/contracts` | workspace |
| `@gsd-build/mcp-server` | `@loop24-build/mcp-server` | workspace |
| `@gsd-build/rpc-client` | `@loop24-build/rpc-client` | workspace |
| `@gsd-build/daemon` | `@loop24-build/daemon` | workspace |
| `@gsd/claude-code-cli` | `@loop24/claude-code-cli` | extension |
| `@gsd/cmux` | `@loop24/cmux` | extension |
| `@opengsd/gsd-pi` (update-check refs) | `@ericsson/loop24` | update-check redirect |

**Test-fixture-only names** (not real packages — used as parser-test inputs in `workspace-manifest.test.ts`, `extension-validator.test.ts`): `@gsd/foo`, `@gsd/wrong-name`, `@gsd/pkg-a`, `@gsd/agent`, `@gsd/agent-core`, `@gsd/agent-modes`, `@gsd/extension-breakout`, `@gsd/provider-anthropic`, `@gsd-build/pkg-b`, `@gsd-build/internal-pkg`, `@gsd-build/engine-`. Renamed for consistency since the parser-recognition assertions key off the scope.

## Tasks

1. Plan stub (this doc)
2. Rename workspace + extension package.json `name` fields (11 files)
3. Update workspace cross-dependencies (deps/devDeps fields)
4. Sweep all imports + dynamic `import()` calls (mechanical perl)
5. Fix `@opengsd/gsd-pi` update-check refs → `@ericsson/loop24` (5+ files)
6. Update test fixtures (parser tests)
7. `npm install` to re-link workspaces, build, regression, commit, tag

**Success criteria for every task:** `npm run build` clean AND standing 74-test regression pass. No `git add -A`.

## Standing regression set (same as Phase 8)

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
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

## Reference counts (audit pre-flight)

- `@gsd/pi-coding-agent`: 354 references
- `@gsd/pi-ai`: 152
- `@gsd/pi-tui`: 149
- `@gsd/pi-agent-core`: 52
- `@gsd/native`: 52
- `@gsd-build/contracts`: 26
- `@gsd-build/rpc-client`: 23
- `@gsd-build/mcp-server`: 22
- `@gsd/cmux`: 3
- `@gsd-build/daemon`: 2
- `@gsd/claude-code-cli`: 1

**Total in scope: ~836 references across ~150+ files.**

## Out of scope (deferred)

- LICENSE attribution to Lex Christopherson — MIT required
- README "Fork attribution" block — MIT required
- LOOP24-PATCHES.md — fork-history doc
- Commit history — destructive to rewrite
- `docs/branding/` — user's working area
- The 269 GSD-prefixed identifiers Task 6's grep missed (separate follow-up)
- The 22 additional OTTO_X env vars (separate follow-up)
- customType strings `"gsd-*"` and `.gsd/` directory references (Phase 10)
