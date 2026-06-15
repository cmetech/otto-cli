verdict: do-not-port

# 9ca6cee — fix(gsd): avoid swallowing network ECONNRESET

## Target file(s)
- src/resources/extensions/workflow/bootstrap/register-extension.ts

## Divergence
Otto's `register-extension.ts` does NOT contain the buggy `isPipeClosedError` branch that treats `ECONNRESET` as a pipe-closed signal. Otto's code path explicitly checks only `if ((err as NodeJS.ErrnoException).code === "EPIPE")` (line 32) and has no helper that recognises ECONNRESET as recoverable. So the upstream regression that the patch fixes never existed in otto.

## Concrete edits
None — confirm by grepping `ECONNRESET` in `src/resources/extensions/workflow/bootstrap/register-extension.ts` returns no hit (it does not). Optionally add the regression test `handleRecoverableExtensionProcessError leaves ECONNRESET network errors unhandled` to otto's equivalent test file as defensive coverage if a similar helper is later introduced.

## Verdict
Do-not-port. Otto's narrower EPIPE-only filter never had the bug. Track the upstream test for potential later inclusion if/when otto adds a broader recoverable-error matcher.
