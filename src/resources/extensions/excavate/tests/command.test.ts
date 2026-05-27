import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { _setExecFileSyncForTest, handleExcavateCommand } from "../command.js";

function makeCtx(cwd: string, confirmResult = true) {
  const notifications: Array<{ message: string; type?: string }> = [];
  const confirmations: Array<{ title: string; message: string }> = [];
  return {
    ctx: {
      cwd,
      ui: {
        notify(message: string, type?: string) {
          notifications.push({ message, type });
        },
        async confirm(title: string, message: string) {
          confirmations.push({ title, message });
          return confirmResult;
        },
      },
    },
    notifications,
    confirmations,
  };
}

describe("handleExcavateCommand", () => {
  it("defaults bare excavate to the current Git repo and .otto/excavate after confirmation", async () => {
    const repo = mkdtempSync(join(tmpdir(), "otto-excavate-repo-"));
    try {
      execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
      const gitRoot = realpathSync(repo);
      const sent: string[] = [];
      const { ctx, confirmations } = makeCtx(repo, true);

      await handleExcavateCommand("", ctx as any, {
        sendUserMessage(message: string) {
          sent.push(message);
        },
      } as any);

      assert.equal(confirmations.length, 1);
      assert.match(confirmations[0]!.message, new RegExp(`Target: ${gitRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      assert.match(confirmations[0]!.message, /\.otto\/excavate/);
      assert.equal(sent.length, 1);
      assert.match(sent[0]!, new RegExp(`codebase at \`${gitRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\``));
      assert.match(sent[0]!, new RegExp(`WS="${join(gitRoot, ".otto", "excavate").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("does not dispatch bare excavate outside a Git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "otto-excavate-nonrepo-"));
    try {
      const sent: string[] = [];
      const { ctx, notifications, confirmations } = makeCtx(dir, true);

      await handleExcavateCommand("", ctx as any, {
        sendUserMessage(message: string) {
          sent.push(message);
        },
      } as any);

      assert.equal(confirmations.length, 0);
      assert.equal(sent.length, 0);
      assert.equal(notifications[0]?.type, "error");
      assert.match(notifications[0]?.message ?? "", /requires a target path/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires an explicit target for bare excavate when Git is unavailable", async () => {
    const restore = _setExecFileSyncForTest(() => {
      throw new Error("git not found");
    });
    const dir = mkdtempSync(join(tmpdir(), "otto-excavate-no-git-bare-"));
    try {
      const sent: string[] = [];
      const { ctx, notifications, confirmations } = makeCtx(dir, true);

      await handleExcavateCommand("", ctx as any, {
        sendUserMessage(message: string) {
          sent.push(message);
        },
      } as any);

      assert.equal(confirmations.length, 0);
      assert.equal(sent.length, 0);
      assert.equal(notifications[0]?.type, "error");
      assert.match(notifications[0]?.message ?? "", /Git was not found/);
      assert.match(notifications[0]?.message ?? "", /excavate <path>/);
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs explicit-target excavate in no-Git mode when Git is unavailable", async () => {
    const restore = _setExecFileSyncForTest(() => {
      throw new Error("git not found");
    });
    const dir = mkdtempSync(join(tmpdir(), "otto-excavate-no-git-explicit-"));
    try {
      const sent: string[] = [];
      const { ctx, notifications } = makeCtx(dir, true);

      await handleExcavateCommand("./target --workspace ./out", ctx as any, {
        sendUserMessage(message: string) {
          sent.push(message);
        },
      } as any);

      assert.equal(sent.length, 1);
      assert.equal(notifications[0]?.type, "warning");
      assert.match(notifications[0]?.message ?? "", /without workspace commits/);
      assert.match(sent[0]!, /Git is NOT available/);
      assert.match(sent[0]!, /provenance\/stage-log\.jsonl/);
      assert.doesNotMatch(sent[0]!, /git init -q/);
    } finally {
      restore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
