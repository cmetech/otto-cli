# LOOP24 Phase 5 — Prompt Engineer Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/loop24 prompt-engineer <task description>` — a one-shot LLM call that takes a rough developer request and returns a polished prompt suitable for handing to a coding agent. Prints the polished prompt to stdout AND saves it to `~/.loop24/prompts/<YYYY-MM-DD>-<slug>.md` for user-scoped prompt history.

**Architecture:** Smallest piece in the LOOP24 roadmap (per design spec §6.4 — "Pure LLM call against the gateway with a templated system prompt. No LangFlow involved"). Three internal pieces inside `src/resources/extensions/loop24/commands/prompt-engineer/`: (1) `_template.ts` — opinionated system prompt constant that turns rough requests into structured prompts; (2) `_storage.ts` — slugify + atomic-write helper that persists each polished prompt to `~/.loop24/prompts/<YYYY-MM-DD>-<slug>.md`; (3) `command.ts` — slash command handler. Direct `@anthropic-ai/sdk` call (already a transitive dep via pi-ai) honoring `LOOP24_GATEWAY_URL` + `LOOP24_GATEWAY_TOKEN` for compliance. No agent-turn dispatch, no tool registration — pure command-handler→LLM→stdout+disk.

**Tech Stack:** TypeScript (`--experimental-strip-types`), Node ≥22, `@anthropic-ai/sdk` (direct), Node's built-in test runner, `node:fs/promises` for atomic write, brand helpers from `src/brand.ts` (or `process.env` directly — both work since `brand.ts` is already loaded by the time extensions initialize).

**⚠️ TS strip-types constraint:** all `.ts` files run through `--experimental-strip-types`. Avoid `enum`, `namespace`, parameter-property constructors (`constructor(private readonly x: T) {}`), and `import =`. Use explicit field declarations + assignment.

**⚠️ Compliance:** All LLM traffic MUST go through the configured `LOOP24_GATEWAY_URL` when set. Honor `LOOP24_GATEWAY_TOKEN` for Bearer auth in gateway mode. Direct Anthropic mode (no gateway) uses `ANTHROPIC_API_KEY` from env. This matches what Phase 1 wired up in `packages/pi-ai/src/providers/anthropic.ts`.

**Scope boundary:**

In scope:
- `/loop24 prompt-engineer <description>` slash command — registered as a `pi.registerCommand` handler
- System prompt template — hand-crafted, opinionated, expects to produce structured polished prompts
- Anthropic SDK direct call honoring gateway routing
- Save to `~/.loop24/prompts/<YYYY-MM-DD>-<slug>.md` with original request + polished prompt + metadata
- Print polished prompt to stdout (the deliverable), save path to stderr (operational metadata)
- Empty-args case → usage hint
- LOOP24-PATCHES.md Phase 5 section + git tag `phase-5-prompt-engineer`

Out of scope (deferred):
- `loop24 prompts list` / `loop24 prompts show <id>` sub-commands — the user picked save+print knowing they'd need to `ls ~/.loop24/prompts/` until a list command lands. Tracked as a Phase 5 follow-up but NOT in this plan.
- Streaming output — one-shot call, returns full text, prints once. Streaming is unnecessary UX for a sub-second polish task.
- Model selection UI — uses Claude Haiku by default (fast + cheap, ideal for polish tasks). Override via `LOOP24_PROMPT_ENGINEER_MODEL` env var.
- Multi-language variants of the system prompt — single English template.
- Custom output formats (JSON, plain text, etc.) — markdown only.

**Dependencies:**
- `@anthropic-ai/sdk` — already a transitive dep via pi-ai (verified in `packages/pi-ai/src/providers/anthropic.ts:3`).
- Either `LOOP24_GATEWAY_URL` configured (gateway mode) OR `ANTHROPIC_API_KEY` set (direct mode). If neither, the command fails clear with an install-config pointer.
- `HOME` env var (universal on macOS/Linux; Windows is out of scope for v1).

---

## File Structure

### New files

```
src/resources/extensions/loop24/commands/prompt-engineer/
├── _template.ts                                 # NEW — system prompt constant
├── _storage.ts                                  # NEW — slugify + save helper
└── command.ts                                   # NEW — slash command handler

src/resources/extensions/loop24/tests/
├── prompt-engineer-storage.test.ts              # NEW — TDD for _storage.ts
└── prompt-engineer-template.test.ts             # NEW — sanity check for the template
```

### Modified files

- `src/resources/extensions/loop24/index.ts` — add `import { registerPromptEngineerCommand } from "./commands/prompt-engineer/command.js";` and call it in the `Loop24(pi)` body alongside the Phase 4 registrations.
- `src/resources/extensions/loop24/extension-manifest.json` — bump `version` 0.2.0 → 0.3.0; add `"prompt-engineer"` to `provides.commands`; update `description`.

### File responsibilities

| File | Responsibility |
|---|---|
| `_template.ts` | Exports `PROMPT_ENGINEER_SYSTEM` constant. Hand-crafted system prompt that turns rough task descriptions into structured polished prompts. |
| `_storage.ts` | `savePromptHistory(description, polished, modelId, opts?)` → writes `~/.loop24/prompts/<YYYY-MM-DD>-<slug>.md` atomically (tmp + rename). Returns the absolute path. Slug = first ~50 chars of description, kebab-cased, ASCII-only. Collision handling: appends a short UTC time suffix when same-day same-slug already exists. |
| `command.ts` | `registerPromptEngineerCommand(pi)`. Handler: validates args → builds Anthropic client honoring gateway → calls `messages.create` once → extracts text → prints polished prompt to stdout → calls `savePromptHistory` → prints save path to stderr. |

---

## Task 1: System prompt template

**Files:**
- Create: `src/resources/extensions/loop24/commands/prompt-engineer/_template.ts`
- Create: `src/resources/extensions/loop24/tests/prompt-engineer-template.test.ts`

A pure constant + a sanity test. Trivial to write but pinning it lets future edits be reviewed atomically.

- [ ] **Step 1: Write the test**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tests/prompt-engineer-template.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROMPT_ENGINEER_SYSTEM } from "../commands/prompt-engineer/_template.js";

test("PROMPT_ENGINEER_SYSTEM is non-trivial and mentions the polish task", () => {
  assert.ok(typeof PROMPT_ENGINEER_SYSTEM === "string");
  assert.ok(PROMPT_ENGINEER_SYSTEM.length > 400, "expected a non-trivial system prompt");
  // Sanity-check the prompt teaches the model what to do
  assert.match(PROMPT_ENGINEER_SYSTEM, /polish|polished|polishing/i);
  assert.match(PROMPT_ENGINEER_SYSTEM, /coding agent|llm|claude/i);
});

test("PROMPT_ENGINEER_SYSTEM does NOT instruct the model to add preamble", () => {
  // The handler will print the response verbatim — preamble like "Here's your
  // polished prompt:" would leak into stdout. Verify the template tells the
  // model to skip it.
  assert.match(PROMPT_ENGINEER_SYSTEM, /no preamble|without preamble|do not include|don't include|output only/i);
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/prompt-engineer-template.test.ts 2>&1 | tail -5
```

Expected: module-not-found.

- [ ] **Step 3: Write the template**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/commands/prompt-engineer/_template.ts`:

```typescript
/**
 * System prompt for /loop24 prompt-engineer.
 *
 * Opinionated. Turns rough developer task descriptions into structured
 * prompts suitable for handing to a coding agent (Claude Code, GitHub
 * Copilot Chat, or another LLM).
 *
 * Tone: terse, technical, no marketing fluff. Model is told to output ONLY
 * the polished prompt — no preamble, no commentary — because the handler
 * writes the response verbatim to stdout.
 */

export const PROMPT_ENGINEER_SYSTEM = `You are a prompt engineer for software developers.

You receive a rough description of a software engineering task. Your job is
to polish it into a structured prompt suitable for handing to a coding agent
(Claude Code, GitHub Copilot Chat, Cursor, or another LLM).

The polished prompt should:
- Open with a clear, single-sentence statement of the goal
- Identify the key files, components, or systems likely involved (best guess
  from context — say "likely involved" if you're inferring)
- Specify success criteria — how will the agent know the task is done?
- Call out constraints, edge cases, and explicit non-goals
- Suggest a tactical approach (TDD, refactor first, smallest-vertical-slice,
  etc.) when one is clearly more appropriate than another
- Close with a request for the agent to ask clarifying questions before
  starting if anything is ambiguous

Style:
- Concise. No filler. No marketing language.
- Use markdown headings if the prompt is non-trivial in length.
- Match the user's vocabulary — don't introduce jargon they didn't use.
- Don't include meta-commentary about your process.
- Don't include preamble like "Here's your polished prompt:" — output only
  the polished prompt itself.

If the user's request is genuinely too vague to polish into something
actionable, output a single section: "## Clarifying questions needed" with
2-4 specific questions that would unblock a useful polish. Do not invent
context.`;
```

- [ ] **Step 4: Run, verify PASS**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/prompt-engineer-template.test.ts 2>&1 | tail -5
```

Expected: 2/2 pass.

- [ ] **Step 5: Stage (do NOT commit — controller will commit)**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/commands/prompt-engineer/_template.ts \
        src/resources/extensions/loop24/tests/prompt-engineer-template.test.ts
git status --short
```

---

## Task 2: Storage helper (TDD)

**Files:**
- Create: `src/resources/extensions/loop24/commands/prompt-engineer/_storage.ts`
- Create: `src/resources/extensions/loop24/tests/prompt-engineer-storage.test.ts`

Atomic write of the polished prompt to `~/.loop24/prompts/<YYYY-MM-DD>-<slug>.md`. Slug derived from the first ~50 chars of the description. Collision handling: same-day same-slug gets a UTC time suffix.

- [ ] **Step 1: Write failing tests**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/tests/prompt-engineer-storage.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savePromptHistory, slugify } from "../commands/prompt-engineer/_storage.js";

function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "loop24-prompts-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("slugify produces kebab-cased ASCII safe for filenames", () => {
  assert.equal(slugify("Summarize a chunk of text"), "summarize-a-chunk-of-text");
  assert.equal(slugify("Build /loop24 build-flow handler"), "build-loop24-build-flow-handler");
  assert.equal(slugify("Fix bug #1234: race in cache"), "fix-bug-1234-race-in-cache");
  assert.equal(slugify("   weird    whitespace\t\nstuff   "), "weird-whitespace-stuff");
  assert.equal(slugify("résumé café naïve"), "resume-cafe-naive");
});

test("slugify truncates to ~50 chars at word boundaries", () => {
  const long = "implement a really long feature description that goes on and on and on";
  const slug = slugify(long);
  assert.ok(slug.length <= 50, `expected slug ≤50 chars, got ${slug.length}`);
  assert.ok(!slug.endsWith("-"), "expected no trailing hyphen");
});

test("slugify falls back to 'prompt' for input with no slug-able chars", () => {
  assert.equal(slugify("!!!"), "prompt");
  assert.equal(slugify(""), "prompt");
});

test("savePromptHistory writes a markdown file with description + polished + metadata", async () => {
  await withTempDir(async (dir) => {
    const path = await savePromptHistory({
      description: "Refactor the auth module",
      polished: "## Goal\nRefactor the auth module...",
      modelId: "claude-haiku-4-5-20251001",
      baseDir: dir,
    });
    assert.ok(path.startsWith(dir), `path should be inside baseDir; got ${path}`);
    assert.ok(path.endsWith(".md"));
    assert.ok(existsSync(path));
    const body = readFileSync(path, "utf-8");
    assert.match(body, /Refactor the auth module/);     // original request
    assert.match(body, /## Goal\nRefactor the auth module/);  // polished
    assert.match(body, /claude-haiku-4-5-20251001/);    // model
    assert.match(body, /\/loop24 prompt-engineer/);     // attribution
  });
});

test("savePromptHistory uses today's date in the filename", async () => {
  await withTempDir(async (dir) => {
    const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
    const path = await savePromptHistory({
      description: "Test request",
      polished: "polished body",
      modelId: "haiku",
      baseDir: dir,
    });
    assert.match(path, new RegExp(`/${today}-test-request\\.md$`));
  });
});

test("savePromptHistory disambiguates same-day same-slug collisions", async () => {
  await withTempDir(async (dir) => {
    const args = { description: "Same input", polished: "p1", modelId: "m", baseDir: dir };
    const path1 = await savePromptHistory(args);
    const path2 = await savePromptHistory({ ...args, polished: "p2" });
    assert.notEqual(path1, path2, "expected disambiguated paths on collision");
    assert.ok(existsSync(path1));
    assert.ok(existsSync(path2));
    assert.equal(readFileSync(path1, "utf-8").includes("p1"), true);
    assert.equal(readFileSync(path2, "utf-8").includes("p2"), true);
  });
});

test("savePromptHistory creates the baseDir if missing", async () => {
  await withTempDir(async (outer) => {
    const baseDir = join(outer, "does", "not", "exist", "yet");
    assert.equal(existsSync(baseDir), false);
    const path = await savePromptHistory({
      description: "Create dir",
      polished: "x",
      modelId: "m",
      baseDir,
    });
    assert.ok(existsSync(path));
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/prompt-engineer-storage.test.ts 2>&1 | tail -8
```

- [ ] **Step 3: Implement `_storage.ts`**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/commands/prompt-engineer/_storage.ts`:

```typescript
/**
 * Prompt-engineer history storage.
 *
 * Saves each polished prompt to ~/.loop24/prompts/<YYYY-MM-DD>-<slug>.md
 * atomically (tmp + rename). Collision-safe: same-day same-slug appends a
 * UTC time suffix.
 *
 * Default baseDir: ~/.loop24/prompts (resolved via CONFIG_DIR_NAME at
 * call time). Tests inject a temp dir via the baseDir option.
 */

import { writeFile, mkdir, rename, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface SavePromptHistoryOptions {
  description: string;     // user's original input
  polished: string;        // LLM's polished output
  modelId: string;         // for traceability in the saved file
  baseDir?: string;        // override for tests; default ~/.loop24/prompts
}

const FALLBACK_SLUG = "prompt";
const MAX_SLUG_LEN = 50;

/**
 * Convert arbitrary text into a kebab-cased ASCII slug suitable for a
 * filename. Strips diacritics, removes non-alnum-hyphen chars, collapses
 * runs of hyphens, truncates at word boundaries to ~50 chars. Falls back
 * to "prompt" if the result is empty.
 */
export function slugify(text: string): string {
  const normalized = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")  // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")      // non-alnum → hyphen
    .replace(/^-+|-+$/g, "")           // trim leading/trailing hyphens
    .replace(/-{2,}/g, "-");           // collapse runs

  if (normalized.length === 0) return FALLBACK_SLUG;
  if (normalized.length <= MAX_SLUG_LEN) return normalized;

  // Truncate at the last word boundary within the limit.
  const cut = normalized.slice(0, MAX_SLUG_LEN);
  const lastHyphen = cut.lastIndexOf("-");
  return (lastHyphen > 20 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/, "");
}

function defaultBaseDir(): string {
  return join(homedir(), ".loop24", "prompts");
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
}

function utcTimeSuffix(): string {
  return new Date().toISOString().slice(11, 19).replace(/:/g, "");  // HHMMSS
}

function buildMarkdown(
  description: string,
  polished: string,
  modelId: string,
  generatedAt: string,
): string {
  return [
    `# Polished prompt — ${generatedAt}`,
    "",
    "## Original request",
    "",
    "```",
    description,
    "```",
    "",
    "## Polished prompt",
    "",
    polished,
    "",
    "---",
    `Model: \`${modelId}\``,
    `Generated by \`/loop24 prompt-engineer\``,
    "",
  ].join("\n");
}

export async function savePromptHistory(opts: SavePromptHistoryOptions): Promise<string> {
  const baseDir = opts.baseDir ?? defaultBaseDir();
  await mkdir(baseDir, { recursive: true });

  const date = todayUtcDate();
  const slug = slugify(opts.description);
  let path = join(baseDir, `${date}-${slug}.md`);
  if (existsSync(path)) {
    const suffix = utcTimeSuffix();
    path = join(baseDir, `${date}-${slug}-${suffix}.md`);
    // If THAT also exists (sub-second collision), keep appending until clean.
    let i = 0;
    while (existsSync(path)) {
      path = join(baseDir, `${date}-${slug}-${suffix}-${++i}.md`);
    }
  }

  const generatedAt = new Date().toISOString();
  const body = buildMarkdown(opts.description, opts.polished, opts.modelId, generatedAt);

  const tmpPath = `${path}.tmp`;
  await writeFile(tmpPath, body, { mode: 0o600 });
  await rename(tmpPath, path);
  return path;
}
```

- [ ] **Step 4: Run, verify PASS**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  src/resources/extensions/loop24/tests/prompt-engineer-storage.test.ts 2>&1 | tail -10
```

Expected: 7/7 pass.

- [ ] **Step 5: Stage (do NOT commit)**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/commands/prompt-engineer/_storage.ts \
        src/resources/extensions/loop24/tests/prompt-engineer-storage.test.ts
git status --short
```

---

## Task 3: Command handler with direct Anthropic SDK call

**Files:**
- Create: `src/resources/extensions/loop24/commands/prompt-engineer/command.ts`

Direct `@anthropic-ai/sdk` call. Honor `LOOP24_GATEWAY_URL` + `LOOP24_GATEWAY_TOKEN`. Pick `claude-haiku-4-5-20251001` by default (fast, cheap, ideal for polish); allow `LOOP24_PROMPT_ENGINEER_MODEL` override.

No TDD for this file — the LLM call is the integration point and mocking the SDK is more friction than benefit. The template + storage tests (Tasks 1 + 2) cover the deterministic pieces; this file is the glue. Manual smoke in Task 5.

- [ ] **Step 1: Confirm @anthropic-ai/sdk is importable from an extension**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
node -e "import('@anthropic-ai/sdk').then(m => console.log('ok:', Object.keys(m.default || m).slice(0, 5)))"
```

Expected: prints something like `ok: [ 'Anthropic', 'APIError', ... ]`. If it errors, the SDK isn't resolvable from the workspace root — fix by ensuring it's in the workspace's package.json dependencies (it is, transitively, via `@gsd/pi-ai`).

- [ ] **Step 2: Write the command handler**

Create `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/commands/prompt-engineer/command.ts`:

```typescript
/**
 * /loop24 prompt-engineer <description>
 *
 * One-shot LLM call. Takes a rough developer task description, returns a
 * polished prompt suitable for handing to a coding agent. Prints the
 * polished prompt to stdout (the deliverable) and saves a copy to
 * ~/.loop24/prompts/<YYYY-MM-DD>-<slug>.md (user-scoped history).
 *
 * Compliance: honors LOOP24_GATEWAY_URL when set so all LLM traffic exits
 * through the LOOP24 gateway. Without a gateway, requires ANTHROPIC_API_KEY.
 *
 * Model: defaults to claude-haiku-4-5-20251001 (fast, cheap, ideal for a
 * polish task). Override with LOOP24_PROMPT_ENGINEER_MODEL.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";
import { PROMPT_ENGINEER_SYSTEM } from "./_template.js";
import { savePromptHistory } from "./_storage.js";

const USAGE = `Usage: /loop24 prompt-engineer <rough task description>

Examples:
  /loop24 prompt-engineer add caching to the search endpoint
  /loop24 prompt-engineer refactor auth module to remove session tokens

Output: polished prompt printed to stdout; copy saved to ~/.loop24/prompts/.`;

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 4096;

interface PromptEngineerResult {
  polished: string;
  modelId: string;
}

async function runPromptEngineer(description: string): Promise<PromptEngineerResult> {
  const mod = await import("@anthropic-ai/sdk");
  const Anthropic = mod.default;

  const baseURL = process.env.LOOP24_GATEWAY_URL?.trim() || undefined;
  const gatewayToken = process.env.LOOP24_GATEWAY_TOKEN?.trim() || undefined;
  const directApiKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;

  // Auth mode:
  //  - Gateway mode: baseURL set. Use authToken (Bearer) when token present;
  //    otherwise no auth (matches the LOOP24 gateway's optional-token contract).
  //  - Direct mode: no baseURL. Use apiKey from ANTHROPIC_API_KEY.
  let clientOpts: ConstructorParameters<typeof Anthropic>[0];
  if (baseURL) {
    clientOpts = gatewayToken
      ? { baseURL, authToken: gatewayToken, apiKey: "unused" }
      : { baseURL, apiKey: "unused" };
  } else {
    if (!directApiKey) {
      throw new Error(
        "No LLM credentials configured. Set LOOP24_GATEWAY_URL (gateway mode) " +
        "or ANTHROPIC_API_KEY (direct mode). See `loop24 config` for setup.",
      );
    }
    clientOpts = { apiKey: directApiKey };
  }

  const client = new Anthropic(clientOpts);
  const modelId = process.env.LOOP24_PROMPT_ENGINEER_MODEL?.trim() || DEFAULT_MODEL;

  const response = await client.messages.create({
    model: modelId,
    max_tokens: MAX_TOKENS,
    system: PROMPT_ENGINEER_SYSTEM,
    messages: [{ role: "user", content: description }],
  });

  const polished = response.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (!polished) {
    throw new Error("LLM returned an empty response. Try rephrasing your request.");
  }

  return { polished, modelId };
}

export function registerPromptEngineerCommand(pi: ExtensionAPI): void {
  pi.registerCommand("prompt-engineer", {
    description: "Polish a rough task description into a structured prompt for a coding agent",
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      const description = args.trim();
      if (!description) {
        process.stderr.write(USAGE + "\n");
        return;
      }

      let result: PromptEngineerResult;
      try {
        result = await runPromptEngineer(description);
      } catch (err) {
        process.stderr.write(`[loop24 prompt-engineer] ${(err as Error).message}\n`);
        return;
      }

      // Polished prompt to stdout (the deliverable).
      process.stdout.write(result.polished + "\n");

      // Persist to ~/.loop24/prompts/ and surface the save path to stderr.
      try {
        const savedPath = await savePromptHistory({
          description,
          polished: result.polished,
          modelId: result.modelId,
        });
        process.stderr.write(`[loop24 prompt-engineer] saved → ${savedPath}\n`);
      } catch (err) {
        process.stderr.write(`[loop24 prompt-engineer] save failed: ${(err as Error).message}\n`);
      }
    },
  });
}
```

- [ ] **Step 3: Build**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
```

If the Anthropic SDK constructor's option type rejects the `authToken` field (some SDK versions name it `auth_token`), check the actual type:
```bash
grep -nE "authToken\|auth_token" node_modules/@anthropic-ai/sdk/src/*.ts node_modules/@anthropic-ai/sdk/index.d.ts 2>/dev/null | head -5
```
Adjust the field name to match the installed SDK version.

- [ ] **Step 4: Stage (do NOT commit)**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/commands/prompt-engineer/command.ts
git status --short
```

---

## Task 4: Wire into index.ts + bump manifest

**Files:**
- Modify: `src/resources/extensions/loop24/index.ts`
- Modify: `src/resources/extensions/loop24/extension-manifest.json`

- [ ] **Step 1: Add the import + registration to index.ts**

Edit `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/index.ts`.

Add the import near the existing Phase 4 imports:
```typescript
import { registerPromptEngineerCommand } from "./commands/prompt-engineer/command.js";
```

In the `Loop24(pi)` function body, after the Phase 4 registrations (`registerBuildFlowCommand(pi);`), add:
```typescript
  // ── Register /loop24 prompt-engineer slash command (Phase 5) ──
  registerPromptEngineerCommand(pi);
```

Update the file's top docblock to mention Phase 5: add a line under "Owns:" — `*   - One-shot LLM polish: /loop24 prompt-engineer`.

- [ ] **Step 2: Bump the manifest**

Edit `/Users/coreyellis/Projects/repos/local/loop24-client/src/resources/extensions/loop24/extension-manifest.json` to:

```json
{
  "id": "loop24",
  "name": "LOOP24",
  "version": "0.3.0",
  "description": "LOOP24-specific services — gateway probe, LangFlow flow triggers (Phase 3), LangFlow flow builder (Phase 4), prompt engineer (Phase 5)",
  "tier": "core",
  "requires": { "platform": ">=2.29.0" },
  "provides": {
    "hooks": ["session_start"],
    "tools": [
      "loop24__refresh_catalog",
      "loop24__normalize_catalog",
      "loop24__check_catalog_health",
      "loop24__inspect_component",
      "loop24__validate_flow",
      "loop24__import_flow",
      "loop24__smoke_test_flow"
    ],
    "commands": ["build-flow", "prompt-engineer"]
  }
}
```

- [ ] **Step 3: Build + regression**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm run build 2>&1 | tail -3
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test \
  packages/pi-coding-agent/src/config.test.ts \
  src/resources/extensions/workflow/tests/update-command.test.ts \
  src/resources/extensions/workflow/tests/extension-bootstrap-isolation.test.ts \
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
  2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 4: Smoke — verify prompt-engineer is registered**

```bash
rm -rf ~/.loop24/agent
LOOP24_DEBUG_EXTENSIONS=1 loop24 --print "hi" 2>&1 | grep "loop24-debug" | grep -i "prompt-engineer"
```

Expected: a line confirming `prompt-engineer` was registered.

- [ ] **Step 5: Stage (do NOT commit)**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/loop24/index.ts \
        src/resources/extensions/loop24/extension-manifest.json
git status --short
```

---

## Task 5: Live smoke + tag + LOOP24-PATCHES.md

**Files:**
- Modify: `LOOP24-PATCHES.md`

- [ ] **Step 1: Live smoke (best-effort)**

Run a real prompt-engineer invocation to verify the LLM call + save path:

```bash
cd /tmp
loop24 --print "/loop24 prompt-engineer add rate limiting to the search endpoint" 2>&1 | tee /tmp/pe-smoke.log
ls -la ~/.loop24/prompts/ | head -5
cat ~/.loop24/prompts/$(ls -t ~/.loop24/prompts/ | head -1)
```

Expected:
- stdout contains the polished prompt
- stderr contains `[loop24 prompt-engineer] saved → /Users/...../prompt-engineer/2026-XX-XX-add-rate-limiting-to-the-search-endpoint.md`
- The saved file has the original request, polished prompt, model id, attribution

If the LLM call fails (no gateway, no API key, or auth error), capture the error message and continue — the registration + save-path code path is what matters for the tag. Note the failure in the LOOP24-PATCHES.md write-up.

- [ ] **Step 2: Append Phase 5 section to LOOP24-PATCHES.md**

Insert a new section between Phase 4 and "Known Deferred Cleanups":

```markdown
## Phase 5 — Prompt engineer command (tagged: phase-5-prompt-engineer)

Per design spec §6.4 — the "smallest piece" in the LOOP24 roadmap. Ships
`/loop24 prompt-engineer <description>` — a one-shot LLM call that turns a
rough developer request into a polished prompt suitable for handing to a
coding agent.

### src/resources/extensions/loop24/commands/prompt-engineer/_template.ts (NEW)
Exports `PROMPT_ENGINEER_SYSTEM` — opinionated system prompt that instructs
the model to polish a rough description into a structured coding-task prompt
(goal sentence, files involved, success criteria, constraints, tactical
approach, ask-clarifying-questions ending). Explicitly forbids preamble so
the handler can write the response verbatim to stdout. 2 sanity tests.

### src/resources/extensions/loop24/commands/prompt-engineer/_storage.ts (NEW)
`savePromptHistory({description, polished, modelId, baseDir?})` writes
`<baseDir>/<YYYY-MM-DD>-<slug>.md` atomically (tmp + rename, mode 0600).
Slug is kebab-cased ASCII (NFKD normalize → strip diacritics → alnum + hyphen)
truncated at word boundaries to ≤50 chars; falls back to "prompt" if input
has no slug-able chars. Same-day same-slug collisions get a UTC time suffix
(then a numeric suffix on sub-second collisions). Default baseDir:
`~/.loop24/prompts/`. 7 TDD tests.

### src/resources/extensions/loop24/commands/prompt-engineer/command.ts (NEW)
`registerPromptEngineerCommand(pi)` — registers `/loop24 prompt-engineer`.
Handler:
  1. Usage hint on empty args
  2. Direct `@anthropic-ai/sdk` call (`messages.create`, max_tokens 4096)
  3. Honors `LOOP24_GATEWAY_URL` (gateway mode, optional `LOOP24_GATEWAY_TOKEN`
     Bearer) or `ANTHROPIC_API_KEY` (direct mode); fails clear if neither
  4. Model defaults to `claude-haiku-4-5-20251001`; override with
     `LOOP24_PROMPT_ENGINEER_MODEL`
  5. Prints polished prompt to stdout (the deliverable)
  6. Saves a copy via `savePromptHistory()`; surfaces save path to stderr

No TDD on the handler — LLM call is the integration boundary, mocking the
SDK is more friction than benefit. The deterministic pieces (template,
storage) are fully TDD-covered. Manual smoke at Phase 5 tag.

### src/resources/extensions/loop24/index.ts (MODIFIED)
Added `registerPromptEngineerCommand(pi)` after the Phase 4 registrations.

### src/resources/extensions/loop24/extension-manifest.json (MODIFIED)
Version 0.2.0 → 0.3.0. Description updated to mention Phase 5.
`provides.commands` extends to `["build-flow", "prompt-engineer"]`.

### New env vars
- `LOOP24_PROMPT_ENGINEER_MODEL` — optional override for the model used by
  `/loop24 prompt-engineer`. Defaults to `claude-haiku-4-5-20251001`.

### Tests added
`prompt-engineer-template.test.ts` (2), `prompt-engineer-storage.test.ts` (7)
= **9 new tests**, all passing. Full regression at end of Task 4: all pass.

### Deferred (out of scope; explicitly chosen by controller)
- `/loop24 prompts list` and `/loop24 prompts show <id>` sub-commands — until
  one ships, browse with `ls ~/.loop24/prompts/` and `cat ...`.

### Live smoke (Task 5)
[Fill in with actual results after running Step 1 — what was generated,
file path, model used, anything unexpected.]
```

- [ ] **Step 3: Stage + commit + tag**

The controller will commit. Stage only:

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add LOOP24-PATCHES.md
git status --short
```

Controller will commit all staged files (Tasks 1–4 plus this patches doc) in a sequence of atomic commits, then tag `phase-5-prompt-engineer`.

---

## Definition of Done

Phase 5 is complete when ALL of these are true:

- `PROMPT_ENGINEER_SYSTEM` exists and instructs the model to output ONLY the polished prompt.
- `slugify()` produces predictable kebab-cased ASCII slugs and handles edge cases (diacritics, whitespace, empty input, long input).
- `savePromptHistory()` writes atomically, creates the dir on demand, disambiguates collisions, and includes original + polished + model id + attribution.
- `/loop24 prompt-engineer` is a registered command in the loop24 extension.
- The handler honors `LOOP24_GATEWAY_URL` + `LOOP24_GATEWAY_TOKEN` (gateway mode) or falls back to `ANTHROPIC_API_KEY` (direct mode), with a clear error if neither is configured.
- Empty args → usage hint, no LLM call.
- Successful invocation prints the polished prompt to stdout and saves to `~/.loop24/prompts/<YYYY-MM-DD>-<slug>.md`.
- `extension-manifest.json` bumped to 0.3.0; declares the new command.
- All Phase 0–4 regression tests still pass, plus Phase 5's 9 new tests.
- `LOOP24_DEBUG_EXTENSIONS=1 loop24 --print "hi" 2>&1 | grep "loop24-debug" | grep "prompt-engineer"` confirms registration.
- `phase-5-prompt-engineer` git tag exists.
- LOOP24-PATCHES.md has a Phase 5 section.

---

## Self-Review

**Spec coverage (vs design spec §6.4):**
- ✅ "Pure LLM call against the gateway" — Task 3 (gateway routing via `LOOP24_GATEWAY_URL`)
- ✅ "Templated system prompt" — Task 1 (`PROMPT_ENGINEER_SYSTEM`)
- ✅ "No LangFlow involved" — Task 3 imports `@anthropic-ai/sdk` directly, no LangFlow client
- ✅ "Imperative TS module in `commands/prompt-engineer/`" — exact path
- ✅ Q5 resolved to "print + save to ~/.loop24/prompts/" — Tasks 2 + 3

**Placeholder scan:** None. All code blocks are concrete. The patches-doc "Live smoke" subsection is the only TODO — explicitly marked for fill-in after running Task 5 Step 1.

**Type consistency:**
- `SavePromptHistoryOptions` → defined Task 2, consumed Task 3
- `slugify(text)`, `savePromptHistory(opts)` — signatures stable
- `PROMPT_ENGINEER_SYSTEM` — single constant, single consumer
- `registerPromptEngineerCommand(pi)` — single registration call

**Known risks:**
1. **Anthropic SDK `authToken` field name** — Task 3 uses `authToken`; some SDK versions use `auth_token` or expect Bearer via a custom header. Step 3 of Task 3 has the verification grep.
2. **Module resolution for `@anthropic-ai/sdk`** — works in the workspace context because pi-ai depends on it; verify with Step 1 of Task 3.
3. **`ctx.cwd` not used** — the prompt-engineer is workspace-agnostic. The handler doesn't need workspace state. This is deliberate.
4. **No streaming** — the response prints once at the end. For a sub-second polish task this is fine; if users complain about latency feeling unresponsive, swap to `messages.stream` in a follow-up.

---

*End of Phase 5 plan.*
