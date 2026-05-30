verdict: do-not-port

# d1fb34b — fix(ai): use valid synthetic Responses message ids closes #5148

## Target file(s)
packages/pi-ai/src/providers/openai-responses-shared.ts
(no equivalent for the test file's exact assertion)

## Divergence
Superseded by prior otto divergence. Upstream changes the synthetic fallback id from `pi_msg_${msgIndex}` / `pi_msg_${msgIndex}_${textBlockIndex}` to `msg_pi_${msgIndex}` / `msg_pi_${msgIndex}_${textBlockIndex}` (OpenAI rejects ids not starting with `msg_`). otto's openai-responses-shared.ts has already diverged: it has NO `fallbackMessageId` variable and NO `textBlockIndex` tracking. otto's fallback (in `convertResponsesMessages`, ~line 169-175) already uses `msg_${msgIndex}` when no signature id is present, and `msg_${shortHash(msgId)}` when an id exceeds 64 chars — both already valid `msg_`-prefixed ids. The exact upstream lines being patched do not exist in otto.

## Concrete edits
None required. otto's synthetic ids already start with `msg_`, which is the property this commit was fixing (invalid `pi_msg_` prefix). The bug being fixed is not present in otto. Optionally confirm by reading packages/pi-ai/src/providers/openai-responses-shared.ts lines ~166-184 to verify the `msg_${msgIndex}` / `msg_${shortHash(...)}` fallback is intact.

## Verdict
do-not-port — otto already emits valid `msg_`-prefixed synthetic ids; the patched `pi_msg_` code path was replaced by otto's own simpler logic, so the fix is already effectively present.
