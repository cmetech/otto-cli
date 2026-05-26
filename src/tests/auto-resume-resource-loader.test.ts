// GSD2 — Regression test: auto-mode resume resolves resource-loader.js from deployed path (#3949)
// Copyright (c) 2026 Jeremy McSpadden <jeremy@fluxlabs.net>
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { applyLoaderCliEntrypointEnv, resolveLoaderCliEntrypoint } from "../loader-entrypoint.ts";

const devCli = await import("../../scripts/dev-cli-helpers.mjs");

test("source dev CLI remains the child-process OTTO_BIN_PATH", (t) => {
  const root = mkdtempSync(join(tmpdir(), "gsd-loader-entrypoint-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const invokedLoader = join(root, "src", "loader.ts");
  const devCliPath = join(root, "scripts", "dev-cli.js");
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(devCliPath, "#!/usr/bin/env node\n");

  assert.equal(
    resolveLoaderCliEntrypoint({ workflowRoot: root, invokedBinPath: invokedLoader, existsSync }),
    resolve(devCliPath),
  );
});

test("explicit CLI path overrides the invoked source loader path", () => {
  const env = { OTTO_CLI_PATH: "/custom/otto" } as NodeJS.ProcessEnv;
  const resolved = applyLoaderCliEntrypointEnv(env, {
    workflowRoot: "/repo",
    invokedBinPath: "/repo/src/loader.ts",
    existsSync: () => true,
  });

  assert.equal(resolved, resolve("/custom/otto"));
  assert.equal(env.OTTO_BIN_PATH, resolve("/custom/otto"));
  assert.equal(env.OTTO_CLI_PATH, "/custom/otto");
});

test("dev CLI wrapper passes itself as every child-process CLI entrypoint", () => {
  const preflight = devCli.buildWorkspaceBuildPreflight({ root: "/repo" });
  assert.deepEqual(preflight, {
    command: process.execPath,
    args: ["/repo/scripts/ensure-workspace-builds.cjs"],
    options: {
      cwd: "/repo",
      stdio: "inherit",
      timeout: 120_000,
    },
  });

  const env = devCli.buildDevCliChildEnv({ PATH: "/usr/bin" }, "/repo/scripts/dev-cli.js");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.OTTO_DEV_CLI_PATH, "/repo/scripts/dev-cli.js");
  assert.equal(env.OTTO_CLI_PATH, "/repo/scripts/dev-cli.js");
  assert.equal(env.OTTO_BIN_PATH, "/repo/scripts/dev-cli.js");

  assert.deepEqual(
    devCli.buildDevCliSpawnArgs({
      resolveTsPath: "/repo/src/resources/extensions/workflow/tests/resolve-ts.mjs",
      srcLoaderPath: "/repo/src/loader.ts",
      argv: ["--print", "hello"],
    }),
    [
      "--import",
      "/repo/src/resources/extensions/workflow/tests/resolve-ts.mjs",
      "--experimental-strip-types",
      "/repo/src/loader.ts",
      "--print",
      "hello",
    ],
  );
});

test("OTTO_PKG_ROOT still resolves the deployed resource-loader location", () => {
  const pkgRoot = process.cwd();
  const resourceLoaderPath = join(pkgRoot, "dist", "resource-loader.js");
  assert.equal(resourceLoaderPath, join(pkgRoot, "dist", "resource-loader.js"));
});
