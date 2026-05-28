import test from "node:test";
import assert from "node:assert/strict";

import { COMMAND_NAMESPACE } from "@otto/pi-coding-agent";

import { registerWorkflowCommand } from "../commands.ts";
import { dispatchWorkflowCommand } from "../commands/dispatcher.ts";
import { slashCommand } from "../strings.ts";

function createMockPi() {
  const commands = new Map<string, any>();
  const sentUserMessages: string[] = [];
  return {
    registerCommand(name: string, options: any) {
      commands.set(name, options);
    },
    registerTool() {},
    registerShortcut() {},
    on() {},
    sendMessage() {},
    sendUserMessage(message: string) {
      sentUserMessages.push(message);
    },
    commands,
    sentUserMessages,
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

test("/otto description includes discuss", () => {
  const pi = createMockPi();
  registerWorkflowCommand(pi as any);

  const gsd = pi.commands.get(COMMAND_NAMESPACE);
  assert.ok(gsd, `registerWorkflowCommand should register /${COMMAND_NAMESPACE}`);
  assert.ok(
    gsd.description.includes("discuss"),
    "description should include discuss",
  );
});

test("/otto description includes debug", () => {
  const pi = createMockPi();
  registerWorkflowCommand(pi as any);

  const gsd = pi.commands.get(COMMAND_NAMESPACE);
  assert.ok(gsd.description.includes("debug"), "description should include debug");
});

test("/otto next completions include --debug", () => {
  const pi = createMockPi();
  registerWorkflowCommand(pi as any);

  const gsd = pi.commands.get(COMMAND_NAMESPACE);
  const completions = gsd.getArgumentCompletions("next ");
  const debug = completions.find((c: any) => c.value === "next --debug");
  assert.ok(debug, "next --debug should appear in completions");
});

test("/otto debug completions include list|status|continue|--diagnose", () => {
  const pi = createMockPi();
  registerWorkflowCommand(pi as any);

  const gsd = pi.commands.get(COMMAND_NAMESPACE);
  const completions = gsd.getArgumentCompletions("debug ");
  const values = completions.map((c: any) => c.value);
  for (const expected of ["debug list", "debug status", "debug continue", "debug --diagnose"]) {
    assert.ok(values.includes(expected), `missing completion: ${expected}`);
  }
});

test("/otto completions include excavate and its workspace option", () => {
  const pi = createMockPi();
  registerWorkflowCommand(pi as any);

  const gsd = pi.commands.get(COMMAND_NAMESPACE);
  const topLevel = gsd.getArgumentCompletions("ex");
  assert.ok(
    topLevel.some((c: any) => c.value === "excavate"),
    "top-level completions should include excavate",
  );

  const nested = gsd.getArgumentCompletions("excavate ");
  assert.ok(
    nested.some((c: any) => c.value === "excavate --workspace ./.otto/excavate"),
    "excavate completions should include --workspace",
  );
});

test("/otto excavate routes to the excavate playbook without requiring an OTTO project", async () => {
  const ctx = createMockCtx();
  const pi = createMockPi();

  await dispatchWorkflowCommand("excavate ./repo", ctx as any, pi as any);

  assert.equal(pi.sentUserMessages.length, 1);
  assert.match(pi.sentUserMessages[0]!, /OTTO excavate/);
  assert.match(pi.sentUserMessages[0]!, /\.\/repo/);
  assert.match(pi.sentUserMessages[0]!, /\.otto\/excavate/);
});

test("/otto widget completions include full|small|min|off", () => {
  const pi = createMockPi();
  registerWorkflowCommand(pi as any);

  const gsd = pi.commands.get(COMMAND_NAMESPACE);
  const completions = gsd.getArgumentCompletions("widget ");
  const values = completions.map((c: any) => c.value);
  for (const expected of ["widget full", "widget small", "widget min", "widget off"]) {
    assert.ok(values.includes(expected), `missing completion: ${expected}`);
  }
});

test("/otto logs completions still include debug after adding /otto debug", () => {
  const pi = createMockPi();
  registerWorkflowCommand(pi as any);

  const gsd = pi.commands.get(COMMAND_NAMESPACE);
  const completions = gsd.getArgumentCompletions("logs ");
  const values = completions.map((c: any) => c.value);
  assert.ok(values.includes("logs debug"), "logs debug completion should remain available");
});

test("/otto help full includes /otto debug command", async () => {
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
