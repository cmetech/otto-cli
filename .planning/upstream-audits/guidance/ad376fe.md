verdict: cherry-pick

# ad376fe — fix(gsd): preserve codebase cache timestamp

## Target file(s)
- src/resources/extensions/workflow/codebase-generator.ts

## Divergence
Otto's `codebase-generator.ts` still has the buggy code: `DEFAULT_MAX_AGE_MS = 15 * 60_000` (line 110), `maxAgeMs = ensureOptions?.maxAgeMs ?? DEFAULT_MAX_AGE_MS` (line 473), and the `maxAgeMs > 0 && Number.isFinite(ageMs) && ageMs > maxAgeMs ? "expired"` branch (line 524). The upstream patch removes all three — the cache should be invalidated by content fingerprint, not wall-clock age. Otto is identical to upstream pre-patch.

## Concrete edits
1. Delete the line `const DEFAULT_MAX_AGE_MS = 15 * 60_000;` near the other DEFAULT_* constants.
2. Delete `const maxAgeMs = ensureOptions?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;` in `ensureCodebaseMapFresh`.
3. Delete the `const ageMs = metadata ? now - Date.parse(metadata.generatedAt) : Number.POSITIVE_INFINITY;` line.
4. Remove the `: maxAgeMs > 0 && Number.isFinite(ageMs) && ageMs > maxAgeMs ? "expired"` branch from the `staleReason` chained ternary, leaving fingerprint / file-count / truncation checks.
5. Inspect callers — if anything passes `maxAgeMs` to `ensureCodebaseMapFresh`, that arg can stay defined in the type (still accepted, just ignored) or be cleaned up alongside.
6. Port the upstream test additions (29 lines) into `src/resources/extensions/workflow/tests/codebase-generator.test.ts`, adjusting import paths.

## Verdict
Clean cherry-pick. The fix is purely subtractive (removes a wall-clock staleness rule that was generating unnecessary regenerations) and ships with a regression test that asserts the cache survives across time when fingerprints match. Risk is minimal: callers that wanted aggressive invalidation can pass `force: true`.
