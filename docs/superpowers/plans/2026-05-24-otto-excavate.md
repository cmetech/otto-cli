# OTTO `excavate` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/otto excavate <path>` — a bundled OTTO command that reverse-engineers a source repo into raw-tier, provenance-cited behavioral specs by injecting an orchestrator playbook as an agent turn that fans out general-purpose workers.

**Architecture:** A bundled TS extension registers the command; its handler does thin deterministic prep (validate args, resolve bundled-skill paths, build a playbook string) then calls `pi.sendUserMessage(playbook)` to run it. The agent executes the playbook — init a git-versioned `./analysis-workspace/`, dispatch general-purpose `Agent` workers (batched ≤4) that `Read` bundled OTTO-rebranded methodology skills and write provenance-cited specs, then a light verify + summary. No `resource-loader` change (extensions + skills already sync).

**Tech Stack:** TypeScript (ESM, `@loop24/pi-coding-agent` `ExtensionAPI`), `node:test` + `node:assert/strict`, the repo's bundled-extension pattern (`src/resources/extensions/*/{extension-manifest.json,index.ts}`).

**Reference facts (verified):**
- ExtensionAPI: `registerCommand(name, { description, handler })` (`types.ts:1428`); `sendUserMessage(content, { deliverAs? })` "always triggers a turn" (`types.ts:1485`).
- Bundled extensions auto-enable via `ensureRegistryEntries` (`resource-loader.ts:651`); skills sync to `~/.agents/skills` (`:628`).
- Source greenfield skills to adapt live at `~/.claude/skills/greenfield-{source-analysis,multi-source-synthesis,behavioral-spec-writing,provenance-methodology,validation-methodology}/SKILL.md`.
- Repo: `/Users/coreyellis/Projects/repos/local/loop24-client`. Tests run with:
  `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test --test-timeout=30000 <file>`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/resources/extensions/excavate/extension-manifest.json` | Bundled-extension manifest (id, tier, provided command) |
| `src/resources/extensions/excavate/index.ts` | Entry: `default (pi) =>` registers the command |
| `src/resources/extensions/excavate/args.ts` | **Pure**: parse/validate `<path> [--workspace <dir>]` |
| `src/resources/extensions/excavate/paths.ts` | **Pure**: resolve the 5 bundled skill absolute paths |
| `src/resources/extensions/excavate/playbook.ts` | **Pure**: `buildPlaybook({target,workspace,skillPaths})` → string |
| `src/resources/extensions/excavate/command.ts` | Wire handler: args → paths → playbook → `pi.sendUserMessage` |
| `src/resources/extensions/excavate/tests/{args,paths,playbook}.test.ts` | Unit tests for the pure modules |
| `src/resources/skills/excavate-source-analysis/SKILL.md` | Methodology (← greenfield-source-analysis) |
| `src/resources/skills/excavate-synthesis/SKILL.md` | Methodology (← greenfield-multi-source-synthesis) |
| `src/resources/skills/excavate-spec-writing/SKILL.md` | Methodology (← greenfield-behavioral-spec-writing) |
| `src/resources/skills/excavate-provenance/SKILL.md` | Methodology (← greenfield-provenance-methodology) |
| `src/resources/skills/excavate-validation/SKILL.md` | Methodology (← greenfield-validation-methodology) |

Keep each TS file focused and pure where possible so it's unit-testable in isolation; the only non-pure file is `command.ts` (it calls `pi.*`).

---

## Task 1: Argument parsing (pure)

**Files:**
- Create: `src/resources/extensions/excavate/args.ts`
- Test: `src/resources/extensions/excavate/tests/args.test.ts`

- [ ] **Step 1: Write the failing test**

`src/resources/extensions/excavate/tests/args.test.ts`:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExcavateArgs } from "../args.js";

describe("parseExcavateArgs", () => {
  it("parses a bare target path with the default workspace", () => {
    assert.deepEqual(parseExcavateArgs("./repo"), {
      ok: true, target: "./repo", workspace: "./analysis-workspace",
    });
  });
  it("honors --workspace override (space form)", () => {
    assert.deepEqual(parseExcavateArgs("./repo --workspace ./out"), {
      ok: true, target: "./repo", workspace: "./out",
    });
  });
  it("honors --workspace=VALUE (equals form)", () => {
    assert.deepEqual(parseExcavateArgs("./repo --workspace=./out"), {
      ok: true, target: "./repo", workspace: "./out",
    });
  });
  it("errors when no target is given", () => {
    const r = parseExcavateArgs("");
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /target path/i);
  });
  it("errors when --workspace has no value", () => {
    const r = parseExcavateArgs("./repo --workspace");
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /--workspace/);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/excavate/tests/args.test.ts`
Expected: FAIL — cannot find module `../args.js`.

- [ ] **Step 3: Implement `args.ts`**

`src/resources/extensions/excavate/args.ts`:
```typescript
export type ParsedArgs =
  | { ok: true; target: string; workspace: string }
  | { ok: false; error: string };

const DEFAULT_WORKSPACE = "./analysis-workspace";

// Parse `<target> [--workspace <dir>|--workspace=<dir>]`. Quotes are not
// required for the PoC-scale usage; tokens split on whitespace.
export function parseExcavateArgs(raw: string): ParsedArgs {
  const tokens = (raw ?? "").trim().split(/\s+/).filter(Boolean);
  let target: string | undefined;
  let workspace = DEFAULT_WORKSPACE;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "--workspace") {
      const v = tokens[++i];
      if (!v) return { ok: false, error: "--workspace requires a directory value" };
      workspace = v;
    } else if (t.startsWith("--workspace=")) {
      const v = t.slice("--workspace=".length);
      if (!v) return { ok: false, error: "--workspace requires a directory value" };
      workspace = v;
    } else if (!t.startsWith("-") && target === undefined) {
      target = t;
    }
  }

  if (!target) return { ok: false, error: "excavate requires a target path: /otto excavate <path>" };
  return { ok: true, target, workspace };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/excavate/tests/args.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/excavate/args.ts src/resources/extensions/excavate/tests/args.test.ts
git commit -m "feat(excavate): argument parsing for /otto excavate"
```

---

## Task 2: Skill-path resolution (pure)

**Files:**
- Create: `src/resources/extensions/excavate/paths.ts`
- Test: `src/resources/extensions/excavate/tests/paths.test.ts`

The 5 skills sync to `~/.agents/skills/excavate-*`. Resolve their SKILL.md absolute paths from a provided skills-root (injected so the test can pass a temp dir).

- [ ] **Step 1: Write the failing test**

`src/resources/extensions/excavate/tests/paths.test.ts`:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveSkillPaths, EXCAVATE_SKILLS } from "../paths.js";

describe("resolveSkillPaths", () => {
  it("maps every excavate skill to <root>/<name>/SKILL.md", () => {
    const root = "/tmp/skills";
    const paths = resolveSkillPaths(root);
    assert.equal(Object.keys(paths).length, EXCAVATE_SKILLS.length);
    assert.equal(paths["excavate-source-analysis"], join(root, "excavate-source-analysis", "SKILL.md"));
    assert.equal(paths["excavate-validation"], join(root, "excavate-validation", "SKILL.md"));
  });
  it("lists exactly the five core-slice skills", () => {
    assert.deepEqual([...EXCAVATE_SKILLS].sort(), [
      "excavate-provenance", "excavate-source-analysis", "excavate-spec-writing",
      "excavate-synthesis", "excavate-validation",
    ]);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/excavate/tests/paths.test.ts`
Expected: FAIL — cannot find module `../paths.js`.

- [ ] **Step 3: Implement `paths.ts`**

`src/resources/extensions/excavate/paths.ts`:
```typescript
import { homedir } from "node:os";
import { join } from "node:path";

export const EXCAVATE_SKILLS = [
  "excavate-source-analysis",
  "excavate-synthesis",
  "excavate-spec-writing",
  "excavate-provenance",
  "excavate-validation",
] as const;

export type ExcavateSkill = (typeof EXCAVATE_SKILLS)[number];
export type SkillPaths = Record<ExcavateSkill, string>;

/** The synced ecosystem skills dir (industry-standard skills.sh location). */
export function defaultSkillsRoot(): string {
  return join(homedir(), ".agents", "skills");
}

/** Map each excavate skill to its SKILL.md absolute path under `root`. */
export function resolveSkillPaths(root: string = defaultSkillsRoot()): SkillPaths {
  const out = {} as SkillPaths;
  for (const name of EXCAVATE_SKILLS) out[name] = join(root, name, "SKILL.md");
  return out;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/excavate/tests/paths.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/excavate/paths.ts src/resources/extensions/excavate/tests/paths.test.ts
git commit -m "feat(excavate): bundled-skill path resolution"
```

---

## Task 3: Orchestrator playbook builder (pure)

**Files:**
- Create: `src/resources/extensions/excavate/playbook.ts`
- Test: `src/resources/extensions/excavate/tests/playbook.test.ts`

- [ ] **Step 1: Write the failing test**

`src/resources/extensions/excavate/tests/playbook.test.ts`:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPlaybook } from "../playbook.js";
import { resolveSkillPaths } from "../paths.js";

describe("buildPlaybook", () => {
  const playbook = buildPlaybook({
    target: "/repo",
    workspace: "./analysis-workspace",
    skillPaths: resolveSkillPaths("/tmp/skills"),
  });

  it("embeds the target and workspace", () => {
    assert.match(playbook, /\/repo/);
    assert.match(playbook, /\.\/analysis-workspace/);
  });
  it("references each bundled skill path", () => {
    assert.match(playbook, /\/tmp\/skills\/excavate-source-analysis\/SKILL\.md/);
    assert.match(playbook, /\/tmp\/skills\/excavate-spec-writing\/SKILL\.md/);
    assert.match(playbook, /\/tmp\/skills\/excavate-provenance\/SKILL\.md/);
  });
  it("instructs general-purpose dispatch with a batch cap of 4", () => {
    assert.match(playbook, /general-purpose/);
    assert.match(playbook, /\b4\b/);
  });
  it("requires provenance citations and names the core stages", () => {
    assert.match(playbook, /<!-- cite:/);
    assert.match(playbook, /module-map/i);
    assert.match(playbook, /journeys/i);
    assert.match(playbook, /contracts/i);
    assert.match(playbook, /verification-report/i);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/excavate/tests/playbook.test.ts`
Expected: FAIL — cannot find module `../playbook.js`.

- [ ] **Step 3: Implement `playbook.ts`**

`src/resources/extensions/excavate/playbook.ts`:
```typescript
import type { SkillPaths } from "./paths.js";

export interface PlaybookInput {
  target: string;
  workspace: string;
  skillPaths: SkillPaths;
}

/**
 * Build the orchestrator playbook the agent executes. The agent runs the stages
 * itself, dispatching general-purpose Agent workers (each told to Read a bundled
 * skill for methodology) and writing provenance-cited specs into the workspace.
 */
export function buildPlaybook({ target, workspace, skillPaths }: PlaybookInput): string {
  return `You are running OTTO excavate: reverse-engineer the codebase at \`${target}\` into raw-tier behavioral specifications with provenance. Work methodically through the stages below and then STOP. Do the analysis by dispatching workers — keep your own context for coordination.

## Dispatch rules
- Dispatch each worker with the Agent tool, subagent_type "general-purpose".
- Each worker prompt MUST include: its ROLE, an instruction to "Read the skill file at <path> in full and follow its methodology", what to READ (inputs), what to WRITE (exact output path), and the Definition of Done.
- When workers in a stage are independent, dispatch them in ONE message in parallel, but cap each batch at 4 workers. Wait for the batch, commit, then the next batch.
- Every behavioral claim a worker writes MUST carry a provenance citation: \`<!-- cite: <relative-source-file>:Lx-Ly -->\`.
- If a worker returns no output, log it and continue — the verification stage will catch gaps. If a parallel batch fails, retry those workers sequentially.

## Stage 0 — Workspace init (run directly with bash)
\`\`\`bash
WS="${workspace}"
mkdir -p "$WS"/raw/source "$WS"/raw/synthesis "$WS"/raw/specs/modules "$WS"/raw/specs/journeys "$WS"/raw/specs/contracts "$WS"/provenance
cd "$WS" && git init -q && printf '%s\\n' '.gitignore' > .gitignore 2>/dev/null || true
\`\`\`
Write \`$WS/workspace.json\` with { target: "${target}", created_at: <now>, tier: "raw", stages: [] }. Commit: \`[init] workspace for ${target}\`.

## Stage 1 — Source analysis
Dispatch ROLE source-mapper → Read \`${skillPaths["excavate-source-analysis"]}\`. Read every source file under \`${target}\` (do not skim). Decompose into modules; write per-area source notes to \`${workspace}/raw/source/\` and a module list to \`${workspace}/raw/synthesis/module-map.md\` (one \`### <module>\` heading per module). DoD: module-map.md has ≥1 module and source notes exist. Commit.

## Stage 2 — Synthesis (parallel, ≤4)
Dispatch in parallel:
- ROLE feature-discoverer → Read \`${skillPaths["excavate-synthesis"]}\`. From the source notes + module map, write a feature inventory to \`${workspace}/raw/synthesis/features.md\`.
- ROLE architecture-analyst → Read \`${skillPaths["excavate-synthesis"]}\`. Write an architecture model to \`${workspace}/raw/synthesis/architecture.md\`.
Commit after the batch.

## Stage 3 — Deep documentation (parallel, ≤4 per batch)
Read \`${workspace}/raw/synthesis/module-map.md\` for the module list. For EVERY module dispatch ROLE module-deep-dive → Read \`${skillPaths["excavate-spec-writing"]}\` (spec template + behavioral language) and \`${skillPaths["excavate-provenance"]}\` (citation format). Read the module's source exhaustively; write a behavioral spec to \`${workspace}/raw/specs/modules/<module-slug>.md\` with \`<!-- cite: file:Lx-Ly -->\` on every claim. Batch ≤4, commit per batch.
Then dispatch (parallel):
- ROLE journey-analyzer → Read \`${skillPaths["excavate-spec-writing"]}\`. Write end-to-end user journeys to \`${workspace}/raw/specs/journeys/\`.
- ROLE contract-extractor → Read \`${skillPaths["excavate-spec-writing"]}\`. Extract CLI flags, env vars, config keys to \`${workspace}/raw/specs/contracts/\`.
Commit after the batch.

## Stage 4 — Light verification
Dispatch ROLE verifier → Read \`${skillPaths["excavate-validation"]}\`. Read all specs in \`${workspace}/raw/specs/\`; check provenance coverage (every claim cited) and cross-spec consistency. Write \`${workspace}/raw/specs/verification-report.md\` with a PASS/FAIL line and any gaps. (No remediation loop — report only.) Commit.

## Stage 5 — Summary
Print: target, workspace, modules documented, total spec files, verification PASS/FAIL. Tell the user the specs are at \`${workspace}/raw/specs/\` with grep-able \`<!-- cite: -->\` provenance. STOP.`;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/excavate/tests/playbook.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/excavate/playbook.ts src/resources/extensions/excavate/tests/playbook.test.ts
git commit -m "feat(excavate): orchestrator playbook builder"
```

---

## Task 4: Command wiring + manifest + entry

**Files:**
- Create: `src/resources/extensions/excavate/command.ts`, `index.ts`, `extension-manifest.json`

- [ ] **Step 1: Write `command.ts`**

`src/resources/extensions/excavate/command.ts`:
```typescript
import type { ExtensionAPI, ExtensionCommandContext } from "@loop24/pi-coding-agent";
import { parseExcavateArgs } from "./args.js";
import { resolveSkillPaths } from "./paths.js";
import { buildPlaybook } from "./playbook.js";

export default function registerExcavate(pi: ExtensionAPI): void {
  pi.registerCommand("excavate", {
    description: "Reverse-engineer a codebase into provenance-cited behavioral specs",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parsed = parseExcavateArgs(typeof args === "string" ? args : "");
      if (!parsed.ok) {
        ctx.ui.notify(parsed.error, "error");
        return;
      }
      const playbook = buildPlaybook({
        target: parsed.target,
        workspace: parsed.workspace,
        skillPaths: resolveSkillPaths(),
      });
      // sendUserMessage always triggers a turn; the agent then executes the playbook.
      pi.sendUserMessage(playbook);
    },
  });
}
```

- [ ] **Step 2: Write `index.ts`**

`src/resources/extensions/excavate/index.ts`:
```typescript
import type { ExtensionAPI } from "@loop24/pi-coding-agent";
import registerExcavate from "./command.js";

export default function excavate(pi: ExtensionAPI) {
  registerExcavate(pi);
}
```

- [ ] **Step 3: Write `extension-manifest.json`**

`src/resources/extensions/excavate/extension-manifest.json`:
```json
{
  "id": "excavate",
  "name": "Excavate",
  "version": "1.0.0",
  "description": "Reverse-engineer a codebase into provenance-cited behavioral specs",
  "tier": "bundled",
  "requires": { "platform": ">=2.29.0" },
  "provides": { "commands": ["excavate"] }
}
```
(Match the `requires.platform` value used by a sibling bundled manifest, e.g. `src/resources/extensions/slash-commands/extension-manifest.json`, in case it has drifted — copy that exact value.)

- [ ] **Step 4: Typecheck the extension compiles**

Run: `npx tsc -p tsconfig.resources.json --noEmit 2>&1 | grep -i excavate || echo "no excavate errors"`
Expected: `no excavate errors`.

- [ ] **Step 5: Commit**

```bash
git add src/resources/extensions/excavate/command.ts src/resources/extensions/excavate/index.ts src/resources/extensions/excavate/extension-manifest.json
git commit -m "feat(excavate): register /otto excavate command + manifest"
```

---

## Task 5: Bundle the 5 OTTO-rebranded methodology skills

**Files:**
- Create: `src/resources/skills/excavate-{source-analysis,synthesis,spec-writing,provenance,validation}/SKILL.md`

Each is adapted from its greenfield source with a **full OTTO rebrand**. Do them one at a time; same procedure each.

- [ ] **Step 1: Copy the source skill bodies as a starting point**

```bash
cp ~/.claude/skills/greenfield-source-analysis/SKILL.md       src/resources/skills/excavate-source-analysis/SKILL.md   --parents 2>/dev/null || (mkdir -p src/resources/skills/excavate-source-analysis && cp ~/.claude/skills/greenfield-source-analysis/SKILL.md src/resources/skills/excavate-source-analysis/SKILL.md)
mkdir -p src/resources/skills/excavate-synthesis      && cp ~/.claude/skills/greenfield-multi-source-synthesis/SKILL.md src/resources/skills/excavate-synthesis/SKILL.md
mkdir -p src/resources/skills/excavate-spec-writing   && cp ~/.claude/skills/greenfield-behavioral-spec-writing/SKILL.md src/resources/skills/excavate-spec-writing/SKILL.md
mkdir -p src/resources/skills/excavate-provenance     && cp ~/.claude/skills/greenfield-provenance-methodology/SKILL.md  src/resources/skills/excavate-provenance/SKILL.md
mkdir -p src/resources/skills/excavate-validation     && cp ~/.claude/skills/greenfield-validation-methodology/SKILL.md  src/resources/skills/excavate-validation/SKILL.md
```

- [ ] **Step 2: Apply the rebrand transforms to every copied SKILL.md**

For each of the 5 files, edit so that:
1. **Frontmatter `name:`** matches the folder (`excavate-source-analysis`, `excavate-synthesis`, `excavate-spec-writing`, `excavate-provenance`, `excavate-validation`). Keep a `description:` (rewrite to OTTO voice).
2. **Scrub brand terms** in prose: replace `greenfield` → `excavate`/`OTTO`; remove `Claude`, `claude-code`, `earendil`, and any GPL/attribution lines; remove references to other greenfield skills not bundled here (the core slice has only these 5 — drop cross-refs to runtime/binary/community/etc.).
3. **Fix dispatch language** to OTTO reality: anywhere the text assumes a named worker agent or `Agent(subagent_type=<name>)` / `Task` tool, rewrite to "you are a general-purpose worker dispatched with a role + this skill; produce the specified output." Remove any `skills:` auto-load assumption.
4. **Keep the methodology substance** — the analysis steps, the spec template (in spec-writing), the `<!-- cite: file:Lx-Ly -->` citation format (in provenance), the verification criteria (in validation). These are the value; preserve them.

- [ ] **Step 3: Structural check (no brand leakage, frontmatter intact)**

Run:
```bash
for d in source-analysis synthesis spec-writing provenance validation; do
  f="src/resources/skills/excavate-$d/SKILL.md"
  echo "== $f =="
  head -4 "$f" | grep -E "^name:|^description:" || echo "FRONTMATTER MISSING"
  grep -niE "greenfield|claude|earendil|GPL|subagent_type" "$f" && echo "LEAKAGE ABOVE" || echo "clean"
done
```
Expected: each file shows `name:`/`description:` and `clean` (no leakage). Fix any leakage before committing.

- [ ] **Step 4: Confirm the citation format + spec template survived**

Run: `grep -l "cite:" src/resources/skills/excavate-provenance/SKILL.md && grep -liE "spec id|behavioral|## .*spec" src/resources/skills/excavate-spec-writing/SKILL.md`
Expected: both print their file path (methodology substance retained).

- [ ] **Step 5: Commit**

```bash
git add src/resources/skills/excavate-source-analysis src/resources/skills/excavate-synthesis src/resources/skills/excavate-spec-writing src/resources/skills/excavate-provenance src/resources/skills/excavate-validation
git commit -m "feat(excavate): bundle 5 OTTO-rebranded methodology skills"
```

---

## Task 6: Build, load-check, parallel-dispatch confirm, acceptance run

**Files:** none new (verification + any fixes)

- [ ] **Step 1: Full build**

Run: `npm run build 2>&1 | tail -5`
Expected: completes without error (compiles the extension, copies skills to `dist/resources`).

- [ ] **Step 2: Confirm the extension + skills install/discover**

Run:
```bash
node /Users/coreyellis/Projects/repos/local/loop24-client/dist/loader.js --mode json -p "List your available slash commands whose name contains 'excavate', and list available skills whose name starts with 'excavate'." 2>&1 | tail -20
```
Expected: mentions the `excavate` command and the 5 `excavate-*` skills. If the command/skills don't appear, the bundle didn't sync — check the manifest `tier:"bundled"` and that `npm run build` copied them to `dist/resources`.

- [ ] **Step 3: Parallel-dispatch confirm (the flagged risk)**

Run:
```bash
node /Users/coreyellis/Projects/repos/local/loop24-client/dist/loader.js --mode json -p "Dispatch THREE general-purpose Agent workers in a single message, in parallel: worker 1 writes 'one' to /tmp/excavate-par/1.txt, worker 2 writes 'two' to /tmp/excavate-par/2.txt, worker 3 writes 'three' to /tmp/excavate-par/3.txt (mkdir -p as needed). Report when all three return." 2>&1 | tail -15
cat /tmp/excavate-par/1.txt /tmp/excavate-par/2.txt /tmp/excavate-par/3.txt 2>/dev/null
```
Expected: all three files exist with their contents — confirms parallel general-purpose dispatch works headless. If only sequential works, note it; the playbook already says "retry sequentially," so the feature still functions (slower).

- [ ] **Step 4: Acceptance run on a tiny target (empirical — LLM behavior, not unit-testable)**

Create a 3-file sample (or reuse `~/greenfield-poc/target` if present), then:
```bash
mkdir -p /tmp/excavate-accept && cd /tmp/excavate-accept
node /Users/coreyellis/Projects/repos/local/loop24-client/dist/loader.js --mode json -p "/otto excavate ~/greenfield-poc/target" 2>&1 | tail -25
echo "--- specs ---"; ls -R /tmp/excavate-accept/analysis-workspace/raw/specs 2>/dev/null
echo "--- citations ---"; grep -rc "<!-- cite:" /tmp/excavate-accept/analysis-workspace/raw/specs/modules/ 2>/dev/null
```
Expected: `/otto excavate` triggered a turn (command delivery via `sendUserMessage` worked — NOT a no-op), the workspace tree exists, and `raw/specs/modules/` holds provenance-cited behavioral specs. Eyeball one spec for accuracy against the target. (If `/otto excavate` no-ops in `-p` mode like bare slash-commands did, that means command-dispatch differs from template expansion — confirm the registered command fires; if not, fall back to documenting interactive-only invocation for the MVP.)

- [ ] **Step 5: Commit any fixes + a short results note**

```bash
git add -A src/resources/extensions/excavate src/resources/skills/excavate-*
git commit -m "fix(excavate): adjustments from build + acceptance run" || echo "no fixes needed"
```

---

## Self-Review notes (for the implementer)
- The only non-unit-testable piece is the LLM-orchestrated run (Task 6 Step 4) — this is stated, not faked.
- `pi.sendUserMessage` is the load-bearing delivery call; Task 6 Step 4 explicitly verifies it fires in headless. If it doesn't, the MVP is interactive-only (acceptable fallback) — do not invent a prompts-sync mechanism without checking with the controller.
- Do NOT touch `src/resource-loader.ts` — the bundle rides the existing extension + skills sync. If something doesn't sync, diagnose the manifest/build first.
- Keep the playbook in `playbook.ts` (one responsibility: build the string). Do not move orchestration into TS — the agent must drive dispatch (claude-code provider constraint).
```
