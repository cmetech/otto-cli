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

test("parseFlags camelCases kebab flag keys", () => {
  assert.deepEqual(
    parseFlags(["--pr", "42", "--head-ref", "fix/b", "--targets", "a.ts,b.ts", "--log-dir", "/tmp/g"]),
    { pr: "42", headRef: "fix/b", targets: "a.ts,b.ts", logDir: "/tmp/g" }
  );
});

test("dispatch feeds documented gate flags to the handler as the params gateForPr reads", async () => {
  let received = null;
  const handlers = { gate: (args) => { received = parseFlags(args); return received; } };
  await dispatch(["gate", "--pr", "400", "--head-ref", "fix/x", "--targets", "a.ts", "--log-dir", "/tmp/g"], handlers);
  // gateForPr destructures { pr, headRef, targets, logDir } — all must be present:
  assert.equal(received.pr, "400");
  assert.equal(received.headRef, "fix/x");
  assert.equal(received.targets, "a.ts");
  assert.equal(received.logDir, "/tmp/g");
});
