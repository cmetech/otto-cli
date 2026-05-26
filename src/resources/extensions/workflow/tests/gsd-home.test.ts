/**
 * Tests for workflowHome() — OTTO home directory resolution.
 *
 * @see https://github.com/open-gsd/otto-pi/issues/5015
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

describe("workflowHome", () => {
  let savedWorkflowHome: string | undefined;
  let workflowHome: () => string;

  beforeEach(async () => {
    savedWorkflowHome = process.env.OTTO_HOME;
    const mod = await import("../home.js");
    workflowHome = mod.workflowHome;
  });

  afterEach(() => {
    if (savedWorkflowHome !== undefined) {
      process.env.OTTO_HOME = savedWorkflowHome;
    } else {
      delete process.env.OTTO_HOME;
    }
  });

  it("returns ~/.otto by default", () => {
    delete process.env.OTTO_HOME;
    assert.equal(workflowHome(), join(homedir(), ".otto"));
  });

  it("uses OTTO_HOME env var when set", () => {
    process.env.OTTO_HOME = "/custom/otto/home";
    // resolve() normalizes to platform absolute path on Windows
    assert.equal(workflowHome(), resolve("/custom/otto/home"));
  });

  it("returns a non-empty string", () => {
    assert.ok(workflowHome().length > 0);
  });
});
