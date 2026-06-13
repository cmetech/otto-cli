import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRevalidationManifest } from "../revalidate-do-not-port.mjs";

test("includes only type:do-not-port issues and extracts the sha", () => {
  const issues = [
    { number: 10, title: "[upstream/pi-dev] 🐛 fix x [sha=abc1234]", labels: [{ name: "type:do-not-port" }], body: "...sha=abc1234..." },
    { number: 11, title: "keep me out", labels: [{ name: "type:cherry-pick-candidate" }], body: "sha=def5678" },
  ];
  const m = buildRevalidationManifest(issues);
  assert.equal(m.length, 1);
  assert.equal(m[0].number, 10);
  assert.equal(m[0].sha, "abc1234");
  assert.equal(m[0].hasNewGuidance, false);
});

test("falls back to title sha when body lacks one and tolerates missing sha", () => {
  const issues = [
    { number: 12, title: "x [sha=9999999]", labels: [{ name: "type:do-not-port" }], body: "no key here" },
    { number: 13, title: "no sha anywhere", labels: [{ name: "type:do-not-port" }], body: "none" },
  ];
  const m = buildRevalidationManifest(issues);
  assert.equal(m.find((x) => x.number === 12).sha, "9999999");
  assert.equal(m.find((x) => x.number === 13).sha, null);
});

test("accepts string labels too", () => {
  const m = buildRevalidationManifest([
    { number: 14, title: "t [sha=aaaaaaa]", labels: ["type:do-not-port"], body: "" },
  ]);
  assert.equal(m.length, 1);
  assert.equal(m[0].sha, "aaaaaaa");
});

test("empty input yields empty manifest", () => {
  assert.deepEqual(buildRevalidationManifest([]), []);
});

import { revalidateDoNotPort } from "../revalidate-do-not-port.mjs";

test("revalidateDoNotPort queries gh with the right args and builds the manifest", () => {
  let captured = null;
  const ghRunner = (args) => {
    captured = args;
    return JSON.stringify([
      { number: 20, title: "t [sha=bbbbbbb]", body: "", labels: [{ name: "type:do-not-port" }] },
    ]);
  };
  const m = revalidateDoNotPort({ targetRepo: "cmetech/otto-cli", ghRunner });
  assert.equal(m.length, 1);
  assert.equal(m[0].number, 20);
  assert.equal(m[0].sha, "bbbbbbb");
  assert.ok(captured.includes("type:do-not-port"), `args: ${captured}`);
  assert.ok(captured.includes("--state") && captured.includes("all"), `args: ${captured}`);
});
