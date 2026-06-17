import test from "node:test";
import assert from "node:assert/strict";

import { handleRecoverableExtensionProcessError } from "../bootstrap/register-extension.ts";

// Root cause (#164 / upstream 8f2fab5): a persistently-broken output pipe whose
// destroyed/writableEnded flags never flip is swallowed on every write — a
// tight, progress-free CPU spin. The fix must (a) treat the Windows
// `write EOF` / `read EOF` variant as a recoverable pipe-closed error so it does
// not escape to the uncaught-exception crash path, and (b) never re-throw when
// writing to a broken stderr (safeStderr), so the handler can't re-enter itself
// and re-loop.

test("Windows 'write EOF' (no errno code) is treated as a recoverable pipe-closed error", () => {
  let stderr = "";
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    // No `code` set — this is how Windows surfaces a closed read end.
    const handled = handleRecoverableExtensionProcessError(
      Object.assign(new Error("write EOF"), { syscall: "write" }),
    );
    assert.equal(handled, true);
  } finally {
    process.stderr.write = originalWrite;
  }
});

test("Windows 'read EOF' (no errno code) is treated as a recoverable pipe-closed error", () => {
  let stderr = "";
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    const handled = handleRecoverableExtensionProcessError(
      Object.assign(new Error("read EOF"), { syscall: "read" }),
    );
    assert.equal(handled, true);
  } finally {
    process.stderr.write = originalWrite;
  }
});

test("ECONNRESET is deliberately NOT swallowed (real network error must surface)", () => {
  const handled = handleRecoverableExtensionProcessError(
    Object.assign(new Error("socket hang up"), {
      code: "ECONNRESET",
      syscall: "read",
    }),
  );
  assert.equal(handled, false);
});

test("EPIPE handler never re-throws when stderr itself is broken (re-entrancy guard)", () => {
  const originalWrite = process.stderr.write.bind(process.stderr);
  // Simulate a broken stderr: every write throws EPIPE. A naive
  // process.stderr.write(...) inside the handler would propagate this and
  // re-enter the guard, re-looping; safeStderr must swallow it.
  process.stderr.write = (() => {
    throw Object.assign(new Error("broken pipe"), { code: "EPIPE", syscall: "write" });
  }) as typeof process.stderr.write;

  try {
    assert.doesNotThrow(() => {
      handleRecoverableExtensionProcessError(
        Object.assign(new Error("broken pipe"), { code: "EPIPE", syscall: "write" }),
      );
    });
  } finally {
    process.stderr.write = originalWrite;
  }
});
