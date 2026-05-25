# OTTO excavate — Layer 4 (Test Vectors + Acceptance Criteria) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-on Layer-4 stage to `/otto excavate` that produces concrete test vectors and Given/When/Then acceptance criteria, making the raw-tier specs verifiable.

**Architecture:** Extend the orchestrator playbook string (`playbook.ts`) with two new workspace dirs + a new parallel L4 stage (two general-purpose worker roles that Read the existing `excavate-validation` skill) + verification/summary updates. Lightly enrich `excavate-validation/SKILL.md` with concrete test-vector examples. No new TS modules; no `args.ts`/`paths.ts`/`EXCAVATE_SKILLS` changes.

**Tech Stack:** TypeScript (template-literal playbook builder), `node:test` + `node:assert/strict`. Tests run with:
`node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test <file>`.

**Repo:** `/Users/coreyellis/Projects/repos/local/loop24-client`. Work on `main` (consistent with the MVP).

---

## File Structure

| Path | Change |
|---|---|
| `src/resources/extensions/excavate/tests/playbook.test.ts` | Add one assertion block for the L4 stage |
| `src/resources/extensions/excavate/playbook.ts` | Stage 0 dirs + new Stage 4 + renumbered Stage 5/6 |
| `src/resources/skills/excavate-validation/SKILL.md` | Append a "Test Vector Examples" subsection |

---

## Task 1: Add the L4 stage to the playbook (TDD)

**Files:**
- Modify (test first): `src/resources/extensions/excavate/tests/playbook.test.ts`
- Modify: `src/resources/extensions/excavate/playbook.ts`

- [ ] **Step 1: Add the failing assertion block to the test**

In `src/resources/extensions/excavate/tests/playbook.test.ts`, immediately AFTER the existing `it("requires provenance citations and names the core stages", …)` block and BEFORE the closing `});` of the `describe`, insert:
```typescript
  it("includes the L4 test-vectors + acceptance-criteria stage", () => {
    assert.match(playbook, /raw\/specs\/test-vectors/);
    assert.match(playbook, /raw\/specs\/validation\/acceptance-criteria/);
    assert.match(playbook, /test-vector-generator/);
    assert.match(playbook, /acceptance-criteria-writer/);
    assert.match(playbook, /AC-\{DOMAIN\}-\{NNN\}/);
  });
```

- [ ] **Step 2: Run the test, verify the NEW assertion fails (others still pass)**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/excavate/tests/playbook.test.ts`
Expected: FAIL — `# fail 1` (the new "includes the L4 …" test fails because the playbook has no `test-vectors`/`acceptance-criteria` content yet); the other 4 pass.

- [ ] **Step 3a: Edit the Stage 0 `mkdir` line in `playbook.ts`**

Replace exactly:
```
mkdir -p "$WS"/raw/source "$WS"/raw/synthesis "$WS"/raw/specs/modules "$WS"/raw/specs/journeys "$WS"/raw/specs/contracts "$WS"/provenance
```
with:
```
mkdir -p "$WS"/raw/source "$WS"/raw/synthesis "$WS"/raw/specs/modules "$WS"/raw/specs/journeys "$WS"/raw/specs/contracts "$WS"/raw/specs/test-vectors "$WS"/raw/specs/validation/acceptance-criteria "$WS"/provenance
```

- [ ] **Step 3b: Replace the verification + summary stages in `playbook.ts`**

Replace exactly this block (the current Stage 4 + Stage 5):
```
## Stage 4 — Light verification
Dispatch ROLE verifier → Read \`${skillPaths["excavate-validation"]}\`. Read all specs in \`${workspace}/raw/specs/\`; check provenance coverage (every claim cited) and cross-spec consistency. Write \`${workspace}/raw/specs/verification-report.md\` with a PASS/FAIL line and any gaps. (No remediation loop — report only.) Commit.

## Stage 5 — Summary
Print: target, workspace, modules documented, total spec files, verification PASS/FAIL. Tell the user the specs are at \`${workspace}/raw/specs/\` with grep-able \`<!-- cite: -->\` provenance. STOP.\`;
```
with:
```
## Stage 4 — Test vectors & acceptance criteria (parallel, ≤4)
Dispatch in parallel:
- ROLE test-vector-generator → Read \`${skillPaths["excavate-validation"]}\`. From the module specs in \`${workspace}/raw/specs/modules/\` and contracts in \`${workspace}/raw/specs/contracts/\`, write concrete test vectors to \`${workspace}/raw/specs/test-vectors/\`: CLI invocation → expected output (and exit code), function input → output pairs, and error-condition cases. Each vector carries a \`<!-- cite: file:Lx-Ly -->\` citation. Vectors MUST be concrete input/output, never abstract descriptions.
- ROLE acceptance-criteria-writer → Read \`${skillPaths["excavate-validation"]}\`. From the module specs in \`${workspace}/raw/specs/modules/\`, write Given/When/Then acceptance criteria to \`${workspace}/raw/specs/validation/acceptance-criteria/\`: each criterion has an \`AC-{DOMAIN}-{NNN}\` ID, a priority (P0–P2), and a verification method.
Commit after the batch: \`[stage-4] test vectors + acceptance criteria\`.

## Stage 5 — Verification
Dispatch ROLE verifier → Read \`${skillPaths["excavate-validation"]}\`. Read all specs in \`${workspace}/raw/specs/\`; check: (a) provenance coverage — every claim cited; (b) cross-spec consistency; (c) every P0 module has ≥1 test vector and ≥1 acceptance criterion; (d) test vectors contain concrete input/output (not abstract descriptions); (e) acceptance criteria have valid \`AC-{DOMAIN}-{NNN}\` IDs, Given/When/Then structure, and a verification method. Write \`${workspace}/raw/specs/verification-report.md\` with a PASS/FAIL line and any gaps. (No remediation loop — report only.) Commit.

## Stage 6 — Summary
Print: target, workspace, modules documented, total spec files, test-vector count, acceptance-criterion count, verification PASS/FAIL. Tell the user the specs are at \`${workspace}/raw/specs/\` with grep-able \`<!-- cite: -->\` provenance. STOP.\`;
```
(Note: the trailing `\`;` closes the template literal + `return` statement — preserve it exactly. Do not change the `Stage 1/2/3` text or the dispatch-rules header.)

- [ ] **Step 4: Run the test, verify all pass**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/excavate/tests/playbook.test.ts`
Expected: `# tests 5`, `# pass 5`, `# fail 0`.

- [ ] **Step 5: Typecheck the resources project (no excavate errors)**

Run: `npx tsc -p tsconfig.resources.json --noEmit 2>&1 | grep -i excavate || echo "no excavate errors"`
Expected: `no excavate errors`.

- [ ] **Step 6: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/excavate/playbook.ts src/resources/extensions/excavate/tests/playbook.test.ts
git commit -m "feat(excavate): add L4 test-vectors + acceptance-criteria stage to playbook"
```
Use ONLY those two paths. One commit.

---

## Task 2: Enrich the excavate-validation skill with concrete test-vector examples

**Files:**
- Modify: `src/resources/skills/excavate-validation/SKILL.md`

- [ ] **Step 1: Append the examples subsection**

Append the following to the END of `src/resources/skills/excavate-validation/SKILL.md` (keep all existing content; add this after the last line):
```markdown

## Test Vector Examples

Test vectors are concrete input/output pairs an implementer can run to confirm a
rebuild matches. Always concrete — never "should handle X correctly".

### CLI invocation → expected output
```
$ greet --shout Ada
HELLO, ADA!
exit: 0
```
<!-- cite: cli.mjs:L5-L11 -->

### Function input → output
```
greet("Ada", { shout: false })  → "Hello, Ada!"
greet("Ada", { shout: true })   → "HELLO, ADA!"
greet("",    {})                 → "Hello, !"
```
<!-- cite: greet.mjs:L3-L4 -->

### Error / edge condition
```
$ greet --name
(no value after --name → retains previous name; exit 0, prints "Hello, world!")
```
<!-- cite: args.mjs:L6-L14 -->

Each vector pairs a concrete input with the exact expected output (and exit code
for CLI cases) and carries a provenance citation. Every P0 acceptance criterion
must have at least one corresponding test vector.
```

- [ ] **Step 2: Brand leakage + structure check**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -niE "greenfield|claude|earendil|GPL|subagent_type" src/resources/skills/excavate-validation/SKILL.md && echo ">>> LEAKAGE" || echo "clean"
grep -c "Test Vector Examples" src/resources/skills/excavate-validation/SKILL.md
head -3 src/resources/skills/excavate-validation/SKILL.md | grep -E "^name: excavate-validation" && echo "frontmatter ok"
```
Expected: `clean`; the examples count is `1`; `frontmatter ok`. If `>>> LEAKAGE`, remove the offending term and re-run.

- [ ] **Step 3: Commit**

```bash
git add src/resources/skills/excavate-validation/SKILL.md
git commit -m "feat(excavate): enrich excavate-validation skill with concrete test-vector examples"
```
Use ONLY that path. One commit.

---

## Task 3: Build + acceptance run

**Files:** none new (verification + any fixes)

- [ ] **Step 1: Build**

Run: `cd /Users/coreyellis/Projects/repos/local/loop24-client && npm run build 2>&1 | tail -5`
Expected: completes without error. Confirm the updated skill copied: `grep -c "Test Vector Examples" dist/resources/skills/excavate-validation/SKILL.md` → `1`.

- [ ] **Step 2: Confirm the skills synced to the ecosystem dir**

Run: `node /Users/coreyellis/Projects/repos/local/loop24-client/dist/loader.js --mode json -p "List available skills whose name starts with 'excavate'." 2>&1 | tail -12`
Expected: all 5 `excavate-*` skills listed (boot syncs them to `~/.agents/skills`).

- [ ] **Step 3: Acceptance run (empirical — LLM-orchestrated, not unit-testable)**

The bare `/excavate` slash-command no-ops in headless `--mode json -p` (a known MVP limitation), so drive the orchestration the proven way: generate the exact playbook the command emits and pass it as the prompt. Run from a clean cwd:
```bash
rm -rf /tmp/excavate-l4 && mkdir -p /tmp/excavate-l4 && cd /tmp/excavate-l4
# Build the playbook string from the compiled module, target = the tiny sample:
node --input-type=module -e "
import { buildPlaybook } from '/Users/coreyellis/Projects/repos/local/loop24-client/dist/resources/extensions/excavate/playbook.js';
import { resolveSkillPaths } from '/Users/coreyellis/Projects/repos/local/loop24-client/dist/resources/extensions/excavate/paths.js';
const t = process.env.HOME + '/greenfield-poc/target';
process.stdout.write(buildPlaybook({ target: t, workspace: '/tmp/excavate-l4/analysis-workspace', skillPaths: resolveSkillPaths() }));
" > /tmp/excavate-l4/playbook.txt
node /Users/coreyellis/Projects/repos/local/loop24-client/dist/loader.js --mode json -p "$(cat /tmp/excavate-l4/playbook.txt)" > /tmp/excavate-l4/run.jsonl 2>&1
echo "exit: $?"
echo "--- test vectors ---"; ls /tmp/excavate-l4/analysis-workspace/raw/specs/test-vectors/ 2>/dev/null
echo "--- acceptance criteria ---"; ls /tmp/excavate-l4/analysis-workspace/raw/specs/validation/acceptance-criteria/ 2>/dev/null
echo "--- AC ids present ---"; grep -rhoE "AC-[A-Z]+-[0-9]+" /tmp/excavate-l4/analysis-workspace/raw/specs/validation/ 2>/dev/null | head
echo "--- a test vector sample ---"; head -30 "$(ls /tmp/excavate-l4/analysis-workspace/raw/specs/test-vectors/*.md 2>/dev/null | head -1)" 2>/dev/null
```
Expected: `raw/specs/test-vectors/` holds files with concrete input/output, and `raw/specs/validation/acceptance-criteria/` holds files with `AC-<DOMAIN>-<NNN>` IDs and Given/When/Then. If `~/greenfield-poc/target` no longer exists, create a 3-file CLI sample (entry/arg-parser/logic) and point the `target` at it. (Sample-target reuse note: the same `~/greenfield-poc/target` the MVP used.)

- [ ] **Step 4: Commit any source fixes**

If the run revealed a source fix needed in `playbook.ts` or the skill, apply + commit:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/excavate/playbook.ts src/resources/skills/excavate-validation/SKILL.md
git commit -m "fix(excavate): L4 adjustments from acceptance run" || echo "no fixes needed"
```
Do NOT `git add -A`; do NOT commit anything under `/tmp` or `~/.agents`.

---

## Self-Review notes (for the implementer)
- Tasks 1–2 are deterministic (string edits + a test); Task 3 is the empirical LLM run (token cost) — that part is verified by inspection, not unit tests, and that's expected.
- Preserve the `playbook.ts` template-literal escaping exactly (the `\`...\`` backticks and the closing `\`;`). A typecheck (Task 1 Step 5) catches breakage.
- Do NOT touch `args.ts`, `paths.ts`, `command.ts`, `index.ts`, or `resource-loader.ts` — L4 is playbook + skill only.
- The acceptance run drives the orchestration by emitting the playbook directly (the registered `/excavate` command doesn't fire in headless `-p`); this is the same proven path used to validate the MVP.
```
