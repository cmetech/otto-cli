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
    assert.match(playbook, /gate-1-report/i);
  });
  it("includes the L4 test-vectors + acceptance-criteria stage", () => {
    assert.match(playbook, /raw\/specs\/test-vectors/);
    assert.match(playbook, /raw\/specs\/validation\/acceptance-criteria/);
    assert.match(playbook, /test-vector-generator/);
    assert.match(playbook, /acceptance-criteria-writer/);
    assert.match(playbook, /AC-\{DOMAIN\}-\{NNN\}/);
  });
  it("runs two blocking gates with remediation loops", () => {
    assert.match(playbook, /Gate 1/);
    assert.match(playbook, /Gate 2/);
    assert.match(playbook, /raw\/specs\/gate-1-report\.md/);
    assert.match(playbook, /raw\/specs\/gate-2-report\.md/);
    assert.match(playbook, /spec-remediator/);
    assert.match(playbook, /ac-remediator/);
    assert.match(playbook, /3 remediation rounds/i);
    assert.match(playbook, /BLOCKED/);
    assert.match(playbook, /contradiction/i);
    assert.match(playbook, /implementation leakage/i);
    // Gate 1 precedes the test-vector stage; Gate 2 follows it.
    assert.ok(playbook.indexOf("Gate 1") < playbook.indexOf("test-vector-generator"));
    assert.ok(playbook.indexOf("test-vector-generator") < playbook.indexOf("Gate 2"));
  });
  it("can disable Git checkpointing and use provenance stage logs instead", () => {
    const noGitPlaybook = buildPlaybook({
      target: "/repo",
      workspace: "./analysis-workspace",
      skillPaths: resolveSkillPaths("/tmp/skills"),
      gitMode: "no-git",
    });

    assert.match(noGitPlaybook, /Git is NOT available/);
    assert.match(noGitPlaybook, /provenance\/stage-log\.jsonl/);
    assert.match(noGitPlaybook, /git_mode: "no-git"/);
    assert.doesNotMatch(noGitPlaybook, /git init -q/);
    assert.doesNotMatch(noGitPlaybook, /run `git add`/);
    assert.doesNotMatch(noGitPlaybook, /run `git commit`/);
  });
});
