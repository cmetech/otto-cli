import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initScaffold } from "../init-scaffold.mjs";

test("nonInteractive writes config + state + creates labels", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-init-"));
  try {
    const ghCalls = [];
    const ghRunner = (args) => {
      ghCalls.push(args);
      if (args[0] === "label" && args[1] === "list") return "";
      if (args[0] === "label" && args[1] === "create") return "";
      return "";
    };
    const result = await initScaffold({
      cwd: dir,
      nonInteractive: true,
      ghRunner,
    });
    // Config written
    const configPath = join(dir, ".planning", "upstream-sync-config.json");
    assert.ok(existsSync(configPath));
    const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
    assert.equal(cfg.targetRepo, "cmetech/otto-cli");
    assert.ok(cfg.upstreams["pi-dev"]);
    assert.ok(cfg.upstreams["gsd-pi"]);
    assert.equal(cfg.applicability.notApplicable.length, 5);
    // State written with starting commits
    const statePath = join(dir, ".planning", "upstream-sync-state.json");
    assert.ok(existsSync(statePath));
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    assert.equal(state.upstreams["pi-dev"].lastAnalyzedCommit, "v0.75.4");
    assert.equal(state.upstreams["gsd-pi"].lastAnalyzedCommit, "v1.0.1");
    // Labels: 27 create calls
    const createCalls = ghCalls.filter((a) => a[0] === "label" && a[1] === "create");
    assert.equal(createCalls.length, 27);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses to overwrite existing config without --overwrite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-init-"));
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(dir, ".planning"), { recursive: true });
    writeFileSync(join(dir, ".planning", "upstream-sync-config.json"), "{}");
    await assert.rejects(
      initScaffold({
        cwd: dir,
        nonInteractive: true,
        ghRunner: () => "",
      }),
      /exists|overwrite/i,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("interactive uses promptUser injection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-init-"));
  try {
    const prompts = [];
    const promptUser = async ({ message, default: def }) => {
      prompts.push({ message, default: def });
      // For Y/n prompts answer "y" to keep defaults; for y/N prompts answer "n" to skip
      if (message.match(/\[Y\/n\]/)) return "y";
      if (message.match(/\[y\/N\]/)) return "n";
      return def ?? "";
    };
    const ghRunner = () => "";
    await initScaffold({
      cwd: dir,
      nonInteractive: false,
      promptUser,
      ghRunner,
    });
    // Should have prompted at least for targetRepo
    assert.ok(prompts.some((p) => p.message.toLowerCase().includes("target")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("overwrite flag allows clobbering existing config", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-init-"));
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(dir, ".planning"), { recursive: true });
    writeFileSync(join(dir, ".planning", "upstream-sync-config.json"), "{}");

    const ghRunner = () => "";
    const result = await initScaffold({
      cwd: dir,
      nonInteractive: true,
      overwrite: true,
      ghRunner,
    });

    const cfg = JSON.parse(readFileSync(result.configPath, "utf-8"));
    assert.equal(cfg.targetRepo, "cmetech/otto-cli");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returned paths match written files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-init-"));
  try {
    const ghRunner = () => "";
    const result = await initScaffold({
      cwd: dir,
      nonInteractive: true,
      ghRunner,
    });
    assert.ok(existsSync(result.configPath), "configPath must exist");
    assert.ok(existsSync(result.statePath), "statePath must exist");
    assert.ok(result.labelsResult, "labelsResult must be present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("nonInteractive seeds lineage roles and the three inspiration repos", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ucp-init-"));
  try {
    const result = await initScaffold({ cwd: dir, nonInteractive: true, ghRunner: () => "" });
    const cfg = JSON.parse(readFileSync(result.configPath, "utf-8"));
    // Lineage repos carry an explicit role
    assert.equal(cfg.upstreams["pi-dev"].role, "lineage");
    assert.equal(cfg.upstreams["gsd-pi"].role, "lineage");
    // Inspiration repos are registered, reference-only
    assert.equal(cfg.upstreams["hermes-agent"].role, "inspiration");
    assert.equal(cfg.upstreams["anton"].role, "inspiration");
    assert.equal(cfg.upstreams["mempalace"].role, "inspiration");
    // State seeds lineage commits only — inspiration repos are not audited
    const state = JSON.parse(readFileSync(result.statePath, "utf-8"));
    assert.ok(state.upstreams["pi-dev"]);
    assert.ok(state.upstreams["gsd-pi"]);
    assert.equal(state.upstreams["hermes-agent"], undefined);
    assert.equal(state.upstreams["anton"], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
