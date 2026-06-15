verdict: cherry-pick

# fc39cdc — fix(ollama): trust /api/show context, sync num_ctx, and fix KNOWN_MODELS drift

## Target file(s)
- src/resources/extensions/ollama/model-capabilities.ts
- src/resources/extensions/ollama/ollama-discovery.ts
- src/resources/extensions/ollama/tests/model-capabilities.test.ts
- src/resources/extensions/ollama/tests/ollama-discovery-priority.test.ts (new)

## Divergence
The ollama extension lives at the same path in otto-cli (`src/resources/extensions/ollama/`) and the pre-fix state matches the upstream pre-fix snapshot: `caps.contextWindow ?? showContextWindow ?? estimate` priority at otto's `ollama-discovery.ts:73–76`, `minimax-m2.7` still at 1048576 (otto `model-capabilities.ts:93`), no `deepseek-v4-*` or `gemma4` rows, no `ollamaOptions` derivation from `showContextWindow`. Only divergence: otto's discovery file already substitutes `OTTO_DEBUG` for `GSD_DEBUG` at line 68 (`if ((process.env.OTTO_DEBUG ?? process.env.OTTO_DEBUG))` — note the duplicated env name is an existing otto bug worth flagging but not part of this port). The upstream comment string mentions "ollama 0.23.2" — port verbatim; the version reference belongs in the empirical evidence trail.

## Concrete edits
1. In `src/resources/extensions/ollama/model-capabilities.ts`, update the KNOWN_MODELS table:
   - In the Reasoning models block, insert above `deepseek-r1` (line 32): three new rows for `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v4`, each with `{ contextWindow: 1048576, reasoning: true, ollamaOptions: { num_ctx: 1048576 } }`. Long-variants first to avoid prefix shadowing — same invariant as `qwen3-coder`/`glm`/`kimi`/`minimax`.
   - Replace the `minimax-m2.7` row (line 93) with `{ contextWindow: 196608, maxTokens: 16384, reasoning: true, ollamaOptions: { num_ctx: 196608 } }` and update the inline comment to explain the cloud-deployment 1M → 192K downgrade.
   - In the Gemma block, insert above `gemma3` (around line 102): `["gemma4", { contextWindow: 262144, reasoning: true, ollamaOptions: { num_ctx: 262144 } }]`.
   - Update the top-of-table comment block (lines 27–30) to read "ollamaOptions.num_ctx is set when the context window has an authoritative source — either KNOWN_MODELS or /api/show. When neither, num_ctx is NOT sent and ollama uses its own safe default."
2. In `src/resources/extensions/ollama/ollama-discovery.ts` around lines 73–76, flip the priority: replace `caps.contextWindow ?? showContextWindow ?? ...` with `showContextWindow ?? caps.contextWindow ?? ...`. Update the surrounding comment to reflect /api/show as source of truth.
3. After the `reasoning` derivation, add a new `ollamaOptions` derivation:
   ```ts
   const ollamaOptions =
       showContextWindow !== undefined
           ? { ...caps.ollamaOptions, num_ctx: showContextWindow }
           : caps.ollamaOptions;
   ```
4. Change the returned `ollamaOptions` field (otto line 124) from `caps.ollamaOptions` to the new `ollamaOptions` local.
5. Port the new test `src/resources/extensions/ollama/tests/ollama-discovery-priority.test.ts` verbatim — it pins the `showContextWindow > caps` resolution order and the num_ctx mirror invariant.
6. Extend `src/resources/extensions/ollama/tests/model-capabilities.test.ts` with:
   - A deepseek-v4 prefix-shadow regression (the new `deepseek-v4-pro` row must win against `deepseek-v4`).
   - A `num_ctx === contextWindow` invariant across the table.
   - A `minimax-m2.7` deployed-backend assertion (`contextWindow === 196608`).
7. Bonus cleanup (not part of the upstream diff): otto's `ollama-discovery.ts:68` reads `(process.env.OTTO_DEBUG ?? process.env.OTTO_DEBUG)` — the second ref should be a fallback like `process.env.OTTO_VERBOSE` or just be deduplicated. Flag and either fix in the same PR or file a follow-up.

## Verdict
CRITICAL_STABILITY for ollama users. The minimax-m2.7 drift (1M table value vs 192K deployed cloud reality) silently truncates or OOMs cloud-routed users; the priority flip plus num_ctx sync makes /api/show authoritative when present and keeps the table as fallback only. Code surface is otto-owned and matches upstream pre-fix byte-for-byte at the changed sites. Low risk, high value — port without modification beyond the OTTO_DEBUG note.
