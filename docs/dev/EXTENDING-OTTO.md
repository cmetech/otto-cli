# Extending OTTO: Skills, Commands, and Subagents

How a user adds capabilities to OTTO, and how a multi-layer capability like
**greenfield** (reverse-engineering a codebase into behavioral specs) maps onto
OTTO's extension model.

> **Heads-up on the `.otto` rename.** This guide uses `~/.otto/agent/...` paths.
> As of this writing the source tree still resolves to `~/.loop24/agent/...` —
> the canonical `package.json` `piConfig.configDir` is still `".loop24"`. The
> folder name is derived entirely from that one field (`config.ts:172`). To make
> `.otto` real:
>
> 1. Edit `piConfig.configDir` → `".otto"` in the root `package.json`.
> 2. Run `npm run sync-piconfig` (or `npm run build`) — this syncs the value into
>    `packages/pi-coding-agent/package.json` and `pkg/package.json`.
>
> Everything below then resolves to `~/.otto/agent/...` automatically. If you
> have not done this yet, mentally substitute `~/.loop24/` for `~/.otto/`.

---

## Where everything comes from (one field each)

OTTO's identity is driven by `piConfig` in the root `package.json`. Three fields
matter here, and they are independent:

| `piConfig` field | Current value | Controls |
|---|---|---|
| `configDir` | `.loop24` → target `.otto` | The config folder: `~/.otto/agent/` |
| `name` | `loop24` | `APP_NAME`, and the env override var `LOOP24_CODING_AGENT_DIR` |
| `commandNamespace` | `otto` | The slash-command prefix: `/otto …` |

So after the `configDir` rename, the agent dir becomes `~/.otto/agent/` but the
env override var stays `LOOP24_CODING_AGENT_DIR` until you also change `name`.

**Resolved paths** (from `config.ts`):

| Path | Function | Default |
|---|---|---|
| Agent dir | `getAgentDir()` | `~/.otto/agent/` |
| Prompt templates (commands) | `getPromptsDir()` | `~/.otto/agent/prompts/` |
| Subagents | — | `~/.otto/agent/agents/` |
| TS extensions | — | `~/.otto/agent/extensions/` |
| Skills | `initResources(skillsDir)` | `~/.agents/skills/` |
| Settings | `getSettingsPath()` | `~/.otto/agent/settings.json` |

Override the whole agent dir with the env var `LOOP24_CODING_AGENT_DIR`
(`config.ts:178`, derived from `APP_NAME`).

---

## The three extension surfaces

"Skill" and "command" are **different things** in OTTO. This is the core mental
model:

| Surface | What it is | Lives in | Discovered by |
|---|---|---|---|
| **Skill** | Domain expertise the agent pulls in mid-task | `~/.agents/skills/` + settings `skills` paths + project | A folder containing `SKILL.md` |
| **Command (markdown)** | A `/slash` command whose body is injected as a prompt | `~/.otto/agent/prompts/` (user) or `<project>/.otto/prompts/` | One `.md` file = one `/name` |
| **Command (code)** | A `/slash` command that runs real TypeScript | `~/.otto/agent/extensions/` | `pi.registerCommand()` in an extension |
| **Subagent** | A named worker dispatched via the `Agent` tool | `~/.otto/agent/agents/` (user) or `<project>/.gsd/agents/` | A `.md` file with frontmatter |

---

## 1. Skills — "knowledge on demand"

A skill is a **folder** with a `SKILL.md` file. It is NOT a command — it is
context the agent loads when its `description` matches the task (or when the user
types `/skill-name`).

### Anatomy

```
my-skill/
├── SKILL.md              # Required. Router + essential principles (always loaded)
├── workflows/            # Optional. Step-by-step procedures the agent FOLLOWS
├── references/           # Optional. Domain knowledge the agent READS
├── templates/            # Optional. Output structures the agent COPIES + fills
└── scripts/              # Optional. Code the agent EXECUTES as-is
```

`SKILL.md` frontmatter only needs two fields:

```markdown
---
name: my-skill
description: One precise sentence. This is the trigger — the agent matches the task against it. Be specific about WHEN to use it.
---

# My Skill

Body in markdown. All prompting best practices apply: clear, direct, XML
structure where useful. Assume the model is smart — only add context it lacks.
```

### How a user creates one

- **By hand:** create the folder + `SKILL.md`, drop it in `~/.agents/skills/`.
- **Guided:** run the **`/create-skill`** skill, which teaches structure and best
  practices (see `src/resources/skills/create-skill/SKILL.md`).

### How OTTO finds it

Skills are discovered from the skills dir (`~/.agents/skills/`), from any paths
listed in `settings.json` under `skills`, and from the project. Bundled product
skills are synced from `src/resources/skills/` → skills dir at install time
(`resource-loader.ts:628`).

---

## 2. Commands — two flavors

### a) The easy way: a markdown prompt template (no code)

Drop a `.md` file into `~/.otto/agent/prompts/` (global) or
`<project>/.otto/prompts/` (project-local). **The filename becomes the slash
command**, and the body becomes a prompt injected into the live agent turn — the
agent then acts on it with all its tools (Bash, Read, Write, Agent, etc.).

Argument substitution is supported and **aligns with Claude/Codex/OpenCode**
(`prompt-templates.ts:66-99`):

| Placeholder | Expands to |
|---|---|
| `$ARGUMENTS` | All args, space-joined |
| `$1`, `$2`, … | Positional args |
| `$@` | All args, space-joined |
| `${@:N}` | Args from the Nth onward (bash-style) |
| `${@:N:L}` | `L` args starting at `N` |

Example — `~/.otto/agent/prompts/triage.md`:

```markdown
---
description: Triage a failing test and propose a fix
---

Investigate the failing test: $ARGUMENTS

1. Run it and read the failure.
2. Trace the root cause in the source.
3. Propose a minimal fix. Do not apply it yet.
```

Typing `/triage tests/foo.test.ts` injects that body (with `$ARGUMENTS` filled)
as the prompt. This is the closest analog to a Claude markdown slash command and
is the right choice when the command is *"build a prompt and let the agent do the
work."*

> Note: the template loader reads only the `description` frontmatter field. Extra
> Claude-style frontmatter (`arguments:`, `allowed-tools:`) is ignored, not an
> error — so Claude command files mostly drop in as-is.

### b) The powerful way: a TypeScript extension

For deterministic logic (calling an API, running shell, showing a UI dialog),
write a `pi.registerCommand()` handler in an extension. This is what
`/otto prompt-engineer` does (`src/resources/extensions/loop24/commands/prompt-engineer/`):
it takes a rough description, calls the Claude API once, and prints a polished
prompt.

```typescript
pi.registerCommand("my-command", {
  description: "What it does",
  handler: async (args, ctx) => {
    // args = everything after "/my-command "
    // ctx  = ExtensionCommandContext (waitForIdle, newSession, reload, ui.*)
    ctx.ui.notify(`Running with ${args}`, "info");
  },
});
```

### How a user creates one

- **Markdown template:** just create the `.md` file (above). Zero tooling.
- **TS extension:** run **`/create-slash-command`** or **`/create-extension`** —
  both interview you and scaffold the TypeScript
  (`src/resources/extensions/slash-commands/`).

### Which to use

| If the command is… | Use |
|---|---|
| "Compose a prompt and let the agent run" | Markdown template |
| "Run code, call an API, show UI, deterministic output" | TS extension |

---

## 3. Subagents — named workers

A subagent is a `.md` file in `~/.otto/agent/agents/` (or project `.gsd/agents/`)
with frontmatter and a body that becomes its system prompt
(`subagent/agents.ts:89-107`). **This format is identical to Claude's agent
format.**

```markdown
---
name: my-worker
description: When to dispatch this worker
tools: Read, Grep, Glob, Write, Bash      # optional, comma-separated
model: haiku                               # optional override
---

You are a focused worker that … (system prompt body)
```

The orchestrator dispatches it via the `Agent` tool with
`subagent_type: "my-worker"`.

### How a user creates one

By hand: drop the `.md` in the agents dir. Bundled product agents sync from
`src/resources/agents/` → agents dir at install (`resource-loader.ts:627`).

---

## 4. Importing existing Claude assets

OTTO ships a Claude-import flow (`claude-import.ts`, reached through the
GSD/workflow preferences wizard) that scans:

- `~/.claude/skills/**/SKILL.md` — skills
- `~/.claude/plugins/` (marketplaces + flat) — plugins/components

…and registers the ones you select into OTTO's settings (skill paths +
preferences). So users who already have Claude skills do not have to recreate
them. Note: Claude markdown **agents** are not registered as loadable extension
packages by this flow — they need to live in the agents dir (above).

---

## Worked example: making greenfield a built-in OTTO capability

Greenfield is instructive because it uses **all three surfaces at once** — which
is exactly why it is not a single "skill":

| Greenfield piece | OTTO surface |
|---|---|
| 25 × `greenfield-*` (methodology) | **Skills** |
| `greenfield-analyzer`, `greenfield-sanitizer` | **Subagents** |
| `greenfield-analyze`, `greenfield-sanitize` (orchestrator playbooks) | **Commands** (markdown prompt templates) |

The `/greenfield-analyze` playbook dispatches `Agent(subagent_type:
"greenfield-analyzer")` many times; each dispatch tells the subagent which
`greenfield-*` skill to follow. So the command drives the subagents, and the
subagents load the skills.

### Option A — Local install (one machine, no product code)

Fast, reversible, and the right way to verify the dispatch + skill-loading works
end-to-end before committing it to the product.

1. **Skills** — either import via the Claude-import wizard (they are already in
   `~/.claude/skills/greenfield-*`), or copy them into `~/.agents/skills/`.
2. **Subagents** — copy `greenfield-analyzer.md` and `greenfield-sanitizer.md`
   into `~/.otto/agent/agents/`.
3. **Commands** — copy `greenfield-analyze.md` and `greenfield-sanitize.md` into
   `~/.otto/agent/prompts/`. They become `/greenfield-analyze` and
   `/greenfield-sanitize`; `$ARGUMENTS` already works in their bodies.
4. Reload OTTO. Run `/greenfield-analyze <path>`.

**Verify during the first run** (these are the two load-bearing assumptions):
- OTTO's `Agent` tool resolves the custom `subagent_type: "greenfield-analyzer"`
  to the agent you dropped in.
- The dispatched subagent can load `greenfield-*` skills via the Skill tool.

### Option B — Bundle into the OTTO product (ships to all users)

1. **Skills** → add `greenfield-*` folders under `src/resources/skills/`
   (synced to skills dir at install).
2. **Subagents** → add `greenfield-analyzer.md` + `greenfield-sanitizer.md` under
   `src/resources/agents/` (synced at install).
3. **Commands** → there is currently **no prompts-sync** step in
   `resource-loader.ts` (it syncs `extensions`, `agents`, and `skills` only —
   `resource-loader.ts:626-628`). Two ways to close that gap:
   - Add a `syncResourceDir(join(resourcesDir, 'prompts'), getPromptsDir())` line
     and ship the playbooks as `src/resources/prompts/*.md`, **or**
   - Wrap each playbook in a thin `pi.registerCommand()` TS extension that injects
     the playbook body into the agent turn.
4. **Brand sanitization** — strip earendil/gsd/GPL attribution from the
   customer-facing skill/agent/command text before bundling (per the OTTO
   rebrand). This is a content pass across ~29 files, not a mechanical rename.

### Recommendation

Do **Option A first** to prove the pipeline runs under OTTO, then promote it to
**Option B** with the prompts-sync step + sanitization once it is verified.
