# Upstream audit — pi-dev — 2026-05-30

**Scope**: v0.75.4 (3533843) → HEAD (dbb9911)
**Commits scanned**: 129
**Issues filed**: 59
**Not applicable to OTTO**: 2 (matched applicability rules)
**Skipped (mechanical)**: 18 (merge / chore / docs / already filed)
**Unclassified (manual triage)**: 46

## Critical — security (0)

(none)

## Critical — stability (4)

- #1 (exists, OPEN) — 🐛 [sha=fa1180b] fix(ai): detect Poolside context overflow — `conflict-risk:none`
- #2 (exists, OPEN) — 🐛 [sha=ce0e801] fix(coding-agent): retry RPC stdout backpressure — `conflict-risk:none`
- #2 (exists, OPEN) — 🐛 [sha=d0d1d8e] fix(rpc): respect stdout backpressure — `conflict-risk:none`
- #45 — 🐛 [sha=15f1dea] fix(coding-agent): disable managed extension peer resolution — `conflict-risk:none`

## Nice-to-have fixes (48)

- #3 — 🩹 [sha=31b961f] fix(coding-agent): sync clipboard binary archive deps — `conflict-risk:none`
- #4 — 🩹 [sha=ba2d313] fix(ai): handle OpenCode Kimi reasoning params — `conflict-risk:none`
- #5 — 🩹 [sha=a36a132] fix(ai): abort Codex SSE body reads — `conflict-risk:none`
- #7 — 🩹 [sha=edd1212] fix(coding-agent): buffer early input before prompt loop — `conflict-risk:none`
- #8 — 🩹 [sha=9d2bceb] fix(tui): forward OSC 8 hyperlinks under tmux when the client supports them — `conflict-risk:none`
- #10 — 🩹 [sha=4faac05] fix(ai): handle OpenCode reasoning params — `conflict-risk:none`
- #13 — 🩹 [sha=93600d8] fix(release): align package repository metadata — `conflict-risk:none`
- #14 — 🩹 [sha=f3b4e12] fix(release): upgrade npm for trusted publishing — `conflict-risk:none`
- #11 (exists, OPEN) — 🩹 [sha=4b4641c] fix(coding-agent): scope custom session dir lookups — `conflict-risk:none`
- #16 — 🩹 [sha=b64f3f5] fix(coding-agent): run extension cleanup and restore terminal on signal exits — `conflict-risk:none`
- #17 — 🩹 [sha=d1fb34b] fix(ai): use valid synthetic Responses message ids closes #5148 — `conflict-risk:none`
- #18 — 🩹 [sha=3f1ce9b] fix(ai): avoid duplicate Codex replay message ids closes #5148 — `conflict-risk:none`
- #19 — 🩹 [sha=3e9f717] fix(coding-agent): make config env references explicit — `conflict-risk:none`
- #21 — 🩹 [sha=a29a790] fix(coding-agent): drain follow-ups queued during agent_end — `conflict-risk:none`
- #23 — 🩹 [sha=b85bf65] fix(coding-agent): restore diff code block highlighting — `conflict-risk:none`
- #24 — 🩹 [sha=6ab62a0] fix(tui): harden keyboard protocol negotiation — `conflict-risk:none`
- #25 — 🩹 [sha=16dc525] fix(build): resolve internal packages from workspace dist — `conflict-risk:none`
- #27 — 🩹 [sha=7c02a55] fix(ai): timeout Codex SSE header stalls — `conflict-risk:none`
- #28 — 🩹 [sha=91b46c2] fix(ai): avoid stale Cerebras test model — `conflict-risk:none`
- #29 — 🩹 [sha=701801d] fix(tui): align input word segmentation with editor (#5068) — `conflict-risk:none`
- #31 — 🩹 [sha=4bbe295] fix(tui): provide the JetBrains terminal capabilities (#5037) — `conflict-risk:none`
- #32 — 🩹 [sha=b62776e] fix(tui): preserve ASCII punctuation word boundaries with Intl.Segmenter (#5067) — `conflict-risk:none`
- #33 — 🩹 [sha=493efd4] fix(codex): timeouts for websockets (#4979) — `conflict-risk:none`
- #34 — 🩹 [sha=26f1e00] fix(ai): use hyphenated Codex session header — `conflict-risk:none`
- #35 — 🩹 [sha=2531fc1] fix(ui): preserve user ordered-list markers (closes #5013) — `conflict-risk:none`
- #36 — 🩹 [sha=59ec800] fix(coding-agent): bypass age gates for self-update — `conflict-risk:none`
- #37 — 🩹 [sha=4402100] fix(tui): leverage Intl.Segmenter for proper Unicode word boundaries (#5022) — `conflict-risk:none`
- #38 — 🩹 [sha=8fb1e87] fix(ai): disable hidden provider 429 retries (#4991) — `conflict-risk:none`
- #39 — 🩹 [sha=71446c6] fix(ai): correct Codex Spark context window — `conflict-risk:none`
- #40 — 🩹 [sha=fc8a155] fix(ai): honor Codex Responses maxRetries — `conflict-risk:none`
- #41 — 🩹 [sha=3eb0027] fix(tui): enable OSC 8 for Windows Terminal (closes #4923) — `conflict-risk:none`
- #42 — 🩹 [sha=e007fcd] fix(rpc): reject pending requests on child process exit — `conflict-risk:none`
- #43 — 🩹 [sha=30b3ab3] fix(tui): remove native modifier escape hatch — `conflict-risk:none`
- #44 — 🩹 [sha=c5181a2] fix(tui): detect Apple Terminal Shift+Enter — `conflict-risk:none`
- #46 — 🩹 [sha=3f89350] fix(coding-agent): ship clipboard sidecar in bun binaries — `conflict-risk:none`
- #47 — 🩹 [sha=2e1f07b] fix(coding-agent): avoid invalid footer home abbreviation — `conflict-risk:none`
- #48 — 🩹 [sha=e9146a5] fix(coding-agent): use async operations in tools — `conflict-risk:none`
- #49 — 🩹 [sha=c85dbb1] fix(coding-agent): reconcile pinned git update refs — `conflict-risk:none`
- #50 — 🩹 [sha=42379a3] fix(coding-agent): add OpenCode session headers — `conflict-risk:none`
- #51 — 🩹 [sha=7002c68] fix(ai): declare Bedrock Smithy HTTP handler dependency — `conflict-risk:none`
- #52 — 🩹 [sha=b3ed545] fix(export-html): escape quotes in exported attributes — `conflict-risk:none`
- #53 — 🩹 [sha=baf4028] fix(coding-agent): use the right basedir for patterns — `conflict-risk:none`
- #54 — 🩹 [sha=c100620] fix(coding-agent): Clean up Path Handling (#4873) — `conflict-risk:none`
- #55 — 🩹 [sha=bf56a86] fix(coding-agent): reconcile git package refs — `conflict-risk:none`
- #57 — 🩹 [sha=11c3da4] fix(ai): set bedrock claude default max tokens — `conflict-risk:none`
- #58 — 🩹 [sha=f953067] fix(coding-agent): correct bash truncation line count — `conflict-risk:none`
- #60 — 🩹 [sha=7dad27e] fix(coding-agent): avoid duplicate bash truncation path — `conflict-risk:none`
- #61 — 🩹 [sha=088987b] fix(coding-agent): list themes by content name — `conflict-risk:none`

## Features (11)

- #6 — ✨ [sha=dbcfc16] feat(coding-agent): Export CLI argument parser — `conflict-risk:none`
- #9 — ✨ [sha=42ce989] feat(coding-agent): hyperlink file paths in tool titles — `conflict-risk:none`
- #11 — ✨ [sha=17e9e87] feat(coding-agent): print resume hint on interactive exit — `conflict-risk:none`
- #12 — ✨ [sha=7a5dc0d] feat(coding-agent): Export convertToPng for extensions — `conflict-risk:none`
- #15 — ✨ [sha=9380d5f] feat(coding-agent): add exclude tools option closes #5109 — `conflict-risk:none`
- #20 — ✨ [sha=9d5fb70] feat(ai): add Codex device code login (#4911) — `conflict-risk:none`
- #22 — ✨ [sha=bcea4b2] feat(coding-agent): expose streamingBehavior on InputEvent — `conflict-risk:none`
- #26 — ✨ [sha=52dc08c] feat(session): Explicit session id naming (#5076) — `conflict-risk:none`
- #30 — ✨ [sha=61babc2] feat(rpc): add excludeFromContext flag to bash command (closes #5039) — `conflict-risk:none`
- #56 — ✨ [sha=c554364] feat(ai): refactor device code login for copilot — `conflict-risk:none`
- #59 — ✨ [sha=60a55a2] feat(coding-agent): expose edit tool unified patch — `conflict-risk:none`

## Unclassified — needs manual triage (46)

- `dbb9911` — Add [Unreleased] section for next cycle (no rubric match; manual review)
- `0897f17` — Release v0.78.0 (no rubric match; manual review)
- `36515a3` — Document release npm age gate override (no rubric match; manual review)
- `886fa6c` — Audit unreleased changelog entries (no rubric match; manual review)
- `c1633e6` — Clarify hardware cursor docs (no rubric match; manual review)
- `0ffa590` — Fix GitLab Duo thinking metadata (no rubric match; manual review)
- `9c4a3f3` — Fix ANSI wrapping stack overflow (no rubric match; manual review)
- `a213abb` — Fix OpenRouter Kimi K2.6 developer role (no rubric match; manual review)
- `778f519` — Remove leading spaces from resume session hint (no rubric match; manual review)
- `7921ae4` — Require explicit provider API keys (no rubric match; manual review)
- `ce554ad` — Add startup session name flag (no rubric match; manual review)
- `7619aae` — ai: add custom-header support to Bedrock provider (no rubric match; manual review)
- `abf07d0` — Add [Unreleased] section for next cycle (no rubric match; manual review)
- `8322745` — Release v0.77.0 (no rubric match; manual review)
- `f29472c` — Audit unreleased changelog entries (no rubric match; manual review)
- `0127cae` — Fix OpenRouter DeepSeek V4 xhigh reasoning (no rubric match; manual review)
- `f9fa077` — Fix startup timing attribution (no rubric match; manual review)
- `1ab2899` — Remove unavailable tool preference guideline (no rubric match; manual review)
- `97ef317` — Fix Kimi and Xiaomi model metadata (no rubric match; manual review)
- `bfa3d1f` — Update Claude Opus and GPT thinking metadata (no rubric match; manual review)
- `53ca936` — Update clipboard native addon (no rubric match; manual review)
- `b63d263` — Finish harness tool registry semantics (no rubric match; manual review)
- `458a7bc` — Fix Anthropic empty thinking signature replay (no rubric match; manual review)
- `5b31ffd` — Abort session work during dispose (no rubric match; manual review)
- `edd2644` — Expose tool prompt guidelines to extensions (no rubric match; manual review)
- `17d39cc` — Add changelog entry for PR 5115 (no rubric match; manual review)
- `e43f2c3` — Clarify PR review worktree rules (no rubric match; manual review)
- `cbe8625` — Fix input event streaming behavior semantics (no rubric match; manual review)
- `39a26c8` — Add [Unreleased] section for next cycle (no rubric match; manual review)
- `706f872` — Release v0.76.0 (no rubric match; manual review)
- `96f0edd` — Count user image tokens in context estimates (no rubric match; manual review)
- `9600ded` — revert: fix rpc stdout backpressure (no rubric match; manual review)
- `30f48fe` — Add [Unreleased] section for next cycle (no rubric match; manual review)
- `89ba72c` — Update release instructions and image models (no rubric match; manual review)
- `83a227a` — Update release instructions and generated models (no rubric match; manual review)
- `ea2b70d` — Release v0.75.5 (no rubric match; manual review)
- `98477f2` — Clarify release smoke test instructions (no rubric match; manual review)
- `b9566fc` — Audit unreleased changelog entries (no rubric match; manual review)
- `373bd12` — Collapse read output by default (no rubric match; manual review)
- `8100046` — Finish async tool cleanup (no rubric match; manual review)
- `ba09f1c` — Refine async tool control flow (no rubric match; manual review)
- `9b62f1f` — Fix Anthropic eager tool input compat test (no rubric match; manual review)
- `d801d88` — Support adaptive thinking for Anthropic-compatible aliases (no rubric match; manual review)
- `c841a6c` — Clean up OAuth device-code callbacks (no rubric match; manual review)
- `7426ce9` — Tighten AGENTS.md and extract LLM provider checklist to skill (no rubric match; manual review)
- `b8326ca` — Add [Unreleased] section for next cycle (no rubric match; manual review)

## Not applicable to OTTO (2)

These commits were reviewed against the applicability rules in `.planning/upstream-sync-config.json` and intentionally not filed as issues.

| Commit | Subject | Rule | Reason |
|---|---|---|---|
| `b6b0f69` | feat(ci): Actually bump setup-bun to 2.2.0 | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `20bcab2` | feat(ci): Update setup-bun to 2.2.0 | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |

## Skipped (18)

Mechanical filter — `chore:` / `docs:` / `test:` / `ci:` / `style:` / `refactor:` / `build:` prefixes plus merge commits and PatchDeck syncs. No applicability or severity judgment made; not filed.

<details>
<summary>Expand</summary>

- `7be8a10` chore: approve contributor rolfvreijdenberger — `prefix:chore:`
- `f9832cc` chore: approve contributor stephanmck — `prefix:chore:`
- `7e70886` chore: approve contributor MichaelYochpaz — `prefix:chore:`
- `ae50dec` chore(release): publish packages from CI — `prefix:chore:`
- `99aec8e` test(tui): reduce keyboard negotiation coverage — `prefix:test:`
- `1e168a8` docs(coding-agent): fix development AGENTS link — `prefix:docs:`
- `41d28a9` docs(changelog): audit unreleased entries — `prefix:docs:`
- `7c2775f` chore: approve contributor DanielThomas — `prefix:chore:`
- `4a98f74` chore(tui): remove unused xterm dependency — `prefix:chore:`
- `d80bcc3` test(ai): avoid hardcoded Fireworks router id — `prefix:test:`
- `1a2a536` chore: update PR prompt template — `prefix:chore:`
- `ced73b3` docs: note Node 20 rescue release — `prefix:docs:`
- `b0c5554` docs: document safe development install — `prefix:docs:`
- `1367164` chore: approve contributor AJM10565 — `prefix:chore:`
- `2171cef` test(coding-agent): update bash truncation expectation — `prefix:test:`
- `4868222` chore(tui): replace koffi with Windows VT input helper — `prefix:chore:`
- `385a11b` docs: document dependency install security — `prefix:docs:`
- `3b37c9e` chore: add HF_TOKEN to pi-test.ps1 --no-env unset list — `prefix:chore:`

</details>

## Preflight results

- All 14 required checks passed
- Auto-created labels: 0

---

State advanced: `lastAnalyzedCommit` → `dbb9911` (pi-dev HEAD as of 2026-05-30).
