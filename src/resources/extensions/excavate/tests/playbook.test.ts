import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPlaybook } from "../playbook.js";
import { resolveSkillPaths } from "../paths.js";

describe("buildPlaybook", () => {
  const playbook = buildPlaybook({
    target: "/repo",
    workspace: "./analysis-workspace",
    skillPaths: resolveSkillPaths("/tmp/skills"),
  });

  it("embeds the target and workspace", () => {
    assert.match(playbook, /\/repo/);
    assert.match(playbook, /\.\/analysis-workspace/);
  });
  it("references each bundled skill path", () => {
    assert.match(playbook, /\/tmp\/skills\/excavate-source-analysis\/SKILL\.md/);
    assert.match(playbook, /\/tmp\/skills\/excavate-spec-writing\/SKILL\.md/);
    assert.match(playbook, /\/tmp\/skills\/excavate-provenance\/SKILL\.md/);
  });
  it("instructs general-purpose dispatch with a batch cap of 4", () => {
    assert.match(playbook, /general-purpose/);
    assert.match(playbook, /\b4\b/);
  });
  it("requires provenance citations and names the core stages", () => {
    assert.match(playbook, /<!-- cite:/);
    assert.match(playbook, /module-map/i);
    assert.match(playbook, /journeys/i);
    assert.match(playbook, /contracts/i);
    assert.match(playbook, /verification-report/i);
  });
  it("includes the L4 test-vectors + acceptance-criteria stage", () => {
    assert.match(playbook, /raw\/specs\/test-vectors/);
    assert.match(playbook, /raw\/specs\/validation\/acceptance-criteria/);
    assert.match(playbook, /test-vector-generator/);
    assert.match(playbook, /acceptance-criteria-writer/);
    assert.match(playbook, /AC-\{DOMAIN\}-\{NNN\}/);
  });
});
