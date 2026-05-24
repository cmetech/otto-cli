import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPython, runBash, ensurePython3 } from "../tools/python-runtime.js";

function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "loop24-python-runtime-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("ensurePython3 returns interpreter info when python3 is on PATH", async () => {
  const info = await ensurePython3();
  assert.ok(info.ok, `expected python3 available; got: ${info.ok ? "ok" : info.error}`);
  if (info.ok) {
    assert.ok(info.binary.length > 0);
    assert.ok(info.version.startsWith("Python 3"), `expected Python 3.x, got: ${info.version}`);
  }
});

test("runPython executes a script and captures stdout + exit code", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "hello.py");
    writeFileSync(script, `import sys\nprint("hi", "there")\nsys.exit(0)\n`);
    const result = await runPython(script, []);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /hi there/);
    assert.equal(result.stderr, "");
  });
});

test("runPython captures stderr and non-zero exit", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "fail.py");
    writeFileSync(script, `import sys\nprint("boom", file=sys.stderr)\nsys.exit(2)\n`);
    const result = await runPython(script, []);
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /boom/);
  });
});

test("runPython forwards positional args to the script", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "args.py");
    writeFileSync(script, `import sys\nprint(" ".join(sys.argv[1:]))\n`);
    const result = await runPython(script, ["foo", "bar baz"]);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /foo bar baz/);
  });
});

test("runPython forwards env vars (override) on top of process.env", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "env.py");
    writeFileSync(script, `import os\nprint(os.environ.get("LANGFLOW_SERVER_URL", "UNSET"))\n`);
    const result = await runPython(script, [], { env: { LANGFLOW_SERVER_URL: "http://test:7860" } });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /http:\/\/test:7860/);
  });
});

test("runBash executes a .sh script and captures stdout + exit code", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "say.sh");
    writeFileSync(script, "#!/usr/bin/env bash\necho \"hello from bash\"\nexit 0\n");
    chmodSync(script, 0o755);
    const result = await runBash(script, []);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /hello from bash/);
  });
});

test("runPython times out and returns exitCode 124 when script exceeds timeout", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "slow.py");
    writeFileSync(script, "import time\ntime.sleep(5)\n");
    const result = await runPython(script, [], { timeoutMs: 200 });
    assert.equal(result.exitCode, 124, `expected 124 (timeout), got ${result.exitCode}`);
    assert.match(result.stderr, /timed out/i);
  });
});
