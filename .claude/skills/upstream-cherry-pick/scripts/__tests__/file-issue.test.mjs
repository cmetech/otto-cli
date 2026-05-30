import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileIssue } from "../file-issue.mjs";

const samplePayload = {
  title: "[upstream/pi-dev] 🐛 fix: foo [sha=abc1234]",
  body: "## body\n\nMulti-line content with **markdown** and `code`.\n",
  labels: ["upstream:pi-dev", "severity:critical-stability", "status:triaged"],
};

test("successful file returns number and url", async () => {
  let receivedArgs = null;
  let receivedBodyFile = null;
  const ghRunner = (args) => {
    receivedArgs = args;
    const i = args.indexOf("--body-file");
    if (i >= 0) receivedBodyFile = args[i + 1];
    return "https://github.com/foo/bar/issues/42\n";
  };
  const result = await fileIssue({ payload: samplePayload, targetRepo: "foo/bar", ghRunner });
  assert.equal(result.number, 42);
  assert.equal(result.url, "https://github.com/foo/bar/issues/42");
  // gh args check
  assert.ok(receivedArgs.includes("--repo"));
  assert.ok(receivedArgs.includes("foo/bar"));
  assert.ok(receivedArgs.includes("--title"));
  assert.ok(receivedArgs.includes(samplePayload.title));
  assert.ok(receivedArgs.includes("--label"));
  assert.ok(receivedArgs.includes("upstream:pi-dev,severity:critical-stability,status:triaged"));
});

test("temp body file is created and cleaned up", async () => {
  let bodyFilePath = null;
  let bodyContent = null;
  const ghRunner = (args) => {
    const i = args.indexOf("--body-file");
    bodyFilePath = args[i + 1];
    bodyContent = readFileSync(bodyFilePath, "utf-8");
    return "https://github.com/foo/bar/issues/1\n";
  };
  await fileIssue({ payload: samplePayload, targetRepo: "foo/bar", ghRunner });
  // File existed during gh call but is cleaned up after
  assert.equal(bodyContent, samplePayload.body);
  assert.ok(!existsSync(bodyFilePath), "temp file should be cleaned up");
});

test("gh failure returns error without throwing", async () => {
  const ghRunner = () => { throw new Error("rate limited"); };
  const result = await fileIssue({ payload: samplePayload, targetRepo: "foo/bar", ghRunner });
  assert.match(result.error, /rate limited/);
  assert.deepEqual(result.payload, samplePayload);
  assert.equal(result.number, undefined);
});

test("unexpected output triggers an error result", async () => {
  const ghRunner = () => "not a url\n";
  const result = await fileIssue({ payload: samplePayload, targetRepo: "foo/bar", ghRunner });
  assert.ok(result.error, "should report parse failure");
});
