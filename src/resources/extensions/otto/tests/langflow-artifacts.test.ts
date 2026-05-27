import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveLangFlowArtifacts } from "../langflow/artifacts.js";

test("resolveLangFlowArtifacts keeps LangFlow files under .otto/langflow", () => {
  const root = "/tmp/otto-project";
  const paths = resolveLangFlowArtifacts(root);

  assert.equal(paths.root, join(root, ".otto", "langflow"));
  assert.equal(paths.generated, join(root, ".otto", "langflow", "generated"));
  assert.equal(paths.imported, join(root, ".otto", "langflow", "imported"));
  assert.equal(paths.samples, join(root, ".otto", "langflow", "samples"));
  assert.equal(paths.catalog, join(root, ".otto", "langflow", "catalog"));
  assert.equal(paths.runs, join(root, ".otto", "langflow", "runs"));
});
