# OTTO dev mock gateway

A transparent HTTP proxy that forwards `POST /v1/messages` to
`https://api.anthropic.com/v1/messages`. Stand-in for the real
`otto-gateway`'s Anthropic surface (`SURF-V2-01`) until that team
ships it.

## Why this exists

OTTO's Phase 1 (gateway routing) needs SOMETHING to point at to
validate the end-to-end client-side wiring. The real `otto-gateway`
is pre-implementation; this mock unblocks OTTO development without
waiting on it.

## Usage

```bash
# Terminal 1: start the mock gateway
export ANTHROPIC_API_KEY=sk-ant-...        # required — upstream auth
node scripts/dev-gateway/server.js
# → listens on http://127.0.0.1:7250 by default
# → port override via OTTO_DEV_GATEWAY_PORT

# Terminal 2: run otto routed through the mock
export OTTO_GATEWAY_URL=http://127.0.0.1:7250
export OTTO_GATEWAY_TOKEN=anything       # optional; mock accepts any value
otto
```

When you launch `otto`, the banner status line should read
`gateway: routed → 127.0.0.1:7250`. Any messages you send route
through the mock, which forwards them to Anthropic with your real
`ANTHROPIC_API_KEY`.

## What it does NOT do

- No compliance logging / redaction — that's the real gateway's job
- No rate limiting / quota
- No request/response transformation beyond Authorization stripping
- No persistence — restarts are stateless

When the real gateway lands, swap `OTTO_GATEWAY_URL` to point at it
and stop using this script.
