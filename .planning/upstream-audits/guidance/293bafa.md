verdict: manual-port

# 293bafa — fix: repair extension CI compatibility

## Target file(s)
- packages/pi-ai/src/index.ts (already exports transformMessagesWithReport — skip)
- packages/pi-ai/src/providers/transform-messages.ts (already has WithReport variant — skip)
- src/resources/extensions/workflow/tests/parallel-skill-prompt-integration.test.ts
- src/resources/extensions/workflow/tests/provider-errors.test.ts
- src/resources/extensions/workflow/tests/provider-switch-observer.test.ts
- src/resources/extensions/workflow/tests/skill-activation.test.ts
- src/resources/extensions/visual-brief/tests/visual-brief.test.ts

## Divergence
The `transform-messages.ts` and `pi-ai/src/index.ts` changes are already present in otto (grep confirms `transformMessagesWithReport`, `makeEmptyReport`, `hasReportChanges` all exist). The test-file changes have NOT been ported — otto's `provider-errors.test.ts` still imports `RETRYABLE_ERROR_RE` directly (line 26) and contains the `agent-session retryable regex` test at line 713. Upstream replaces those with a `classifyError`-based test that doesn't depend on the cross-package deep import. Otto's other test files have the same surface and presumably need similar CI-decoupling tweaks.

## Concrete edits
1. Skip `packages/pi-ai/src/index.ts` and `packages/pi-ai/src/providers/transform-messages.ts` — already up to date.
2. In `src/resources/extensions/workflow/tests/provider-errors.test.ts`: drop the deep import of `RETRYABLE_ERROR_RE`, replace the "agent-session retryable error regex" test with the upstream `classifyError`-based test (verifies retryable messages classify as transient `kind: "server"`, while `model not found` and `temporarily backed off` do not).
3. Apply the corresponding adjustments to `provider-switch-observer.test.ts`, `parallel-skill-prompt-integration.test.ts`, `skill-activation.test.ts`, and `visual-brief.test.ts` per upstream patch — typically removing deep imports of internal `pi-coding-agent` symbols, switching to public `@otto/pi-ai` API.

## Verdict
Port the test-side decoupling. Verify against otto's package boundary — `@otto/pi-ai` not `@gsd/pi-ai`. Source already has the runtime change.
