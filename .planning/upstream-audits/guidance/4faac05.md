verdict: do-not-port

# 4faac05 — fix(ai): handle OpenCode reasoning params

## Target file(s)
upstream: `packages/ai/scripts/generate-models.ts`, `packages/ai/src/providers/openai-completions.ts`, `packages/ai/src/types.ts`, `packages/ai/README.md`
otto-cli candidates: `packages/pi-ai/scripts/generate-models.ts`, `packages/pi-ai/src/providers/openai-completions.ts`, `packages/pi-ai/src/types.ts`

## Divergence
The core code change gates `reasoning_effort` on `compat.supportsReasoningEffort` inside the `thinkingFormat === "deepseek"` branch of `buildParams`. otto-cli's `openai-completions.ts` has NO `deepseek` branch — its `buildParams` only handles `thinkingFormat` values `"zai"` and `"qwen"` (line 397: `if ((compat.thinkingFormat === "zai" || compat.thinkingFormat === "qwen") ...)`), and the `thinkingFormat` type in `types.ts:327` is `"openai" | "zai" | "qwen"`. The deepseek thinking-object code path the fix corrects simply does not exist here.

The generator changes (`applyThinkingLevelMetadata` kimi-k2.6 / grok-build-0.1, `string-thinking` → `deepseek`) also have no analog: otto-cli's `generate-models.ts` lacks `applyThinkingLevelMetadata` and the kimi/grok compat branches, and generated model files under `src/models/generated/` are regenerated build output.

Note: otto-cli ALREADY gates OpenAI-style reasoning_effort on `supportsReasoningEffort` (openai-completions.ts:400), so the spirit of "don't send reasoning_effort when unsupported" is partly present, but not for the deepseek format being fixed.

## Concrete edits
None applicable without first porting the deepseek/string-thinking thinkingFormat subsystem, which is a separate, larger effort.

## Verdict
do-not-port — fix targets a `deepseek` thinkingFormat branch and generator metadata absent from otto-cli. README/CHANGELOG-only portions are not worth porting in isolation.
