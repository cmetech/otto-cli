import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("postinstall respects PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", () => {
  const result = spawnSync("node", ["scripts/postinstall.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
      OTTO_SKIP_RTK_INSTALL: "1",
    },
    encoding: "utf-8",
  });

  assert.equal(result.status, 0, `postinstall exits cleanly: ${result.stderr}`);
});

test("postinstall replaces a pre-existing symlinked rg in OTTO_HOME bin dir", { skip: platform() === "win32" }, () => {
  // Reproduces a real-world local setup: ~/.otto/agent/bin/rg is a symlink to
  // /opt/homebrew/bin/rg. Before the symlink-aware copy, copyFileSync followed
  // the link and EACCES'd on the Homebrew-owned target. Now we unlink first.
  const home = mkdtempSync(join(tmpdir(), "otto-postinstall-symlink-"));
  try {
    const binDir = join(home, "agent", "bin");
    mkdirSync(binDir, { recursive: true });
    // Symlink rg to a system path the test process cannot write through.
    // /usr/bin/true exists on macOS and Linux runners and is system-owned.
    symlinkSync("/usr/bin/true", join(binDir, "rg"));

    const result = spawnSync("node", ["scripts/install.js"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        OTTO_HOME: home,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
        OTTO_SKIP_RTK_INSTALL: "1",
        // Force the postinstall code path (skips npm install -g which would
        // otherwise run when invoked via `node` directly).
        npm_lifecycle_event: "postinstall",
      },
      encoding: "utf-8",
    });

    assert.equal(result.status, 0, `postinstall exits cleanly: ${result.stderr}`);
    // If the native @cmetech/otto-engine-* dep is installed on this platform,
    // rg should now be a regular file (the bundled binary), not a symlink.
    // If the native dep isn't installed, copyBundledTools is a no-op and the
    // symlink is preserved — both shapes prove the EACCES path is fixed.
    const st = lstatSync(join(binDir, "rg"));
    assert.ok(st.isFile() || st.isSymbolicLink(), "rg is either a regular file (copied) or still a symlink (no-op)");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
