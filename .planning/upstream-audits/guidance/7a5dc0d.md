verdict: manual-port

# 7a5dc0d — feat(coding-agent): Export convertToPng for extensions

## Target file(s)
packages/pi-coding-agent/src/index.ts
(source already present: packages/pi-coding-agent/src/utils/image-convert.ts exports `convertToPng`)

## Divergence
Minor divergence. The change is a single added re-export line. Upstream adds it right after the `image-resize` export, but otto's index.ts does NOT export `image-resize` at all and uses `.js` extension specifiers. The nearby anchor that does exist is the clipboard/frontmatter export block (`export { parseFrontmatter, stripFrontmatter } from "./utils/frontmatter.js";` at ~line 422). `convertToPng` is confirmed exported from `./utils/image-convert.ts`.

## Concrete edits
Add to packages/pi-coding-agent/src/index.ts near the other utils exports (e.g. after the frontmatter export at ~line 422):
`export { convertToPng } from "./utils/image-convert.js";`
Note the `.js` specifier (otto convention), not `.ts`.

## Verdict
manual-port — trivially small but the upstream anchor line (`image-resize`) is absent and the import specifier extension differs (.js vs .ts), so it won't cherry-pick clean. One-line hand edit.
