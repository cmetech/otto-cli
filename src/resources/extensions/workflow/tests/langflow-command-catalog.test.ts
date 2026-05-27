import test from "node:test";
import assert from "node:assert/strict";

import { getWorkflowArgumentCompletions, TOP_LEVEL_SUBCOMMANDS } from "../commands/catalog.ts";
import { showHelp } from "../commands/handlers/core.ts";

function createMockCtx() {
  const notifications: { message: string; level: string }[] = [];
  return {
    notifications,
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
  };
}

test("/otto langflow catalog exposes lifecycle subcommands", () => {
  const topLevel = TOP_LEVEL_SUBCOMMANDS.find((entry) => entry.cmd === "langflow");
  assert.ok(topLevel, "langflow should appear in top-level command completions");
  assert.match(topLevel.desc, /show/);
  assert.match(topLevel.desc, /delete/);
  assert.match(topLevel.desc, /export/);

  const completions = getWorkflowArgumentCompletions("langflow ");
  const labels = completions.map((entry) => entry.label);
  for (const expected of ["status", "connect", "disconnect", "flows", "show", "samples", "import", "delete", "export", "run", "build"]) {
    assert.ok(labels.includes(expected), `missing langflow completion: ${expected}`);
  }
});

test("/otto langflow catalog exposes lifecycle flags", () => {
  assert.ok(
    getWorkflowArgumentCompletions("langflow import --").some((entry) => entry.value === "langflow import --update"),
    "import should complete --update",
  );
  assert.ok(
    getWorkflowArgumentCompletions("langflow delete --").some((entry) => entry.value === "langflow delete --yes"),
    "delete should complete --yes",
  );
  assert.ok(
    getWorkflowArgumentCompletions("langflow export --").some((entry) => entry.value === "langflow export --overwrite"),
    "export should complete --overwrite",
  );
});

test("/otto help full lists updated langflow lifecycle commands", () => {
  const ctx = createMockCtx();
  showHelp(ctx as never, "full");

  const help = ctx.notifications.at(0)?.message ?? "";
  assert.match(help, /\/otto langflow\s+LangFlow control plane\s+\[status\|connect\|disconnect\|flows\|show\|samples\|import\|delete\|export\|run\|build\]/);
});
