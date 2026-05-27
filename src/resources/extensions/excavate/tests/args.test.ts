import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseExcavateArgs } from "../args.js";

describe("parseExcavateArgs", () => {
  it("parses a bare target path with the default workspace", () => {
    assert.deepEqual(parseExcavateArgs("./repo"), {
      ok: true, target: "./repo", workspace: "./.otto/excavate",
    });
  });
  it("honors --workspace override (space form)", () => {
    assert.deepEqual(parseExcavateArgs("./repo --workspace ./out"), {
      ok: true, target: "./repo", workspace: "./out",
    });
  });
  it("honors --workspace=VALUE (equals form)", () => {
    assert.deepEqual(parseExcavateArgs("./repo --workspace=./out"), {
      ok: true, target: "./repo", workspace: "./out",
    });
  });
  it("errors when no target is given", () => {
    const r = parseExcavateArgs("");
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /target path/i);
  });
  it("allows a missing target when the command layer will infer the current Git repository", () => {
    assert.deepEqual(parseExcavateArgs("", { allowMissingTarget: true }), {
      ok: true, target: "", workspace: "./.otto/excavate",
    });
  });
  it("errors when --workspace has no value", () => {
    const r = parseExcavateArgs("./repo --workspace");
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /--workspace/);
  });
});
