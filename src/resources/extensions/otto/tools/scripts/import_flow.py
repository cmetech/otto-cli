#!/usr/bin/env python3

"""
Import a Langflow flow JSON file into a running Langflow server.

Endpoint:

    POST /api/v1/flows/upload/

Environment variables:

    LANGFLOW_SERVER_URL
    LANGFLOW_API_KEY

Default values:

    LANGFLOW_SERVER_URL=http://127.0.0.1:7860

Usage:

    python .claude/skills/langflow-flow-builder/scripts/import_flow.py flows/generated/my-flow.json
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

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
    headers: dict[str, str] = {
        "accept": "application/json",
    }

    if api_key:
        headers["x-api-key"] = api_key

    return headers


def main() -> int:
    load_dotenv()

    if len(sys.argv) != 2:
        print("Usage: import_flow.py <flow-json-file>", file=sys.stderr)
        return 1

    flow_file = Path(sys.argv[1])

    if not flow_file.exists():
        print(f"ERROR: Flow file not found: {flow_file}", file=sys.stderr)
        return 1

    if not flow_file.is_file():
        print(f"ERROR: Path is not a file: {flow_file}", file=sys.stderr)
        return 1

    langflow_url = os.environ.get(
        "LANGFLOW_SERVER_URL",
        "http://127.0.0.1:7860",
    ).rstrip("/")

    api_key = os.environ.get("LANGFLOW_API_KEY", "").strip()

    url = f"{langflow_url}/api/v1/flows/upload/"
    headers = build_headers(api_key)

    print(f"Importing flow into Langflow: {flow_file}")
    print(f"Langflow URL: {url}")

    try:
        with flow_file.open("rb") as file_handle:
            files = {
                "file": (
                    flow_file.name,
                    file_handle,
                    "application/json",
                )
            }

            response = requests.post(
                url,
                headers=headers,
                files=files,
                timeout=120,
            )

    except requests.RequestException as exc:
        print("ERROR: Could not connect to Langflow.", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        return 1

    if response.status_code >= 400:
        print("ERROR: Flow import failed.", file=sys.stderr)
        print(f"Status: {response.status_code}", file=sys.stderr)
        print(response.text[:8000], file=sys.stderr)
        return 1

    print("Flow import response:")
    print(response.text)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
