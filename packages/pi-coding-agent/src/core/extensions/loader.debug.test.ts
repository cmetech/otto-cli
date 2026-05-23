import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"

const ORIGINAL_ENV = process.env.LOOP24_DEBUG_EXTENSIONS
const ORIGINAL_STDERR_WRITE = process.stderr.write.bind(process.stderr)

let captured: string[] = []

beforeEach(() => {
  captured = []
  process.stderr.write = ((chunk: string | Uint8Array) => {
    captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"))
    return true
  }) as typeof process.stderr.write
})

afterEach(() => {
  process.stderr.write = ORIGINAL_STDERR_WRITE
  if (ORIGINAL_ENV === undefined) delete process.env.LOOP24_DEBUG_EXTENSIONS
  else process.env.LOOP24_DEBUG_EXTENSIONS = ORIGINAL_ENV
})

test("LOOP24_DEBUG_EXTENSIONS=1 emits a registration line per pi.registerCommand call", async () => {
  process.env.LOOP24_DEBUG_EXTENSIONS = "1"

  // Import the loader fresh (after env var is set). Use a dynamic import to
  // get a clean reference and call createExtensionAPI directly.
  const loaderModule = await import("./loader.js")
  // We exercise this by constructing an extension + api the same way loadExtension does.
  // The loader doesn't export createExtensionAPI by default — see Step 3 for the export.
  const { createExtensionAPI, createExtension } = loaderModule as unknown as {
    createExtensionAPI: (ext: unknown, runtime: unknown, cwd: string, eventBus: unknown) => { registerCommand: (n: string, o: { handler: () => void }) => void }
    createExtension: (path: string, resolved: string) => unknown
  }

  const fakeRuntime = {
    refreshTools: () => {},
    pendingProviderRegistrations: [],
  }
  const fakeEventBus = { emit: () => {}, on: () => {} }
  const extension = createExtension("/fake/ext.js", "/fake/ext.js")
  const api = createExtensionAPI(extension, fakeRuntime, "/tmp", fakeEventBus)

  api.registerCommand("loop24", { handler: () => {} })

  const text = captured.join("")
  assert.match(text, /\[loop24-debug\] registered command 'loop24'/)
  assert.match(text, /\/fake\/ext\.js/)
})

test("LOOP24_DEBUG_EXTENSIONS unset → no debug output", async () => {
  delete process.env.LOOP24_DEBUG_EXTENSIONS

  const loaderModule = await import("./loader.js")
  const { createExtensionAPI, createExtension } = loaderModule as unknown as {
    createExtensionAPI: (ext: unknown, runtime: unknown, cwd: string, eventBus: unknown) => { registerCommand: (n: string, o: { handler: () => void }) => void }
    createExtension: (path: string, resolved: string) => unknown
  }
  const fakeRuntime = { refreshTools: () => {}, pendingProviderRegistrations: [] }
  const fakeEventBus = { emit: () => {}, on: () => {} }
  const extension = createExtension("/fake/ext2.js", "/fake/ext2.js")
  const api = createExtensionAPI(extension, fakeRuntime, "/tmp", fakeEventBus)

  api.registerCommand("test", { handler: () => {} })

  const text = captured.join("")
  assert.equal(text, "", "no debug output should appear when env var is unset")
})
