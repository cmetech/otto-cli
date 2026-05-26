#!/usr/bin/env python3

"""
Refresh the local Langflow component catalog from a running Langflow server.

This script calls:

    GET /api/v1/all

and writes:

    catalog/components.raw.json

Environment variables:

    LANGFLOW_SERVER_URL
    LANGFLOW_API_KEY
    LANGFLOW_RAW_COMPONENT_CATALOG

Default values:

    LANGFLOW_SERVER_URL=http://127.0.0.1:7860
    LANGFLOW_RAW_COMPONENT_CATALOG=catalog/components.raw.json

Usage:

    python .claude/skills/langflow-flow-builder/scripts/refresh_component_catalog.py
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

    This avoids requiring python-dotenv just for this helper script.
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
    }

    if api_key:
        headers["x-api-key"] = api_key

    return headers


def write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    tmp_path = path.with_suffix(".tmp.json")

    tmp_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True),
        encoding="utf-8",
    )

    tmp_path.replace(path)


def main() -> int:
    load_dotenv()

    langflow_url = os.environ.get(
        "LANGFLOW_SERVER_URL",
        "http://127.0.0.1:7860",
    ).rstrip("/")

    api_key = os.environ.get("LANGFLOW_API_KEY", "").strip()

    output_file = Path(
        os.environ.get(
            "LANGFLOW_RAW_COMPONENT_CATALOG",
            "catalog/components.raw.json",
        )
    )

    url = f"{langflow_url}/api/v1/all"
    headers = build_headers(api_key)

    print(f"Refreshing Langflow component catalog from: {url}")

    try:
        response = requests.get(
            url,
            headers=headers,
            timeout=90,
        )
    except requests.RequestException as exc:
        print("ERROR: Could not connect to Langflow.", file=sys.stderr)
        print(f"URL: {url}", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        return 1

    if response.status_code >= 400:
        print("ERROR: Langflow returned an error.", file=sys.stderr)
        print(f"Status: {response.status_code}", file=sys.stderr)
        print(response.text[:4000], file=sys.stderr)
        return 1

    try:
        payload = response.json()
    except ValueError as exc:
        print("ERROR: Langflow returned a non-JSON response.", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        print(response.text[:4000], file=sys.stderr)
        return 1

    write_json_atomic(output_file, payload)

    print(f"Wrote raw component catalog: {output_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
