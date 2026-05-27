import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildFlowRuntimeDefaults,
  composeBuildFlowPrompt,
} from "../commands/build-flow/command.js";

test("buildFlowRuntimeDefaults prefers configured OTTO gateway with Anthropic messages shape", () => {
  const defaults = buildFlowRuntimeDefaults({
    env: {
      OTTO_GATEWAY_URL: "http://127.0.0.1:18080/",
      OTTO_GATEWAY_TOKEN: "configured-token",
    },
    localGatewayReachable: false,
  });

  assert.equal(defaults.gatewayAvailable, true);
  assert.equal(defaults.baseUrl, "http://127.0.0.1:18080");
  assert.equal(defaults.apiFamily, "anthropic-messages");
  assert.equal(defaults.requestPath, "/v1/messages");
  assert.equal(defaults.model, "claude-sonnet-4");
  assert.equal(defaults.tokenPlaceholder, "${OTTO_GATEWAY_TOKEN}");
});

test("buildFlowRuntimeDefaults uses local gateway default when health probe succeeds", () => {
  const defaults = buildFlowRuntimeDefaults({
    env: {},
    localGatewayReachable: true,
  });

  assert.equal(defaults.gatewayAvailable, true);
  assert.equal(defaults.baseUrl, "http://127.0.0.1:18080");
  assert.equal(defaults.apiFamily, "anthropic-messages");
});

test("composeBuildFlowPrompt injects gateway defaults and flow compliance requirements", () => {
  const prompt = composeBuildFlowPrompt({
    description: "build a hello world chat flow",
    referenceContext: "REFERENCE",
    runtimeDefaults: buildFlowRuntimeDefaults({
      env: { OTTO_GATEWAY_URL: "http://127.0.0.1:18080" },
      localGatewayReachable: false,
    }),
  });

  assert.match(prompt, /OTTO GATEWAY DEFAULTS/);
  assert.match(prompt, /Prefer an Anthropic-compatible LangFlow component/);
  assert.match(prompt, /http:\/\/127\.0\.0\.1:18080/);
  assert.match(prompt, /\/v1\/messages/);
  assert.match(prompt, /claude-sonnet-4/);
  assert.match(prompt, /FLOW COMPLIANCE CHECKLIST/);
  assert.match(prompt, /valid user-entry path/i);
  assert.match(prompt, /terminal output path/i);
  assert.match(prompt, /Chat Output must be connected/i);
  assert.match(prompt, /ChatOutput `input_value` is usually a HandleInput/i);
  assert.match(prompt, /type: other/i);
  assert.match(prompt, /If LangFlow says connections were removed/i);
  assert.match(prompt, /failure handling/i);
  assert.match(prompt, /Validate with otto__validate_flow.*repair/i);
});
