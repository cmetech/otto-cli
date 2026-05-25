# OTTO excavate — Formal Gates + Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace excavate's single report-only verification stage with two blocking quality gates (Gate 1 Spec Gate after deep-docs, Gate 2 AC Gate after L4), each with a targeted remediation loop of up to 3 rounds and a hard-STOP/BLOCKED posture on exhaustion.

**Architecture:** Restructure the orchestrator playbook string (`playbook.ts`): insert a new Gate 1 stage before the L4 test-vectors stage, replace the old report-only verification with a Gate 2 stage after L4, and renumber/extend the summary. Each gate dispatches a `verifier` worker that writes a verdict report naming offending files; on FAIL it dispatches targeted `spec-remediator`/`ac-remediator` workers and re-runs, up to 3 rounds, then BLOCKED+STOP. Lightly enrich `excavate-validation/SKILL.md` to name the gates and pin the remediation protocol + report format. No new TS modules; no `args.ts`/`paths.ts`/`EXCAVATE_SKILLS` changes.

**Tech Stack:** TypeScript (template-literal playbook builder), `node:test` + `node:assert/strict`. Tests run with:
`node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test <file>`.

**Repo:** `/Users/coreyellis/Projects/repos/local/loop24-client`. Work on `main` (consistent with the MVP + L4).

---

## File Structure

| Path | Change |
|---|---|
| `src/resources/extensions/excavate/tests/playbook.test.ts` | Update the retired `verification-report` assertion to the gate reports; add one assertion block for the two gates + remediation |
| `src/resources/extensions/excavate/playbook.ts` | Replace the Stage 4/5/6 block (test-vectors → report-only verify → summary) with Gate 1 / test-vectors / Gate 2 / summary (4 stages, renumbered) |
| `src/resources/skills/excavate-validation/SKILL.md` | Rename the two gate-criteria headings to Gate 1 / Gate 2; add a "Remediation Loop" and a "Gate Report Format" subsection |

---

## Task 1: Restructure the playbook into two gates with remediation (TDD)

**Files:**
- Modify (test first): `src/resources/extensions/excavate/tests/playbook.test.ts`
- Modify: `src/resources/extensions/excavate/playbook.ts`

- [ ] **Step 1: Update the retired assertion in the existing test**

In `src/resources/extensions/excavate/tests/playbook.test.ts`, inside the `it("requires provenance citations and names the core stages", …)` block, replace exactly this line:
```typescript
    assert.match(playbook, /verification-report/i);
```
with:
```typescript
    assert.match(playbook, /gate-1-report/i);
```
(The retired `verification-report.md` is replaced by the two gate reports; the Gate 2 report is asserted in the new block below.)

- [ ] **Step 2: Add the failing assertion block for the gates**

In the same file, immediately AFTER the `it("includes the L4 test-vectors + acceptance-criteria stage", …)` block and BEFORE the closing `});` of the `describe`, insert:
```typescript
  it("runs two blocking gates with remediation loops", () => {
    assert.match(playbook, /Gate 1/);
    assert.match(playbook, /Gate 2/);
    assert.match(playbook, /raw\/specs\/gate-1-report\.md/);
    assert.match(playbook, /raw\/specs\/gate-2-report\.md/);
    assert.match(playbook, /spec-remediator/);
    assert.match(playbook, /ac-remediator/);
    assert.match(playbook, /3 remediation rounds/i);
    assert.match(playbook, /BLOCKED/);
    assert.match(playbook, /contradiction/i);
    assert.match(playbook, /implementation leakage/i);
    // Gate 1 precedes the test-vector stage; Gate 2 follows it.
    assert.ok(playbook.indexOf("Gate 1") < playbook.indexOf("test-vector-generator"));
    assert.ok(playbook.indexOf("test-vector-generator") < playbook.indexOf("Gate 2"));
  });
```

- [ ] **Step 3: Run the tests, verify the new/changed assertions fail**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/excavate/tests/playbook.test.ts`
Expected: FAIL — `# fail 2` (the changed "names the core stages" test now fails on `/gate-1-report/i`, and the new "runs two blocking gates" test fails); the other 3 pass.

- [ ] **Step 4: Replace the Stage 4/5/6 block in `playbook.ts`**

In `src/resources/extensions/excavate/playbook.ts`, replace exactly this block (current Stage 4 + Stage 5 + Stage 6, ending at the template-literal close `STOP.\`;`):
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
with:
```
## Stage 4 — Gate 1: Spec Gate (blocking, up to 3 remediation rounds)
Dispatch ROLE verifier → Read \`${skillPaths["excavate-validation"]}\`. Read \`${workspace}/raw/specs/modules/\`, \`${workspace}/raw/specs/journeys/\`, \`${workspace}/raw/specs/contracts/\`, and \`${workspace}/raw/synthesis/module-map.md\`. Check: (a) zero contradictions between specs; (b) constants/crypto values verified against source, not assumed; (c) every behavioral claim has a \`<!-- cite: -->\` provenance citation — hard gate, zero uncited claims; (d) assumed claims are a small minority; (e) every module in module-map.md has a spec. Write \`${workspace}/raw/specs/gate-1-report.md\`: first line a verdict (\`PASS\` / \`FAIL\` / \`BLOCKED\`), then for each failing criterion a finding that NAMES the offending spec file(s) and what must change, then a quantitative summary line. Commit \`[gate-1] spec gate report\`.
REMEDIATION LOOP: if the verdict is FAIL and fewer than 3 remediation rounds have run, dispatch remediation workers in a batch (≤4 — one per flagged file/area) ROLE spec-remediator → Read \`${skillPaths["excavate-spec-writing"]}\` and \`${skillPaths["excavate-provenance"]}\`. Each fixes ONLY the findings named for its file (add the missing citation, resolve the named contradiction, write the missing module's spec, correct the unverified constant) — do not rewrite passing specs. Commit \`[gate-1 round N] remediation\`. Then re-dispatch the verifier and rewrite gate-1-report.md. Repeat until the verdict is PASS or 3 rounds have run. If still FAIL after the 3rd round, set the report verdict to BLOCKED, run Stage 7 in its BLOCKED form, and STOP — do NOT run Stage 5 or Stage 6.

## Stage 5 — Test vectors & acceptance criteria (parallel, ≤4)
Dispatch in parallel:
- ROLE test-vector-generator → Read \`${skillPaths["excavate-validation"]}\`. From the module specs in \`${workspace}/raw/specs/modules/\` and contracts in \`${workspace}/raw/specs/contracts/\`, write concrete test vectors to \`${workspace}/raw/specs/test-vectors/\`: CLI invocation → expected output (and exit code), function input → output pairs, and error-condition cases. Each vector carries a \`<!-- cite: file:Lx-Ly -->\` citation. Vectors MUST be concrete input/output, never abstract descriptions.
- ROLE acceptance-criteria-writer → Read \`${skillPaths["excavate-validation"]}\`. From the module specs in \`${workspace}/raw/specs/modules/\`, write Given/When/Then acceptance criteria to \`${workspace}/raw/specs/validation/acceptance-criteria/\`: each criterion has an \`AC-{DOMAIN}-{NNN}\` ID, a priority (P0–P2), and a verification method.
Commit after the batch: \`[stage-5] test vectors + acceptance criteria\`.

## Stage 6 — Gate 2: AC Gate (blocking, up to 3 remediation rounds)
Dispatch ROLE verifier → Read \`${skillPaths["excavate-validation"]}\`. Read \`${workspace}/raw/specs/test-vectors/\` and \`${workspace}/raw/specs/validation/\`, cross-checking against \`${workspace}/raw/specs/modules/\`. Check: (a) no implementation leakage — apply the reimplementor test; (b) no P0 completeness gaps; (c) acceptance criteria have valid \`AC-{DOMAIN}-{NNN}\` IDs and link to their specs; (d) every P0 acceptance criterion has ≥1 test vector; (e) test vectors contain concrete input/output, not abstract descriptions; (f) every module has at least one acceptance criterion. Write \`${workspace}/raw/specs/gate-2-report.md\` with the same verdict / per-finding / summary format as Gate 1. Commit \`[gate-2] ac gate report\`.
REMEDIATION LOOP: same protocol as Gate 1, but remediation workers are ROLE ac-remediator → Read \`${skillPaths["excavate-validation"]}\`. Each fixes ONLY its flagged acceptance criteria / test vectors (add the missing test vector, fix the malformed AC-{DOMAIN}-{NNN} ID, abstract the leaked identifier, add the missing module's acceptance criteria). Commit \`[gate-2 round N] remediation\`, re-dispatch the verifier, up to 3 rounds. If still FAIL after the 3rd round, set gate-2-report.md to BLOCKED, run Stage 7 in its BLOCKED form, and STOP.

## Stage 7 — Summary
Print: target, workspace, modules documented, total spec files, test-vector count, acceptance-criterion count, Gate 1 verdict + rounds used, Gate 2 verdict + rounds used. If either gate is BLOCKED, lead with \`BLOCKED\`, list the unresolved findings, and note which later stages were skipped. Otherwise tell the user the specs are at \`${workspace}/raw/specs/\` (grep-able \`<!-- cite: -->\` provenance) and the gate reports at \`${workspace}/raw/specs/gate-1-report.md\` and \`${workspace}/raw/specs/gate-2-report.md\`. STOP.\`;
```
(Preserve the trailing `\`;` exactly — it closes the template literal + `return`. Do not change the Stage 0/1/2/3 text or the dispatch-rules header.)

- [ ] **Step 5: Run the tests, verify all pass**

Run: `node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs --experimental-strip-types --test src/resources/extensions/excavate/tests/playbook.test.ts`
Expected: `# tests 6`, `# pass 6`, `# fail 0`.

- [ ] **Step 6: Typecheck the resources project (no excavate errors)**

Run: `npx tsc -p tsconfig.resources.json --noEmit 2>&1 | grep -i excavate || echo "no excavate errors"`
Expected: `no excavate errors`.

- [ ] **Step 7: Commit**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/excavate/playbook.ts src/resources/extensions/excavate/tests/playbook.test.ts
git commit -m "feat(excavate): replace report-only verify with Gate 1/Gate 2 + remediation"
```
Use ONLY those two paths. One commit. (If the commit to `main` is soft-blocked by the permission classifier, retry once — direct-to-main local commits are the project convention here.)

---

## Task 2: Name the gates and pin the remediation protocol in the validation skill

**Files:**
- Modify: `src/resources/skills/excavate-validation/SKILL.md`

- [ ] **Step 1: Rename the Gate 1 heading**

In `src/resources/skills/excavate-validation/SKILL.md`, replace exactly:
```markdown
### Spec Gate (after specs are written)
```
with:
```markdown
### Gate 1 — Spec Gate (after specs are written)
```

- [ ] **Step 2: Rename the Gate 2 heading**

Replace exactly:
```markdown
### Acceptance-Criteria Gate (after ACs are written)
```
with:
```markdown
### Gate 2 — AC Gate (after L4 — test vectors and acceptance criteria)
```

- [ ] **Step 3: Insert the Remediation Loop + Gate Report Format subsections**

In the same file, immediately BEFORE this line:
```markdown
### Implementation Leakage Definition
```
insert:
```markdown
### Remediation Loop

Gates are blocking. When a gate's verdict is FAIL, the orchestrator dispatches
remediation workers — one per offending file named in the report — and re-runs the
gate. Each remediation worker fixes ONLY the findings named for its file; it does
not rewrite specs that already pass. The loop runs up to **3 rounds** per gate. If
the gate still FAILs after the 3rd round, its verdict becomes **BLOCKED**: the
pipeline stops, later stages do not run, and the run summary leads with the
unresolved findings. A blocked Gate 1 means test-vector generation and Gate 2
never run.

### Gate Report Format

Every gate writes a report whose first line is the verdict — one of `PASS`,
`FAIL`, or `BLOCKED`. Each failing criterion is a finding that names the offending
file(s) and states what must change to pass. The report ends with a quantitative
summary (criteria checked, findings, coverage %).

```

- [ ] **Step 4: Brand leakage + structure check**

Run:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -niE "greenfield|claude|earendil|GPL|subagent_type" src/resources/skills/excavate-validation/SKILL.md && echo ">>> LEAKAGE" || echo "clean"
grep -c "Gate 1 — Spec Gate" src/resources/skills/excavate-validation/SKILL.md
grep -c "Gate 2 — AC Gate" src/resources/skills/excavate-validation/SKILL.md
grep -c "Remediation Loop" src/resources/skills/excavate-validation/SKILL.md
grep -c "Gate Report Format" src/resources/skills/excavate-validation/SKILL.md
head -3 src/resources/skills/excavate-validation/SKILL.md | grep -E "^name: excavate-validation" && echo "frontmatter ok"
```
Expected: `clean`; each of the four `grep -c` prints `1`; `frontmatter ok`. If `>>> LEAKAGE`, remove the offending term and re-run. (Note: the pre-existing AC-CONFIG example and Verification-Methods table are unchanged — they contain no banned terms.)

- [ ] **Step 5: Commit**

```bash
git add src/resources/skills/excavate-validation/SKILL.md
git commit -m "feat(excavate): name Gate 1/Gate 2 + document remediation loop in validation skill"
```
Use ONLY that path. One commit.

---

## Task 3: Build + acceptance run

**Files:** none new (verification + any fixes)

- [ ] **Step 1: Build**

Run: `cd /Users/coreyellis/Projects/repos/local/loop24-client && npm run build 2>&1 | tail -5`
Expected: completes without error. Confirm the playbook + skill copied:
```bash
grep -c "Gate 1: Spec Gate" dist/resources/extensions/excavate/playbook.js
grep -c "Remediation Loop" dist/resources/skills/excavate-validation/SKILL.md
```
Expected: each prints `1`.

- [ ] **Step 2: Acceptance run (empirical — LLM-orchestrated, not unit-testable)**

The bare `/excavate` slash-command no-ops in headless `--mode json -p` (a known MVP limitation), so drive the orchestration the proven way: emit the exact playbook the command builds and pass it as the prompt. Run from a clean cwd:
```bash
rm -rf /tmp/excavate-gates && mkdir -p /tmp/excavate-gates && cd /tmp/excavate-gates
node --input-type=module -e "
import { buildPlaybook } from '/Users/coreyellis/Projects/repos/local/loop24-client/dist/resources/extensions/excavate/playbook.js';
import { resolveSkillPaths } from '/Users/coreyellis/Projects/repos/local/loop24-client/dist/resources/extensions/excavate/paths.js';
const t = process.env.HOME + '/greenfield-poc/target';
process.stdout.write(buildPlaybook({ target: t, workspace: '/tmp/excavate-gates/analysis-workspace', skillPaths: resolveSkillPaths() }));
" > /tmp/excavate-gates/playbook.txt
node /Users/coreyellis/Projects/repos/local/loop24-client/dist/loader.js --mode json -p "$(cat /tmp/excavate-gates/playbook.txt)" > /tmp/excavate-gates/run.jsonl 2>&1
echo "exit: $?"
echo "--- gate 1 report ---"; head -5 /tmp/excavate-gates/analysis-workspace/raw/specs/gate-1-report.md 2>/dev/null
echo "--- gate 2 report ---"; head -5 /tmp/excavate-gates/analysis-workspace/raw/specs/gate-2-report.md 2>/dev/null
echo "--- gate commits ---"; git -C /tmp/excavate-gates/analysis-workspace log --oneline | grep -iE "gate-[12]" || echo "(no gate commits found)"
echo "--- verification-report retired? ---"; ls /tmp/excavate-gates/analysis-workspace/raw/specs/verification-report.md 2>/dev/null && echo "STILL PRESENT (unexpected)" || echo "absent (expected)"
```
Expected: both `gate-1-report.md` and `gate-2-report.md` exist, each starting with a `PASS`/`FAIL`/`BLOCKED` verdict line; `git log` shows `[gate-1] …` and `[gate-2] …` commits (and `[gate-N round M] remediation` commits IF a gate found a fixable defect — a clean tiny target may PASS first try, which is fine). If `~/greenfield-poc/target` no longer exists, create a 3-file CLI sample (entry/arg-parser/logic) and point `target` at it.

- [ ] **Step 3: Optional remediation-loop check (manual, token cost)**

To exercise the loop deliberately: after a PASS run, hand-edit one module spec under `/tmp/excavate-gates/analysis-workspace/raw/specs/modules/` to remove a `<!-- cite: -->` citation (introducing an uncited claim), then re-emit + re-run the playbook from Stage 4 onward (or re-run the whole playbook against the same workspace). Confirm `gate-1-report.md` reports the uncited-claim finding naming that file and that at least one `[gate-1 round 1] remediation` commit appears before the verdict returns to PASS. This is an LLM-orchestrated behavior — verified by inspection, not a unit test; documented here, not faked.

- [ ] **Step 4: Commit any source fixes**

If the run revealed a fix needed in `playbook.ts` or the skill, apply + commit:
```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add src/resources/extensions/excavate/playbook.ts src/resources/skills/excavate-validation/SKILL.md
git commit -m "fix(excavate): gate adjustments from acceptance run" || echo "no fixes needed"
```
Do NOT `git add -A`; do NOT commit anything under `/tmp` or `~/.agents`.

---

## Self-Review notes (for the implementer)

**Spec coverage** — every section of `2026-05-24-otto-excavate-gates-design.md` maps to a task:
- Two gates, Gate 1 before L4 / Gate 2 after → Task 1 Step 4 (stage layout) + Task 1 Step 2 ordering asserts.
- 3 remediation rounds, targeted, hard-STOP/BLOCKED → Task 1 Step 4 REMEDIATION LOOP prose + Task 1 Step 2 asserts (`3 remediation rounds`, `BLOCKED`, `spec-remediator`/`ac-remediator`).
- Separate gate reports `gate-1-report.md`/`gate-2-report.md`, `verification-report.md` retired → Task 1 Step 1 (assertion swap) + Step 4 prose + Task 3 Step 2 retirement check.
- Gate criteria (contradictions / leakage / P0 / IDs / vectors) → Task 1 Step 4 prose + Step 2 keyword asserts.
- Skill enrichment (gate naming, Remediation Loop, Gate Report Format; AC content intact) → Task 2.
- Summary gains gate verdict + rounds lines → Task 1 Step 4 Stage 7.
- Testing (unit + documented-manual empirical) → Task 1 (unit) + Task 3 (empirical).

**Notes:**
- Tasks 1–2 are deterministic (string edits + tests); Task 3 is the empirical LLM run (token cost), verified by inspection — expected, not a gap.
- Preserve the `playbook.ts` template-literal escaping exactly (the `\`…\`` backticks and the closing `\`;`). The typecheck (Task 1 Step 6) catches breakage.
- Do NOT touch `args.ts`, `paths.ts`, `command.ts`, `index.ts`, or `resource-loader.ts` — this is playbook + skill only.
- The acceptance run drives the orchestration by emitting the playbook directly (the registered `/excavate` command doesn't fire in headless `-p`); same proven path used to validate the MVP and L4.
