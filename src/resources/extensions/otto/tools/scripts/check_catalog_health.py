#!/usr/bin/env python3

"""
Check the normalized Langflow component catalog for common flow-building capabilities.

Reads:

    catalog/components.normalized.json

Usage:

    python .claude/skills/langflow-flow-builder/scripts/check_catalog_health.py
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


CHECKS = {
    "chat_input": [
        "chatinput",
        "chat input",
        "input message",
    ],
    "chat_output": [
        "chatoutput",
        "chat output",
        "output message",
    ],
    "prompt": [
        "prompt",
        "template",
    ],
    "llm_model": [
        "model",
        "language model",
        "openai",
        "anthropic",
        "ollama",
        "bedrock",
        "azure",
    ],
    "embeddings": [
        "embedding",
        "embeddings",
    ],
    "retriever": [
        "retriever",
        "retrieve",
        "search documents",
    ],
    "vector_store": [
        "vector",
        "qdrant",
        "weaviate",
        "chroma",
        "astra",
        "milvus",
        "elasticsearch",
    ],
    "agent": [
        "agent",
        "tools",
    ],
    "tool": [
        "tool",
    ],
    "parser": [
        "parser",
        "json",
        "structured",
    ],
    "custom_or_python": [
        "custom",
        "python",
        "code",
    ],
    "safety_or_guardrail": [
        "guardrail",
        "moderation",
        "toxicity",
        "presidio",
        "anonym",
        "privacy",
        "pii",
    ],
}


def load_catalog() -> dict[str, Any]:
    if not CATALOG_PATH.exists():
        raise FileNotFoundError(
            f"Missing normalized catalog: {CATALOG_PATH}. "
            "Run refresh_component_catalog.py and normalize_component_catalog.py first."
        )

    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def searchable_text(component: dict[str, Any]) -> str:
    parts: list[str] = []

    for key in [
        "type",
        "display_name",
        "category",
        "description",
        "catalog_path",
    ]:
        value = component.get(key)

        if isinstance(value, str):
            parts.append(value)

    for base_class in component.get("base_classes") or []:
        if isinstance(base_class, str):
            parts.append(base_class)

    for field in component.get("fields") or []:
        if isinstance(field, dict):
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

    for output in component.get("outputs") or []:
        if isinstance(output, dict):
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


def main() -> int:
    try:
        catalog = load_catalog()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    components = catalog.get("components", [])

    if not isinstance(components, list):
        print("ERROR: Invalid catalog. Expected `components` list.", file=sys.stderr)
        return 1

    print(f"Catalog: {CATALOG_PATH}")
    print(f"Component count: {len(components)}")
    print()

    indexed = [
        {
            "component": component,
            "text": searchable_text(component),
        }
        for component in components
        if isinstance(component, dict)
    ]

    for check_name, terms in CHECKS.items():
        matches: list[dict[str, Any]] = []

        for item in indexed:
            text = item["text"]

            if any(term.lower() in text for term in terms):
                matches.append(item["component"])

        print("=" * 100)
        print(f"Check: {check_name}")
        print(f"Search terms: {', '.join(terms)}")
        print(f"Matches: {len(matches)}")

        for component in matches[:12]:
            component_type = component.get("type") or "unknown"
            display_name = component.get("display_name") or component_type
            category = component.get("category") or "Uncategorized"
            base_classes = component.get("base_classes") or []

            base_classes_text = ", ".join(base_classes) if base_classes else "none"

            print(f"  - {component_type} | {display_name} | category={category} | base_classes={base_classes_text}")

        if len(matches) > 12:
            print(f"  ... {len(matches) - 12} more")

        print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
