verdict: do-not-port

# e21fd8e — fix: avoid agent-core build-order dependency

## Target file(s)
- packages/pi-coding-agent/src/core/agent-session.ts (otto has full real module, not a re-export)

## Divergence
Upstream's `packages/pi-coding-agent/src/core/agent-session.ts` is a single-line file that re-exports `AgentSessionEvent` and `SessionStateChangeReason` from `@gsd/agent-core`. The fix changes the source path from `@gsd/agent-core/agent-session.js` to a relative `../../../gsd-agent-core/src/agent-session.ts` to dodge a build-order dependency. Otto-cli's `packages/pi-coding-agent/src/core/agent-session.ts` is the FULL real `AgentSession` class implementation — not a stub, not a re-export. It defines the agent lifecycle, session management, model switching, streaming, tool refresh, etc. (see the sibling test files: `agent-session-streaming.test.ts`, `agent-session-model-switch.test.ts`, `agent-session-tool-refresh.test.ts`). Otto has not split agent-core out into a separate package, so the build-order problem upstream is solving does not exist here.

## Concrete edits
1. None. Applying upstream's diff would replace otto's entire `AgentSession` class with a one-line re-export to a path that does not exist in otto.

## Verdict
Skip. Hostile to otto's structure. The bug upstream is fixing only exists because they extracted gsd-agent-core into its own package and hit a TypeScript build-order race. Otto keeps everything inside `packages/pi-coding-agent` and so cannot have this bug.
