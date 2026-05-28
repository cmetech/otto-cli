# OTTO Gateway Model Discovery Design

## Problem

Today, `OTTO_GATEWAY_URL` can cause direct Anthropic models to route through the local OTTO Gateway. That is confusing once the gateway exposes its own dynamic model catalog: users should be able to distinguish direct/static providers from gateway-backed models. The gap is provider separation: OTTO still presents the static local Anthropic registry, while the gateway has a dynamic catalog from Kiro's `session/new` `availableModels[]`.

Gateway discovery is intentionally exposed through OpenAI/Ollama-compatible discovery endpoints:

- `GET /v1/models`
- `GET /api/tags`

The Anthropic Messages surface has no public `/v1/models` equivalent, so OTTO must use the gateway's OpenAI-shaped discovery endpoint while still sending generation requests through Anthropic Messages.

## Goal

When gateway routing is enabled, OTTO should dynamically discover gateway-backed models from `GET ${OTTO_GATEWAY_URL}/v1/models`, show them as selectable `otto-gateway/*` models, and send the selected model ID back to the gateway in the Anthropic `model` field. Only `otto-gateway/*` models route through the gateway.

## Non-Goals

- Do not change `otto-gateway` endpoints.
- Do not add OpenAI Responses generation routing in OTTO for this feature.
- Do not replace the static Anthropic registry for direct Anthropic API-key usage.
- Do not route `anthropic/*`, `openai/*`, or `openai-codex/*` through OTTO Gateway just because `OTTO_GATEWAY_URL` is set.
- Do not assume every gateway model is actually an Anthropic model.

## Design

Add a first-class synthetic provider named `otto-gateway`.

The provider is discoverable only when `OTTO_GATEWAY_URL` is set and `OTTO_GATEWAY_DISABLED !== "1"`. It discovers model IDs from the gateway's OpenAI-compatible `GET /v1/models` endpoint, but converts discovered entries into OTTO models with `api: "anthropic-messages"` and `baseUrl: OTTO_GATEWAY_URL`. This preserves the current working generation path.

Example displayed models:

```text
otto-gateway/claude-sonnet-4-6
otto-gateway/gpt-5.4
otto-gateway/gpt-5.4-codex
```

When the user selects `otto-gateway/gpt-5.4`, the Anthropic request body contains:

```json
{
  "model": "gpt-5.4",
  "messages": [],
  "stream": true
}
```

The provider prefix is only an OTTO-side registry namespace. The payload model ID remains the gateway catalog ID.

Direct providers remain direct:

```text
anthropic/claude-sonnet-4-6    direct Anthropic API key
openai/gpt-5.4                 direct OpenAI API key
openai-codex/gpt-5.4           direct ChatGPT/Codex subscription OAuth
otto-gateway/gpt-5.4           OTTO Gateway via Anthropic Messages transport
```

## Components

### Gateway Discovery Adapter

Add an adapter in `packages/pi-coding-agent/src/core/model-discovery.ts`:

- provider: `otto-gateway`
- discovery URL: `${baseUrl}/v1/models`
- auth: `Authorization: Bearer ${OTTO_GATEWAY_TOKEN}` only when token exists
- parser: reuse OpenAI-compatible model parsing where possible
- failures: return a normal discovery error, not startup failure

The gateway adapter should not be returned for generic Anthropic providers. It is specific to OTTO Gateway because the discovery surface is a gateway convention, not an Anthropic protocol feature.

### Registry Integration

Update `ModelRegistry` so gateway discovery is auto-enabled when:

- `OTTO_GATEWAY_URL` is non-empty
- `OTTO_GATEWAY_DISABLED !== "1"`

`getProviderBaseUrl("otto-gateway")` should return the normalized gateway URL from env. `isProviderRequestReady("otto-gateway")` should return true under the same condition. `getGatewayApiKeyForProvider()` should return the gateway token or placeholder only for `otto-gateway`.

Discovered `otto-gateway` models must convert to:

```ts
{
  provider: "otto-gateway",
  api: "anthropic-messages",
  baseUrl: process.env.OTTO_GATEWAY_URL,
  id: discovered.id
}
```

Default capabilities should be conservative:

- `input: ["text"]` unless discovery reports images
- `contextWindow: 128000` unless discovery reports one
- `maxTokens: 16384` unless discovery reports one
- `reasoning: false` unless discovery reports reasoning support
- zero cost unless discovery reports cost

### Routing

No new generation transport is needed. The Anthropic provider implementation should switch the SDK base URL to `OTTO_GATEWAY_URL` only when the selected model provider is `otto-gateway`. Because `otto-gateway` models use `api: "anthropic-messages"`, they flow through the same code path while direct `anthropic/*` models continue to use their configured direct base URL and API key.

The request body already sends `model.id`, so model selection is naturally honored by the gateway.

### Footer

The footer should show `GW routed` only when the selected model provider is `otto-gateway` and gateway env is active. Static/direct providers should show direct/bypass status even when the gateway is configured.

## Error Handling

If discovery fails, OTTO should keep working with static models and report the discovery failure only where discovery results are surfaced. Startup and chat should not fail solely because `/v1/models` is unavailable.

If the selected gateway-discovered model is later rejected by the gateway during generation, the normal model request error should be shown. OTTO should not silently fall back to a different model.

## Tests

Add unit coverage for:

- `getDiscoveryAdapter("otto-gateway")` returns a discoverable adapter.
- Gateway discovery calls `${OTTO_GATEWAY_URL}/v1/models`, not Anthropic's public API.
- Gateway discovery includes the optional bearer token header.
- `ModelRegistry.discoverModels(["otto-gateway"])` converts discovered entries into `provider: "otto-gateway"` and `api: "anthropic-messages"`.
- `isProviderRequestReady("otto-gateway")` follows gateway env state.
- Direct `anthropic/*` models are not marked request-ready by gateway env alone and do not receive gateway placeholder credentials.
- Anthropic client routing uses gateway only for `otto-gateway/*`.
- Footer routing status is true only for `otto-gateway/*` Anthropic Messages models when gateway env is active.

## Human Verification

With gateway running:

```bash
export OTTO_GATEWAY_URL=http://127.0.0.1:18080
otto
```

Then:

1. Open model selection and confirm `otto-gateway/*` models appear from the gateway catalog.
2. Select a non-static gateway model, such as a Kiro-reported Codex model.
3. Send a normal prompt.
4. Confirm gateway logs show the selected model ID in the request body.
5. Confirm OTTO footer shows `GW routed`, not bypass.
