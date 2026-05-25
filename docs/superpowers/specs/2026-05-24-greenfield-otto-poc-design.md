# Greenfield-on-OTTO — Proof of Concept Design

**Date:** 2026-05-24
**Status:** Approved — ready for implementation plan
**Type:** Proof of concept (de-risking spike), not the final feature.

## Purpose

Validate that the **greenfield** reverse-engineering capability (a Claude Code
plugin: orchestrator commands + worker agents + methodology skills) can run under
**OTTO** and produce the same kind of output — *before* investing in a full
product-bundled integration.

Greenfield is built for Claude Code conventions; OTTO differs on all of them:

| Layer | greenfield (Claude) | OTTO |
|---|---|---|
| Agent tool names | `Read, Glob, Grep, Bash` (capitalized) | `read, grep, bash, find, ls` (lowercase); skill tool is `Skill` |
| Skill loading | `skills:` frontmatter auto-loads skills | `discoverAgents` ignores `skills:`; skills surface via `<available_skills>` when tools include `read` or `Skill`, and load from `~/.agents/skills` (+ project `.agents/skills`) |
| Subagent dispatch | `Agent(subagent_type: "name")` | `subagent({ agent: "name", task: "…" })` tool |
| Command delivery | `~/.claude/commands/*.md` | prompt templates in the agent `prompts/` dir |

So greenfield is an **adaptation**, not a drop-in. This PoC proves the adaptation
works on a minimal slice.

## Unknowns this PoC resolves

1. **Dispatch by name** — OTTO's `subagent` tool resolves and launches a custom
   agent (`greenfield-analyzer`).
2. **Native skill invocation in a launched subagent** *(the pivotal one)* — a
   child `pi --mode json -p --tools …` process can invoke a greenfield skill by
   name and follow its methodology. Code review says this works when the agent's
   `tools` include `Skill` (invocation) and `read` (catalog surfacing) and the
   skill is present in the skills dir; the PoC confirms it empirically.
3. **End-to-end output** — a provenance-annotated behavioral spec file is written
   for a real (tiny) target.

## Isolation model (nothing touches the live config)

Everything lives under `~/greenfield-poc/`:

```
~/greenfield-poc/
├── .otto/agent/                 # OTTO_HOME=~/greenfield-poc/.otto
│   ├── agents/greenfield-analyzer.md
│   ├── prompts/greenfield-analyze.md
│   └── auth.json, models.json   # COPIED from ~/.otto/agent (read-only cred reuse)
├── .agents/skills/              # project-local skills (cwd=~/greenfield-poc)
│   ├── greenfield-source-analysis/
│   ├── greenfield-provenance-methodology/
│   └── greenfield-behavioral-spec-writing/
├── target/                      # tiny sample CLI to analyze
└── workspace/                   # spec output
```

- `OTTO_HOME` (added in OTTO branding step 4) redirects `appRoot` → agent dir, so
  agents/prompts resolve under the sandbox. `loader.ts` then sets
  `LOOP24_CODING_AGENT_DIR` to it, so pi's `getAgentDir()` agrees.
- Skills load from the **project-local** `.agents/skills/` (relative to cwd),
  leaving the real `~/.agents/skills` untouched.
- `auth.json` + `models.json` are **copied** from the real `~/.otto/agent` so the
  sandbox has a working model. Greenfield files never enter the live dir.

## Components

### 1. Sample target — `~/greenfield-poc/target/`
~4 files: a tiny CLI (entry point, arg parser, one logic module, README) with real
enough behavior to document and small enough to eyeball.

### 2. Skills — copied as-is (no body adaptation needed)
Into `~/greenfield-poc/.agents/skills/`:
- `greenfield-source-analysis` — methodology the analyzer follows
- `greenfield-provenance-methodology` — citation format
- `greenfield-behavioral-spec-writing` — spec template

SKILL.md format is identical between Claude and OTTO, so these copy verbatim.

### 3. Agent — `~/greenfield-poc/.otto/agent/agents/greenfield-analyzer.md`
greenfield's analyzer, with:
- `tools:` rewritten to OTTO names **plus `Skill` and `read`**, e.g.
  `read, find, grep, write, edit, bash, websearch, webfetch, Skill`
  (exact OTTO tool names verified against `src/resources/agents/*.md` and pi's
  tool registry during implementation).
- The `skills:` frontmatter left in place but understood to be inert under OTTO.
- Generic system-prompt body unchanged.

### 4. Command — `~/greenfield-poc/.otto/agent/prompts/greenfield-analyze.md`
A **trimmed** orchestrator (no 7-layer pipeline, no gates). Behavior:
- `$ARGUMENTS` = target path.
- Create the workspace dir.
- A **single** dispatch via OTTO's `subagent` tool:
  `subagent({ agent: "greenfield-analyzer", task: "Role: source-analyzer. Invoke
  the greenfield-source-analysis skill for methodology. Read every file under
  <target>. Write a provenance-annotated behavioral spec to
  ~/greenfield-poc/workspace/specs/source.md, each claim carrying a
  `<!-- cite: file:Lx-Ly -->` citation." })`.

## Execution

Run **headless** so it can be driven and captured from the shell:

```
cd ~/greenfield-poc
OTTO_HOME=~/greenfield-poc/.otto node <repo>/dist/loader.js --mode json -p \
  "/greenfield-analyze ~/greenfield-poc/target"
```

Capture the JSONL event stream (to confirm the `subagent` dispatch and the skill
invocation) and inspect `workspace/specs/source.md`.

## Success criteria

- The command dispatches `greenfield-analyzer` via the `subagent` tool (visible in
  the event stream).
- The subagent invokes the `greenfield-source-analysis` skill (visible in its
  transcript / a `<skill name="greenfield-source-analysis" …>` block).
- `workspace/specs/source.md` exists with `<!-- cite: … -->` provenance citations.
- Manual eyeball: the spec accurately describes the sample target's behavior.

## Fallback

If a `-p` subagent cannot invoke the Skill tool in practice (unknown 2 fails),
switch the dispatch to **approach B**: the orchestrator (main session, which loads
skills) reads `greenfield-source-analysis` and inlines its methodology into the
`task` string, so the subagent needs no skill access. Re-run and re-verify.

## Out of scope (deferred to the post-PoC full-bundle design)

- All 25 `greenfield-*` skills; the `greenfield-sanitizer` agent and Layers 5–7.
- The full 7-layer pipeline, gates, and remediation loops.
- A `prompts/` sync step in `resource-loader.ts` (product bundling).
- Brand / attribution sanitization of greenfield content.
- Any change to OTTO product code (`src/`). The PoC is entirely sandbox files.

## Decision gate

If the PoC passes: proceed to a full-bundle design (skills + agents → `src/resources/`,
command delivery mechanism, sanitization, product bundling).
If it fails on unknown 2 even with the fallback: reassess (vendor-as-is vs simplify).
