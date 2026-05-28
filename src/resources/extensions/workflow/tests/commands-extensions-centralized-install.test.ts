import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleExtensions } from "../commands-extensions.ts";

function createContext() {
  const notifications: Array<{ message: string; level: string }> = [];
  return {
    notifications,
    ctx: {
      ui: {
        notify(message: string, level: string) {
          notifications.push({ message, level });
        },
      },
    },
  };
}

describe("/otto extensions centralized install flow", () => {
  it("directs install, uninstall, and update to terminal package commands", async () => {
    for (const command of ["install ./sample", "uninstall sample", "update sample"]) {
      const { ctx, notifications } = createContext();

      await handleExtensions(command, ctx as never);

      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].level, "warning");
      assert.match(notifications[0].message, /has been removed/);
      assert.match(notifications[0].message, /otto (install|remove|package update)/);
    }
  });
});
