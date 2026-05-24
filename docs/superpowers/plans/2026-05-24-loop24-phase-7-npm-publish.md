# LOOP24 Phase 7 — Public npm Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: AWAITING USER REVIEW.** This plan was written but not yet executed. The user opted for the "scope plan first" path; review and redirect before execution.

**Goal:** Publish LOOP24 to the public npm registry as `@ericsson/loop24` so anyone with npm can `npm install -g @ericsson/loop24` (or `npx @ericsson/loop24`) and get a working `loop24` binary. Bundles the entire workspace tree using the proven `files`-array pattern from `@opengsd/gsd-pi`.

**Architecture:** Mirror gsd-pi's published-tarball shape. `package.json` gets a `bin` entry (`loop24` → `dist/loader.js`), a `files` array (`["dist", "packages", "pkg", "src/resources", "LICENSE", "README.md"]`), a `prepublishOnly` script that runs `npm run build`, a `repository` field (deferred for now — user opted to "sort GitHub later"), and the `name` field flips from `@loop24/client` to `@ericsson/loop24`. The inherited `scripts/postinstall.js` + `scripts/install.js` (which were rebranded in earlier phases) handle install-time wiring. README and LOOP24-PATCHES.md get a quick "permanent hard fork of gsd-pi" attribution pass.

**Tech Stack:** No new TypeScript. Pure `package.json` + Markdown + bash. npm CLI ≥9 (for workspace + scope handling).

**⚠️ Pre-publish manual step (user, NOT this agent):**

Before any of these tasks can complete the actual `npm publish` step, the user needs to:

1. **Claim the `@ericsson` npm organization.** Sign in at npmjs.com, create the `@ericsson` org. (npm orgs are free for public packages.) Add the publishing user as an owner.
2. **Authenticate the local npm CLI** to that org: `npm login --scope=@ericsson --auth-type=web`.

This plan assumes those manual steps are complete before Task 7 (the actual publish). All preceding tasks (1-6) work without it and can land via commit; they're all about preparing the package for publish.

**Scope boundary:**

In scope:
- Flip `name` from `@loop24/client` to `@ericsson/loop24` across all three piConfig sites + root + dependent metadata
- Add `bin`, `files`, `prepublishOnly` to root `package.json`
- Audit `scripts/postinstall.js` + `scripts/install.js` (inherited from gsd-pi, rebranded in earlier phases) for any remaining `gsd`/`@opengsd` literals that would break a fresh public install
- Audit `LOOP24-PATCHES.md` and other docs for content that should NOT ship publicly (no actual secrets expected; flagging language/internal-host references)
- Public-ready README: reframe "internal release" + "compliance proxy" to "optional gateway routing"; add explicit "permanent hard fork of open-gsd/gsd-pi" attribution
- Dry-run publish via `npm pack` to verify tarball contents before actual publish
- Optional: live `npm publish` (requires user's manual prep steps above)
- LOOP24-PATCHES.md Phase 7 section + git tag `phase-7-npm-publish`

Out of scope (deferred):
- GitHub repo creation, CI publish workflow — user explicitly chose "publish from local; sort GitHub later"
- `repository` field with a real URL — will land when GitHub repo exists
- Republishing `@gsd/*` workspace packages under `@ericsson/*` scope — gsd-pi proved we don't need to (they ship workspace pkgs as files inside the tarball)
- npm 2FA / automation tokens — manual `npm publish` for v1
- Homebrew formula, Windows installer, auto-update
- Version-bump automation (`semantic-release`, etc.) — manual `npm version` for v1
- Public CHANGELOG generation — write one manually if needed; out of Phase 7

**Dependencies:**
- npm CLI ≥9 (bundled with Node 22+)
- `python3` + `requests` runtime dependency for `/loop24 build-flow` — documented in INSTALL.md (Phase 6); reiterated in README and the npm package description
- No new npm packages — package shape only

---

## File Structure

### Files modified

```
package.json                                           # name, version, bin, files, prepublishOnly, repository, keywords, description
packages/pi-coding-agent/package.json                  # piConfig sync if name changes
pkg/package.json                                       # piConfig sync if name changes
README.md                                              # public-ready framing, fork attribution
LOOP24-PATCHES.md                                      # Phase 7 section
scripts/postinstall.js                                 # audit for residual gsd/@opengsd literals
scripts/install.js                                     # audit for residual gsd/@opengsd literals
```

### File responsibilities (what changes per file)

| File | Change |
|---|---|
| `package.json` (root) | `name: "@ericsson/loop24"`, `description` (npm registry blurb), `bin: {"loop24": "./dist/loader.js"}`, `files: ["dist", "packages", "pkg", "src/resources", "LICENSE", "README.md"]`, `prepublishOnly: "npm run build"`, `keywords` updated, `repository` placeholder (sorted later per user choice), `engines.node` confirmed `>=22`. piConfig left alone (it's already `loop24`/`LOOP24` — the npm package name and the piConfig `name` are independent). |
| `packages/pi-coding-agent/package.json` | No piConfig change (still `loop24`). Audit `name` field for `@gsd/` — if needed to flip to `@ericsson/`, document the migration cost in Out-of-scope. Default: leave as `@gsd/pi-coding-agent` since gsd-pi proved workspace pkgs ship as files without registry presence. |
| `pkg/package.json` | Same — piConfig already aligned. No `name` change needed unless we decide workspace pkgs flip too. |
| `README.md` | Reframe overview: remove "internal release", soften "compliance proxy" to "optional gateway routing for compliance environments", add a "Fork attribution" block near top citing `open-gsd/gsd-pi`. Update install instructions to show `npm install -g @ericsson/loop24` as the primary path; clone+install.sh as alternative. |
| `LOOP24-PATCHES.md` | New Phase 7 section: what shipped, the inherited tarball shape, the workspace-pkg "ships as files" approach, the deferred GitHub repo / `repository` URL. |
| `scripts/postinstall.js`, `scripts/install.js` | Audit-only. Inherited from gsd-pi; rebranded incrementally across phases. If they still reference `@opengsd` or `gsd-pi`, fix in this phase so the public install works. |

---

## Task 1: Inspect inherited postinstall + install scripts

**Files:**
- Audit: `scripts/postinstall.js`
- Audit: `scripts/install.js`

These scripts run when someone `npm install -g @ericsson/loop24`. They handle binary symlinking on platforms where npm's default bin-linking is unreliable, plus first-run setup hints. They were inherited from gsd-pi. They may reference `@opengsd/gsd-pi` or `gsd` in user-visible output. Audit before publish.

- [ ] **Step 1: Read both scripts**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
wc -l scripts/postinstall.js scripts/install.js
cat scripts/postinstall.js
echo "---"
cat scripts/install.js
```

- [ ] **Step 2: Inventory residual `gsd`/`@opengsd`/`gsd-pi` references**

```bash
grep -nE "gsd|opengsd|GSD" scripts/postinstall.js scripts/install.js | head -30
```

Categorize each hit as one of:
1. **User-visible string** (notify, console.log, throw new Error) → fix (template to BRAND/COMMAND_NAMESPACE/package name)
2. **Internal identifier** (function name, var name, file path that matches our renamed dirs) → leave per Known Deferred Cleanups item 7
3. **Comment / JSDoc** → leave per item 8

- [ ] **Step 3: Apply fixes for user-visible category 1 only**

Reads brand strings either from `package.json` (the way `src/help-text.ts` does it — synchronous JSON.parse at module load) or from `process.env`. Match whichever pattern these scripts already use; don't introduce a new one.

If there's nothing user-visible to fix, this task is a pure audit + a documentation note in the LOOP24-PATCHES.md write-up.

- [ ] **Step 4: Verify `npm install` still succeeds**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm install 2>&1 | tail -10
```

Expected: no errors. The postinstall script runs as part of `npm install` so a broken script surfaces here.

- [ ] **Step 5: Stage (do NOT commit)**

If anything changed:
```bash
git add scripts/postinstall.js scripts/install.js
git status --short
```

If nothing changed, skip — note "audit-only, no edits needed" in the report.

---

## Task 2: Add `bin`, `files`, `prepublishOnly` to root `package.json`

**Files:**
- Modify: `package.json` (root)

The four core fields that turn the repo into a publishable npm package.

- [ ] **Step 1: Read the current package.json**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
cat package.json | python3 -m json.tool > /tmp/pj.json && head -80 /tmp/pj.json
```

Note the existing `scripts` block (we'll add `prepublishOnly` to it) and where `bin` / `files` would slot in if absent.

- [ ] **Step 2: Add the four fields**

Edits to `package.json` (use the `Edit` tool, not a full rewrite — preserves other fields like `workspaces`, `engines`, `piConfig`):

1. **Update `name`:** flip from `"@loop24/client"` to `"@ericsson/loop24"`.
2. **Update `description`:** replace whatever's there (or add if absent) with: `"Terminal-based developer chat assistant. Permanent hard fork of gsd-pi with LangFlow flow triggers, a flow builder, and optional gateway routing for compliance environments."`.
3. **Add `bin` after `description`:**
   ```json
   "bin": {
     "loop24": "./dist/loader.js"
   },
   ```
4. **Add `files`** (insert near `bin`):
   ```json
   "files": [
     "dist",
     "packages",
     "pkg",
     "src/resources",
     "scripts",
     "LICENSE",
     "README.md"
   ],
   ```
5. **Add `prepublishOnly`** to the existing `scripts` block:
   ```json
   "prepublishOnly": "npm run build",
   ```

6. **Add `keywords`** (insert before `dependencies`):
   ```json
   "keywords": [
     "ai",
     "agent",
     "cli",
     "terminal",
     "langflow",
     "anthropic",
     "claude",
     "compliance",
     "developer-tools"
   ],
   ```

7. **Update `homepage`/`repository`:**
   - If missing or pointing at `open-gsd/gsd-pi`, set to a placeholder + comment:
     ```json
     "homepage": "https://github.com/PLACEHOLDER-cmetech/loop24-client",
     "bugs": "https://github.com/PLACEHOLDER-cmetech/loop24-client/issues",
     "repository": {
       "type": "git",
       "url": "git+https://github.com/PLACEHOLDER-cmetech/loop24-client.git"
     },
     ```
   - The `PLACEHOLDER-` prefix makes it grep-able for the eventual GitHub-URL cutover.
   - Note in the Phase 7 LOOP24-PATCHES.md entry: real URLs land when GitHub repo lands.

- [ ] **Step 3: Verify package.json parses cleanly**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
python3 -m json.tool package.json > /dev/null && echo "valid JSON"
node -e "const pkg = require('./package.json'); console.log('name:', pkg.name); console.log('bin:', pkg.bin); console.log('files:', pkg.files);"
```

Expected: both succeed; printed name is `@ericsson/loop24`.

- [ ] **Step 4: `npm install` to make sure nothing broke**

```bash
npm install 2>&1 | tail -5
```

Expected: clean. (If npm errors on the new name format, capture and report.)

- [ ] **Step 5: Stage (do NOT commit)**

```bash
git add package.json
git status --short
```

---

## Task 3: Audit + update README for public-ready framing

**Files:**
- Modify: `README.md`

The current README (Phase 6) is LOOP24-first but still has "internal release" language. For public npm, reframe to:
- "Optional gateway routing for compliance environments" (not "your internal compliance proxy")
- Add a **Fork attribution** block citing `open-gsd/gsd-pi` and Lex Christopherson
- Primary install: `npm install -g @ericsson/loop24` (NOT clone+install.sh)
- Clone+install.sh remains as the "dev/contributor" install path

- [ ] **Step 1: Apply the edits**

Use `Edit` tool calls — preserve sections that work as-is.

1. **Top-of-file note**: After the `# LOOP24` heading, add a new block:
   ```markdown
   > **Fork attribution.** LOOP24 is a permanent hard fork of [open-gsd/gsd-pi](https://github.com/open-gsd/gsd-pi) by Lex Christopherson, used under the MIT License. See [`LICENSE`](LICENSE).
   ```

2. **Overview paragraph** — soften the gateway language:
   - Change: `"Routes every LLM token through loop24-gateway (your internal compliance proxy) when configured."`
   - To: `"Optionally routes every LLM token through a gateway URL (LOOP24_GATEWAY_URL) — useful in compliance environments where direct provider access is restricted. Falls back to direct Anthropic when no gateway is configured."`

3. **Status section** — remove "internal release" framing:
   - Change: `"v0.x — internal release. Distribution is git clone + install script (Phase 1). An internal npm registry (@loop24/client) is planned but not yet active."`
   - To: `"v0.x — early release. Install via npm or clone the repo. The CLI is functional but the public registry presence is new — please file issues if you hit anything."`

4. **Quickstart section** — invert the order:
   - New primary path:
     ```markdown
     ## Quickstart

     ### Install from npm (recommended)

     ```bash
     npm install -g @ericsson/loop24
     loop24
     ```

     ### Install from source (contributors)

     ```bash
     git clone <github-repo>/loop24-client.git
     cd loop24-client
     ./scripts/install.sh
     ```
     ```

   - `<github-repo>` is a placeholder until the public repo lands. README is the single place to update when the URL is real.

5. **License section** — already says MIT + Lex Christopherson; verify and leave.

- [ ] **Step 2: Verify all local links still resolve**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
for link in $(grep -oE "\[.+\]\([a-z][^)]+\)" README.md | sed -E 's/.*\(([^)]+)\)/\1/' | grep -v "^http"); do
  [ -e "$link" ] || echo "MISSING: $link"
done
echo "(no MISSING means all resolve)"
```

- [ ] **Step 3: Stage (do NOT commit)**

```bash
git add README.md
git status --short
```

---

## Task 4: Audit LOOP24-PATCHES.md for public-leak risks

**Files:**
- Audit: `LOOP24-PATCHES.md`

LOOP24-PATCHES.md ships in the public tarball (it's in the repo root). Audit for content that's specifically internal-flavored — e.g., references to internal hosts, gateway URLs that look private, anything that would feel weird in a public-facing artifact.

- [ ] **Step 1: Grep for likely-internal markers**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
grep -nEi "ericsson|internal|rosetta|gitlab\.|proprietary|confidential" LOOP24-PATCHES.md
```

For each hit, decide:
- If it's a generic word (`internal` as in "internal module") → leave
- If it's identifying info (a real internal host, a real internal team name) → redact or generalize

- [ ] **Step 2: Verify there are no embedded credentials, tokens, or API keys**

```bash
grep -nE "sk-ant-|sk-[A-Za-z0-9]{20,}|api[_-]?key.*[:=]['\"][A-Za-z0-9]{20,}|password.*[:=]['\"][^'\"]{6,}" LOOP24-PATCHES.md
```

Expected: zero matches. If anything turns up, redact before publish.

- [ ] **Step 3: Apply edits if needed; otherwise no-op**

If anything needs to change, edit in place. Otherwise note "no leaks found" in the report.

- [ ] **Step 4: Stage (only if edits made)**

---

## Task 5: Dry-run `npm pack` and inspect the tarball

**Files:** none (verification step)

`npm pack` builds the same tarball that `npm publish` would upload, but writes it to disk. Inspecting it before actual publish catches mistakes (missing files, accidentally-included internal docs, oversized tarball).

- [ ] **Step 1: Run `npm pack`**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm pack --dry-run 2>&1 | tail -50
```

The dry-run prints the file list and total size without writing a tarball. Expected: includes `dist/`, `packages/`, `pkg/`, `src/resources/`, `scripts/`, `LICENSE`, `README.md`. Should NOT include `node_modules`, `.git`, `docs/superpowers/`, `.planning/`, the loop24-config dir.

- [ ] **Step 2: Write the tarball to disk and inspect**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm pack 2>&1 | tail -3
TARBALL=$(ls -t ericsson-loop24-*.tgz | head -1)
echo "Tarball: $TARBALL"
ls -lh "$TARBALL"
echo ""
echo "Top-level structure:"
tar tzf "$TARBALL" | awk -F/ '{print $2}' | sort -u | head -15
echo ""
echo "File count: $(tar tzf "$TARBALL" | wc -l)"
echo ""
echo "Looking for leaks (should be empty):"
tar tzf "$TARBALL" | grep -iE "\.env|\.git/|node_modules|\.planning/|docs/superpowers" | head -10
```

Expected:
- Tarball ~30-50MB (gsd-pi was 49MB at 9663 files; we're similar size)
- Top-level: dist, packages, pkg, src, scripts, LICENSE, README.md, package.json
- No `.env`, `.git/`, `node_modules`, `.planning/`, `docs/superpowers` content

- [ ] **Step 3: Test the tarball by installing locally**

```bash
TEST_DIR=$(mktemp -d -t loop24-publish-test-XXXX)
cd "$TEST_DIR"
npm install --prefix . "/Users/coreyellis/Projects/repos/local/loop24-client/$TARBALL" 2>&1 | tail -10
echo ""
echo "=== Installed binary ==="
ls -la "$TEST_DIR/node_modules/.bin/loop24" 2>&1 | head
echo ""
echo "=== Smoke ==="
"$TEST_DIR/node_modules/.bin/loop24" --version 2>&1 | head -3
"$TEST_DIR/node_modules/.bin/loop24" --help 2>&1 | head -5
echo ""
echo "=== Cleanup ==="
rm -rf "$TEST_DIR" "/Users/coreyellis/Projects/repos/local/loop24-client/$TARBALL"
```

Expected: install completes, `loop24 --version` prints `1.0.1`, `--help` prints the LOOP24 banner.

If the install fails or smoke fails, the tarball isn't ready for publish — DO NOT proceed to Task 7. Surface the failure.

- [ ] **Step 4: Stage nothing** (verification task; report results)

---

## Task 6: Commit Tasks 1-5 + write Phase 7 LOOP24-PATCHES.md section

**Files:**
- Modify: `LOOP24-PATCHES.md`

Tasks 1-5 have prepared the package. Bundle their staged changes into a single "pre-publish prep" commit, write the LOOP24-PATCHES.md entry, and stop. The actual `npm publish` happens in Task 7 only after the user has completed their manual org-claim + auth steps.

- [ ] **Step 1: Insert Phase 7 section into LOOP24-PATCHES.md**

Add between Phase 6 and Phase 5 sections (since the file goes Phase 0 → 0.6 → 1 → 2b → 2c → 3 → 4 → 5 → 6 chronologically, append after Phase 6):

```markdown
## Phase 7 — Public npm publish prep (tagged: phase-7-npm-publish-prep)

Prepares the package for `npm publish` to `@ericsson/loop24` on the public
registry. Actual publish is a manual user step (see "Publish protocol"
below) because it requires:
  1. Claiming the `@ericsson` org on npmjs.com
  2. `npm login --scope=@ericsson --auth-type=web`
  3. Choosing the version bump (`npm version patch|minor|major`)
  4. Running `npm publish --access public` from the repo root

### package.json (MODIFIED)
- `name`: `@loop24/client` → `@ericsson/loop24`
- `description`: rewritten for public registry blurb
- `bin`: `{"loop24": "./dist/loader.js"}` (NEW)
- `files`: `["dist", "packages", "pkg", "src/resources", "scripts", "LICENSE", "README.md"]` (NEW). Mirrors `@opengsd/gsd-pi`'s pattern of bundling the entire workspace as files inside the tarball rather than publishing each workspace pkg separately.
- `prepublishOnly`: `"npm run build"` (NEW) — guarantees dist is fresh before publish
- `keywords`: ai, agent, cli, terminal, langflow, anthropic, claude, compliance, developer-tools (NEW)
- `homepage`, `bugs`, `repository`: placeholder GitHub URLs with `PLACEHOLDER-` prefix; final URLs land when the public repo is created
- piConfig untouched (still `loop24`/`LOOP24` — independent of npm package name)

### scripts/postinstall.js + scripts/install.js (AUDITED)
[Fill in after Task 1 — either "no edits needed" or list of fixes]

### README.md (MODIFIED)
- Top-of-file fork attribution block citing `open-gsd/gsd-pi` and MIT license
- Overview reframed: "internal compliance proxy" → "optional gateway routing for compliance environments"
- Status: removed "internal release" language
- Quickstart: `npm install -g @ericsson/loop24` is now the primary path; clone+install.sh moved to "Install from source (contributors)"

### LOOP24-PATCHES.md (MODIFIED)
- Audited for internal-host references and embedded credentials — none found
- This section added

### Dry-run verification (Task 5)
[Fill in after Task 5 — tarball size, file count, smoke result]

### Manual publish protocol (executed outside this plan)

After this prep is committed and tagged:

```bash
# 1. One-time setup (user must do this)
# Sign in at npmjs.com, create the @ericsson org, add yourself as owner.
npm login --scope=@ericsson --auth-type=web

# 2. Bump version
npm version patch   # 1.0.1 → 1.0.2

# 3. Publish
npm publish --access public   # @scope packages default to private; --access public makes it public

# 4. Verify
npm view @ericsson/loop24
npx @ericsson/loop24 --version
```

### Deferred to a follow-up phase
- Real GitHub repository (placeholder URLs in package.json get replaced
  when the repo lands). User opted to "publish from local; sort GitHub
  later" in the Phase 7 design discussion.
- CI publish workflow (currently manual `npm publish`)
- Version-bump automation (`semantic-release` etc.)
- npm 2FA / automation tokens
- Republishing `@gsd/*` workspace packages under `@ericsson/*` scope — gsd-pi proved this is unnecessary; workspace pkgs ship as files inside the tarball
```

- [ ] **Step 2: Stage + commit**

The controller commits Tasks 1-5's staged changes plus this LOOP24-PATCHES.md update as a single coherent "phase 7 prep" commit:

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add LOOP24-PATCHES.md
git status --short    # should show package.json, README.md, LOOP24-PATCHES.md (and maybe scripts/* if Task 1 made edits)
git commit -m "$(cat <<'EOF'
chore(loop24): Phase 7 prep — package for @ericsson/loop24 publish

Mirrors @opengsd/gsd-pi's tarball shape: files-array bundling of
the entire workspace, no bundledDependencies, postinstall handles
install-time wiring.

package.json:
  - name: @loop24/client → @ericsson/loop24
  - description, keywords, homepage/bugs/repository (placeholder URLs
    until GitHub repo lands)
  - bin: {loop24: ./dist/loader.js}
  - files: [dist, packages, pkg, src/resources, scripts, LICENSE, README.md]
  - prepublishOnly: npm run build

README.md:
  - Fork attribution block (MIT, citing open-gsd/gsd-pi)
  - Reframed gateway as optional (was "internal compliance proxy")
  - Primary install path is now npm install -g @ericsson/loop24

LOOP24-PATCHES.md: Phase 7 section documenting the prep + manual
publish protocol (user must claim @ericsson org + npm login first).

piConfig (still loop24/LOOP24) untouched. Workspace pkg names
(@gsd/*) untouched — they ship as files in the tarball.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Tag `phase-7-npm-publish-prep`** (NOT the publish itself — that's Task 7)

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git tag -a phase-7-npm-publish-prep -m "Phase 7 prep complete: package.json ready for npm publish to @ericsson/loop24. Mirrors @opengsd/gsd-pi's files-array bundling pattern. README reframed for public release with fork attribution. LOOP24-PATCHES.md documents the manual publish protocol (user must claim @ericsson npm org + login before running npm publish). Workspace pkgs (@gsd/*) untouched — they ship as files in the tarball, not as separate registry entries. GitHub repo + CI publish workflow deferred per user choice ('publish from local; sort GitHub later')."
git tag -l | tail -12
```

---

## Task 7: Live publish (gated on user manual prep)

**Files:** none (runtime step)

> **Gate:** Do not run this task until the user has:
> 1. Claimed the `@ericsson` organization on npmjs.com
> 2. Run `npm login --scope=@ericsson --auth-type=web` and successfully authenticated
> 3. Confirmed they want to publish

If any of those aren't done, STOP and report BLOCKED with the user-facing summary of what they need to do.

- [ ] **Step 1: Confirm npm login state**

```bash
npm whoami --registry=https://registry.npmjs.org/ 2>&1 | head -3
npm org ls @ericsson 2>&1 | head -5   # confirms membership in the org
```

If `whoami` errors or org ls doesn't list the user, STOP — auth is not set up.

- [ ] **Step 2: Bump version**

The current version is `1.0.1` (inherited from gsd-pi via the fork). For the first public LOOP24 release, bump to `1.1.0` to signal a meaningful divergence (Phase 3-6 added flow triggers, build-flow, prompt-engineer, install.sh):

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
npm version minor --no-git-tag-version   # 1.0.1 → 1.1.0; we'll tag manually after publish
```

(Don't let `npm version` create its own tag — it conflicts with our existing tag naming convention.)

- [ ] **Step 3: Dry-run publish**

```bash
npm publish --dry-run --access public 2>&1 | tail -30
```

Inspect the output:
- Tarball name should be `ericsson-loop24-1.1.0.tgz`
- File count + size should match Task 5's dry-run
- Should announce `+ @ericsson/loop24@1.1.0` in the summary

- [ ] **Step 4: Actual publish**

```bash
npm publish --access public 2>&1 | tail -10
```

Expected: `+ @ericsson/loop24@1.1.0`. The `--access public` flag is required for scoped packages (npm defaults scoped packages to private; without `--access public` the publish fails with a paid-subscription error).

- [ ] **Step 5: Verify the published package**

```bash
sleep 10   # registry needs a few seconds to propagate
npm view @ericsson/loop24 2>&1 | head -20
echo "---"
echo "=== Install + smoke from public registry ==="
TEST_DIR=$(mktemp -d -t loop24-pub-test-XXXX)
cd "$TEST_DIR"
npm install --prefix . @ericsson/loop24 2>&1 | tail -8
"$TEST_DIR/node_modules/.bin/loop24" --version
"$TEST_DIR/node_modules/.bin/loop24" --help | head -5
echo "=== Cleanup ==="
rm -rf "$TEST_DIR"
```

Expected: `npm view` shows the published metadata; the smoke install + version + help all succeed.

- [ ] **Step 6: Commit the version bump + tag**

```bash
cd /Users/coreyellis/Projects/repos/local/loop24-client
git add package.json packages/pi-coding-agent/package.json pkg/package.json package-lock.json
git commit -m "chore(release): @ericsson/loop24@1.1.0 published to public npm

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git tag -a phase-7-npm-publish -m "Phase 7 complete: @ericsson/loop24@1.1.0 published to the public npm registry. Tarball mirrors @opengsd/gsd-pi's files-array bundling. Install: npm install -g @ericsson/loop24."
git tag -l | tail -12
git log --oneline | head -8
```

- [ ] **Step 7: Update LOOP24-PATCHES.md Phase 7 section**

Fill in the actual published version + tarball stats (file count, size, npm-published-at timestamp). One small commit:

```bash
git add LOOP24-PATCHES.md
git commit -m "docs: LOOP24-PATCHES.md — Phase 7 live publish results"
```

---

## Definition of Done

Phase 7 prep (Tasks 1-6) is complete when ALL of these are true:

- `package.json` has `name: @ericsson/loop24`, `bin`, `files`, `prepublishOnly`, `keywords`, placeholder `repository`/`homepage`/`bugs`.
- README.md reframed for public: fork attribution at top, gateway is "optional", `npm install -g @ericsson/loop24` is the primary install path.
- LOOP24-PATCHES.md audited — no leaks (no embedded credentials, no identifying internal-host references).
- `scripts/postinstall.js` + `scripts/install.js` audited; user-visible strings templated if needed.
- `npm pack --dry-run` succeeds; tarball contents reviewed; no `.git/`, `.env`, `node_modules`, `.planning/`, or `docs/superpowers/` leak in.
- `npm pack` + local install test succeeds: `loop24 --version` prints `1.0.1` (or whatever the version was at prep time), `--help` prints the banner.
- `phase-7-npm-publish-prep` tag exists.

Phase 7 publish (Task 7) is complete when ALL of these are true:

- User has manually claimed the `@ericsson` org and authenticated `npm login`.
- `npm publish --access public` succeeded for `@ericsson/loop24@1.1.0`.
- `npm view @ericsson/loop24` shows the published metadata.
- `npm install @ericsson/loop24` in a clean temp dir succeeds; smoke (`--version` + `--help`) passes.
- `phase-7-npm-publish` tag exists.
- LOOP24-PATCHES.md Phase 7 section filled in with actual publish results.

---

## Self-Review

**Spec coverage (vs design spec §7 — but reframed for public, not internal):**
- ✅ "npm install -g @loop24/client works from a properly-configured .npmrc" — reframed to "npm install -g @ericsson/loop24 works from the public registry"
- ✅ "Same source, same installer logic, packaged" — Tasks 1-2

**New scope vs original Phase 7 spec:**
- Public registry instead of internal Verdaccio/Nexus (user's redirect from §7)
- Scope is `@ericsson` not `@loop24` (user's choice — `@ericsson` is claimable and aligns with the gitlab.rosetta.ericssondevops.com origin path of the source skill)
- GitHub repo + CI deferred (user explicitly chose "publish from local; sort GitHub later" — risky for source-discoverability but the user accepted that tradeoff)

**Placeholder scan:** Two intentional placeholders that need user follow-up:
1. `PLACEHOLDER-cmetech/loop24-client` in package.json `repository`/`homepage`/`bugs` — replaced when GitHub repo lands. Grep-able by the `PLACEHOLDER-` prefix.
2. `<github-repo>` in README's "Install from source" block — same.

The LOOP24-PATCHES.md write-up has two TODO subsections that ONLY make sense after Tasks 1 and 5 run: `[Fill in after Task 1]` and `[Fill in after Task 5]`. Those are explicitly marked.

**Type consistency:** N/A (no types).

**Known risks:**

1. **`@ericsson` scope claim is a user action.** If the user can't actually register the `@ericsson` org (because they're not an Ericsson employee with permission, or because npm reserves company-style names), Phase 7 publish stalls. Fallback names: `@ericssondevops/loop24`, `@cmetech/loop24` (user's existing scope?), or unscoped `loop24` (free per our earlier check).

2. **License attribution.** LICENSE file currently says "Copyright (c) 2026 Lex Christopherson". Fork attribution preserves that. The user should NOT change this attribution. If anyone asks "why does the fork have someone else's name?", the README's "Fork attribution" block answers.

3. **`scripts/postinstall.js` semantics.** Inherited from gsd-pi. If it does anything risky (writes to `~/`, runs network calls, requires elevated permissions), the public install will surprise users. Task 1 audits this — implementer should flag anything weird, not silently accept.

4. **Workspace pkgs as files.** `@gsd/pi-coding-agent` lives in `packages/pi-coding-agent/` inside the published tarball. Node's resolver finds it via... I don't know, actually — gsd-pi's tarball shows them as files but there must be something in the postinstall or pre-built code that wires `@gsd/pi-coding-agent` → `packages/pi-coding-agent/dist/`. Task 1's audit of `scripts/postinstall.js` should clarify this. Worst case: the workspace setup relies on symlinks created at install time, and the postinstall does that.

5. **Tarball size (49MB).** Large for an npm package. Users with slow connections will feel it. Acceptable for a developer tool but worth noting.

6. **No CHANGELOG.** First public release should arguably have one. Out of Phase 7 scope per the user; future Phase 7.1 if requested.

7. **`prepublishOnly: npm run build`** runs every time. If the build fails, publish fails — which is the correct behavior. But it means publish is slow (~30-90s of npm run build before the upload).

---

*End of Phase 7 plan.*
