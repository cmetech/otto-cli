/**
 * Tests for workflowHome() — GSD home directory resolution.
 *
 * @see https://github.com/open-gsd/gsd-pi/issues/5015
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

describe("workflowHome", () => {
  let savedWorkflowHome: string | undefined;
  let workflowHome: () => string;

  beforeEach(async () => {
    savedWorkflowHome = process.env.GSD_HOME;
    const mod = await import("../home.js");
    workflowHome = mod.workflowHome;
  });

  afterEach(() => {
    if (savedWorkflowHome !== undefined) {
      process.env.GSD_HOME = savedWorkflowHome;
    } else {
      delete process.env.GSD_HOME;
    }
  });

  it("returns ~/.gsd by default", () => {
    delete process.env.GSD_HOME;
    assert.equal(workflowHome(), join(homedir(), ".gsd"));
  });

  it("uses GSD_HOME env var when set", () => {
    process.env.GSD_HOME = "/custom/gsd/home";
    // resolve() normalizes to platform absolute path on Windows
    assert.equal(workflowHome(), resolve("/custom/gsd/home"));
  });

  it("returns a non-empty string", () => {
    assert.ok(workflowHome().length > 0);
  });
});
