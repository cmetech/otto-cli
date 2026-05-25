import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveSkillPaths, EXCAVATE_SKILLS } from "../paths.js";

describe("resolveSkillPaths", () => {
  it("maps every excavate skill to <root>/<name>/SKILL.md", () => {
    const root = "/tmp/skills";
    const paths = resolveSkillPaths(root);
    assert.equal(Object.keys(paths).length, EXCAVATE_SKILLS.length);
    assert.equal(paths["excavate-source-analysis"], join(root, "excavate-source-analysis", "SKILL.md"));
    assert.equal(paths["excavate-validation"], join(root, "excavate-validation", "SKILL.md"));
  });
  it("lists exactly the five core-slice skills", () => {
    assert.deepEqual([...EXCAVATE_SKILLS].sort(), [
      "excavate-provenance", "excavate-source-analysis", "excavate-spec-writing",
      "excavate-synthesis", "excavate-validation",
    ]);
  });
});
