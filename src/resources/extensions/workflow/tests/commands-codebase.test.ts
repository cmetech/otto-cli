import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildCodebaseAskPrompt,
  getCodebaseKnowledgeStatus,
  handleCodebase,
} from "../commands-codebase.ts";
import { withCommandCwd } from "../commands/context.ts";

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "otto-codebase-command-"));
  mkdirSync(join(dir, ".otto", "workflow"), { recursive: true });
  return dir;
}

function makeCtx() {
  const notifications: Array<{ message: string; type?: string }> = [];
  return {
    notifications,
    ctx: {
      ui: {
        notify(message: string, type?: string) {
          notifications.push({ message, type });
        },
      },
    },
  };
}

function makePi() {
  const sent: string[] = [];
  return {
    sent,
    pi: {
      sendUserMessage(message: string) {
        sent.push(message);
      },
    },
  };
}

test("/otto codebase ask dispatches a source-aware Q&A prompt and warns when excavation is missing", async () => {
  const project = makeProject();
  try {
    const { ctx, notifications } = makeCtx();
    const { pi, sent } = makePi();

    await withCommandCwd(project, async () => {
      await handleCodebase("ask where are commands registered?", ctx as any, pi as any);
    });

    assert.equal(sent.length, 1);
    assert.match(sent[0]!, /where are commands registered\?/);
    assert.match(sent[0]!, /Always inspect source directly/);
    assert.match(sent[0]!, /codebase excavate/);
    assert.equal(notifications[0]?.type, "warning");
    assert.match(notifications[0]?.message ?? "", /No excavation artifacts found/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("/otto codebase ask sees excavation artifacts when present", () => {
  const project = makeProject();
  try {
    mkdirSync(join(project, ".otto", "excavate"), { recursive: true });
    writeFileSync(join(project, ".otto", "excavate", "workspace.json"), "{}\n", "utf-8");
    const status = getCodebaseKnowledgeStatus(project);
    const prompt = buildCodebaseAskPrompt("how does routing work?", project, status);

    assert.equal(status.hasExcavation, true);
    assert.equal(status.hasWorkspaceJson, true);
    assert.match(prompt, /Excavation artifacts are available/);
    assert.match(prompt, /raw\/synthesis\/module-map\.md/);
    assert.match(prompt, /Follow embedded/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("/otto codebase excavate forwards to the excavation playbook", async () => {
  const project = makeProject();
  try {
    const { ctx } = makeCtx();
    const { pi, sent } = makePi();

    await withCommandCwd(project, async () => {
      await handleCodebase("excavate ./src --workspace ./out", ctx as any, pi as any);
    });

    assert.equal(sent.length, 1);
    assert.match(sent[0]!, /OTTO excavate/);
    assert.match(sent[0]!, /codebase at `\.\/src`/);
    assert.match(sent[0]!, /WS="\.\/out"/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
