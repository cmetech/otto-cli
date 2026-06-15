verdict: cherry-pick

# 97d4ddb — fix(bug-1): Zero-tool-call retries spin on provider error messages

## Target file(s)
- src/resources/extensions/workflow/auto/phases.ts
- src/resources/extensions/workflow/tests/auto-loop.test.ts

## Divergence
Otto's `auto/phases.ts` line 2586 has the same `if (lastUnit && lastUnit.toolCalls === 0)` zero-tool-call branch as upstream's pre-commit base. All required dependencies are already present in otto:
- `pauseAutoForProviderError` imported (line 40).
- `classifyError` / `isTransient` exported from `../error-classifier.ts` (otto's local file).
- `emitCancelledUnitEnd` and `resumeAutoAfterProviderDelay` used elsewhere in the file.

Only adds: new helper `extractLastAssistantText`, constant `TRANSIENT_PROVIDER_MESSAGE_KINDS`, and the new pre-emptive branch.

## Concrete edits
1. In `src/resources/extensions/workflow/auto/phases.ts`:
   - Add import line: `import { classifyError, isTransient } from "../error-classifier.js";`
   - After the existing constants near the top of the file (e.g., near `STUCK_WINDOW_SIZE`), add:
     ```ts
     const TRANSIENT_PROVIDER_MESSAGE_KINDS = new Set(["rate-limit", "network", "stream", "connection", "server"]);
     ```
   - Add the `extractLastAssistantText` helper verbatim from upstream.
   - In the zero-tool-call branch starting at line 2586, insert the new "provider message classification" block BEFORE the existing `USER_DRIVEN_DEEP_UNITS.has(unitType)` check. Verbatim from upstream — no brand strings inside.
2. Port test cases from upstream's `tests/auto-loop.test.ts` additions (filter to the new test names). No path/brand changes expected.

## Verdict
Direct cherry-pick — all dependencies exist with same names in otto. Real bug (CPU-spin on provider errors) with clean fix. Apply.
