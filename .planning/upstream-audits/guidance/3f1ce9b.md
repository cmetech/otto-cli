verdict: manual-port

# 3f1ce9b — fix(ai): avoid duplicate Codex replay message ids closes #5148

## Target file(s)
packages/pi-ai/src/providers/openai-responses-shared.ts
(new test) packages/pi-ai/test/openai-responses-message-id.test.ts — does not yet exist

## Divergence
File exists and the `convertResponsesMessages` assistant-text branch is structurally intact, but otto-cli still has the OLD logic: fallback `msgId = \`msg_${msgIndex}\`` with no per-text-block disambiguation (no `textBlockIndex`). Note: otto-cli's prefix convention elsewhere is `msg_pi_` style, while the upstream patch text uses `pi_msg_` — otto-cli should keep its own prefix scheme. Because of the prefix-naming divergence, a raw cherry-pick is risky; port by hand.

## Concrete edits
1. In the `assistant` branch of `convertResponsesMessages`, declare `let textBlockIndex = 0;` just before the `for (const block of msg.content)` loop (right after `isDifferentModel` is computed).
2. Inside `else if (block.type === "text")`, before the `let msgId = parsedSignature?.id;` line, compute a per-block fallback id: `const fallbackMessageId = textBlockIndex === 0 ? \`msg_${msgIndex}\` : \`msg_${msgIndex}_${textBlockIndex}\`; textBlockIndex++;` (keep otto-cli's existing prefix word; the point of the fix is the `_${textBlockIndex}` suffix for 2nd+ text blocks).
3. Change `msgId = \`msg_${msgIndex}\`;` to `msgId = fallbackMessageId;`.
4. Port the upstream test as packages/pi-ai/test/openai-responses-message-id.test.ts, adjusting import extensions to otto-cli convention.

## Verdict
manual-port — tiny change, structure intact; only reason not to cherry-pick is the message-id prefix naming divergence between repos. Verify the exact prefix string otto-cli emits before committing.
