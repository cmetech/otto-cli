import { test } from "node:test";
import assert from "node:assert/strict";
import { preflightCleanMain } from "../preflight-clean-main.mjs";

function gitRunnerStub(map) {
  return (args) => {
    if (args[0] === "fetch") return "";
    if (args[0] === "rev-list" && args[1] === "--count") {
      const range = args[2]; // e.g. "origin/main..main"
      if (range in map) return String(map[range]);
      throw new Error(`unexpected range: ${range}`);
    }
    throw new Error(`unexpected git invocation: ${args.join(" ")}`);
  };
}

test("clean when local main matches origin/main (ahead=0, behind=0)", () => {
  const r = preflightCleanMain({
    gitRunner: gitRunnerStub({ "origin/main..main": 0, "main..origin/main": 0 }),
  });
  assert.equal(r.clean, true);
  assert.equal(r.ahead, 0);
  assert.equal(r.behind, 0);
  assert.match(r.message, /matches/);
});

test("clean when local main is behind origin/main only (fetch will catch us up)", () => {
  const r = preflightCleanMain({
    gitRunner: gitRunnerStub({ "origin/main..main": 0, "main..origin/main": 3 }),
  });
  assert.equal(r.clean, true);
  assert.equal(r.ahead, 0);
  assert.equal(r.behind, 3);
  assert.match(r.message, /behind/);
});

test("NOT clean when local main has unpushed commits (ahead>0)", () => {
  const r = preflightCleanMain({
    gitRunner: gitRunnerStub({ "origin/main..main": 2, "main..origin/main": 0 }),
  });
  assert.equal(r.clean, false);
  assert.equal(r.ahead, 2);
  assert.match(r.message, /2 commit\(s\) ahead/);
  assert.match(r.message, /Push them/);
});

test("NOT clean when local main has diverged (ahead>0 AND behind>0)", () => {
  const r = preflightCleanMain({
    gitRunner: gitRunnerStub({ "origin/main..main": 1, "main..origin/main": 4 }),
  });
  assert.equal(r.clean, false);
  assert.equal(r.ahead, 1);
  assert.equal(r.behind, 4);
});

test("calls git fetch before checking counts by default", () => {
  const calls = [];
  preflightCleanMain({
    gitRunner: (args) => { calls.push(args[0]); if (args[0] === "fetch") return ""; return "0"; },
  });
  assert.equal(calls[0], "fetch");
});

test("skips fetch when fetch:false (for tests / explicit opt-out)", () => {
  const calls = [];
  preflightCleanMain({
    fetch: false,
    gitRunner: (args) => { calls.push(args[0]); return "0"; },
  });
  assert.ok(!calls.includes("fetch"));
});

test("rejects unsafe ref names to defend against shell-meta injection", () => {
  assert.throws(() => preflightCleanMain({ base: "origin/main; rm -rf /", fetch: false, gitRunner: () => "0" }));
  assert.throws(() => preflightCleanMain({ head: "$(whoami)", fetch: false, gitRunner: () => "0" }));
});
