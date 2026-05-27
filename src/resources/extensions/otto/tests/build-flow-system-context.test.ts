import { test } from "node:test";
import assert from "node:assert/strict";
import { loadReferenceDocs, REFERENCE_DOC_NAMES } from "../commands/build-flow/_system-context.js";

test("REFERENCE_DOC_NAMES lists the four expected files in load order", () => {
  assert.deepEqual([...REFERENCE_DOC_NAMES], [
    "workflow.md",
    "component-catalog-rules.md",
    "edge-handle-rules.md",
    "flow-json-rules.md",
  ]);
});

test("loadReferenceDocs concatenates all four docs with file-header banners", async () => {
  const text = await loadReferenceDocs();
  // Each doc should contribute a header banner naming the file.
  for (const name of REFERENCE_DOC_NAMES) {
    assert.ok(text.includes(name), `expected concatenated text to reference ${name}`);
  }
  // The full text is non-trivial in length (every doc is ~5-10KB).
  assert.ok(text.length > 10_000, `expected >10KB of context, got ${text.length} bytes`);
});

test("loadReferenceDocs includes robust flow compliance guidance", async () => {
  const text = await loadReferenceDocs();

  assert.match(text, /Flow compliance checklist/i);
  assert.match(text, /valid user-entry path/i);
  assert.match(text, /terminal output path/i);
  assert.match(text, /Chat Output must be connected/i);
  assert.match(text, /ChatOutput `input_value` is usually a `HandleInput`/i);
  assert.match(text, /Do not generate a ChatOutput target handle with `type: "str"`/i);
  assert.match(text, /If Langflow imports the flow but reports that connections were removed/i);
  assert.match(text, /failure handling/i);
  assert.match(text, /validate and repair/i);
});

test("loadReferenceDocs throws a clear error when a doc is missing (path override)", async () => {
  await assert.rejects(
    () => loadReferenceDocs("/nonexistent/path/to/reference"),
    (err: Error) => /reference.*not found|ENOENT/i.test(err.message),
  );
});
