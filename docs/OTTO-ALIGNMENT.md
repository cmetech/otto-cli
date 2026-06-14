# OTTO Alignment — Ethos, Direction & Scope Rubric

**Status:** Living document — the canonical "what fits OTTO" anchor.
**Owner:** Corey Ellis
**Cite from:** the upstream-port pipeline's feature fit-check (`/upstream-cherry-pick`),
roadmap/planning decisions, and any "should we build this?" call.
**Source material:** `docs/dev/2026-05-24-anton-capabilities-otto-roadmap.md`,
`docs/dev/building-coding-agents/25-designing-for-non-technical-users-vibe-coders.md`,
the `coworker-phase-*` plans, and external reference agents Anton (MindsDB) and
Hermes (Nous Research) — see *References*.

---

## 1. The north star

**OTTO is becoming an AI co-worker, not just a coding assistant.**

Today OTTO is a *coding agent*: code for a codebase is the product. We are moving
toward a *doing agent* — you hand it an **outcome** ("clean this inbox", "ship a
revenue dashboard", "stand up this integration") and it does whatever work is
needed to deliver it. Code becomes a means, not the end. (This is the Anton
model; we reimplement the *concept* natively in TypeScript on the Pi packages, we
do not copy Anton's AGPL source.)

The audience widens from engineers to **non-technical users** — managers, project
managers, administrators, operators. The governing principle:

> **The human should never have to think in code** — not in input, not in output,
> not in errors, not in verification. The technical layer is absorbed by the
> system. The human operates in **intent, vision, preference, and judgment.**

So every change is judged against one question: **does this help OTTO finish real
outcomes for real people (technical and non-technical), or does it only make a
better coding assistant?**

## 2. How we get there (the pillars)

OTTO is built on the **Pi packages**. The capability direction (from the roadmap +
reference agents):

- **Outcome delivery** — a persistent execution scratchpad/kernel + typed
  deliverables (artifacts) with provenance, so OTTO *finishes* things instead of
  drafting them.
- **Personas & packages** — see §3; the headline differentiator.
- **Soul / identity** — a durable agent personality (à la Hermes' `SOUL.md`,
  slot-1 in the system prompt) that can take on **persona overlays**.
- **Memory & self-improvement** — persistent memory, error→lesson learning loops.
- **Local-first data + privacy** — local SQL/analysis + a secret vault; the
  non-technical-user, admin/PM workload, not heavy ML.
- **Broad foundation** — multi-provider LLM + MCP client/server (already strong;
  protect it).

## 3. Personas & application packages (the headline feature)

The thing that makes OTTO a *co-worker* rather than a generic assistant:

- **Persona packages** — a user can **install / uninstall** a persona (built as Pi
  packages). A persona bundles the skills, scripts, and workflows for a *role*:
  e.g. a **Manager** persona brings email, spreadsheet, presentation, reporting
  skills; an **Analyst** persona brings data-connect + dashboard skills.
- **Application packages** — cross-cutting integrations that any persona can use:
  e.g. **Jira**, **Langflow**, a CRM. These aren't tied to one role.
- **Soul-per-persona** — the agent's **soul (identity/voice/behavioral defaults)
  shifts with the active persona**, like a Hermes session overlay layered on the
  base `SOUL.md`. **This GUIDES, it does not RESTRICT** — with the Manager persona
  active OTTO leans toward manager-style tasks and tone, but it can still do
  anything the user asks outside that persona.

A change that **enables or strengthens** this system (a new skill type a persona
could ship, the package install/uninstall mechanism, the soul-overlay mechanism,
an integration a persona/app-package would expose, an outcome a non-technical user
would want) is **core** — even if, viewed narrowly, it looks like "not a coding
feature." That's the point: co-worker capability *is* the product.

## 4. Source repositories — where fixes vs. ideas come from

Upstream repos play **two distinct roles**. The cherry-pick logic must know which
role a repo has, because it changes *what* (if anything) we port from it.

### Fork-lineage repos → port the **fix** (`role: lineage`)
- **`pi`** (`../pi`) and **`gsd-pi`** (`../gsd-pi`). OTTO is forked from `gsd-pi`,
  which is built on `pi`.
- These are our **maintenance stream**. The `/upstream-cherry-pick` audit scans
  their commits and files issues for: **bugs, stability, security, performance,
  correctness, dependency upkeep**. This is the always-port technical work.
- Features from lineage repos still go through the §5 fit-check (a lineage repo
  can introduce a feature we may or may not want).

### Inspiration / ethos repos → port the **idea**, not the code (`role: inspiration`)
- **`hermes-agent`** (`../hermes-agent`, Nous Research), **`anton`** (`../anton`, MindsDB),
  **`mempalace`** (`../mempalace`), and similar. Cloned as **local siblings**
  alongside the lineage repos so subagents can read their source while designing a
  feature — but registered in the cherry-pick config with `role: inspiration`.
- We do **NOT** cherry-pick fixes or code from these, and the audit does **not**
  triage their commit streams. They are a **curated reference library** consulted
  when we *design and build* a co-worker capability (personas, memory, scratchpad,
  soul, outcomes): we mine their **intent, examples, and approach**, then
  **reimplement natively for OTTO** on the Pi packages.
- Direct code copy is **rare-to-never** — and often legally blocked (e.g. Anton is
  **AGPL-3.0**). Default: reimplement the concept, do not vendor the source.

**Rule of thumb:** *lineage → port the fix; inspiration → port the idea.* When we
classify a feature as `core` (§5), the inspiration repos are where its *approach*
comes from; the lineage repos are where its *fixes* come from.

## 5. The scope rubric (how to classify a candidate)

Used by the upstream-port fit-check on **lineage-repo** candidates. **Bug/
stability/security/performance/correctness/dependency-maintenance fixes are ALWAYS
ported — alignment is N/A.** The fit-check only applies to **new features/
capabilities**, classified one of:

### `alignment: core` — port (advances the mission)
Advances the co-worker direction. Examples:
- Execution scratchpad/kernel, artifacts/rendering, provenance.
- Persona/package install-uninstall, soul/personality/overlays, skill or
  application-package mechanisms.
- Outcome-delivery, scheduling/autonomy (crons), memory & self-improvement.
- Non-technical UX: intent-based input, "show the thing not the process",
  problems-not-errors, safety/undo, A/B reactions.
- Local-first data/analysis, secret vault; multi-provider/MCP foundation.
- Integrations a persona or application-package would expose (email, sheets,
  Jira, Langflow, CRM, dashboards).

### `alignment: adjacent` — defer (useful, not on the critical path)
Genuinely useful but not advancing the current direction; **park it** until the
roadmap reaches it. Examples: a quality-of-life dev-tooling improvement with no
co-worker payoff yet; an integration with no current persona/app-package home; an
optimization for a workflow we don't prioritize. *Defer, don't reject.*

### `alignment: out-of-scope` — don't port (off-course or conflicting)
Either a **coding-assistant-only** feature with no co-worker payoff, or something
that **conflicts with the ethos**. Examples:
- Deepens "you must think in code" UX (raw config the user must hand-edit, an
  engineer-only surface a non-technical user can't use).
- Niche developer tooling that only serves the coding-agent use case and adds
  surface/maintenance with no doing-agent value.
- Anything contradicting **local-first / privacy**, the **brand/attribution**
  stance, or a committed roadmap decision.
- Scope creep that pulls maintenance away from the persona/outcome direction.

When unsure between `adjacent` and `out-of-scope`, prefer **`adjacent`** — defer
rather than reject, and let a human decide.

## 6. How the verdict is used

- It's recorded as an `alignment:{core,adjacent,out-of-scope}` label on the issue,
  with a short comment citing *this doc's* criterion that drove it.
- It is **advisory**: the system tags and explains; a **human always makes the
  final call** and is the only one who closes/withdraws an issue. Nothing is
  auto-rejected.
- `core` flows into the normal port pipeline; `adjacent` is held; `out-of-scope`
  is surfaced for a human to confirm and close.

## 7. Living-document note

This evolves as the roadmap commits (the roadmap is currently *exploratory*). When
direction changes, update this file first — the fit-check reads it, so the rubric
and the roadmap stay in lockstep. Re-running the backlog fit-check after an update
re-classifies open feature issues against the new criteria.

## References

- **Anton** (MindsDB) — open-source "AI coworker / doing agent": you hand it an
  outcome, it delivers the deliverable + a transparent execution scratchpad.
  `role: inspiration`. <https://github.com/mindsdb/anton>, <https://mindshub.ai/agents/anton>
- **Hermes Agent** (Nous Research) — five pillars (Memory, Skills, **Soul**, Crons,
  Self-improvement); `SOUL.md` is the durable slot-1 identity, with session
  **personality overlays** that supplement (not replace) the base — the model for
  soul-per-persona. `role: inspiration`. <https://hermes-agent.nousresearch.com/docs/>
- **mempalace** — memory-palace reference for the memory pillar. `role: inspiration`.
- Internal: `docs/dev/2026-05-24-anton-capabilities-otto-roadmap.md`,
  `docs/dev/building-coding-agents/25-designing-for-non-technical-users-vibe-coders.md`,
  `coworker-phase-*` plans.
