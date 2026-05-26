#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = pkg.version;
const optionalDependencies = pkg.optionalDependencies ?? {};
const enginePackages = Object.keys(optionalDependencies)
  .filter((name) => name.startsWith("@opengsd/engine-"))
  .sort();

if (enginePackages.length === 0) {
  process.stderr.write("ERROR: no @opengsd/engine-* optionalDependencies found\n");
  process.exit(1);
}

const allowAnyVersion = process.argv.includes("--any-version");
const missing = [];
const NPM_VIEW_TIMEOUT_MS = 30_000;

function viewPackageVersion(spec) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const result = spawnSync("npm", ["view", spec, "version"], {
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: NPM_VIEW_TIMEOUT_MS,
    });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
    if (result.error?.code !== "ETIMEDOUT") {
      return "";
    }
    process.stderr.write(`WARN: npm view timed out for ${spec}; retrying (${attempt}/2)\n`);
  }
  return "";
}

for (const name of enginePackages) {
  const spec = allowAnyVersion ? name : `${name}@${version}`;
  const packageVersion = viewPackageVersion(spec);

  if (packageVersion) {
    process.stdout.write(`verified ${spec}: ${packageVersion}\n`);
    continue;
  }

  missing.push(spec);
}

// DuckDB native bindings are third-party-published optional dependencies of
// @duckdb/node-api. They must still be resolvable from the publish registry or
// enterprise mirror for every platform OTTO supports.
const duckdbBindings = [
  "@duckdb/node-bindings-darwin-arm64",
  "@duckdb/node-bindings-darwin-x64",
  "@duckdb/node-bindings-linux-arm64",
  "@duckdb/node-bindings-linux-arm64-musl",
  "@duckdb/node-bindings-linux-x64",
  "@duckdb/node-bindings-linux-x64-musl",
  "@duckdb/node-bindings-win32-arm64",
  "@duckdb/node-bindings-win32-x64",
];

for (const name of duckdbBindings) {
  const packageVersion = viewPackageVersion(name);

  if (packageVersion) {
    process.stdout.write(`verified ${name}: ${packageVersion}\n`);
    continue;
  }

  missing.push(name);
}

if (missing.length === 0) {
  process.stdout.write("Native platform package verification passed.\n");
  process.exit(0);
}

process.stderr.write("ERROR: missing native platform packages on npm:\n");
for (const spec of missing) {
  process.stderr.write(`  - ${spec}\n`);
}
process.stderr.write(
  allowAnyVersion
    ? "Publish the missing @opengsd/engine-* packages before publishing @cmetech/otto.\n"
    : "Run the native binary publish workflow for this version before publishing @cmetech/otto.\n",
);
process.exit(1);
