# OTTER — Elevator Pitch

## The pitch

**OTTER** provides an integrated developer assistant that elevates engineering **P**roductivity and ensures **L**ocal **C**ompliance by **O**rchestrating **T**ools, **T**asks, **E**xecution, and **R**esearch through a governed laptop runtime.

## How the letters map

| Letter | Word | What it means |
|---|---|---|
| **O** | **O**rchestrating | OTTER is the conductor — it classifies each request and routes it to the right backend (Gateway, Langflow, or local) |
| **T** | **T**ools | Wields kiro-cli, MCP servers, language tooling, and shell — everything a developer reaches for |
| **T** | **T**asks | Code, Research, Ops, Automate — the four task types every dev/admin/PM ask resolves to |
| **E** | **E**xecution | Runs the work locally on the user's laptop; tool calls and side effects stay on-machine |
| **R** | **R**esearch | Investigates, synthesizes, cites — equally fluent for engineering questions and operational ones |

## Why it matters

- **One entrypoint for three roles.** Developers, administrators, and project managers all use the same CLI. No per-role tooling sprawl.
- **Compliance by construction.** Every LLM token routes through the Loop24 Gateway when configured. Auth, audit, rate limits, and content moderation live in one place — not scattered across clients.
- **Local-first.** Tool execution stays on the laptop. OTTER doesn't ship developer state to a cloud worker when a local one will do.
- **Provider-agnostic.** Speaks Anthropic, OpenAI, and Ollama chat APIs to the Gateway. No architectural lock-in.

## Where it fits

OTTER is the user-facing CLI of the **loop24 product family** — sibling to the Loop24 Gateway (the brain), Langflow (the automation orchestrator), and OSCAR (the remote operational data agent). Everything but OSCAR lives on the developer's laptop.

## OTTO — the short form

> **OTTO** is the on-laptop coding assistant that gets out of your way.

For casual reference, marketing copy, and conversational mentions, OTTER is also called **OTTO**. Same product, friendlier name. Reads as "auto" — fitting for a tool whose job is to automate the work between *ask* and *answer*.

## Audience

- **Developers** in regulated industries who need AI assistance without sending source through unaudited paths
- **Administrators** who want to triage incidents, summarize logs, and pull live ops data without writing custom scripts
- **Project managers** who need to query ticket systems and synthesize status without leaving the terminal
- **Platform teams** evaluating AI tooling that can be governed centrally rather than per-developer

## Status

v0.x — early release. Distributed as `@ericsson/loop24` on npm. The OTTER brand is being introduced gradually; the package, binary, and config directory all remain `loop24`.
