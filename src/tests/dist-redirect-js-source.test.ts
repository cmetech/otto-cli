import test from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"

import { resolve as resolveWithTestLoader } from "../resources/extensions/workflow/tests/dist-redirect.mjs"

const nextResolve = async (specifier: string) => ({ url: specifier })

// Root cause (upstream 871910a): the rule that rewrites relative `.js` imports
// under `/src/` to `.ts` was unconditional, so a real JS source-of-truth file
// (e.g. installer scripts that ship as `.js`) got rewritten to a non-existent
// `.ts` and broke. The fix must probe the candidate `.ts` on disk first and
// fall through to the `.js` when no `.ts` source exists.

test("dist-redirect leaves a relative .js import unchanged when no .ts source exists", async () => {
  // parentURL is inside /src/ so the rewrite rule is active, and the specifier
  // points at a sibling that has NO .ts counterpart on disk.
  const parentURL = new URL(
    "../resources/extensions/workflow/tests/dist-redirect.mjs",
    import.meta.url,
  ).href

  const specifier = "./__definitely_missing_js_source__.js"
  const tsCandidate = fileURLToPath(new URL(specifier.replace(/\.js$/, ".ts"), parentURL))

  // Sanity: the .ts candidate genuinely does not exist.
  const { existsSync } = await import("node:fs")
  assert.equal(existsSync(tsCandidate), false, "test fixture .ts must not exist")

  const resolved = await resolveWithTestLoader(specifier, { parentURL }, nextResolve)

  assert.equal(
    resolved.url,
    specifier,
    "relative .js with no .ts source-of-truth must NOT be rewritten to .ts",
  )
})

test("dist-redirect still rewrites a relative .js import to .ts when the .ts source exists", async () => {
  // app-paths.ts exists as a real source file; the .js import from within /src/
  // must continue to be redirected to the .ts source.
  const parentURL = new URL("./resolve-ts-loader.test.ts", import.meta.url).href
  const specifier = "../app-paths.js"
  const tsCandidate = new URL(specifier.replace(/\.js$/, ".ts"), parentURL)

  const resolved = await resolveWithTestLoader(specifier, { parentURL }, nextResolve)

  assert.equal(
    resolved.url,
    tsCandidate.href,
    ".js with an existing .ts source must still be rewritten to .ts",
  )
})
