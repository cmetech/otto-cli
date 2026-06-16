import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatch, KNOWN_COMMANDS, parseFlags } from "../swarm-control.mjs";

test("dispatch routes to a registered handler and returns its result", async () => {
  const calls = [];
  const handlers = { ping: async (args) => { calls.push(args); return { ok: true, echo: args }; } };
  const out = await dispatch(["ping", "--x", "1"], handlers);
  assert.deepEqual(out, { ok: true, echo: ["--x", "1"] });
  assert.deepEqual(calls, [["--x", "1"]]);
});

test("dispatch throws a usage error for an unknown command", async () => {
  await assert.rejects(() => dispatch(["bogus"], {}), /unknown command: bogus/);
});

test("KNOWN_COMMANDS lists the subcommands this plan ships", () => {
  assert.ok(KNOWN_COMMANDS.includes("verify-fix"));
  assert.ok(KNOWN_COMMANDS.includes("gate"));
});

test("parseFlags parses --k v pairs and boolean flags", () => {
  assert.deepEqual(parseFlags(["--pr", "400", "--branch", "fix/x", "--unattended"]), { pr: "400", branch: "fix/x", unattended: true });
});
