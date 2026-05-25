# Greenfield-on-OTTO PoC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that under OTTO a trimmed `/greenfield-analyze` dispatches the `greenfield-analyzer` subagent via OTTO's `subagent` tool, the subagent natively invokes a greenfield skill, and writes one provenance-annotated spec for a tiny target — all isolated under a throwaway `OTTO_HOME`.

**Architecture:** Sandbox everything under `~/greenfield-poc/`. `OTTO_HOME=~/greenfield-poc/.otto` redirects the agent dir (agents + prompts); skills load from project-local `~/greenfield-poc/.agents/skills/` (loaded when cwd=`~/greenfield-poc`); auth/models are copied from the real `~/.otto/agent`. Execute headless via `dist/loader.js --mode json -p`. No product code (`src/`) changes.

**Tech Stack:** OTTO CLI (built `dist/loader.js`), Node 22, greenfield Claude plugin assets in `~/.claude/{skills,agents}/`.

**Reference paths (constants used throughout):**
- Repo: `/Users/coreyellis/Projects/repos/local/loop24-client`
- Loader: `/Users/coreyellis/Projects/repos/local/loop24-client/dist/loader.js`
- Sandbox root: `~/greenfield-poc`
- Greenfield source assets: `~/.claude/skills/greenfield-*`, `~/.claude/agents/greenfield-analyzer.md`

---

## File Structure

| Path | Responsibility |
|---|---|
| `~/greenfield-poc/target/{cli.mjs,args.mjs,greet.mjs,README.md}` | Tiny sample CLI to analyze |
| `~/greenfield-poc/.agents/skills/greenfield-{source-analysis,provenance-methodology,behavioral-spec-writing}/` | Methodology skills (copied verbatim) |
| `~/greenfield-poc/.otto/agent/agents/greenfield-analyzer.md` | Worker agent, `tools:` adapted to OTTO |
| `~/greenfield-poc/.otto/agent/prompts/greenfield-analyze.md` | Trimmed orchestrator prompt template |
| `~/greenfield-poc/.otto/agent/{auth.json,models.json}` | Copied creds so the sandbox has a model |
| `~/greenfield-poc/workspace/specs/source.md` | PoC output (written by the subagent) |
| `~/greenfield-poc/RESULTS.md` | Findings + decision-gate record |

---

## Task 1: Create sandbox + sample target

**Files:**
- Create: `~/greenfield-poc/target/cli.mjs`, `args.mjs`, `greet.mjs`, `README.md`
- Create (dirs): `~/greenfield-poc/.otto/agent/agents`, `.otto/agent/prompts`, `.agents/skills`, `workspace/specs`

- [ ] **Step 1: Make the directory tree**

```bash
mkdir -p ~/greenfield-poc/.otto/agent/agents \
         ~/greenfield-poc/.otto/agent/prompts \
         ~/greenfield-poc/.agents/skills \
         ~/greenfield-poc/workspace/specs \
         ~/greenfield-poc/target
```

- [ ] **Step 2: Write the sample target files**

`~/greenfield-poc/target/cli.mjs`:
```javascript
#!/usr/bin/env node
import { parseArgs } from "./args.mjs";
import { greet } from "./greet.mjs";

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log("usage: greet [--shout] [--name <name>] <name?>");
  process.exit(0);
}
const message = greet(opts.name, { shout: opts.shout });
console.log(message);
```

`~/greenfield-poc/target/args.mjs`:
```javascript
// Minimal flag parser: --help, --shout (boolean), --name <v>, positional name.
export function parseArgs(argv) {
  const opts = { help: false, shout: false, name: "world" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--shout") opts.shout = true;
    else if (a === "--name") opts.name = argv[++i] ?? opts.name;
    else if (!a.startsWith("-")) opts.name = a;
  }
  return opts;
}
```

`~/greenfield-poc/target/greet.mjs`:
```javascript
// Build a greeting. Uppercases the whole string when shout is set.
export function greet(name, { shout = false } = {}) {
  const base = `Hello, ${name}!`;
  return shout ? base.toUpperCase() : base;
}
```

`~/greenfield-poc/target/README.md`:
```markdown
# greet

A tiny CLI that prints a greeting.

    greet Ada              # Hello, Ada!
    greet --shout Ada      # HELLO, ADA!
    greet --name Ada       # Hello, Ada!
```

- [ ] **Step 3: Verify the target runs (sanity)**

Run: `node ~/greenfield-poc/target/cli.mjs --shout Ada`
Expected: `HELLO, ADA!`

---

## Task 2: Seed auth/models into the sandbox

**Files:**
- Create: `~/greenfield-poc/.otto/agent/auth.json`, `~/greenfield-poc/.otto/agent/models.json` (copies)

- [ ] **Step 1: Confirm the real creds exist**

Run: `ls -l ~/.otto/agent/auth.json ~/.otto/agent/models.json 2>/dev/null || ls -l ~/.loop24/agent/auth.json ~/.loop24/agent/models.json`
Expected: at least `auth.json` listed. (If the live dir is still `~/.loop24` because the step-3 migration hasn't run on this machine yet, use that path as the source in Step 2.)

- [ ] **Step 2: Copy creds into the sandbox**

```bash
SRC=~/.otto/agent; [ -f "$SRC/auth.json" ] || SRC=~/.loop24/agent
cp "$SRC/auth.json"   ~/greenfield-poc/.otto/agent/auth.json
cp "$SRC/models.json" ~/greenfield-poc/.otto/agent/models.json 2>/dev/null || true
```

- [ ] **Step 3: Verify**

Run: `ls -l ~/greenfield-poc/.otto/agent/auth.json`
Expected: file exists, non-zero size.

---

## Task 3: Copy the 3 greenfield skills (verbatim)

**Files:**
- Create: `~/greenfield-poc/.agents/skills/greenfield-source-analysis/`, `greenfield-provenance-methodology/`, `greenfield-behavioral-spec-writing/`

- [ ] **Step 1: Copy the skill folders**

```bash
for s in greenfield-source-analysis greenfield-provenance-methodology greenfield-behavioral-spec-writing; do
  cp -R ~/.claude/skills/$s ~/greenfield-poc/.agents/skills/$s
done
```

- [ ] **Step 2: Verify each has a SKILL.md**

Run: `for s in greenfield-source-analysis greenfield-provenance-methodology greenfield-behavioral-spec-writing; do test -f ~/greenfield-poc/.agents/skills/$s/SKILL.md && echo "ok $s" || echo "MISSING $s"; done`
Expected: three `ok` lines, no `MISSING`.

---

## Task 4: Adapt the greenfield-analyzer agent for OTTO

**Files:**
- Create: `~/greenfield-poc/.otto/agent/agents/greenfield-analyzer.md` (copy of source with `tools:` rewritten)

- [ ] **Step 1: Copy the source agent into the sandbox**

```bash
cp ~/.claude/agents/greenfield-analyzer.md ~/greenfield-poc/.otto/agent/agents/greenfield-analyzer.md
```

- [ ] **Step 2: Rewrite the `tools:` frontmatter line to OTTO tool names**

In `~/greenfield-poc/.otto/agent/agents/greenfield-analyzer.md`, replace the line:
```
tools: Read, Glob, Grep, Write, Edit, Bash, WebFetch, WebSearch
```
with:
```
tools: read, glob, grep, write, edit, bash, find, ls, Skill
```
Rationale: OTTO tool names are lowercase (`read, glob, grep, write, edit, bash, find, ls`); `Skill` (capitalized) is the skill-invocation tool. `read` also makes the `<available_skills>` catalog surface in the subagent's system prompt (`system-prompt.ts:138`). Web tools are dropped — not needed for local source analysis. Leave the `skills:` frontmatter line as-is (inert under OTTO; documents intent).

- [ ] **Step 3: Verify the frontmatter parses (name/description/tools present)**

Run: `sed -n '1,6p' ~/greenfield-poc/.otto/agent/agents/greenfield-analyzer.md`
Expected: frontmatter shows `name: greenfield-analyzer`, a `description:`, and `tools: read, glob, grep, write, edit, bash, find, ls, Skill`.

---

## Task 5: Write the trimmed orchestrator prompt template

**Files:**
- Create: `~/greenfield-poc/.otto/agent/prompts/greenfield-analyze.md`

- [ ] **Step 1: Write the prompt template**

`~/greenfield-poc/.otto/agent/prompts/greenfield-analyze.md`:
```markdown
---
description: (PoC) Reverse-engineer a small target into one provenance-annotated behavioral spec
---

# /greenfield-analyze (PoC)

Target: $ARGUMENTS

You are the orchestrator. Do exactly this, then stop:

1. Ensure the workspace exists: the spec goes in `~/greenfield-poc/workspace/specs/source.md`.

2. Dispatch ONE worker using the `subagent` tool, single mode:
   - agent: `greenfield-analyzer`
   - task: >
       Role: source-analyzer. Invoke the `greenfield-source-analysis` skill for
       methodology and the `greenfield-provenance-methodology` skill for citation
       format. Read EVERY file under the target path `$ARGUMENTS` (use read/grep/ls
       — do not skim). Produce a behavioral specification following the
       `greenfield-behavioral-spec-writing` skill's template, written in behavioral
       language (no raw identifiers as the description — explain what the code does).
       Every behavioral claim MUST carry a provenance citation in the form
       `<!-- cite: <relative-file>:Lx-Ly -->`. Write the spec to
       `~/greenfield-poc/workspace/specs/source.md`.

3. After the worker returns, read `~/greenfield-poc/workspace/specs/source.md` and
   report: the number of behavioral claims, the number of provenance citations,
   and whether the spec covers the CLI entry point, the argument parser, and the
   greeting logic. Do not do the analysis yourself — rely on the worker's output.
```

- [ ] **Step 2: Verify it's discoverable as a template**

Run: `OTTO_HOME=~/greenfield-poc/.otto node /Users/coreyellis/Projects/repos/local/loop24-client/dist/loader.js --help >/dev/null 2>&1; ls ~/greenfield-poc/.otto/agent/prompts/greenfield-analyze.md`
Expected: the file path prints (it exists in the global prompts dir for the sandbox home).

---

## Task 6: Smoke-test the sandbox harness

Confirms OTTO boots under the sandbox home and sees the agent + skills BEFORE the real run.

- [ ] **Step 1: Confirm the build exists**

Run: `test -f /Users/coreyellis/Projects/repos/local/loop24-client/dist/loader.js && echo ok`
Expected: `ok`. If missing, run `npm run build` in the repo first.

- [ ] **Step 2: List agents under the sandbox home (agent discovery works)**

Run:
```bash
cd ~/greenfield-poc && OTTO_HOME=~/greenfield-poc/.otto \
  node /Users/coreyellis/Projects/repos/local/loop24-client/dist/loader.js \
  --mode json -p "/subagent" 2>&1 | tail -30
```
Expected: output includes `greenfield-analyzer` in the available-agents list. If it does NOT appear, stop and check the agent file path / frontmatter before proceeding.

- [ ] **Step 3: Confirm skills load under the sandbox (project skill dir)**

Run:
```bash
cd ~/greenfield-poc && OTTO_HOME=~/greenfield-poc/.otto \
  node /Users/coreyellis/Projects/repos/local/loop24-client/dist/loader.js \
  --mode json -p "List the names of every skill whose name starts with 'greenfield' that you can see in available_skills." 2>&1 | tail -20
```
Expected: the model lists the three `greenfield-*` skills. If none appear, the project skills dir isn't being read — verify cwd is `~/greenfield-poc` and the folders are under `.agents/skills/`.

---

## Task 7: Run the PoC headless and capture output

**Files:**
- Create: `~/greenfield-poc/run.jsonl` (captured event stream)

- [ ] **Step 1: Run the orchestrator headless, capturing the JSONL stream**

```bash
cd ~/greenfield-poc && OTTO_HOME=~/greenfield-poc/.otto \
  node /Users/coreyellis/Projects/repos/local/loop24-client/dist/loader.js \
  --mode json -p "/greenfield-analyze ~/greenfield-poc/target" \
  > ~/greenfield-poc/run.jsonl 2>&1
echo "exit: $?"
```
Expected: exit 0 (or a non-error completion). The run may take a minute while the subagent works.

- [ ] **Step 2: Confirm the template expanded (not treated as literal text)**

Run: `grep -c "source-analyzer\|greenfield-source-analysis" ~/greenfield-poc/run.jsonl`
Expected: ≥1. If 0, the prompt template did NOT expand in `-p` mode — apply the **Task 7 fallback** below.

> **Task 7 fallback (template didn't expand):** pass the orchestrator instructions inline instead of via the slash command. Re-run Step 1 with the body of `greenfield-analyze.md` (everything after the frontmatter, with `$ARGUMENTS` replaced by `~/greenfield-poc/target`) as the `-p` argument. Continue to Task 8.

---

## Task 8: Verify success criteria

- [ ] **Step 1: The subagent was dispatched via the `subagent` tool**

Run: `grep -E "\"subagent\"|tool.*subagent|greenfield-analyzer" ~/greenfield-poc/run.jsonl | head`
Expected: at least one line showing a `subagent` tool call referencing `greenfield-analyzer`.

- [ ] **Step 2: The subagent invoked the greenfield skill**

Run: `grep -E "skill name=\"greenfield-source-analysis\"|Skill.*greenfield-source-analysis|greenfield-source-analysis" ~/greenfield-poc/run.jsonl | head`
Expected: evidence the `greenfield-source-analysis` skill was invoked (a `<skill name="greenfield-source-analysis" …>` block or a `Skill` tool call with that name).
If absent → unknown 2 failed with the native approach; record it and apply the **spec's approach-B fallback** (orchestrator inlines the skill methodology into the task), then re-run Task 7–8.

- [ ] **Step 3: The spec file exists with provenance citations**

Run:
```bash
test -f ~/greenfield-poc/workspace/specs/source.md && \
  echo "claims/citations:" && grep -c "<!-- cite:" ~/greenfield-poc/workspace/specs/source.md
```
Expected: file exists; citation count ≥3 (entry point, arg parser, greet logic).

- [ ] **Step 4: Manual eyeball for correctness**

Run: `cat ~/greenfield-poc/workspace/specs/source.md`
Expected: the spec describes, in behavioral language, the CLI entry/dispatch, the flag parsing (`--help/-h`, `--shout`, `--name`, positional), and the uppercase-on-shout greeting — each with a citation pointing at the right file/lines.

---

## Task 9: Record findings + decision gate

**Files:**
- Create: `~/greenfield-poc/RESULTS.md`

- [ ] **Step 1: Write the results record**

`~/greenfield-poc/RESULTS.md` — capture, for each unknown, PASS/FAIL + evidence:
1. Dispatch by name (Task 8 Step 1).
2. Native skill invocation in the launched subagent (Task 8 Step 2) — note whether the native approach worked or the approach-B fallback was needed.
3. End-to-end provenance spec output (Task 8 Steps 3–4).
Plus: which OTTO tool-name adaptations were required, and any surprises (template expansion in `-p`, project-skill loading, auth seeding).

- [ ] **Step 2: State the decision**

In `RESULTS.md`, conclude with one of:
- **PROCEED** to the full-bundle design (all 25 skills + sanitizer agent + pipeline + `resource-loader` prompts-sync + sanitization), noting which adaptations the bundle must apply, OR
- **REASSESS** (native skill invocation unworkable even with fallback) — vendor-as-is vs simplify.

- [ ] **Step 3 (optional): tear down the sandbox**

Run (only once findings are recorded): `echo "sandbox kept at ~/greenfield-poc (remove with: rm -rf ~/greenfield-poc)"`
The sandbox is disposable and touches nothing in the live config; leave or remove at will.

---

## Notes for the implementer

- **No `src/` changes.** This PoC is entirely sandbox files + reads of existing greenfield assets. If you feel the urge to edit product code, stop — that belongs to the post-PoC bundle.
- **Don't commit the sandbox.** `~/greenfield-poc/` is outside the repo; nothing here should be staged. The only repo artifact is this plan and the spec (already committed).
- **If OTTO boots to the wrong config dir,** check that `OTTO_HOME` is exported on the same command and that `cd ~/greenfield-poc` precedes the loader call (skills are cwd-relative).
- **The `subagent` tool comes from the repo bundle, not the sandbox agent dir.** The loader discovers bundled extensions from the repo's `dist/resources/extensions` (via `LOOP24_BUNDLED_EXTENSION_PATHS`) regardless of `OTTO_HOME`, so the `subagent` tool/command should be available even though the sandbox `agent/` has no `extensions/` dir. Task 6 Step 2 (`/subagent`) is the explicit confirmation — if it reports unknown command/tool, the bundle wasn't discovered and you must run from the repo's built `dist/loader.js` (not a stale global install).
- **Benign side effect:** on boot the loader may sync OTTO's *own* bundled skills into the real `~/.agents/skills/` (normal OTTO install behavior). That is OTTO's skills, not greenfield's — the greenfield PoC skills stay in the sandbox's project `.agents/skills/`. Greenfield isolation is preserved; only note it so the synced OTTO skills aren't a surprise.
