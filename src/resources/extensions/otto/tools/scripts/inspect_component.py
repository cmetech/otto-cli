#!/usr/bin/env python3

"""
Inspect components from the normalized Langflow component catalog.

Reads:

    catalog/components.normalized.json

Usage:

    python .claude/skills/langflow-flow-builder/scripts/inspect_component.py <search-term>

Examples:

    python .claude/skills/langflow-flow-builder/scripts/inspect_component.py chat
    python .claude/skills/langflow-flow-builder/scripts/inspect_component.py openai
    python .claude/skills/langflow-flow-builder/scripts/inspect_component.py qdrant
    python .claude/skills/langflow-flow-builder/scripts/inspect_component.py toxicity
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any


CATALOG_PATH = Path(
    os.environ.get(
        "LANGFLOW_COMPONENT_CATALOG",
        "catalog/components.normalized.json",
    )
)


def load_catalog(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(
            f"Missing normalized catalog: {path}. "
            "Run refresh_component_catalog.py and normalize_component_catalog.py first."
        )

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise ValueError(f"Catalog is not valid JSON: {path}") from exc


def component_search_text(component: dict[str, Any]) -> str:
    parts: list[str] = []

    for key in [
        "type",
        "display_name",
        "category",
        "description",
    ]:
        value = component.get(key)

        if isinstance(value, str):
            parts.append(value)

    for base_class in component.get("base_classes") or []:
        if isinstance(base_class, str):
            parts.append(base_class)

    for field in component.get("fields") or []:
        if not isinstance(field, dict):
            continue

        for key in [
            "name",
            "display_name",
            "type",
            "field_type",
            "info",
        ]:
            value = field.get(key)

            if isinstance(value, str):
                parts.append(value)

        for input_type in field.get("input_types") or []:
            if isinstance(input_type, str):
                parts.append(input_type)

    for output in component.get("outputs") or []:
        if not isinstance(output, dict):
            continue

        for key in [
            "name",
            "display_name",
            "type",
            "method",
        ]:
            value = output.get(key)

            if isinstance(value, str):
                parts.append(value)

    return " ".join(parts).lower()


def summarize_component(component: dict[str, Any]) -> str:
    component_type = component.get("type") or "unknown"
    display_name = component.get("display_name") or component_type
    category = component.get("category") or "Uncategorized"
    description = component.get("description") or ""
    base_classes = component.get("base_classes") or []
    fields = component.get("fields") or []
    outputs = component.get("outputs") or []

    lines: list[str] = []

    lines.append("=" * 100)
    lines.append(f"Type: {component_type}")
    lines.append(f"Display name: {display_name}")
    lines.append(f"Category: {category}")

    if description:
        lines.append(f"Description: {description}")

    if base_classes:
        lines.append("Base classes:")
        for item in base_classes:
            lines.append(f"  - {item}")

    if fields:
        lines.append("Fields:")
        for field in fields:
            if not isinstance(field, dict):
                continue

            name = field.get("name") or "unknown"
            display = field.get("display_name")
            field_type = field.get("type") or field.get("field_type")
            input_types = field.get("input_types")
            required = field.get("required")
            advanced = field.get("advanced")

            details: list[str] = []

            if display:
                details.append(f"display={display}")

            if field_type:
                details.append(f"type={field_type}")

            if input_types:
                details.append(f"input_types={input_types}")

            if required is not None:
                details.append(f"required={required}")

            if advanced is not None:
                details.append(f"advanced={advanced}")

            detail_text = ", ".join(details)

            if detail_text:
                lines.append(f"  - {name}: {detail_text}")
            else:
                lines.append(f"  - {name}")

    if outputs:
        lines.append("Outputs:")
        for output in outputs:
            if not isinstance(output, dict):
                continue

            name = output.get("name") or "unknown"
            output_type = output.get("type")
            display = output.get("display_name")
            method = output.get("method")

            details = []

            if display:
                details.append(f"display={display}")

            if output_type:
                details.append(f"type={output_type}")

            if method:
                details.append(f"method={method}")

            detail_text = ", ".join(details)

            if detail_text:
                lines.append(f"  - {name}: {detail_text}")
            else:
                lines.append(f"  - {name}")

    return "\n".join(lines)


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: inspect_component.py <search-term>", file=sys.stderr)
        return 1

    query = " ".join(sys.argv[1:]).strip().lower()

    if not query:
        print("ERROR: Search term cannot be empty.", file=sys.stderr)
        return 1

    try:
        catalog = load_catalog(CATALOG_PATH)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    components = catalog.get("components", [])

    if not isinstance(components, list):
        print("ERROR: Invalid normalized catalog. Expected a top-level `components` list.", file=sys.stderr)
        return 1

    matches: list[dict[str, Any]] = []

    for component in components:
        if not isinstance(component, dict):
            continue

        search_text = component_search_text(component)

        if query in search_text:
            matches.append(component)

    if not matches:
        print(f"No component matches found for: {query}")
        return 2

    print(f"Found {len(matches)} match(es) for: {query}")

    for component in matches:
        print(summarize_component(component))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
