# Upstream Pipeline Hardening — Phase 3 (Other Correctness Fixes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two confirmed Phase-0 correctness defects safe: (1) `_common/issue-update.mjs` must be idempotent on re-run — no duplicate "Applied in …" comment, no error closing an already-closed issue; and (2) `_common/select-issues.mjs` must not re-select an issue whose fix already merged (including out-of-band) when `--resume`-style selection runs.

**Architecture:** Both fixes are local to the two `_common` scripts (moved there in Phase 1, used by upstream-fix and upstream-merge). `issue-update.mjs` gains a single pre-check read (`gh issue view --json state,comments`) when a comment or close is requested, then skips a comment whose body already exists and skips a close on an already-closed issue. `select-issues.mjs` gains an opt-in `excludeApplied` mode (`--exclude-applied`) that asks GitHub, per candidate, whether the open issue has a **linked merged PR** (via `gh api graphql` over the issue's timeline) and drops those — the authoritative signal that catches out-of-band merges the `status:applied` label never recorded. SKILL.md docs are updated so upstream-fix passes `--exclude-applied` on resume and notes the idempotent lifecycle.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, dependency-injected `gh` runner (no network in tests). Skill files live under `.claude/skills/` (gitignored at `.gitignore:43`; commit with `git add -f`). Editing `.claude/skills/` trips the self-modification block — obtain operator authorization at session start.

---

## Pre-flight (read before Task 1)

**Self-modification block:** every task edits `.claude/skills/`. Confirm Corey has authorized skill edits for this session before starting.

**Branch:** all work happens on `feat/upstream-hardening-phase-3` off `main`.

**Regression net (full skill suite — run after every task, must stay green; baseline 358):**

```bash
node --test \
  .claude/skills/_common/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-cherry-pick/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-cherry-pick/__tests__/*.test.mjs \
  .claude/skills/upstream-fix/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-merge/scripts/__tests__/*.test.mjs \
  .claude/skills/upstream-swarm/scripts/__tests__/*.test.mjs
```

**Commit convention:** Conventional Commits, scope `upstream`. End every commit message body with the required `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. `git add -f` for `.claude/skills/` files.

**Scope guardrails (from Phase 0 — do NOT widen):**
- The real issue-update defect is the **duplicate comment**; labels and `gh issue close` are already gh-idempotent. The fix adds a comment guard + a close-state guard so the op is a clean no-op on re-run. Do not rewrite the whole module.
- `upstream-swarm` has its OWN `select-issues.mjs` — it is **out of scope**. Only `_common/select-issues.mjs` (used by upstream-fix) changes here.
- Debunked items (merge re-gate-on-resume, rebase classifier) are NOT in this phase.

## File Structure

**Modify:**
- `.claude/skills/_common/scripts/issue-update.mjs` — add idempotency pre-check (comment-skip + close-skip).
- `.claude/skills/_common/scripts/__tests__/issue-update.test.mjs` — idempotency tests.
- `.claude/skills/_common/scripts/select-issues.mjs` — add `excludeApplied` + GitHub linked-merged-PR check (`buildAppliedCheckArgs`, `parseAppliedFromGraphql`, `isIssueApplied`).
- `.claude/skills/_common/scripts/__tests__/select-issues.test.mjs` — applied-exclusion tests.
- `.claude/skills/upstream-fix/SKILL.md` — pass `--exclude-applied` on resume; note idempotent Phase D.
- `.claude/skills/upstream-merge/SKILL.md` — one-line note that the issue-update close/comment is idempotent on re-run.

---

### Task 1: `issue-update.mjs` — idempotent comment + close

**Files:**
- Modify: `.claude/skills/_common/scripts/issue-update.mjs` (`updateIssue` :12-35)
- Test: `.claude/skills/_common/scripts/__tests__/issue-update.test.mjs`

When a `comment` or `close` is requested, do ONE pre-check read (`gh issue view --json state,comments`). Skip posting a comment whose trimmed body already exists; skip closing an already-`CLOSED` issue. Labels stay as-is (gh-idempotent). A failed pre-check falls through to best-effort (does not block the op). The function never throws on an already-applied action.

- [ ] **Step 1: Write the failing tests**

Append to `.claude/skills/_common/scripts/__tests__/issue-update.test.mjs`:

```js
// ---------------------------------------------------------------------------
// Phase 3: idempotency
// ---------------------------------------------------------------------------

/** Recorder whose `issue view --json` returns a canned view; other calls echo "". */
function viewRecorder(view) {
  const calls = [];
  const r = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify(view);
    return "";
  };
  r.calls = calls;
  return r;
}

test("skips a duplicate comment and a redundant close (no-op on already-applied)", () => {
  const body = "Applied in abc1234 (PR https://github.com/cmetech/otto-cli/pull/9).";
  const gh = viewRecorder({ state: "CLOSED", comments: [{ body }] });
  const out = updateIssue({ number: 63, repo: "cmetech/otto-cli", comment: body, close: true, ghRunner: gh });
  assert.ok(!gh.calls.some((c) => c[0] === "issue" && c[1] === "comment"), "must NOT post a second comment");
  assert.ok(!gh.calls.some((c) => c[0] === "issue" && c[1] === "close"), "must NOT re-close");
  assert.ok(out.actions.includes("comment-skipped"), `actions: ${out.actions}`);
  assert.ok(out.actions.includes("close-skipped"), `actions: ${out.actions}`);
});

test("first run on an open issue with no matching comment posts + closes", () => {
  const gh = viewRecorder({ state: "OPEN", comments: [] });
  const out = updateIssue({ number: 63, repo: "r", comment: "Applied in abc1234.", close: true, ghRunner: gh });
  assert.ok(gh.calls.some((c) => c[0] === "issue" && c[1] === "comment"), "posts the comment");
  assert.ok(gh.calls.some((c) => c[0] === "issue" && c[1] === "close"), "closes the issue");
  assert.ok(out.actions.includes("comment") && out.actions.includes("close"), `actions: ${out.actions}`);
});

test("posts the comment when existing comments differ", () => {
  const gh = viewRecorder({ state: "OPEN", comments: [{ body: "an unrelated comment" }] });
  updateIssue({ number: 63, repo: "r", comment: "Applied in abc1234.", ghRunner: gh });
  assert.ok(gh.calls.some((c) => c[0] === "issue" && c[1] === "comment"), "different body → posts");
});

test("label-only call makes no pre-check view request", () => {
  const gh = viewRecorder({ state: "OPEN", comments: [] });
  updateIssue({ number: 7, repo: "r", addLabels: ["status:in-progress"], ghRunner: gh });
  assert.ok(!gh.calls.some((c) => c[0] === "issue" && c[1] === "view"), "no precheck when only labels");
  assert.ok(gh.calls.some((c) => c[0] === "issue" && c[1] === "edit"), "edits labels");
});

test("a failing pre-check does not block the op (best-effort)", () => {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "view") throw new Error("gh view boom");
    return "";
  };
  const out = updateIssue({ number: 7, repo: "r", comment: "Applied in abc1234.", close: true, ghRunner: gh });
  // precheck failed → state unknown → proceed (don't throw)
  assert.ok(calls.some((c) => c[1] === "comment"), "still posts when precheck fails");
  assert.ok(calls.some((c) => c[1] === "close"), "still closes when precheck fails");
  assert.ok(out.actions.includes("comment") && out.actions.includes("close"));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .claude/skills/_common/scripts/__tests__/issue-update.test.mjs`
Expected: the new idempotency tests FAIL (no `comment-skipped`/`close-skipped`, and a `view` call is made even for label-only). Pre-existing tests still pass.

- [ ] **Step 3: Implement the pre-check in `updateIssue`**

Replace the body of `updateIssue` (`issue-update.mjs:12-35`) with:

```js
export function updateIssue({ number, repo = DEFAULT_REPO, addLabels = [], removeLabels = [], comment = null, close = false, ghRunner = defaultGhRunner }) {
  const actions = [];

  // Idempotency pre-check: one read of state + comments, only when a comment or
  // close is requested (label edits are already gh-idempotent). A failed read
  // falls through to best-effort so the pre-check never blocks the op.
  let state = null;
  let existingComments = [];
  if (comment || close) {
    try {
      const view = JSON.parse(ghRunner(["issue", "view", String(number), "--repo", repo, "--json", "state,comments"]) || "{}");
      state = view.state ?? null; // "OPEN" | "CLOSED"
      existingComments = Array.isArray(view.comments) ? view.comments : [];
    } catch {
      state = null;
      existingComments = [];
    }
  }

  if (addLabels.length || removeLabels.length) {
    const args = ["issue", "edit", String(number), "--repo", repo];
    for (const l of addLabels) args.push("--add-label", l);
    for (const l of removeLabels) args.push("--remove-label", l);
    ghRunner(args);
    if (addLabels.length) actions.push("add-label");
    if (removeLabels.length) actions.push("remove-label");
  }

  if (comment) {
    const already = existingComments.some((c) => (c.body ?? "").trim() === comment.trim());
    if (already) {
      actions.push("comment-skipped");
    } else {
      ghRunner(["issue", "comment", String(number), "--repo", repo, "--body", comment]);
      actions.push("comment");
    }
  }

  if (close) {
    if (state === "CLOSED") {
      actions.push("close-skipped");
    } else {
      ghRunner(["issue", "close", String(number), "--repo", repo]);
      actions.push("close");
    }
  }

  return { number, actions };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test .claude/skills/_common/scripts/__tests__/issue-update.test.mjs`
Expected: PASS (old + new). Note the pre-existing "posts a comment and closes" test still passes: its `recorder()` returns `""` for the view call, `JSON.parse("" || "{}")` → `{}` → state `null`, comments `[]`, so the comment posts and the close runs.

- [ ] **Step 5: Run the full regression net** — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/_common/scripts/issue-update.mjs .claude/skills/_common/scripts/__tests__/issue-update.test.mjs
git commit -m "$(cat <<'EOF'
fix(upstream): make issue-update idempotent (skip dup comment + redundant close)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `select-issues.mjs` — exclude already-applied issues via GitHub linked-PR check

**Files:**
- Modify: `.claude/skills/_common/scripts/select-issues.mjs`
- Test: `.claude/skills/_common/scripts/__tests__/select-issues.test.mjs`

Add an opt-in `excludeApplied` mode. When set, each candidate open issue (after the existing label exclusion) is checked against GitHub: if its timeline has a **linked merged PR**, the issue's fix already landed (even out-of-band, where `status:applied` was never set) and it is dropped. Pure helpers (`buildAppliedCheckArgs`, `parseAppliedFromGraphql`) are unit-tested; the gh call goes through the injected `ghRunner`. A failed check does NOT exclude (fail open — never skip genuinely unmerged work).

- [ ] **Step 1: Write the failing tests**

Append to `.claude/skills/_common/scripts/__tests__/select-issues.test.mjs` (the import line at top already pulls from `../select-issues.mjs` — extend it to add the new exports):

```js
import {
  buildAppliedCheckArgs,
  parseAppliedFromGraphql,
} from "../select-issues.mjs";

test("buildAppliedCheckArgs targets the gh graphql API with owner/name/num", () => {
  const args = buildAppliedCheckArgs(63, "cmetech/otto-cli");
  assert.equal(args[0], "api");
  assert.equal(args[1], "graphql");
  assert.ok(args.some((a) => a === "owner=cmetech"), `args: ${args}`);
  assert.ok(args.some((a) => a === "name=otto-cli"), `args: ${args}`);
  assert.ok(args.some((a) => a === "num=63"), `args: ${args}`);
  assert.ok(args.some((a) => /^query=/.test(a)), "carries a graphql query");
});

test("parseAppliedFromGraphql is true when a linked PR is merged", () => {
  const json = JSON.stringify({
    data: { repository: { issue: { timelineItems: { nodes: [
      { __typename: "CrossReferencedEvent", source: { __typename: "PullRequest", merged: true } },
    ] } } } },
  });
  assert.equal(parseAppliedFromGraphql(json), true);
});

test("parseAppliedFromGraphql is false when no linked PR is merged", () => {
  const json = JSON.stringify({
    data: { repository: { issue: { timelineItems: { nodes: [
      { __typename: "CrossReferencedEvent", source: { __typename: "PullRequest", merged: false } },
      { __typename: "ConnectedEvent", subject: { __typename: "Issue" } },
    ] } } } },
  });
  assert.equal(parseAppliedFromGraphql(json), false);
});

test("parseAppliedFromGraphql tolerates empty / malformed payloads", () => {
  assert.equal(parseAppliedFromGraphql("{}"), false);
  assert.equal(parseAppliedFromGraphql(""), false);
  assert.equal(parseAppliedFromGraphql("not json"), false);
});

test("selectIssues excludeApplied drops issues with a linked merged PR (incl. out-of-band)", () => {
  const dir = tmp();
  try {
    const gdir = join(dir, "guidance");
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, "ce0e801.md"), "strategy: adapted-port\n\n## Target file(s)\n\n- `a.ts`\n");
    writeFileSync(join(gdir, "4b4641c.md"), "strategy: adapted-port\n\n## Target file(s)\n\n- `b.ts`\n");
    const fakeIssues = [
      { number: 63, title: "x", labels: [{ name: "type:port-required" }], body: "[sha=ce0e801]" }, // merged out-of-band
      { number: 11, title: "w", labels: [{ name: "type:port-required" }], body: "[sha=4b4641c]" }, // still open/unmerged
    ];
    const mergedFor = new Set([63]); // #63 has a linked merged PR
    const ghRunner = (args) => {
      if (args[0] === "issue" && args[1] === "list") return JSON.stringify(fakeIssues);
      if (args[0] === "api" && args[1] === "graphql") {
        const numArg = args.find((a) => /^num=/.test(a)) ?? "";
        const num = Number(numArg.slice("num=".length));
        return JSON.stringify({
          data: { repository: { issue: { timelineItems: { nodes: [
            { __typename: "CrossReferencedEvent", source: { __typename: "PullRequest", merged: mergedFor.has(num) } },
          ] } } } },
        });
      }
      return "";
    };
    const out = join(dir, "selected.json");
    const result = selectIssues({ filter: { all: true }, ghRunner, guidanceDir: gdir, outPath: out, excludeApplied: true });
    const kept = result.records.map((r) => r.number).sort();
    assert.deepEqual(kept, [11], `kept: ${kept}`);
    assert.equal(result.excludedApplied, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("selectIssues without excludeApplied makes no graphql calls (back-compat)", () => {
  const dir = tmp();
  try {
    const gdir = join(dir, "guidance");
    mkdirSync(gdir, { recursive: true });
    writeFileSync(join(gdir, "ce0e801.md"), "strategy: adapted-port\n\n## Target file(s)\n\n- `a.ts`\n");
    let graphqlCalls = 0;
    const ghRunner = (args) => {
      if (args[0] === "api") graphqlCalls++;
      return JSON.stringify([{ number: 63, title: "x", labels: [{ name: "type:port-required" }], body: "[sha=ce0e801]" }]);
    };
    selectIssues({ filter: { all: true }, ghRunner, guidanceDir: gdir, outPath: join(dir, "s.json") });
    assert.equal(graphqlCalls, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test .claude/skills/_common/scripts/__tests__/select-issues.test.mjs`
Expected: FAIL — `buildAppliedCheckArgs`/`parseAppliedFromGraphql` not exported; `excludeApplied` ignored.

- [ ] **Step 3: Implement in `select-issues.mjs`**

(a) Add the linked-PR helpers (place after `shaFromBody`, before `selectIssues`):

```js
/** gh args for a GraphQL query over an issue's timeline → linked PR merge state. */
export function buildAppliedCheckArgs(number, repo = DEFAULT_REPO) {
  const [owner, name] = repo.split("/");
  const query =
    "query($owner:String!,$name:String!,$num:Int!){repository(owner:$owner,name:$name){issue(number:$num){" +
    "timelineItems(first:50,itemTypes:[CROSS_REFERENCED_EVENT,CONNECTED_EVENT,CLOSED_EVENT]){nodes{__typename " +
    "... on CrossReferencedEvent{source{__typename ... on PullRequest{merged}}} " +
    "... on ConnectedEvent{subject{__typename ... on PullRequest{merged}}} " +
    "... on ClosedEvent{closer{__typename ... on PullRequest{merged}}}}}}}}";
  return ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `num=${number}`];
}

/** True iff any timeline node references a MERGED pull request. */
export function parseAppliedFromGraphql(jsonText) {
  let data;
  try { data = JSON.parse(jsonText || "{}"); } catch { return false; }
  const nodes = data?.data?.repository?.issue?.timelineItems?.nodes ?? [];
  for (const n of nodes) {
    const pr = n?.source ?? n?.subject ?? n?.closer ?? null;
    if (pr && pr.merged === true) return true;
  }
  return false;
}

/** Ask GitHub whether issue #number already has a linked merged PR (fail-open). */
export function isIssueApplied({ number, repo = DEFAULT_REPO, ghRunner = defaultGhRunner }) {
  try {
    return parseAppliedFromGraphql(ghRunner(buildAppliedCheckArgs(number, repo)));
  } catch {
    return false; // a failed check must NOT exclude — never skip genuinely unmerged work
  }
}
```

(b) Thread `excludeApplied` through `selectIssues`. Change the signature and the loop. Replace the `selectIssues` signature line and the per-issue exclusion. The signature becomes:

```js
export function selectIssues({ filter, repo = DEFAULT_REPO, ghRunner = defaultGhRunner, guidanceDir = DEFAULT_GUIDANCE_DIR, outPath, excludeApplied = false }) {
```

Add an `excludedApplied` counter before the loop:

```js
  const records = [];
  let excludedApplied = 0;
```

Inside the loop, right after the existing label-exclusion `continue` (the `if (names.includes(EXCLUDE_TYPE) || names.includes(EXCLUDE_STATUS)) continue;` line), add the applied check:

```js
    if (excludeApplied && isIssueApplied({ number: i.number, repo, ghRunner })) {
      excludedApplied += 1;
      continue;
    }
```

(c) Add `excludedApplied` to the return object:

```js
  return { count: records.filter((r) => !r.needsTriage).length, needsTriage: records.filter((r) => r.needsTriage).length, excludedApplied, path: outPath, records };
```

(d) Wire the CLI flag. In `parseArgv`, add a local and a case, and return it:

```js
function parseArgv(argv) {
  const filter = {}; let outPath = null; let guidanceDir = DEFAULT_GUIDANCE_DIR; let excludeApplied = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") filter.all = true;
    else if (a === "--severity") filter.severity = argv[++i];
    else if (a === "--type") filter.type = argv[++i];
    else if (a === "--label") filter.label = argv[++i];
    else if (a === "--issues") filter.issues = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--out") outPath = argv[++i];
    else if (a === "--guidance-dir") guidanceDir = argv[++i];
    else if (a === "--exclude-applied") excludeApplied = true;
  }
  return { filter, outPath, guidanceDir, excludeApplied };
}
```

And in the CLI entrypoint, thread it:

```js
    const { filter, outPath, guidanceDir, excludeApplied } = parseArgv(process.argv.slice(2));
    const r = selectIssues({ filter, guidanceDir, outPath, excludeApplied });
    process.stdout.write(JSON.stringify({ count: r.count, needsTriage: r.needsTriage, excludedApplied: r.excludedApplied, path: r.path }, null, 2) + "\n");
```

Also update the module's top doc comment to mention the printed `excludedApplied` field and `--exclude-applied`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test .claude/skills/_common/scripts/__tests__/select-issues.test.mjs`
Expected: PASS (old + new). The existing tests pass `ghRunner` stubs that return the issue list for any call and never set `excludeApplied`, so no graphql path runs.

- [ ] **Step 5: Run the full regression net** — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/_common/scripts/select-issues.mjs .claude/skills/_common/scripts/__tests__/select-issues.test.mjs
git commit -m "$(cat <<'EOF'
fix(upstream): exclude already-applied issues on resume via linked-PR check

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: SKILL.md docs — resume passes `--exclude-applied`; idempotent lifecycle (doc-only)

**Files:**
- Modify: `.claude/skills/upstream-fix/SKILL.md` (select-issues invocation :66-72; resume bullet :85-87 and :266; Phase D :249-253)
- Modify: `.claude/skills/upstream-merge/SKILL.md` (issue-update note :147-148)

No code/tests; verify by grep + suite-still-green.

- [ ] **Step 1: upstream-fix — select-issues on resume**

In `.claude/skills/upstream-fix/SKILL.md`, the Phase-A "2. **Select issues:**" step (`:66-72`) shows the `select-issues.mjs` invocation. Append a resume note after that code block:

```markdown
   On `--resume`, add `--exclude-applied`: select-issues then asks GitHub whether
   each candidate open issue has a **linked merged PR** and drops those — so a fix
   that already landed (including merged out-of-band, where `status:applied` was
   never set by the skill) is not re-selected. The printed `excludedApplied` count
   reports how many were dropped.
```

- [ ] **Step 2: upstream-fix — tighten the resume bullet**

The resume note at `:85-87` currently says issues already `status:applied` are skipped by the scheduler. Extend it to mention the out-of-band guard:

```markdown
   On `--resume`, skip init — the ledger already exists; issues already
   `status:applied` are skipped by the scheduler, and selection additionally
   drops any open issue with a linked merged PR (`--exclude-applied`), covering
   fixes merged outside the skill.
```

And the Flags entry at `:266`:

```markdown
- `--resume` — idempotent re-run from the ledger; skips `status:applied` and
  (via `--exclude-applied` selection) any issue with a linked merged PR.
```

- [ ] **Step 3: upstream-fix — note idempotent Phase D**

After the Phase-D "Applied" code block (`:252`, the line `Set ledger issue status \`applied\`.`), add:

```markdown
   `issue-update.mjs` is idempotent: a re-run skips the duplicate "Applied in …"
   comment and does not re-close an already-closed issue (it reports
   `comment-skipped` / `close-skipped`), so resuming Phase D never throws or
   double-comments.
```

- [ ] **Step 4: upstream-merge — idempotent note**

In `.claude/skills/upstream-merge/SKILL.md`, after the `issue-update.mjs … --comment "Merged in <mergeSha>." --close` block (`:147-148`), add:

```markdown
   This is idempotent — re-running skips the duplicate "Merged in …" comment and
   will not re-close an already-closed issue.
```

- [ ] **Step 5: Verify**

Run: `grep -n "exclude-applied\|excludedApplied\|comment-skipped\|linked merged PR\|idempotent" .claude/skills/upstream-fix/SKILL.md .claude/skills/upstream-merge/SKILL.md`
Expected: the new prose present in both files.

Run the full regression net (no code changed) — expected 0 fail.

- [ ] **Step 6: Commit**

```bash
git add -f .claude/skills/upstream-fix/SKILL.md .claude/skills/upstream-merge/SKILL.md
git commit -m "$(cat <<'EOF'
docs(upstream): resume passes --exclude-applied; document idempotent issue-update

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Final verification + branch finalize

**Files:** none (verification only)

- [ ] **Step 1: Run the complete skill suite** (full glob from Pre-flight). Expected: 358 baseline + new Phase-3 tests, 0 fail.

- [ ] **Step 2: Grep the invariants**

Run: `grep -rn "import.*\.\./\.\./upstream-\(fix\|merge\|swarm\|cherry-pick\)/scripts" .claude/skills/*/scripts/*.mjs`
Expected: no PRODUCTION cross-skill imports (Phase 1 invariant; integration test files may legitimately import across skills — ignore `__tests__/` hits).

Run: `grep -n "comment-skipped\|close-skipped" .claude/skills/_common/scripts/issue-update.mjs` — confirm the no-op paths exist.
Run: `grep -n "excludeApplied\|isIssueApplied" .claude/skills/_common/scripts/select-issues.mjs` — confirm the guard is wired.

- [ ] **Step 3: Finalize the branch**

Use `superpowers:finishing-a-development-branch`. Per the established per-phase workflow (Phase 0+1 → `0cf2b583`, Phase 2 → `a9ebe2f4`, both `--no-ff` merges to `main`), merge `feat/upstream-hardening-phase-3` to `main` with `--no-ff`. Confirm with Corey if a PR is preferred instead.

- [ ] **Step 4: Update the memory file**

Update `project_upstream_pipeline_hardening.md`: mark Phase 3 DONE (commit sha, final suite count) and record the two fixes + the decision (GitHub linked-PR check for the resume guard; exact-body match for comment dedup). Note Phase 4 (scaling) is next.

---

## Self-Review (run before execution)

**Spec coverage (§3):**
- §3.1 Idempotent issue lifecycle — duplicate comment is the real defect; skip-if-already-commented; skip redundant close; never exit non-zero on already-applied → Task 1 (`comment-skipped`/`close-skipped`, best-effort precheck, test "re-run against already-closed succeeds as no-op, no second comment"). ✅
- §3.2 `status:applied` resume gap — guard so resume does not re-fix already-merged issues, incl. out-of-band → Task 2 (`excludeApplied` + GitHub linked-merged-PR check; test "issue whose PR merged out-of-band is excluded"). ✅
- Items explicitly NOT in this phase (merge re-gate-on-resume, rebase classifier) — absent from the plan. ✅

**Decision baked in:** GitHub linked-PR check (chosen over local-ledger / reference-scan) — authoritative for out-of-band merges, DI-stubbed in tests, fail-open so a failed check never skips unmerged work.

**Placeholder scan:** every code step has full source; doc steps have exact insertion text + grep verification. No TBD/TODO.

**Type consistency:** `updateIssue` returns `{number, actions}` with new action tokens `comment-skipped`/`close-skipped`. `selectIssues` returns the existing shape plus `excludedApplied`. New exports `buildAppliedCheckArgs` / `parseAppliedFromGraphql` / `isIssueApplied` are used identically across Task 2's code and tests. CLI flag is `--exclude-applied` everywhere.

**Watch-points for the executor:**
- Task 1: the pre-check must run ONLY when `comment || close` (label-only calls must make no `view` request — a test asserts this). `gh --json state` returns uppercase `"OPEN"/"CLOSED"`.
- Task 2: keep the applied check AFTER the label-exclusion `continue` so dropped issues cost no graphql call; the check must fail-open (a thrown ghRunner must not exclude). Confirm `gh api graphql -F num=<n>` sends an integer (gh `-F` does typed coercion) so the `Int!` variable binds.
- Task 2: the existing select-issues tests use a bare `ghRunner = () => JSON.stringify(fakeIssues)` — they must remain green because they don't set `excludeApplied` (no graphql path). Do not change them.
