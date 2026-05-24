#!/usr/bin/env python3

"""
Smoke test a Langflow flow through the local Langflow API.

Endpoint:

    POST /api/v1/run/<flow-id-or-name>

Environment variables:

    LANGFLOW_SERVER_URL
    LANGFLOW_API_KEY

Default values:

    LANGFLOW_SERVER_URL=http://127.0.0.1:7860

Usage:

    python .claude/skills/langflow-flow-builder/scripts/smoke_test_flow.py <flow-id-or-name> "hello"

Example:

    python .claude/skills/langflow-flow-builder/scripts/smoke_test_flow.py my-flow-id "What is Langflow?"
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

import requests


def load_dotenv(path: str = ".env") -> None:
    """
    Minimal .env loader.

    Existing environment variables take precedence over values in .env.
    """

    env_path = Path(path)

    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()

        if not line:
            continue

        if line.startswith("#"):
            continue

        if "=" not in line:
            continue

        key, value = line.split("=", 1)

        key = key.strip()
        value = value.strip().strip('"').strip("'")

        if not key:
            continue

        os.environ.setdefault(key, value)


def build_headers(api_key: str) -> dict[str, str]:
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
    }

    if api_key:
        headers["x-api-key"] = api_key

    return headers


def build_payload(message: str) -> dict[str, Any]:
    return {
        "input_value": message,
        "input_type": "chat",
        "output_type": "chat",
    }


def main() -> int:
    load_dotenv()

    if len(sys.argv) < 3:
        print(
            "Usage: smoke_test_flow.py <flow-id-or-name> <message>",
            file=sys.stderr,
        )
        return 1

    flow_id_or_name = sys.argv[1].strip()
    message = " ".join(sys.argv[2:]).strip()

    if not flow_id_or_name:
        print("ERROR: Flow id or name cannot be empty.", file=sys.stderr)
        return 1

    if not message:
        print("ERROR: Test message cannot be empty.", file=sys.stderr)
        return 1

    langflow_url = os.environ.get(
        "LANGFLOW_SERVER_URL",
        "http://127.0.0.1:7860",
    ).rstrip("/")

    api_key = os.environ.get("LANGFLOW_API_KEY", "").strip()

    url = f"{langflow_url}/api/v1/run/{flow_id_or_name}"
    headers = build_headers(api_key)
    payload = build_payload(message)

    print(f"Smoke testing Langflow flow: {flow_id_or_name}")
    print(f"Langflow URL: {url}")
    print(f"Input message: {message}")

    try:
        response = requests.post(
            url,
            headers=headers,
            json=payload,
            timeout=180,
        )
    except requests.RequestException as exc:
        print("ERROR: Could not connect to Langflow.", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        return 1

    if response.status_code >= 400:
        print("ERROR: Smoke test failed.", file=sys.stderr)
        print(f"Status: {response.status_code}", file=sys.stderr)
        print(response.text[:8000], file=sys.stderr)
        return 1

    try:
        response_payload = response.json()
    except ValueError:
        print("Smoke test response was not JSON:")
        print(response.text)
        return 0

    print("Smoke test response:")
    print(json.dumps(response_payload, indent=2, sort_keys=True))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
