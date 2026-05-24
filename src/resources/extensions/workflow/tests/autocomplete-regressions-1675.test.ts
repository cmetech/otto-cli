import test from "node:test";
import assert from "node:assert/strict";

import { COMMAND_NAMESPACE } from "@loop24/pi-coding-agent";

import { registerWorkflowCommand } from "../commands.ts";
import { dispatchWorkflowCommand } from "../commands/dispatcher.ts";
import { slashCommand } from "../strings.ts";

function createMockPi() {
  const commands = new Map<string, any>();
  return {
    registerCommand(name: string, options: any) {
      commands.set(name, options);
    },
    registerTool() {},
    registerShortcut() {},
    on() {},
    sendMessage() {},
    commands,
  };
}

function createMockCtx() {
  const notifications: { message: string; level: string }[] = [];
  return {
    notifications,
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      custom: async () => {},
    },
    shutdown: async () => {},
  };
}

test("/gsd description includes discuss", () => {
  const pi = createMockPi();
  registerWorkflowCommand(pi as any);

  const gsd = pi.commands.get(COMMAND_NAMESPACE);
  assert.ok(gsd, `registerWorkflowCommand should register /${COMMAND_NAMESPACE}`);
  assert.ok(
    gsd.description.includes("discuss"),
    "description should include discuss",
  );
});

test("/gsd description includes debug", () => {
  const pi = createMockPi();
  registerWorkflowCommand(pi as any);

  const gsd = pi.commands.get(COMMAND_NAMESPACE);
  assert.ok(gsd.description.includes("debug"), "description should include debug");
});

test("/gsd next completions include --debug", () => {
  const pi = createMockPi();
  registerWorkflowCommand(pi as any);

  const gsd = pi.commands.get(COMMAND_NAMESPACE);
  const completions = gsd.getArgumentCompletions("next ");
  const debug = completions.find((c: any) => c.value === "next --debug");
  assert.ok(debug, "next --debug should appear in completions");
});

test("/gsd debug completions include list|status|continue|--diagnose", () => {
  const pi = createMockPi();
  registerWorkflowCommand(pi as any);

  const gsd = pi.commands.get(COMMAND_NAMESPACE);
  const completions = gsd.getArgumentCompletions("debug ");
  const values = completions.map((c: any) => c.value);
  for (const expected of ["debug list", "debug status", "debug continue", "debug --diagnose"]) {
    assert.ok(values.includes(expected), `missing completion: ${expected}`);
  }
});

test("/gsd widget completions include full|small|min|off", () => {
  const pi = createMockPi();
  registerWorkflowCommand(pi as any);

  const gsd = pi.commands.get(COMMAND_NAMESPACE);
  const completions = gsd.getArgumentCompletions("widget ");
  const values = completions.map((c: any) => c.value);
  for (const expected of ["widget full", "widget small", "widget min", "widget off"]) {
    assert.ok(values.includes(expected), `missing completion: ${expected}`);
  }
});

test("/gsd logs completions still include debug after adding /gsd debug", () => {
  const pi = createMockPi();
  registerWorkflowCommand(pi as any);

  const gsd = pi.commands.get(COMMAND_NAMESPACE);
  const completions = gsd.getArgumentCompletions("logs ");
  const values = completions.map((c: any) => c.value);
  assert.ok(values.includes("logs debug"), "logs debug completion should remain available");
});

test("/gsd help full includes /gsd debug command", async () => {
  const ctx = createMockCtx();

  await dispatchWorkflowCommand("help full", ctx as any, {} as any);

  const helpText = ctx.notifications.map((n) => n.message).join("\n");
  // Escape regex special chars in the slashCommand reference so this works for any namespace.
  const debugRef = slashCommand("debug").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(helpText, new RegExp(`${debugRef}\\s+Create\\/list\\/continue persistent debug sessions`));
});

test(`bare ${slashCommand("skip")} shows usage and does not fall through to unknown-command warning`, async () => {
  const ctx = createMockCtx();

  await dispatchWorkflowCommand("skip", ctx as any, {} as any);

  const skipUsage = `Usage: ${slashCommand("skip")} <unit-id>`;
  assert.ok(
    ctx.notifications.some((n) => n.message.includes(skipUsage)),
    "should show skip usage guidance",
  );
  const unknownPrefix = `Unknown: ${slashCommand("skip")}`;
  assert.ok(
    !ctx.notifications.some((n) => n.message.startsWith(unknownPrefix)),
    "should not emit unknown-command warning for bare skip",
  );
});

test("direct loop verbs do not fall through to unknown-command warning", async () => {
  const loopVerbs = [
    "research-milestone",
    "research-slice",
    "plan-milestone",
    "plan-slice",
    "execute-task",
    "complete-slice",
    "validate-milestone",
    "complete-milestone",
  ];

  for (const verb of loopVerbs) {
    const ctx = createMockCtx();
    await dispatchWorkflowCommand(verb, ctx as any, {} as any);
    const unknownPrefix = `Unknown: ${slashCommand(verb)}`;
    assert.ok(
      !ctx.notifications.some((n) => n.message.startsWith(unknownPrefix)),
      `${verb} should be recognized as a valid /${COMMAND_NAMESPACE} command alias`,
    );
  }
});
