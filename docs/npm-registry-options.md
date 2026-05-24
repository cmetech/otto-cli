# npm Registry Options for LOOP24

**Status:** decision-pending reference doc. Captures discussion from 2026-05-24 between owner and Claude (Opus 4.7) when deciding how to distribute LOOP24 via npm. Phase 7 prep is complete; Phase 7 publish is on hold pending registry choice.

---

## Where Phase 7 prep landed

- Tag: `phase-7-npm-publish-prep` (commit `52bc276`)
- `package.json` configured for `@ericsson/loop24` — name, description, keywords, bin, files, simplified `prepublishOnly`
- `scripts/install.js` templated (19 edits) so `npx @ericsson/loop24` self-describes correctly — no more `@opengsd/gsd-pi` references
- README reframed for public release with fork attribution to `open-gsd/gsd-pi`
- LOOP24-PATCHES.md leak-audited (one internal gitlab path generalized)
- Tarball verified: 11.6 MB / 6951 files / no leaks / `loop24 --version` works after install in a fresh temp dir

**What's NOT yet decided:**
- Where to publish (public npmjs.org? private GitLab/Artifactory? both?)
- Whether to publish at all yet (current install path is `git clone + ./scripts/install.sh`)

---

## Decision: public vs private vs both

Three options, picked based on audience:

| Option | Audience | Trade |
|---|---|---|
| **Public npmjs.org** | Anyone with npm | Lowest friction for outside contributors; requires claiming the `@ericsson` org on npmjs.com (likely contested as a company-style name; fallbacks: `@ericssondevops`, `@cmetech`, or unscoped `loop24` — all free at last check) |
| **Private only** (Artifactory / GitLab Package Registry / Nexus / Verdaccio / GitHub Packages) | Internal Ericsson users | Compliance-aligned; no public exposure of internal tooling; requires registry infra (Ericsson likely has Artifactory available) |
| **Both** (private as canonical, public as mirror) | Both | Sequential publishes; same tarball uploaded twice; one set of users gets it from each registry |

Current lean (as of 2026-05-24): **Artifactory** (private), based on owner's available infrastructure.

---

## Private registry comparison

| Option | Hosting | Cost | Best for |
|---|---|---|---|
| **JFrog Artifactory** | Self-hosted or JFrog Cloud | Free OSS; paid Pro from ~$98/mo | Enterprise; multi-format (npm + maven + docker + …). **Owner has access to one.** |
| **GitLab Package Registry** | GitLab-managed (incl. self-hosted GitLab) | Free tier; included in paid | Already on GitLab (Ericsson DevOps GitLab likely has this enabled per-project or per-group) |
| **Verdaccio** | Self-hosted (single Node binary or Docker) | Free / OSS | Small team or "we just need it to work" — ~10 min to stand up |
| **Sonatype Nexus** | Self-hosted | Free OSS; Pro from ~$7k/yr | Enterprise alternative to Artifactory |
| **GitHub Packages** | GitHub-managed | Free public; $4–21/user/mo private | Already on GitHub; tied to GH auth |
| **AWS CodeArtifact** | AWS-managed | Pay-per-use | Already deep in AWS |
| **npm Pro/Teams** | npmjs.com SaaS | $7/user/mo (Teams) | Want the official npm registry experience, private |

---

## How npm clients talk to a registry

An npm registry is fundamentally **(a) tarballs + (b) a JSON metadata document per package**. When `npm install <pkg>` runs:

1. `GET <registry>/<package-name>` → **packument JSON** with all versions, tarball URLs, shasums, dist-tags
2. `GET <tarball-url>` → the `.tgz`

That's it. Everything else (search, web UI, auth) is layered on top.

**Client config lives in `.npmrc`** — three knobs:

```ini
# Option A — single registry for everything (replaces npmjs.org)
registry=https://artifactory.example.com/artifactory/api/npm/npm-local/

# Option B — scope-specific registry (recommended: @ericsson goes private, others stay public)
@ericsson:registry=https://artifactory.example.com/artifactory/api/npm/npm-local/
//artifactory.example.com/artifactory/api/npm/npm-local/:_authToken=${NPM_AUTH_TOKEN}

# Option C — split-file
# project .npmrc:    scope mapping only (safe to commit)
# ~/.npmrc:          _authToken (NEVER commit; CI uses secrets)
```

For LOOP24: **Option B**, so `@ericsson/loop24` resolves privately while `@anthropic-ai/sdk` etc. still come from public npmjs.org.

---

## Multi-registry publish patterns

### Pattern 1: Sequential `npm publish` (simplest)

Run `npm publish` once per registry. Same name + version, different `--registry` each time.

```bash
# From a single packed tarball (guarantees bytes match across registries)
npm pack    # produces ericsson-loop24-1.1.0.tgz

npm publish ericsson-loop24-1.1.0.tgz \
  --registry=https://artifactory.example.com/artifactory/api/npm/npm-loop24-local/

npm publish ericsson-loop24-1.1.0.tgz \
  --registry=https://registry.npmjs.org/ --access public
```

Wrap in scripts to avoid mistakes:

```json
{
  "scripts": {
    "publish:private": "npm publish --registry=https://artifactory...",
    "publish:public":  "npm publish --access public",
    "publish:both":    "npm run publish:private && npm run publish:public"
  }
}
```

**Critical:** always publish the same tarball to both registries — don't rebuild between calls. `npm pack` once, `npm publish <tarball>` twice. Otherwise consumers see different content under the same `name@version` — extremely confusing bug surface.

### Pattern 2: Different names per registry (audience-driven)

Publish two distinct identities — e.g., `@ericsson/loop24` (private, internal users) and `loop24` (public, anyone). At publish time, rewrite the `name` field in `package.json`, then publish each. Adds maintenance overhead (two changelogs, two README quickstarts) — only use this if internal and public versions genuinely differ (e.g., internal version has credentials baked in).

### Pattern 3: Registry-side mirroring (set up once, automatic)

Some registries auto-replicate to others. Most have GOOD support for "private fetches public on demand" (inbound proxy) but POOR support for "private publishes echo out to public npm" (egress, because it's a trust-boundary one-way concern).

| Registry | Mirroring out |
|---|---|
| Verdaccio | Inbound proxy only; doesn't push back |
| JFrog Artifactory | Replication tasks (Pro feature) |
| Sonatype Nexus | Smart Proxy / scheduled tasks |
| GitLab Package Registry | No built-in; would need a CI bridge |
| AWS CodeArtifact | "Upstream" repos (inbound only) |

---

## Artifactory specifics (the path owner is leaning toward)

### Repository types — pick the right one

| Repo type | What it does |
|---|---|
| **Local npm** | Stores tarballs + auto-generates packument metadata. Speaks the npm protocol. **This is what you want for publishing.** |
| **Remote npm** | Proxy/cache to public npmjs.org |
| **Virtual npm** | Aggregates local + remote behind one URL — devs configure one registry, get both |
| **Generic** | Just a file store. No metadata generation. `npm install` won't work. |

### Three ways to get a tarball into Artifactory

**A) `npm publish` (recommended)**

```ini
# ~/.npmrc
@ericsson:registry=https://artifactory.example.com/artifactory/api/npm/npm-loop24-local/
//artifactory.example.com/artifactory/api/npm/npm-loop24-local/:_authToken=<TOKEN>
//artifactory.example.com/artifactory/api/npm/npm-loop24-local/:always-auth=true
```

```bash
npm publish
```

Under the hood: HTTP `PUT /<package-name>` with a JSON body containing base64-encoded tarball + metadata. Artifactory parses it, files the tarball, regenerates the packument.

Pros: version conflicts detected; dist-tags (`latest`, `beta`) handled atomically; same command in CI as locally; uses standard `.npmrc` auth.

**B) Direct upload via `curl -T` or `jf rt upload`**

```bash
npm pack
curl -u <user>:<api-key> -T ericsson-loop24-1.1.0.tgz \
  "https://artifactory.example.com/artifactory/api/npm/npm-loop24-local/@ericsson/loop24/-/loop24-1.1.0.tgz"
```

Or the JFrog CLI (handles indexing better):

```bash
jf rt upload ericsson-loop24-1.1.0.tgz \
  "npm-loop24-local/@ericsson/loop24/-/loop24-1.1.0.tgz" \
  --target-props "npm.name=@ericsson/loop24;npm.version=1.1.0"
```

When to use: emergency restores, scripted bulk migration from another registry, validating a tarball is structurally valid in a sandbox repo before automating the real publish. **Generally don't use this for the routine publish path** — the metadata side doesn't always update cleanly.

**C) Web UI drag-and-drop**

Log into Artifactory → navigate to the npm-local repo → **Deploy** button → drag the `.tgz`. Artifactory parses `package.json` and files it. Useful for one-off uploads or fixing a botched publish.

### Owner's open question: "Could I upload the tarball myself?"

**Short answer: yes, but use `npm publish` for the routine path.**

Long answer: an npm registry really is just storing tarballs + metadata, so direct upload IS technically equivalent. But `npm publish` handles the protocol details that direct upload doesn't:
- Atomic version-conflict detection
- Packument metadata regeneration triggered correctly
- Dist-tag (`latest`, `beta`) assignment
- Authentication that matches what every npm tool already understands

Reserve manual upload for emergency / migration / sandbox-validation scenarios.

---

## What LOOP24 changes when a registry URL is chosen

Two edits, both small:

1. **`package.json`** — add `publishConfig`:
   ```json
   "publishConfig": {
     "@ericsson:registry": "<artifactory-url>"
   }
   ```
   This means `npm publish` (no flags) goes to Artifactory by default. Add the same scripts shown in Pattern 1 above if also publishing to public.

2. **`.npmrc`** at repo root (optional, no token in it — safe to commit):
   ```ini
   @ericsson:registry=<artifactory-url>
   ```

The Phase 7 prep commit already handles the rest (package shape, fork attribution, bin/files/keywords). The registry URL is the last knob.

---

## Practical next steps (when owner is ready)

1. **Get the Artifactory npm-local repo URL + API key** from Ericsson Artifactory admin.
   - URL format: `https://<artifactory-host>/artifactory/api/npm/<repo-name>/`
   - Auth: API key or identity token (set as `_authToken`)
2. **Drop the `.npmrc` config** at `~/.npmrc` (developer machine) or CI secret (build pipeline).
3. **Add `publishConfig` to `package.json`** so `npm publish` self-routes.
4. **Test with `npm publish --dry-run`** before publishing for real.
5. **Bump version 1.0.1 → 1.1.0** (signals meaningful divergence after Phase 3-6 work) — `npm version minor --no-git-tag-version`.
6. **Publish**: `npm publish` (private only) or follow Pattern 1's `publish:both` script (private + public).
7. **Verify**: `npm view @ericsson/loop24 --registry=<artifactory-url>`; install in a clean dir; smoke `loop24 --version`.
8. **Tag**: `git tag -a phase-7-npm-publish -m "..."`.
9. **Update `LOOP24-PATCHES.md`** with the actual publish results.

---

## Risks worth knowing

- **`@ericsson` scope availability on public npmjs.org.** It was free at the 2026-05-24 check, but trademark-style company names often get reserved. If publishing public, claim it early; if it's contested, fall back to `@ericssondevops`, `@cmetech`, or unscoped `loop24`.
- **Workspace pkgs ship as files inside the tarball.** Mirrors `@opengsd/gsd-pi`'s pattern. The `@loop24/*` workspace package names are unchanged — they're loaded as files at runtime via the postinstall script, not resolved from a registry. This works for npmjs.org and Artifactory equally.
- **`scripts/validate-pack.js:155`** still hardcodes `@opengsd/gsd-pi`. Dropped from `prepublishOnly` to unblock Phase 7 prep. Fix is straightforward (read the name from `package.json`) but not done yet.
- **Phase 7 prep removed `sync-platform-versions`** from `prepublishOnly` because it references the deleted `native/scripts/` (Known Deferred Cleanups item 2). Native-platform support was dropped during Phase 0; the removed script wasn't doing anything useful for our fork.
- **Multiple registries means version drift risk.** Always publish the same tarball — `npm pack` once, `npm publish <tarball>` twice — or you get the same `name@version` serving different bytes across registries.

---

## References

- `docs/superpowers/plans/2026-05-24-loop24-phase-7-npm-publish.md` — the full Phase 7 plan
- `LOOP24-PATCHES.md` Phase 7 section — what landed in the prep commit
- `docs/superpowers/specs/2026-05-23-loop24-client-design.md` §7 — original distribution intent (internal Verdaccio/Nexus)
- `package.json` — current shape
- `scripts/install.js` — npx entry point that gets executed when `npx @ericsson/loop24` runs
