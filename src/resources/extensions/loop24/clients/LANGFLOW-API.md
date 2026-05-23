# LangFlow API Reference

**Version Observed:** 1.9.3  
**Server:** http://127.0.0.1:7860  
**Date Captured:** 2026-05-23

## Authentication

**Model:** API key in `x-api-key` header (required on v1.5+)

Status codes observed on this instance:
- No auth header: `403 {"detail":"No authentication credentials provided"}`
- Invalid key: `403 {"detail":"Invalid API key"}`
- Valid key: `200 OK`

The version endpoint (`/api/v1/version`) and health endpoint (`/health`) are **public** and do not require authentication. All other endpoints require a valid `x-api-key` header.

**Note:** The server has `LANGFLOW_AUTO_LOGIN` enabled, which enforces API key requirement. Flows endpoint cannot be accessed without a valid key.

---

## Endpoints

### 1. GET /api/v1/version

**Purpose:** Probe connection and verify LangFlow is running and accessible.

**Request:**
```bash
curl -s http://127.0.0.1:7860/api/v1/version
```

**Response (200 OK):**
```json
{
  "version": "1.9.3",
  "main_version": "1.9.3",
  "package": "Langflow"
}
```

**Notable:** Public endpoint, no auth required.

---

### 2. GET /api/v1/flows/

**Purpose:** List all flows available on the server.

**Request:**
```bash
curl -s -H "x-api-key: YOUR_API_KEY" http://127.0.0.1:7860/api/v1/flows/
```

**Response (200 OK):**
Expected structure (from LangFlow docs):
```json
[
  {
    "id": "e8d81c37-714b-49ae-ba82-e61141f020ee",
    "name": "My Flow",
    "description": "Description of flow",
    "icon": "icon_name",
    "icon_bg_color": "#FF0000",
    "gradient": "gradient_value",
    "data": {},
    "is_component": false,
    "updated_at": "2025-02-04T21:07:36+00:00",
    "webhook": false,
    "endpoint_name": "my-flow",
    "tags": ["tag1"],
    "locked": false,
    "user_id": "user-uuid",
    "project_id": "project-uuid"
  }
]
```

**Authentication:** Required (`x-api-key` header).

**Notable:**
- Returns empty array if no flows exist
- Could not be tested live without valid API key

---

### 3. POST /api/v1/run/{flow_id}

**Purpose:** Execute a flow synchronously or stream results.

**Request (Synchronous):**
```bash
curl -s -X POST "http://127.0.0.1:7860/api/v1/run/YOUR_FLOW_ID" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "input_value": "your input text",
    "session_id": "optional-session-id",
    "input_type": "chat",
    "output_type": "chat"
  }'
```

**Response (200 OK, Synchronous):**
```json
{
  "session_id": "optional-session-id",
  "outputs": [
    {
      "outputs": [
        {
          "results": {
            "message": {
              "text": "The actual output text from the flow goes here"
            }
          }
        }
      ]
    }
  ]
}
```

**JSONPath to output text:**
```
outputs[0].outputs[0].results.message.text
```

**Authentication:** Required (`x-api-key` header).

**Streaming Mode:**

Add `?stream=true` query parameter to enable streaming:

```bash
curl -s -N -X POST "http://127.0.0.1:7860/api/v1/run/YOUR_FLOW_ID?stream=true" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "input_value": "your input",
    "input_type": "chat",
    "output_type": "chat"
  }'
```

**Response (200 OK, Streaming - NDJSON):**

Each line is a complete JSON object (newline-delimited, not SSE):

```
{"event": "add_message", "data": {...}}
{"event": "token", "data": {"chunk": " Have"}}
{"event": "token", "data": {"chunk": " you"}}
{"event": "token", "data": {"chunk": " ever"}}
{"event": "end", "data": {...}}
```

**Streaming Event Types:**
1. `add_message` — Initial message setup
2. `token` — Streamed token chunk (access via `data.chunk`)
3. `end` — Stream termination signal

**Notable:** Streaming uses NDJSON format (not Server-Sent Events with `data:` prefix).

---

## Error Responses

### 403 Unauthorized (Invalid/Missing API Key)

```json
{
  "detail": "Invalid API key"
}
```

### 404 Not Found (Flow Does Not Exist)

Without valid API key, auth error is returned first. Once authenticated:

```json
{
  "detail": "Flow not found"
}
```

Status: `404 Not Found`

### 422 Validation Error (Malformed Request)

```json
{
  "detail": [
    {
      "loc": ["body", "field_name"],
      "msg": "Error message",
      "type": "value_error"
    }
  ]
}
```

---

## Request Body Parameters

Common parameters for run flow (`POST /api/v1/run/{flow_id}`):

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `input_value` | string | Yes | The primary input to the flow |
| `input_type` | string | No | e.g., "chat" |
| `output_type` | string | No | e.g., "chat" |
| `session_id` | string | No | For conversation continuity |

Query parameters:
| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `stream` | boolean | false | Enable streaming (NDJSON format) |

---

## Implementation Notes

1. **Header Name:** Use `x-api-key` (verified), NOT `Authorization: Bearer ...`
2. **Content-Type:** Always `application/json` for request bodies
3. **Output Location:** For non-streaming responses, text is always at `outputs[0].outputs[0].results.message.text`
4. **Streaming Format:** NDJSON (one JSON object per line), not SSE
5. **Public Endpoints:** Only `/api/v1/version` and `/health` are public
6. **API Key Requirement:** Enforced by `LANGFLOW_AUTO_LOGIN` setting on v1.5+; to disable auth, server must have `LANGFLOW_SKIP_AUTH_AUTO_LOGIN=true` set

---

## Testing Notes

- **Version endpoint:** Confirmed working (`1.9.3`)
- **List flows endpoint:** Could not be tested live (requires valid API key; not set in environment)
- **Run flow endpoint:** Could not be tested live (requires valid API key and at least one flow)
- **Streaming:** Format confirmed via documentation (NDJSON with event types)
- **Auth model:** Confirmed `x-api-key` header is recognized (503 on invalid key, 403 on missing)

To fully validate the `run` endpoint response shape, a valid `LANGFLOW_API_KEY` environment variable must be set on the client side, or the server's `LANGFLOW_SKIP_AUTH_AUTO_LOGIN` must be enabled.

---

## Sources

- [LangFlow API - Flow Trigger Endpoints](https://docs.langflow.org/api-flows-run)
- [LangFlow API - Flow Management](https://docs.langflow.org/api-flows)
- [LangFlow Get Started - Quickstart](https://docs.langflow.org/get-started-quickstart)
