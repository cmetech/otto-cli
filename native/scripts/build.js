#!/usr/bin/env node

/**
 * Build script for the OTTO native Rust addon.
 *
 * Usage:
 *   node native/scripts/build.js          # release build
 *   node native/scripts/build.js --dev    # debug build
 *
 * Runs `cargo build` in the engine crate directory and copies the resulting
 * shared library to `native/addon/` with a `.node` extension so Node.js
 * can load it via `require()`.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeRoot = path.resolve(__dirname, "..");
const engineDir = path.join(nativeRoot, "crates", "engine");
const addonDir = path.join(nativeRoot, "addon");

const isDev = process.argv.includes("--dev");
const profile = isDev ? "debug" : "release";
const cargoArgs = ["build"];
if (!isDev) cargoArgs.push("--release");

function findCargo() {
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const executableName = process.platform === "win32" ? "cargo.exe" : "cargo";
  const candidates = [
    ...pathEntries.map((entry) => path.join(entry, executableName)),
    path.join(os.homedir(), ".cargo", "bin", executableName),
  ];

  const rustupHome = process.env.RUSTUP_HOME || path.join(os.homedir(), ".rustup");
  const toolchainsDir = path.join(rustupHome, "toolchains");
  if (fs.existsSync(toolchainsDir)) {
    for (const toolchain of fs.readdirSync(toolchainsDir)) {
      candidates.push(path.join(toolchainsDir, toolchain, "bin", executableName));
    }
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || executableName;
}

console.log(`Building otto-engine (${profile})...`);

const cargo = findCargo();
const cargoBinDir = path.dirname(cargo);
const result = spawnSync(cargo, cargoArgs, {
  cwd: engineDir,
  stdio: "inherit",
  env: {
    ...process.env,
    PATH: [cargoBinDir, process.env.PATH].filter(Boolean).join(path.delimiter),
    // Optimize for native CPU when building locally
    RUSTFLAGS: process.env.RUSTFLAGS || "-C target-cpu=native",
  },
});

if (result.error || result.status !== 0) {
  if (result.error) {
    console.error(`Failed to run cargo: ${result.error.message}`);
  }
  process.exit(1);
}

// Locate the built library
const cargoTargetRoot = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(nativeRoot, "target");

const targetDir = path.join(cargoTargetRoot, profile);
const platformTag = `${process.platform}-${process.arch}`;

const libraryNames = {
  darwin: "libgsd_engine.dylib",
  linux: "libgsd_engine.so",
  win32: "gsd_engine.dll",
};

const libName = libraryNames[process.platform];
if (!libName) {
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}

const sourcePath = path.join(targetDir, libName);
if (!fs.existsSync(sourcePath)) {
  console.error(`Built library not found at: ${sourcePath}`);
  process.exit(1);
}

fs.mkdirSync(addonDir, { recursive: true });

const destFilename = isDev
  ? "otto_engine.dev.node"
  : `otto_engine.${platformTag}.node`;
const destPath = path.join(addonDir, destFilename);

fs.copyFileSync(sourcePath, destPath);
console.log(`Installed: ${destPath}`);
console.log("Build complete.");
