verdict: cherry-pick

# 2ff3dec — fix(pi-ai): normalize Claude tool schemas for Cloud Code Assist

## Target file(s)
- packages/pi-ai/src/providers/google-shared.ts
- packages/pi-ai/src/providers/google-shared.test.ts

## Divergence
Otto-cli's `packages/pi-ai/src/providers/google-shared.ts` shares the same `sanitizeSchemaForGoogle` entrypoint and signature as gsd-pi's. The upstream commit extends the sanitizer to drop `$schema` / `$id` / `unevaluatedProperties`, strip `additionalProperties: false`, drop empty `required: []`, and broaden `const → enum` (also for non-string values) — all generic JSON-schema fixes that apply identically here. The two unrelated hunks in `src/resources/extensions/gsd/tests/dist-redirect.mjs` and `resolve-ts.mjs` are upstream-only and should be omitted.

## Concrete edits
1. Apply the gsd-pi diff to `packages/pi-ai/src/providers/google-shared.ts`: update the doc comment from `const: "value"` to `const: value`; in the skip-key block add `$schema`, `$id`, `unevaluatedProperties`; add the `additionalProperties === false` skip and the empty `required` array skip; remove the `typeof value === "string"` restriction on the `const → enum` conversion so non-string consts are also converted.
2. Apply the matching test additions in `packages/pi-ai/src/providers/google-shared.test.ts` covering the new keyword-skip / empty-required / non-string-const cases.
3. Do NOT port the two `src/resources/extensions/gsd/tests/*.mjs` hunks (no equivalent in otto).
4. Run `cd packages/pi-ai && npm test -- google-shared` to confirm.

## Verdict
Clean port. The sanitizer is shared verbatim between forks and the bug (Google Cloud Code Assist rejecting valid Claude schemas) affects otto-cli identically. Filter out the unrelated `gsd/` test-helper hunks during cherry-pick.
