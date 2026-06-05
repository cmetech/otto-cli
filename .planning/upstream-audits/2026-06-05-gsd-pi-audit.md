# Upstream audit — gsd-pi — 2026-06-05

**Scope**: v1.0.1 (35319aa) → HEAD (ed811bc)
**Commits scanned**: 476
**Issues filed**: 287
**Not applicable to OTTO**: 23 (matched applicability rules)
**Skipped (mechanical)**: 62 (merge / chore / docs / already filed)
**Unclassified (manual triage)**: 103

## Critical — security (1)

- #132 — 🛡️ [sha=3590fda] fix(issue): UOK orchestrator bypasses pre_dispatch_hooks — policy injection never fires — `conflict-risk:none`

## Critical — stability (6)

- #175 — 🐛 [sha=4954d5c] fix: avoid OOM when seeding openai in validate-pack global smoke — `conflict-risk:none`
- #237 — 🐛 [sha=97c2043] fix(issue): Crash/hang at question & save gates: `ProcessTransport is not ready for writing` falls through guard to process.exit(1) — `conflict-risk:none`
- #250 — 🐛 [sha=adf07a7] fix(gsd): preserve crash exit cleanup semantics — `conflict-risk:none`
- #343 — 🐛 [sha=58227e0] fix(bug-2): Crash logs use unbounded per-call filenames crash logs now append to one per-PID file instead of creating timestamped files per call. — `conflict-risk:none`
- #344 — 🐛 [sha=066cee9] fix(bug-1): Recoverable EPIPE events write crash logs EPIPE is handled as recoverable without writing crash artifacts. — `conflict-risk:none`
- #345 — 🐛 [sha=fc39cdc] fix(ollama): trust /api/show context, sync num_ctx, and fix KNOWN_MODELS drift — `conflict-risk:none`

## Nice-to-have fixes (263)

- #83 — 🩹 [sha=6c32ea4] fix: sync engine package lockfile entries — `conflict-risk:none`
- #84 — 🩹 [sha=6cddb44] fix: wait for npm release tarball propagation — `conflict-risk:none`
- #85 — 🩹 [sha=4ba1821] fix: stabilize pack install integration test — `conflict-risk:none`
- #86 — 🩹 [sha=138c104] fix: publish prod native packages inline — `conflict-risk:none`
- #87 — 🩹 [sha=0af8f0d] fix: project root artifacts into worktrees — `conflict-risk:none`
- #88 — 🩹 [sha=494e759] fix: avoid root auto-commit during milestone recovery — `conflict-risk:none`
- #89 — 🩹 [sha=0cf9338] fix: avoid root auto-commit during milestone recovery — `conflict-risk:none`
- #90 — 🩹 [sha=9171fc3] fix: project root artifacts into worktrees — `conflict-risk:none`
- #91 — 🩹 [sha=9a20e26] fix(mcp): recover missing status and gate args — `conflict-risk:none`
- #92 — 🩹 [sha=3166fca] fix: preserve aliases in full tools mode — `conflict-risk:none`
- #93 — 🩹 [sha=8aaf7fa] fix(gsd): sync marker after state recovery — `conflict-risk:none`
- #94 — 🩹 [sha=42290ba] fix: preserve marker identity with repo metadata — `conflict-risk:none`
- #95 — 🩹 [sha=83f54b1] fix: ignore stale gsd identity markers — `conflict-risk:none`
- #96 — 🩹 [sha=9b7f522] fix(gsd): log repo identity remote failures — `conflict-risk:none`
- #97 — 🩹 [sha=4619cd4] fix(gsd): retry missing complete-slice replan artifact — `conflict-risk:none`
- #98 — 🩹 [sha=6bef491] fix(gsd): ignore nested SvelteKit types imports — `conflict-risk:none`
- #99 — 🩹 [sha=2c830cd] fix(bug-2): Verification pause message hides actual failing check auto-mode post-exec pause message now surfaces the actual failing check category/target/message. — `conflict-risk:none`
- #100 — 🩹 [sha=e64a15e] fix(bug-1): SvelteKit './$types' imports falsely fail post-exec checks import-resolution post-exec checks now skip SvelteKit `./$types` generated modules. — `conflict-risk:none`
- #101 — 🩹 [sha=746d2d0] fix(gsd): refresh reconciliation blocker snapshot — `conflict-risk:none`
- #102 — 🩹 [sha=3d12ad5] fix: fail closed on mixed persistent drift blockers — `conflict-risk:none`
- #103 — 🩹 [sha=c7c5236] fix(gsd): preserve drift blockers and orchestration retries — `conflict-risk:none`
- #104 — 🩹 [sha=1d3af22] fix: clear verification retry after closed dispatch skip — `conflict-risk:none`
- #105 — 🩹 [sha=3bd7e05] fix: add slice drift repair guidance — `conflict-risk:none`
- #106 — 🩹 [sha=c5057c9] fix(gsd): prioritize reconciliation blockers — `conflict-risk:none`
- #107 — 🩹 [sha=526ed30] fix(issue): Auto-mode stuck-loop re-dispatches already-completed execute-task units — `conflict-risk:none`
- #108 — 🩹 [sha=8dd6272] fix: preserve discovered skill prompt fallback — `conflict-risk:none`
- #109 — 🩹 [sha=790d022] fix: surface new skills when catalog reload fails — `conflict-risk:none`
- #110 — 🩹 [sha=00dc06b] fix: pause on orchestration drift errors — `conflict-risk:none`
- #111 — 🩹 [sha=e723617] fix: await extension sendMessage turns — `conflict-risk:low`
- #112 — 🩹 [sha=36aab23] fix(issue): [Bug]: Discord invite expired in readme and via bot — `conflict-risk:low`
- #113 — 🩹 [sha=f14fe00] fix: report terminal drift as blockers — `conflict-risk:none`
- #114 — 🩹 [sha=49d3fc9] fix(gsd): resolve worktree registry root from checkout — `conflict-risk:none`
- #115 — 🩹 [sha=9502332] fix(bug-2): Pytest command runs from wrong cwd in monorepo subproject setup corrected repository root resolution so verification executes in the intended subproject cwd. — `conflict-risk:none`
- #116 — 🩹 [sha=b1202a5] fix(auto): avoid provider false positives from zero-tool prose — `conflict-risk:none`
- #117 — 🩹 [sha=491ace3] fix(pi-ai): remove duplicate response id normalization — `conflict-risk:low`
- #118 — 🩹 [sha=8bf3530] fix(issue): complete-slice retries forever when gsd_replan_slice is the correct outcome — `conflict-risk:none`
- #119 — 🩹 [sha=ad881f3] fix(gsd): align drift checks for reopened artifacts — `conflict-risk:none`
- #120 — 🩹 [sha=d8848f8] fix(gsd): allow hook retries after finalization — `conflict-risk:none`
- #121 — 🩹 [sha=7b944da] fix(issue): fix(pi-ai): ensure unique OpenAI Responses message ids after cross-model thinking downgrade — `conflict-risk:low`
- #122 — 🩹 [sha=a69a6e6] fix(pi-ai): keep Bedrock lifecycle test out of src — `conflict-risk:low`
- #123 — 🩹 [sha=1666efb] fix(gsd): align reopen drift checks — `conflict-risk:none`
- #124 — 🩹 [sha=cdb84a5] fix(gsd): clear auto skill visibility after units — `conflict-risk:none`
- #125 — 🩹 [sha=769998a] fix(gsd): dedupe provider error guards — `conflict-risk:none`
- #126 — 🩹 [sha=5d3c33d] fix(issue): [Bug]: retry_on post-unit hook stops auto-mode when same execute-task is re-dispatched — `conflict-risk:none`
- #127 — 🩹 [sha=93b122d] fix: preserve hook model overrides in orchestrator path — `conflict-risk:none`
- #128 — 🩹 [sha=946baa7] fix: align GSD drift artifact resolution — `conflict-risk:none`
- #129 — 🩹 [sha=2e279e8] fix(gsd): refresh skill discovery from disk — `conflict-risk:none`
- #130 — 🩹 [sha=62edd1a] fix: suppress missing origin repo identity warning — `conflict-risk:none`
- #131 — 🩹 [sha=5de837f] fix(issue): chore(pi-ai): regenerate Bedrock model registry for Opus 4.8 + port lifecycle validation test — `conflict-risk:low`
- #133 — 🩹 [sha=f01c6f2] fix(issue): discuss-slice: gsd_summary_save not found — missing entry in AUTO_UNIT_SCOPED_TOOLS — `conflict-risk:none`
- #134 — 🩹 [sha=3f5e830] fix(issue): Project with configured remote falls into first-time-init: getRemoteUrl() swallows transient git failures, flipping the identity hash — `conflict-risk:none`
- #135 — 🩹 [sha=b8f0178] fix(issue): discardMilestone silently skips DB cleanup when MCP server holds WAL connection — `conflict-risk:none`
- #136 — 🩹 [sha=ee99e91] fix: avoid mocked timer in rate limit test — `conflict-risk:none`
- #137 — 🩹 [sha=caf3b51] fix: guard gsd drift recovery — `conflict-risk:none`
- #138 — 🩹 [sha=97d4ddb] fix(bug-1): Zero-tool-call retries spin on provider error messages zero-tool-call completions with transient provider/rate-limit assistant messages now pause with backoff/auto-resume instead of immediate retry. — `conflict-risk:none`
- #139 — 🩹 [sha=e6fe6a6] fix(gsd): reserve dialog frame rows in overlays — `conflict-risk:none`
- #140 — 🩹 [sha=469bdcc] fix: add scrolling to GSD dialogs — `conflict-risk:none`
- #141 — 🩹 [sha=098b1ca] fix(gsd): unify slash dialog borders — `conflict-risk:none`
- #142 — 🩹 [sha=d01b984] fix: remove TUI assistant background — `conflict-risk:none`
- #143 — 🩹 [sha=f444bfb] fix: ignore CLI auth sentinels in doctor routes — `conflict-risk:none`
- #144 — 🩹 [sha=80fcfb5] fix: enforce CLI readiness for external providers — `conflict-risk:none`
- #145 — 🩹 [sha=319751c] fix: check Google CLI provider binaries in doctor — `conflict-risk:none`
- #146 — 🩹 [sha=71369f9] fix: gate all stranded work during auto bootstrap — `conflict-risk:none`
- #147 — 🩹 [sha=b723db3] fix: honor stranded work recovery gates — `conflict-risk:none`
- #148 — 🩹 [sha=8f7f70a] fix: block closeout resolution when git status is unavailable — `conflict-risk:none`
- #149 — 🩹 [sha=3860c0c] fix(gsd): allow setup flows outside git repos — `conflict-risk:none`
- #150 — 🩹 [sha=e2544a9] fix(extensions): harden native tool edge cases — `conflict-risk:none`
- #151 — 🩹 [sha=ddf34c0] fix: align pnpm execpath detection — `conflict-risk:none`
- #152 — 🩹 [sha=b8b6b33] fix: tighten pnpm install detection — `conflict-risk:none`
- #153 — 🩹 [sha=6b378c3] fix: tighten pnpm install path detection — `conflict-risk:none`
- #154 — 🩹 [sha=f696baf] fix: collapse interactive tool output by default — `conflict-risk:none`
- #156 — 🩹 [sha=3fadba9] fix: preserve hook preference file precedence — `conflict-risk:none`
- #157 — 🩹 [sha=257c577] fix(web): avoid phantom SSE shutdown on beforeExit — `conflict-risk:none`
- #158 — 🩹 [sha=37af7ad] fix(ci): repair dist-test node_modules for coverage — `conflict-risk:none`
- #159 — 🩹 [sha=784be52] fix(publish): remove @gsd/* from root dependencies to fix EUNSUPPORTEDPROTOCOL on install — `conflict-risk:none`
- #160 — 🩹 [sha=85a4cb0] fix: align shell pack validation daemon checks — `conflict-risk:none`
- #161 — 🩹 [sha=aa77e48] fix: validate opengsd external deps — `conflict-risk:none`
- #162 — 🩹 [sha=587d2bb] fix: harden npm pack validation — `conflict-risk:none`
- #163 — 🩹 [sha=306f7b9] fix(publish): drop bundledDependencies to resolve E415 (537MB/85k files → 41MB/8.5k) — `conflict-risk:none`
- #164 — 🩹 [sha=8f2fab5] fix(bootstrap): exit on EPIPE storm instead of swallowing in a tight loop — `conflict-risk:none`
- #165 — 🩹 [sha=f71c585] fix: cap R3b recovery retries — `conflict-risk:none`
- #166 — 🩹 [sha=b3cdecc] fix: prevent false-positive approval gate re-trigger after depth verification — `conflict-risk:none`
- #167 — 🩹 [sha=95fb282] fix: use pnpm camelCase package import setting — `conflict-risk:none`
- #168 — 🩹 [sha=1e797bb] fix: set package-import-method=copy to prevent hard-link E415 on npm publish — `conflict-risk:none`
- #169 — 🩹 [sha=871910a] fix(tests): only redirect relative .js to .ts when the .ts source exists — `conflict-risk:none`
- #170 — 🩹 [sha=8e8a184] fix: dereference pnpm symlinks when seeding global validate-pack deps — `conflict-risk:none`
- #171 — 🩹 [sha=82e6398] fix: seed all missing root externals in validate-pack global smoke — `conflict-risk:none`
- #172 — 🩹 [sha=92b241e] fix: seed bundled transitive deps in validate-pack global smoke — `conflict-risk:none`
- #173 — 🩹 [sha=892cab0] fix: drop MCP SDK runtime import from validate-pack global smoke — `conflict-risk:none`
- #174 — 🩹 [sha=7a4a8a3] fix: resolve hoisted openai path in validate-pack global smoke — `conflict-risk:none`
- #177 — 🩹 [sha=1c5b97e] fix: unlink pnpm symlinks before materializing bundled deps — `conflict-risk:none`
- #178 — 🩹 [sha=54a4434] fix: restore workspace:* root deps after prepack regression — `conflict-risk:none`
- #179 — 🩹 [sha=3181463] fix: resolve bundled deps on global install in validate-pack — `conflict-risk:none`
- #180 — 🩹 [sha=7faba93] fix: make validate-pack pass with pnpm workspace protocol — `conflict-risk:none`
- #181 — 🩹 [sha=42e6828] fix: restore green unit tests and validate-pack under pnpm — `conflict-risk:none`
- #182 — 🩹 [sha=8368025] fix: use pnpm cache in prerelease verify — `conflict-risk:none`
- #183 — 🩹 [sha=2b7a93b] fix: align dist-test resolution and package manifest with pnpm workspaces — `conflict-risk:none`
- #184 — 🩹 [sha=9814e35] fix(installer): materialize deps after global --ignore-scripts install — `conflict-risk:none`
- #185 — 🩹 [sha=40397bc] fix: use pnpm optional install flag — `conflict-risk:none`
- #186 — 🩹 [sha=17db4b4] fix(pi-ai): unblock build by removing @smithy/types import — `conflict-risk:low`
- #187 — 🩹 [sha=d6332b6] fix: account for context overhead in donut chart — `conflict-risk:none`
- #188 — 🩹 [sha=fa9e598] fix: satisfy SessionEntry types in context/usage extension tests — `conflict-risk:none`
- #189 — 🩹 [sha=c5d2244] fix: write context reports under project root — `conflict-risk:none`
- #190 — 🩹 [sha=c06228f] fix(install): bundle extension-critical deps for clean global installs — `conflict-risk:low`
- #194 — 🩹 [sha=ec6c5b9] fix(installer): show GSD-Pi wordmark only once during guided install — `conflict-risk:none`
- #195 — 🩹 [sha=51fce9b] fix(ci): use GitHub-hosted runners for build-native npm publish — `conflict-risk:none`
- #196 — 🩹 [sha=48917e6] fix: resolve Windows npm global bin path — `conflict-risk:none`
- #197 — 🩹 [sha=12bf6e7] fix(packaging): merge global node_modules and refresh --help branding — `conflict-risk:none`
- #198 — 🩹 [sha=afeb482] fix(bug-2): doctor-checks misses DB-present/filesystem-missing orphan state doctor runtime checks now report DB-row-present/filesystem-missing milestone drift as `orphan_milestone_db`. — `conflict-risk:none`
- #199 — 🩹 [sha=c2f6d35] fix(bug-1): discardMilestone skips DB cleanup when milestone dir is missing `discardMilestone` now cleans DB state even when milestone directory is already missing. — `conflict-risk:none`
- #200 — 🩹 [sha=d49e42f] fix(packaging): resolve undici after npm global install — `conflict-risk:none`
- #201 — 🩹 [sha=9c62334] fix: resolve npm global root in validate pack — `conflict-risk:none`
- #202 — 🩹 [sha=9ca6cee] fix(gsd): avoid swallowing network ECONNRESET — `conflict-risk:none`
- #203 — 🩹 [sha=756a298] fix(branding): render block P and i in GSD-Pi wordmark — `conflict-risk:none`
- #204 — 🩹 [sha=b0e79d9] fix(installer): prevent handoff timeout and spinner corruption — `conflict-risk:none`
- #205 — 🩹 [sha=cfc3393] fix(branding): narrow GSD-Pi wordmark for 80-column welcome layout — `conflict-risk:none`
- #207 — 🩹 [sha=0030bab] fix(packaging): resolve @gsd/agent-core imports in pi-coding-agent re-exports — `conflict-risk:low`
- #208 — 🩹 [sha=12808c4] fix(ci): use GitHub-hosted runners for npm publish provenance — `conflict-risk:none`
- #209 — 🩹 [sha=adf25e0] fix(ci): pin dev publishes to stable engine packages on npm — `conflict-risk:none`
- #210 — 🩹 [sha=47de708] fix(test): satisfy strict null check in agent-shim test — `conflict-risk:low`
- #211 — 🩹 [sha=2f23e8c] fix: block direct workflow dispatch during validation — `conflict-risk:none`
- #212 — 🩹 [sha=5d42199] fix(test): satisfy strict null check in agent-shim test — `conflict-risk:low`
- #213 — 🩹 [sha=a7c88fa] fix(test): unblock coverage-report package test failures — `conflict-risk:low`
- #214 — 🩹 [sha=933d0f8] fix(test): unblock coverage-report package test failures — `conflict-risk:low`
- #215 — 🩹 [sha=c838be8] fix(gsd): keep diagnostics available during validation blocks — `conflict-risk:none`
- #216 — 🩹 [sha=45b187f] fix(test): unblock test-coverage job failures — `conflict-risk:low`
- #217 — 🩹 [sha=cb0cb37] fix(auto): complete-slice reopen handoff when DB is unavailable — `conflict-risk:none`
- #218 — 🩹 [sha=d67ac2c] fix(ci): keep workspace links during dev version stamping — `conflict-risk:none`
- #219 — 🩹 [sha=82313bf] fix(ci): stop integration tests from hanging on orphaned gsd subprocesses — `conflict-risk:none`
- #220 — 🩹 [sha=400b3b2] fix(worktree): restore JSONL marker cleanup in stash collision path — `conflict-risk:none`
- #221 — 🩹 [sha=491219a] fix(gsd): list /gsd memory in full help menu — `conflict-risk:none`
- #222 — 🩹 [sha=c4d3996] fix(worktree): dedupe stash-restore locals after main merge — `conflict-risk:none`
- #223 — 🩹 [sha=7a8b793] fix(gsd): remove unreachable empty-string blocklist entry — `conflict-risk:none`
- #224 — 🩹 [sha=d5981c4] fix(compaction): reframe prompts as state-snapshot handoff briefings — `conflict-risk:low`
- #225 — 🩹 [sha=2f37735] fix: block workflow starters during unmerged milestones — `conflict-risk:none`
- #226 — 🩹 [sha=33f6971] fix(e2e): clear deferred depth gate after ask_user_questions confirms — `conflict-risk:none`
- #227 — 🩹 [sha=d869a93] fix: block unmerged milestone dispatch aliases — `conflict-risk:none`
- #228 — 🩹 [sha=2a75f7f] fix: clear auto model override after stop — `conflict-risk:none`
- #229 — 🩹 [sha=d004d80] fix: avoid orphaning stale UAT renders — `conflict-risk:none`
- #230 — 🩹 [sha=b34ec05] fix(gsd): block new-project with unmerged milestones — `conflict-risk:none`
- #231 — 🩹 [sha=5b0b2b9] fix(gsd): include memory in command description — `conflict-risk:none`
- #232 — 🩹 [sha=ef22461] fix(bug-2): Stale `full_uat_md` in DB is not cleared when UAT files are deleted stale-render reconciliation now clears `full_uat_md` in DB when `UAT.md` is deleted from disk. — `conflict-risk:none`
- #233 — 🩹 [sha=496f798] fix(bug-1): Browser evidence gate scans UAT docs and misflags CLI milestones browser requirement detection no longer scans `slice.full_uat_md`, preventing UAT planning text from triggering the gate. — `conflict-risk:none`
- #234 — 🩹 [sha=0f91c12] fix(issue): /gsd auto can ignore selected/persisted non-Claude model and reroute to Claude-family model — `conflict-risk:none`
- #235 — 🩹 [sha=f3f92f5] fix(issue): unmerged-milestone-guard blocks all /gsd commands including read-only diagnostics (forensics, capture, knowledge, prefs) — `conflict-risk:none`
- #236 — 🩹 [sha=eebf5ed] fix(issue): /gsd memory missing from autocomplete catalog — `conflict-risk:none`
- #238 — 🩹 [sha=e829025] fix: keep distinct discuss follow-up questions — `conflict-risk:none`
- #239 — 🩹 [sha=386aac8] fix(issue): Plan-slice prompt lacks scope deliverable coverage audit — documents listed in CONTEXT.md Scope table get dropped — `conflict-risk:none`
- #240 — 🩹 [sha=1fa61b0] fix(ci): allow-source-grep for generated-models catalog formatting test — `conflict-risk:low`
- #241 — 🩹 [sha=263527b] fix: preserve chat turn bridges across tool rows — `conflict-risk:none`
- #242 — 🩹 [sha=824f73b] fix(ci): run pi-ai vitest against packages/pi-ai/dist on Windows — `conflict-risk:none`
- #243 — 🩹 [sha=08de82b] fix(ci): invoke vitest via node on Windows package tests — `conflict-risk:none`
- #244 — 🩹 [sha=05441cf] fix(ci): recognize pi-ai vitest paths on Windows runners — `conflict-risk:none`
- #245 — 🩹 [sha=a93a588] fix(ci): split pi-ai node:test and vitest; fix smart-entry notification assert — `conflict-risk:low`
- #246 — 🩹 [sha=47718b1] fix(ci): align tests with git preflight, discuss routing, and pi-ai vitest — `conflict-risk:none`
- #247 — 🩹 [sha=503aec8] fix(tests): satisfy extension typecheck for CI build — `conflict-risk:none`
- #248 — 🩹 [sha=1c3366d] fix(discuss): route new milestones to guided interview and suppress duplicate asks — `conflict-risk:low`
- #249 — 🩹 [sha=6c02e43] fix(issue): complete-slice retry loop silently drops a reopened task via empty replan — `conflict-risk:none`
- #251 — 🩹 [sha=4770ffb] fix(bug-2): Uncaught exception guards exit without releasing auto-mode locks unrecoverable guards now terminate via SIGTERM cleanup path and cleanup signal coverage now includes SIGBREAK. — `conflict-risk:none`
- #252 — 🩹 [sha=c0649d3] fix(bug-1): Windows pipe-closure errors not treated as recoverable broadened recoverable pipe-closure detection to include Windows EOF/connection-reset variants so they are swallowed like EPIPE. — `conflict-risk:none`
- #253 — 🩹 [sha=710e436] fix(gsd): keep grep/find/ls available during guided discuss dispatches — `conflict-risk:low`
- #254 — 🩹 [sha=36e6fcb] fix: handle empty read args only for read tool — `conflict-risk:low`
- #255 — 🩹 [sha=4e87c13] fix(gsd): map requirements backlog when starting new milestone — `conflict-risk:none`
- #256 — 🩹 [sha=5b3f9f2] fix: address chat turn and shim review findings — `conflict-risk:low`
- #257 — 🩹 [sha=10489bc] fix: address PR bug detection findings — `conflict-risk:low`
- #258 — 🩹 [sha=79b1330] fix(pi-ai): use assert in normalize-tool-arguments test for tsc build — `conflict-risk:low`
- #262 — 🩹 [sha=3218fd6] fix: restore project artifact fallback — `conflict-risk:none`
- #263 — 🩹 [sha=a1335b3] fix(gsd): resolve milestone artifacts from worktree projections — `conflict-risk:none`
- #264 — 🩹 [sha=8e01c98] fix(bug-2): Missing uninstall instructions in README added README uninstall steps for global package removal and local state cleanup. — `conflict-risk:none`
- #265 — 🩹 [sha=584f887] fix(bug-1): Fresh install is non-functional fixed install-mode detection so only real postinstall contexts use postinstall flow. — `conflict-risk:none`
- #266 — 🩹 [sha=2198b98] fix(bug-2): Projection doesn't filter superseeded rows KNOWLEDGE projection now filters out superseded memory rows. — `conflict-risk:none`
- #267 — 🩹 [sha=9ee21a9] fix(bug-1): `capture_thought` never supersedes old rows capture path now supersedes prior active same-category memory rows with the same `structuredFields.sourceKnowledgeId`. — `conflict-risk:none`
- #268 — 🩹 [sha=99cf0f6] fix: install deps for fast verification — `conflict-risk:none`
- #269 — 🩹 [sha=ab29d50] fix(agent-loop): restore consecutive tool validation failure cap — `conflict-risk:low`
- #270 — 🩹 [sha=6ed0e54] fix(ci): restore e2e fake LLM and truncateForSummary export — `conflict-risk:low`
- #271 — 🩹 [sha=f51027e] fix(issue): verification-gate: pipes (|) in task-plan Verify commands are rejected as unsafe, causing false 'no-host-checks' pause — `conflict-risk:none`
- #272 — 🩹 [sha=b202c4e] fix(build): resolve pi bootstrap and agent-modes theme imports — `conflict-risk:low`
- #273 — 🩹 [sha=3b39057] fix(models): drop stale kimi-k2.5 metadata override in generator — `conflict-risk:low`
- #274 — 🩹 [sha=47d740f] fix: share tool argument normalization — `conflict-risk:low`
- #275 — 🩹 [sha=9cfd12d] fix: retry MCP smoke install failures — `conflict-risk:none`
- #276 — 🩹 [sha=b136f0f] fix: preserve connected tool turn rendering — `conflict-risk:low`
- #277 — 🩹 [sha=d811e1c] fix(pi): unblock workspace install and pi boundary verification — `conflict-risk:medium`
- #278 — 🩹 [sha=7448d89] fix: stabilize tool invocation matching — `conflict-risk:low`
- #279 — 🩹 [sha=03465a4] fix(gsd): merge completed milestones when ROADMAP projection is missing — `conflict-risk:none`
- #280 — 🩹 [sha=aadeaa4] fix(pi-coding-agent): keep identical parallel tool calls separate — `conflict-risk:low`
- #281 — 🩹 [sha=d0a8a64] fix(pi-ai): restore Google provider switch reports — `conflict-risk:low`
- #282 — 🩹 [sha=91a9ca3] fix(pi-ai): derive Mistral stream message type from request shape — `conflict-risk:low`
- #283 — 🩹 [sha=34e06be] fix(pi-ai): use singular Mistral stream message type export — `conflict-risk:low`
- #284 — 🩹 [sha=4bbc7b2] fix: external worktree state routing and tool argument normalization — `conflict-risk:low`
- #287 — 🩹 [sha=15bf5ca] fix(gsd): report effective verdict after gate downgrade — `conflict-risk:none`
- #288 — 🩹 [sha=3f4de05] fix(ci): avoid actor-scoped checkout token — `conflict-risk:none`
- #289 — 🩹 [sha=89c71c2] fix(pi-ai): restore Gemini 3 tool call signatures — `conflict-risk:low`
- #290 — 🩹 [sha=faf7dbb] fix: keep MCP and complex-schema tools available on Google providers — `conflict-risk:low`
- #291 — 🩹 [sha=ad688c3] fix(pi-ai): correct Mistral stream message type import — `conflict-risk:low`
- #292 — 🩹 [sha=20e324d] fix: harden pi overlay for Cloud Code Assist Claude tool schemas — `conflict-risk:low`
- #293 — 🩹 [sha=b70e549] fix: wait for workspace packages after publish — `conflict-risk:none`
- #294 — 🩹 [sha=af968b9] fix(pi): export BuildSystemPromptOptions from system-prompt seam — `conflict-risk:low`
- #295 — 🩹 [sha=718e1fe] fix(pi): import bridge session types from @gsd/agent-core — `conflict-risk:none`
- #298 — 🩹 [sha=72748c0] fix(issue): pre_dispatch_hooks and post_unit_hooks silently ignored in worktree isolation mode — resolvePreDispatchHooks/resolvePostUnitHooks drop basePath — `conflict-risk:none`
- #299 — 🩹 [sha=e09d78f] fix(issue): checkoutBranchWithStashGuard fails when stash contains untracked files tracked on target branch — `conflict-risk:none`
- #300 — 🩹 [sha=8bb2905] fix(gsd): restore complete-slice isolation cues — `conflict-risk:none`
- #301 — 🩹 [sha=2c3ac68] fix(issue): checkoutBranchWithStashGuard fails when stash contains untracked files tracked on target branch — `conflict-risk:none`
- #302 — 🩹 [sha=e5af6d9] fix(issue): worktree isolation: agent writes code to project root instead of worktree (missing path-rewriting instruction in prompts) — `conflict-risk:none`
- #303 — 🩹 [sha=5754851] fix(issue): [Bug]: Unusuable, unresponsive, fresh install — `conflict-risk:none`
- #304 — 🩹 [sha=9814712] fix: repair descriptor roadmap renders — `conflict-risk:none`
- #305 — 🩹 [sha=5a0af0a] fix: detect stale worktree roadmaps in projection — `conflict-risk:none`
- #306 — 🩹 [sha=f5b1c7c] fix: resolve projected roadmap paths — `conflict-risk:none`
- #307 — 🩹 [sha=91c18da] fix(issue): Artifact renderers use inconsistent gsdRoot vs gsdProjectionRoot when running inside a worktree causing stale-mirror verification failures — `conflict-risk:none`
- #308 — 🩹 [sha=b77bc3a] fix: inline bridge session event shim — `conflict-risk:medium`
- #309 — 🩹 [sha=e21fd8e] fix: avoid agent-core build-order dependency — `conflict-risk:medium`
- #310 — 🩹 [sha=3356ef7] fix: narrow codeql-pr surfaced alerts — `conflict-risk:medium`
- #311 — 🩹 [sha=1903ad0] fix: restore bridge service search handling — `conflict-risk:none`
- #312 — 🩹 [sha=7b80cef] fix: drop noisy codeql path hardening — `conflict-risk:low`
- #313 — 🩹 [sha=5153a32] fix: tighten project path allowlist — `conflict-risk:low`
- #314 — 🩹 [sha=7c2930e] fix: clear remaining codeql blockers — `conflict-risk:medium`
- #315 — 🩹 [sha=7868f95] fix: harden codeql hotspots — `conflict-risk:medium`
- #316 — 🩹 [sha=9225bc2] fix: unstick unit and portability CI — `conflict-risk:low`
- #317 — 🩹 [sha=5a8d59c] fix: stop repeated all-error tool loops — `conflict-risk:low`
- #318 — 🩹 [sha=e2842bc] fix: restore test runtime compatibility across prompt and e2e paths — `conflict-risk:medium`
- #319 — 🩹 [sha=02dce21] fix: bundle internal workspace packages for publish — `conflict-risk:none`
- #320 — 🩹 [sha=293bafa] fix: repair extension CI compatibility — `conflict-risk:low`
- #321 — 🩹 [sha=3c61b31] fix: narrow pi-tui secret scan ignore — `conflict-risk:none`
- #322 — 🩹 [sha=9849f0a] fix: filter discovered models by provider readiness — `conflict-risk:none`
- #323 — 🩹 [sha=e69cf7d] fix(agent-core): preserve compaction truncation tails — `conflict-risk:none`
- #324 — 🩹 [sha=56c39cb] fix: restore legacy session switch hooks — `conflict-risk:none`
- #325 — 🩹 [sha=a759255] fix(pi): restore GSD root-app shims for build:core (Phase 2b) — `conflict-risk:low`
- #328 — 🩹 [sha=2c2b925] fix(issue): [Bug] execute-task re-dispatched after task is complete when verification gate fails with pre-existing errors — `conflict-risk:none`
- #329 — 🩹 [sha=7b1ff8c] fix(issue): [Bug]: verification-gate treats 'bash: <cmd>' prefix as command name — exit 127 triggers 5× re-dispatch loop — `conflict-risk:none`
- #332 — 🩹 [sha=639c926] fix(gsd): allow safe verify metacharacters — `conflict-risk:none`
- #333 — 🩹 [sha=ad376fe] fix(gsd): preserve codebase cache timestamp — `conflict-risk:none`
- #334 — 🩹 [sha=3b08787] fix: answer headless approval gates — `conflict-risk:none`
- #335 — 🩹 [sha=29e71bd] fix: detect opengsd pnpm workspace scope — `conflict-risk:none`
- #336 — 🩹 [sha=298a513] fix(issue): ModelPolicyDispatchBlockedError: cross_provider:false blocks explicit unit model configs when previous unit ran on different provider — `conflict-risk:none`
- #337 — 🩹 [sha=1a12db8] fix(compaction): preserve history on empty summaries — `conflict-risk:low`
- #338 — 🩹 [sha=be4a1e6] fix: clean up remaining opengsd package references — `conflict-risk:none`
- #339 — 🩹 [sha=8e663d2] fix(bug-2): Generated files ignore .gitignore rules smart staging now honors `.gitignore` for `.gsd` even when files were already tracked. — `conflict-risk:none`
- #340 — 🩹 [sha=b56c483] fix(bug-1): GitOps disabled still creates commits disabled GitOps now skips commit closeout paths instead of converting to commit mode. — `conflict-risk:none`
- #341 — 🩹 [sha=814999d] fix: dereference symlinks in findWorkflowCliFromAncestorPath — `conflict-risk:none`
- #342 — 🩹 [sha=2ff3dec] fix(pi-ai): normalize Claude tool schemas for Cloud Code Assist — `conflict-risk:low`
- #346 — 🩹 [sha=78fb60d] fix(ollama): detect thinking capability from /api/show.capabilities — `conflict-risk:none`
- #347 — 🩹 [sha=934515a] fix(bug-2): Command error reporting omits stack traces extension command errors now include stack traces when available. — `conflict-risk:medium`
- #348 — 🩹 [sha=9477a62] fix(bug-1): fileFingerprint crashes on dirty files over 2 GiB oversized dirty tracked files now avoid Node's readFileSync Buffer limit. — `conflict-risk:none`
- #349 — 🩹 [sha=7145ebb] fix(bug-3): Pre-dispatch break leaves ghost iterations open pre-dispatch break now finishes the open journal iteration. — `conflict-risk:none`
- #350 — 🩹 [sha=77e8cee] fix(bug-2): Unhandled-phase warnings pause instead of retrying fresh state unhandled-phase warnings now retry dispatch once with freshly derived state before pausing. — `conflict-risk:none`
- #351 — 🩹 [sha=f120a8b] fix(bug-1): pauseAuto aborts in-flight units after dispatch pre-dispatch health-gate pause is guarded against active units and covered by regression. — `conflict-risk:none`
- #352 — 🩹 [sha=243147a] fix(test): stabilize CI coverage and implementation artifact detection (#84) — `conflict-risk:none`
- #353 — 🩹 [sha=5ac9944] fix(release): keep package-lock in sync with engine optionalDependencies — `conflict-risk:none`
- #354 — 🩹 [sha=0bb223e] fix(issue): [Bug]: verification-gate splits task-plan verify on && — cd loses cwd, causing false failure + 5× re-dispatch loop — `conflict-risk:none`
- #355 — 🩹 [sha=68e1b46] fix(bug-3): Upgrade docs omit uninstalling old global gsd-pi package updated upgrade troubleshooting to uninstall the old global `gsd-pi` package before installing `@opengsd/gsd-pi`. — `conflict-risk:none`
- #356 — 🩹 [sha=8c38b85] fix(bug-2): TUI crashes instead of handling missing native visibleWidth added a TUI-side JS visible-width fallback so render paths do not propagate native proxy throws. — `conflict-risk:low`
- #357 — 🩹 [sha=cbb3b69] fix(bug-1): Linux x64 native addon is unavailable after npm install pinned native engine optional dependencies to the package version and made publish/prepublish require matching engine packages. — `conflict-risk:none`
- #358 — 🩹 [sha=4fad086] fix(ci): allow build-native to publish engine packages at a target semver — `conflict-risk:none`
- #359 — 🩹 [sha=db76d8b] fix(bug-2): Worker-lock self-collision / lock leak across orchestrator iterations milestone leases now tolerate same-process re-entry and pause cleanup releases the held lease. — `conflict-risk:none`
- #360 — 🩹 [sha=46896cb] fix(bug-1): Milestone lifecycle desync: `status` stays `planned` after all slices complete final slice completion now promotes planned milestones to active before validation. — `conflict-risk:none`
- #361 — 🩹 [sha=de5ac79] fix(issue): [Bug]: error on windows update from gsd-2 — `conflict-risk:none`
- #362 — 🩹 [sha=0b1917c] fix(issue): gsd update no-ops on stale higher-versioned manifest → version-mismatch gate dead-locks (incomplete fix for #14) — `conflict-risk:none`
- #363 — 🩹 [sha=c52d1f9] fix(bug-2): Wrong `unitType` string in estimate-based timeout scaling (`auto-timers.js`) changed estimate DB lookup to match the real `execute-task` unit type. — `conflict-risk:none`
- #364 — 🩹 [sha=ce5210c] fix(bug-1): Cross-session recovery counter unconditionally reset at dispatch (`auto/phases.js`) preserved on-disk recovery attempts across fresh cross-session dispatches unless recovery ran in the current session. — `conflict-risk:none`
- #365 — 🩹 [sha=c60b69c] fix(ci): harden native engine bootstrap and npm publish verification — `conflict-risk:none`
- #366 — 🩹 [sha=749e051] fix(ci): native fallbacks for e2e and omit web from CI artifacts — `conflict-risk:none`
- #367 — 🩹 [sha=32b3042] fix(ci): always build web host before validate-pack — `conflict-risk:none`
- #368 — 🩹 [sha=2fbac97] fix: replace leaked absolute developer paths in docs and test fixtures — `conflict-risk:low`
- #369 — 🩹 [sha=28b86bc] fix(auto): wire ScheduleWakeup continuation — `conflict-risk:none`

## Features (18)

- #155 — ✨ [sha=16ce473] feat(gsd): add opt-in local notification bell — `conflict-risk:none`
- #176 — ✨ [sha=2349bf2] feat: add Claude Opus 4.8 model support — `conflict-risk:low`
- #191 — ✨ [sha=84fd49f] feat(gsd): add /gsd usage and /gsd context observability commands — `conflict-risk:none`
- #192 — ✨ [sha=7fe31b9] feat(gsd): wire unit-context-manifest skills policy into scoping — `conflict-risk:low`
- #193 — ✨ [sha=3bf8bcb] feat(gsd): scope skill catalog and trim duplicate prompt surfaces — `conflict-risk:none`
- #206 — ✨ [sha=2676baf] feat(installer): redesign npx-primary guided install flow — `conflict-risk:none`
- #259 — ✨ [sha=61de95d] feat(gsd): enhance requirements backlog handling and completion summaries — `conflict-risk:none`
- #260 — ✨ [sha=315b1a0] feat(gsd): implement quick branch inference and cleanup logic — `conflict-risk:low`
- #261 — ✨ [sha=1211a3e] feat(github-sync): enhance milestone closing logic and error handling — `conflict-risk:none`
- #285 — ✨ [sha=90652ad] feat: enhance tool execution handling and improve component registration — `conflict-risk:low`
- #286 — ✨ [sha=89335bd] feat: enhance transcript rendering with connected user support — `conflict-risk:medium`
- #296 — ✨ [sha=eee1c61] feat(pi): gap closure, test confidence stack, verify:pi-boundary in CI — `conflict-risk:low`
- #297 — ✨ [sha=8ac970e] feat(pi): ADR-010 seam remediation phases A–F — `conflict-risk:low`
- (unfiled) — ✨ [sha=af9d27b] feat(pi): ADR-010 clean seam and vendor earendil-works/pi v0.75.5 (Phase 0–2) — `conflict-risk:high`
- #326 — ✨ [sha=941b208] feat(models): add dedicated uat model slot in preferences — `conflict-risk:none`
- #327 — ✨ [sha=a6d253f] feat: add gsd-mcp runtime binary — `conflict-risk:none`
- #330 — ✨ [sha=4db61b9] feat: persist cloud gateway auth state — `conflict-risk:none`
- #331 — ✨ [sha=272f601] feat: add cloud MCP gateway local runtime — `conflict-risk:none`

## Unclassified — needs manual triage (103)

- `dddedab` — release: v1.1.1 (no rubric match; manual review)
- `57f601d` — release: v1.1.0 (no rubric match; manual review)
- `a00143b` — Fix Claude Code ToolSearch browser remap (no rubric match; manual review)
- `16f7bc9` — Preserve milestone closeout transcript (no rubric match; manual review)
- `343011e` — fix auto worktree untracked content import (no rubric match; manual review)
- `8aea923` — Repair empty worktree doctor fixes (no rubric match; manual review)
- `945089b` — Refresh DB before markdown mismatch check (no rubric match; manual review)
- `f2f761d` — fix doctor empty worktree repair (no rubric match; manual review)
- `1ead481` — fix docker e2e timeout budget (no rubric match; manual review)
- `d93f8bc` — fix secret scan fixture (no rubric match; manual review)
- `c1415e9` — fix mcp tool namespace leaks (no rubric match; manual review)
- `7db3564` — perf(tokens): dedupe always-on prompt rules, tool guidelines, and subagent prose (no rubric match; manual review)
- `4119ee5` — perf(tokens): trim the 16 longest always-on skill descriptions (no rubric match; manual review)
- `7b1e1d7` — perf(tokens): gate the browser tool surface behind opt-in in interactive mode (no rubric match; manual review)
- `7c03af2` — perf(tokens): scope plain interactive chat to the minimal GSD tool surface (no rubric match; manual review)
- `5cda2fd` — perf(tokens): drop 14 workflow alias tools from advertised surface (no rubric match; manual review)
- `c92b919` — perf(tokens): dedupe always-on prompt rules, tool guidelines, and subagent prose (no rubric match; manual review)
- `9312caf` — perf(tokens): trim the 16 longest always-on skill descriptions (no rubric match; manual review)
- `cafeb60` — perf(tokens): gate the browser tool surface behind opt-in in interactive mode (no rubric match; manual review)
- `9a91e4f` — perf(tokens): scope plain interactive chat to the minimal GSD tool surface (no rubric match; manual review)
- `52759d2` — perf(tokens): drop 14 workflow alias tools from advertised surface (no rubric match; manual review)
- `67bdd34` — Fix mcp-server package test compile scope (no rubric match; manual review)
- `89b8417` — Expose checkpoint DB over workflow MCP (no rubric match; manual review)
- `ab9810f` — restore missing bundled skills during resource sync (no rubric match; manual review)
- `531d233` — fix gsd_exec argument normalization (no rubric match; manual review)
- `6cef0bc` — fix safety evidence tool detection (no rubric match; manual review)
- `e1e4f14` — fix strict post-exec warning pause details (no rubric match; manual review)
- `ed6255b` — fix skill prompt refresh after reload (no rubric match; manual review)
- `58e7f52` — vary milestone vision openers (no rubric match; manual review)
- `8fac04a` — Fix usage dialog resize cache (no rubric match; manual review)
- `53e987f` — fix context report opener test (no rubric match; manual review)
- `755b4ad` — fix doctor checks for external cli providers (no rubric match; manual review)
- `d83239d` — fix login auth provider routing (no rubric match; manual review)
- `cf105be` — add claude code subscription guide (no rubric match; manual review)
- `0848b5c` — fix stranded recovery bootstrap test (no rubric match; manual review)
- `1db02f4` — recover stranded milestone work (no rubric match; manual review)
- `073a9eb` — fix task completion verification fallback (no rubric match; manual review)
- `697c5a2` — fix native search partial replay stripping (no rubric match; manual review)
- `5ae0fb9` — Fix Anthropic server tool input deltas (no rubric match; manual review)
- `1afe533` — Preserve Anthropic native search replay blocks (no rubric match; manual review)
- `8988fbe` — fix OpenAI web search tool leak (no rubric match; manual review)
- `e5568c3` — fix shared resource sync (no rubric match; manual review)
- `304fb50` — Fix enabled count to respect enabled setting (no rubric match; manual review)
- `821a16c` — fix pnpm installer detection test in CI (no rubric match; manual review)
- `771d4a7` — fix pnpm update guidance (no rubric match; manual review)
- `75adba6` — auto prepare claude code workflow mcp (no rubric match; manual review)
- `009ac49` — fix external tool result handling (no rubric match; manual review)
- `aea56de` — support pnpm installer updates (no rubric match; manual review)
- `3b82e8e` — fix gsd next custom workflow step mode (no rubric match; manual review)
- `0981259` — truncate expanded read output (no rubric match; manual review)
- `c5aec6b` — remove user chat background (no rubric match; manual review)
- `65d8d0b` — hide ambiguous skill collision warnings (no rubric match; manual review)
- `427d323` — fix pnpm install dependency coverage (no rubric match; manual review)
- `d6d825b` — fix extension dependency resolution for scoped installs (no rubric match; manual review)
- `008f103` — test hook preference precedence on macos (no rubric match; manual review)
- `a2ec7a2` — fix pnpm coverage install isolation (no rubric match; manual review)
- `792ee96` — fix pnpm publish install flow (no rubric match; manual review)
- `0a676b0` — fix dev publish workspace protocol leak (no rubric match; manual review)
- `43ba442` — fix build script contract test (no rubric match; manual review)
- `54294de` — fix pnpm install ci and publish flow (no rubric match; manual review)
- `c6bab51` — Remove stale bundled dependency pack check (no rubric match; manual review)
- `c93fba0` — fix installer dependency repair ordering (no rubric match; manual review)
- `e8cd987` — Fix GSD context usage formatting helpers (no rubric match; manual review)
- `925f043` — fix installer dependency fallbacks (no rubric match; manual review)
- `4adf08c` — Fix onboarding intro styling (no rubric match; manual review)
- `fd6d52b` — Remove duplicate bundleDependencies entry (no rubric match; manual review)
- `000e814` — fix installer prerequisite detection (no rubric match; manual review)
- `e3c25e1` — fix chat trim reconciliation and model cost precision (no rubric match; manual review)
- `2fc11a3` — Remove unused read and user rail branches (no rubric match; manual review)
- `ab1a363` — fix read expansion truncation (no rubric match; manual review)
- `8851827` — Remove duplicate edit path normalization (no rubric match; manual review)
- `8ebbf9d` — Fix agent argument cleanup and chat turn helper (no rubric match; manual review)
- `c33d5a9` — Potential fix for pull request finding 'CodeQL / Incorrect suffix check' (no rubric match; manual review)
- `79ff549` — Update command documentation to clarify usage of `/gsd discuss` and enhance extension notification handling in interactive mode. Adjust cache read values in model configurations and add new model "Qwen3.7 Max". Remove deprecated model entry for "Arcee AI: Trinity Large Thinking (free)". (no rubric match; manual review)
- `03a6813` — Increase fast gates timeout (no rubric match; manual review)
- `24441f0` — Fix density prototype npm script (no rubric match; manual review)
- `9803ba4` — Migrate workflows to Blacksmith (no rubric match; manual review)
- `b1df86f` — fix pi overlay bug regressions (no rubric match; manual review)
- `e68cff5` — Fix agent-modes list models setup (no rubric match; manual review)
- `79f2dd9` — Fix compaction accounting and summary fallback (no rubric match; manual review)
- `1e04cd1` — fix web host build imports (no rubric match; manual review)
- `9b01fb1` — fix optional agent-core asset copy (no rubric match; manual review)
- `7dc1158` — fix ci fast gates (no rubric match; manual review)
- `c9a1012` — Apply compaction threshold override (no rubric match; manual review)
- `691789f` — Gate Codex review behind maintainer label (no rubric match; manual review)
- `4abf206` — Rename local @gsd-build packages to @opengsd (no rubric match; manual review)
- `7e40aa3` — Recover plan milestone schema confusion (no rubric match; manual review)
- `05c8d6c` — Make Discord changelog release-only (no rubric match; manual review)
- `cd23613` — Fix reactive execute terminal blocker recovery (no rubric match; manual review)
- `e952c8d` — Refactor test loop and update assertion message (no rubric match; manual review)
- `cccfad3` — Refactor model capabilities handling in tests (no rubric match; manual review)
- `0f57605` — Update discord-changelog.yml (no rubric match; manual review)
- `89df356` — Isolate bundled skills under GSD agent dir (no rubric match; manual review)
- `a5f2bc7` — release: v1.0.2 (no rubric match; manual review)
- `09a9b98` — cover native JS function fallbacks (no rubric match; manual review)
- `769c905` — harden native fallback and CI artifacts (no rubric match; manual review)
- `eb484e1` — allow coverage job to finish (no rubric match; manual review)
- `462fb0c` — stabilize lint diff base fetch (no rubric match; manual review)
- `ec7183f` — stabilize auto loop coverage tests (no rubric match; manual review)
- `5000f69` — preserve ANSI in native text fallback (no rubric match; manual review)
- `c49f412` — fix scoped npm pack Docker context (no rubric match; manual review)
- `5eb2b6b` — fix npm scope migration and native fallback (no rubric match; manual review)
- `dab71db` — Update README.md (no rubric match; manual review)

## Not applicable to OTTO (23)

These commits were reviewed against the applicability rules in `.planning/upstream-sync-config.json` and intentionally not filed as issues.

| Commit | Subject | Rule | Reason |
|---|---|---|---|
| `e8d8ae3` | fix: preserve pnpm CI verification coverage | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `46d91f5` | fix: remove redundant publish workflow cache setting | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `02188ba` | ci: audit pnpm lockfile with pnpm | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `c40bf9b` | fix installer logo fallback for older Node 22 | `upstream-rebrand` | Changes to pi-dev's branding (logo, package names, etc.) that OTTO has already overridden with its own brand pipeline (scripts/sync-brand-colors.mjs). |
| `268cd1d` | fix(ci): treat already-tagged npm versions as successful publish re-runs | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `e99af2c` | fix(installer): allow postinstall before dist/logo.js is built | `upstream-rebrand` | Changes to pi-dev's branding (logo, package names, etc.) that OTTO has already overridden with its own brand pipeline (scripts/sync-brand-colors.mjs). |
| `48daa98` | fix(installer): preserve clack spinner during npm install | `upstream-rebrand` | Changes to pi-dev's branding (logo, package names, etc.) that OTTO has already overridden with its own brand pipeline (scripts/sync-brand-colors.mjs). |
| `c91bb66` | ci: install deps before fast-gates script tests | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `0332976` | fix(ci): make coverage report non-blocking | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `08445a1` | fix(ci): install web deps for coverage report | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `c6c7d7d` | ci: extend integration test budget | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `ca78473` | ci: extend integration test timeout | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `7abee80` | ci: add codex code review workflow | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `8935c41` | Remove stale Discord changelog workflow | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `10df570` | Remove stale Discord changelog workflow | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `254f3d7` | Move Discord changelog to release-only workflow | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `bac6a70` | Fix Discord changelog workflow script | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `6441898` | Refactor Discord changelog workflow to use GitHub Script | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `e9ddd90` | Add release_tag input to Discord changelog workflow | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `4c55f5a` | Modify changelog workflow to use 'cat' command | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `6f20ca9` | Add Discord changelog workflow | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `a538c2a` | chore(ci): bump cache and artifact actions to v5 for Node 24 | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `ae3690d` | ci: extend build job timeout | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |

## Skipped (62)

Mechanical filter — `chore:` / `docs:` / `test:` / `ci:` / `style:` / `refactor:` / `build:` prefixes plus merge commits and PatchDeck syncs. No applicability or severity judgment made; not filed.

<details>
<summary>Expand</summary>

- `950107e` docs: keep release highlights user-facing — `prefix:docs:`
- `248d591` docs: add v1.1.1 release highlights — `prefix:docs:`
- `f8a5ac4` docs: refresh slash command reference — `prefix:docs:`
- `68fc4f7` chore: refresh CI — `prefix:chore:`
- `7d1be2c` chore: refresh CI — `prefix:chore:`
- `3005ca6` test(gsd): cover discuss-slice scoped tools — `prefix:test:`
- `d971e0f` test(pi-ai): include src tests in vitest config — `prefix:test:`
- `a1d5706` chore(pi-ai): refresh generated model catalog — `prefix:chore:`
- `7e299ee` test: derive user message plain output from raw render — `prefix:test:`
- `324bcb9` test(bootstrap): cover EPIPE storm exit guard and stderr re-entry — `prefix:test:`
- `d59eaed` build: migrate monorepo from npm to pnpm — `prefix:build:`
- `2c10a39` test(pi-ai): cover Bedrock tool schema payload mapping — `prefix:test:`
- `d27dfb5` refactor(gsd): unify skill loading and wire skillFilter — `prefix:refactor:`
- `9b4613a` test(gsd): avoid assigning read-only canonicalProjectRoot in handoff tests — `prefix:test:`
- `1a58f95` test(gsd): cover complete-slice reopen/replan handoff in postUnitPreVerification — `prefix:test:`
- `35c2fe9` test(gsd): add regression coverage for /gsd memory catalog entry — `prefix:test:`
- `a2bf4e7` test(gsd): audit tool availability across workflow scoping paths — `prefix:test:`
- `5f948ed` chore: drop accidental artifacts and unrelated model registry churn — `prefix:chore:`
- `f9a109a` Apply PatchDeck fixes for PR #166 — `merge-commit`
- `44b3a3d` Apply PatchDeck fixes for PR #155 — `merge-commit`
- `64702fe` Apply PatchDeck fixes for PR #155 — `merge-commit`
- `06f2096` Apply PatchDeck fixes for PR #148 — `merge-commit`
- `aa8c8ee` Apply PatchDeck fixes for PR #146 — `merge-commit`
- `a903a1b` Apply PatchDeck fixes for PR #146 — `merge-commit`
- `cd74106` Apply PatchDeck fixes for PR #137 — `merge-commit`
- `b508838` ci: publish mcp server in native release workflow — `prefix:ci:`
- `c739bfb` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `156ed78` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `0c31996` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `ac00570` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `69a01b6` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `8bc5684` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `00ad924` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `5a43b08` docs: link web configurator in README — `prefix:docs:`
- `0e5a3d1` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `d5207e0` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `cfd261c` test: isolate mcp cli and secret-safe fixtures — `prefix:test:`
- `22b277f` test: isolate gsd mcp cli coverage — `prefix:test:`
- `4ec4465` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `9bf2def` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `acc716c` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `e14a484` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `0181dda` test: avoid secret-shaped daemon fixture token — `prefix:test:`
- `7eafb02` Apply PatchDeck fixes for PR #102 — `merge-commit`
- `c6b0ce9` test(gsd): stabilize artifact history depth fixture — `prefix:test:`
- `07785e3` Apply PatchDeck fixes for PR #92 — `merge-commit`
- `06044d4` Apply PatchDeck fixes for PR #87 — `merge-commit`
- `3b0ba25` docs: update Discord community invite to Open GSD server — `prefix:docs:`
- `df060a8` docs: add npm, CI, Discord, and license badges to README — `prefix:docs:`
- `65f5c0b` test: accept exact engine version pins in npm package identity check — `prefix:test:`
- `1ee64d6` test: use distinct project roots for cross-worker lease contention — `prefix:test:`
- `14bdb71` refactor(ci): extract composite actions for artifact restore and Next.js cache — `prefix:refactor:`
- `cab6e38` ci: refactor pipeline and remove CodeRabbit — `prefix:ci:`
- `5ac60b4` docs(vision): use precise, verified dates for the project's history — `prefix:docs:`
- `d2636fe` docs(vision): explain briefly and honestly why the project moved — `prefix:docs:`
- `6a74301` docs: point Get Shit Done v1 references to get-shit-done-redux — `prefix:docs:`
- `9d55970` chore: remove legacy GSD-2 codename across the repo — `prefix:chore:`
- `13517a3` docs(vision): rewrite for gsd-pi and community direction — `prefix:docs:`
- `74c46a1` docs(contributing): update project name to gsd-pi — `prefix:docs:`
- `64a0606` ci: use github token for prerelease checkout — `prefix:ci:`
- `a4cd860` ci: restore docker builder stage — `prefix:ci:`
- `818bb88` Apply PatchDeck fixes for PR #44 — `merge-commit`

</details>

## Preflight results

- All 14 required checks passed
- Auto-created labels: 0

---

State advanced: `lastAnalyzedCommit` → `ed811bc` (gsd-pi HEAD as of 2026-06-05).
