import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_NAME, CONFIG_DIR_NAME, COMMAND_NAMESPACE, BRAND_NAME } from "./config.js";

test("APP_NAME reads piConfig.name from package.json", () => {
  assert.equal(APP_NAME, "otto");
});

test("CONFIG_DIR_NAME reads piConfig.configDir from package.json", () => {
  assert.equal(CONFIG_DIR_NAME, ".otto");
});

test("COMMAND_NAMESPACE reads piConfig.commandNamespace from package.json", () => {
  assert.equal(COMMAND_NAMESPACE, "otto");
});

test("BRAND_NAME reads piConfig.brandName from package.json", () => {
  assert.equal(BRAND_NAME, "OTTO");
});
