verdict: manual-port

# faf7dbb — fix: keep MCP and complex-schema tools available on Google providers

## Target file(s)
- packages/pi-ai/src/providers/provider-capabilities.ts
- packages/pi-ai/src/providers/provider-capabilities.test.ts
- packages/pi-coding-agent/src/core/tools/tool-compatibility-registry.ts
- packages/pi-coding-agent/src/core/sdk-tool-filter.test.ts

## Divergence
Otto-cli's `provider-capabilities.ts` matches the upstream pre-fix shape exactly: `google` (line 108), `google-gemini-cli` (line 117), and `google-vertex` (line 126) all declare `unsupportedSchemaFeatures: ["patternProperties", "const"]`. The pre-filtering occurs through `tool-compatibility-registry.ts` MCP defaults (`schemaFeatures: ["patternProperties"]` at line 37) which match the upstream pre-fix snapshot. The wire-time sanitizer `sanitizeSchemaForGoogle` referenced in the upstream comment must exist in otto's google-shared provider — verify before flipping. The fifth changed file `src/resources/extensions/gsd/tests/claude-tool-schema-golden.test.ts` is gsd-extension-only — skip. The sixth file `src/resources/extensions/gsd/tests/tool-compatibility.test.ts` is also gsd-only — skip.

## Concrete edits
1. Confirm `packages/pi-ai/src/providers/google-shared.ts` (or wherever otto's Google request conversion lives) sanitizes `patternProperties` and `const` at wire time — search for `sanitizeSchemaForGoogle` or equivalent. If absent in otto, port the sanitizer first (the comment in the upstream patch is load-bearing).
2. In `packages/pi-ai/src/providers/provider-capabilities.ts` at lines 108, 117, 126, change `unsupportedSchemaFeatures: ["patternProperties", "const"],` to `unsupportedSchemaFeatures: [],` for the three Google entries (`google`, `google-gemini-cli`, `google-vertex`). Leave a comment pointing to the wire-time sanitizer.
3. In `packages/pi-coding-agent/src/core/tools/tool-compatibility-registry.ts` at lines 36–38, replace the `MCP_TOOL_DEFAULTS = { schemaFeatures: ["patternProperties"] }` with `MCP_TOOL_DEFAULTS: ToolCompatibility = {}` and refresh the comment to point to wire-time sanitization.
4. In `packages/pi-coding-agent/src/core/sdk-tool-filter.test.ts` around line 25–33, update the "filterToolsForProviderRequest removes provider-incompatible tools" test so `complex_schema_tool` ends in `result.compatible` instead of `result.filtered`. Mirror the upstream assertions.
5. Update `packages/pi-ai/src/providers/provider-capabilities.test.ts` where it asserts the Google entries' `unsupportedSchemaFeatures` — adjust to the new `[]` value. Spot-check by running the test before edit to find brittle references.
6. Re-run otto's google-shared tests (`anthropic.gateway.test.ts`, `google-shared.test.ts`, `provider-capabilities.test.ts`) to confirm the sanitizer-only path holds.

## Verdict
Real fix: pre-filtering by capability removed legitimate MCP and subagent tools before Google's wire-time sanitizer could strip the unsupported keywords, breaking subagent dispatch on Cloud Code Assist. Risk is in step 1: if otto lacks the wire-time sanitizer, flipping the capability flags will send invalid schemas to Google and cause request rejection. Verify the sanitizer first; if missing, port it before touching capabilities.
