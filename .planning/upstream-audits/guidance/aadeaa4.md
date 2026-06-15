verdict: cherry-pick

# aadeaa4 — fix(pi-coding-agent): keep identical parallel tool calls separate

## Target file(s)
- packages/pi-coding-agent/src/modes/interactive/controllers/chat-controller.ts
- packages/pi-coding-agent/src/core/chat-controller-ordering.test.ts

## Divergence
Otto has both files at the exact upstream paths: `packages/pi-coding-agent/src/modes/interactive/controllers/chat-controller.ts` and `packages/pi-coding-agent/src/core/chat-controller-ordering.test.ts`. The upstream patch adds `ToolRegistrationSource` typing, `toolRegistrationSources` WeakMap, and `invocationAliasedToolComponents` WeakSet at module scope, plus tweaks `findPendingToolByInvocation` so two identical concurrent `tool_execution_start` events render as separate cards instead of collapsing into one.

A quick check shows otto's `chat-controller.ts` does NOT yet contain `toolRegistrationSources` or `ToolRegistrationSource` — the fix is unported.

## Concrete edits
1. In `packages/pi-coding-agent/src/modes/interactive/controllers/chat-controller.ts`, add the module-scope additions: `type ToolRegistrationSource = "content" | "standalone"`, the `toolRegistrationSources` WeakMap, the `invocationAliasedToolComponents` WeakSet, and the explanatory comment.
2. Adjust `findPendingToolByInvocation` to consult `toolRegistrationSources` so same-source identical invocations are treated as concurrent (separate components), only IDs reported across different event sources reconcile.
3. Wire each ToolExecutionComponent creation site to record its registration source via `toolRegistrationSources.set(component, source)`.
4. Port the new test ("chat-controller keeps parallel identical tool_execution_start calls separate") into `chat-controller-ordering.test.ts`. Adjust the theme global key from `@gsd/pi-coding-agent:theme` to `@otto/pi-coding-agent:theme` to match otto's namespace.

## Verdict
Clean cherry-pick at the logic level. The only namespace adjustment is the Symbol.for theme key (`@gsd/` → `@otto/`). The bug — two simultaneous `read` calls on the same path collapsing into one card — would manifest in otto identically; the fix is small, self-contained, and shipped with its own regression test.
