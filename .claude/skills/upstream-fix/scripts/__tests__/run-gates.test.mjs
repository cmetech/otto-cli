import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGateCommands, runGate, tailLines } from "../run-gates.mjs";

function tmp() { return mkdtempSync(join(tmpdir(), "uf-gates-")); }

test("resolveGateCommands picks test:packages when a packages/ file is touched", () => {
  const cmds = resolveGateCommands(["packages/pi-coding-agent/src/x.ts"]);
  assert.deepEqual(cmds.build, ["npm", "run", "build"]);
  assert.deepEqual(cmds.targeted, ["npm", "run", "test:packages"]);
});

test("resolveGateCommands picks test:unit for src-only files", () => {
  const cmds = resolveGateCommands(["src/foo/bar.ts"]);
  assert.deepEqual(cmds.targeted, ["npm", "run", "test:unit"]);
});

test("tailLines returns the last N lines", () => {
  const text = Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n");
  const tail = tailLines(text, 30);
  assert.equal(tail.split("\n").length, 30);
  assert.ok(tail.endsWith("line49"));
});

test("runGate returns pass:true and empty failTail on success, writes log", () => {
  const dir = tmp();
  try {
    const logPath = join(dir, "gate.log");
    const runner = () => ({ status: 0, stdout: "all good\n", stderr: "" });
    const r = runGate({ gate: "build", cwd: dir, logPath, targetFiles: ["src/a.ts"], runner });
    assert.equal(r.pass, true);
    assert.equal(r.failTail, "");
    assert.ok(existsSync(logPath));
    assert.match(readFileSync(logPath, "utf-8"), /all good/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runGate returns pass:false and failTail (<=30 lines) on failure", () => {
  const dir = tmp();
  try {
    const logPath = join(dir, "gate.log");
    const big = Array.from({ length: 100 }, (_, i) => `err${i}`).join("\n");
    const runner = () => ({ status: 1, stdout: big, stderr: "boom" });
    const r = runGate({ gate: "targeted", cwd: dir, logPath, targetFiles: ["packages/pi-ai/src/x.ts"], runner });
    assert.equal(r.pass, false);
    assert.ok(r.failTail.split("\n").length <= 30);
    assert.match(r.failTail, /boom|err99/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("runGate regression gate runs the single test file via strip-types", () => {
  const dir = tmp();
  try {
    const logPath = join(dir, "gate.log");
    let captured;
    const runner = (cmd, args) => { captured = [cmd, ...args]; return { status: 0, stdout: "", stderr: "" }; };
    runGate({ gate: "regression", cwd: dir, logPath, testFile: "packages/pi-ai/src/x.test.ts", targetFiles: [], runner });
    assert.ok(captured.includes("--experimental-strip-types"));
    assert.ok(captured.includes("packages/pi-ai/src/x.test.ts"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("full gate chains multiple commands and stops at the first failure", () => {
  const dir = tmp();
  try {
    const logPath = join(dir, "gate.log");
    const seen = [];
    const runner = (cmd, args) => { seen.push([cmd, ...args].join(" ")); return { status: seen.length === 2 ? 1 : 0, stdout: "", stderr: "fail-here" }; };
    const r = runGate({ gate: "full", cwd: dir, logPath, targetFiles: [], runner });
    assert.equal(r.pass, false);
    assert.equal(seen.length, 2); // stopped after the second (failing) step
    assert.match(r.failTail, /fail-here/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("full gate passes when all steps succeed", () => {
  const dir = tmp();
  try {
    const logPath = join(dir, "gate.log");
    const runner = () => ({ status: 0, stdout: "ok", stderr: "" });
    const r = runGate({ gate: "full", cwd: dir, logPath, targetFiles: [], runner });
    assert.equal(r.pass, true);
    assert.equal(r.failTail, "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
