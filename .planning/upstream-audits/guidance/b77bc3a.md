verdict: do-not-port

# b77bc3a — fix: inline bridge session event shim

## Target file(s)
- none (otto's `agent-session.ts` is the source, not a shim)

## Divergence
Upstream's `packages/pi-coding-agent/src/core/agent-session.ts` was a single-line shim re-exporting `AgentSessionEvent` and `SessionStateChangeReason` from `../../../gsd-agent-core/src/agent-session.ts`. The fix inlines the type definitions into pi-coding-agent so it can build before the `gsd-agent-core` dist exists. Otto-cli has no `packages/gsd-agent-core` package — the agent-session source lives in `packages/pi-coding-agent/src/core/agent-session.ts` directly (the file is ~800 lines and includes `export type SessionStateChangeReason = ...` at line 115 and `export type AgentSessionEvent = ...` at line 128 along with the `AgentSession` class itself). So the bug (shim breaks build ordering) does not exist in otto, and the fix (inlining the types) is the state otto is already in.

## Concrete edits
1. (none — verified `otto/packages/pi-coding-agent/src/core/agent-session.ts` already inlines both types at lines 115 and 128)

## Verdict
Do-not-port. Otto absorbed ADR-010's pi/gsd split differently from upstream: instead of a `gsd-agent-core` package re-exported via shim into `pi-coding-agent`, otto keeps the agent-session implementation in `pi-coding-agent` itself. The shim layer that the upstream fix patches simply does not exist in otto. Caveat: when porting future commits that reach into `@gsd/agent-core` or `gsd-agent-core/src/agent-session.ts`, route them to the equivalent symbol inside otto's `pi-coding-agent/src/core/agent-session.ts` instead.
