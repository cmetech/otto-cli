#!/usr/bin/env python3

"""
Normalize Langflow's raw component catalog into an AI-agent-friendly index.

Reads:

    catalog/components.raw.json

Writes:

    catalog/components.normalized.json
    catalog/component-index.md

This version is intentionally flexible because Langflow's /api/v1/all response
can vary by version and may identify components by parent keys instead of
explicit `type` fields.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any


RAW_PATH = Path(
    os.environ.get(
        "LANGFLOW_RAW_COMPONENT_CATALOG",
        "catalog/components.raw.json",
    )
)

NORMALIZED_PATH = Path(
    os.environ.get(
        "LANGFLOW_COMPONENT_CATALOG",
        "catalog/components.normalized.json",
    )
)

INDEX_PATH = Path("catalog/component-index.md")


EXCLUDE_COMPONENT_NAMES = {
    "template",
    "fields",
    "outputs",
    "inputs",
    "metadata",
    "frontend_node",
    "code",
    "base_classes",
}


def safe_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()

    return None


def clean_component_type(value: str) -> str:
    value = value.strip()

    # Some Langflow keys can include path-ish or category-ish prefixes.
    value = value.split("/")[-1]
    value = value.split(".")[-1]

    return value


def looks_like_component_name(value: str) -> bool:
    if not value:
        return False

    if value in EXCLUDE_COMPONENT_NAMES:
        return False

    # Allow snake_case components and PascalCase components.
    return bool(re.match(r"^[A-Za-z_][A-Za-z0-9_ -]*$", value))


def first_string(obj: dict[str, Any], keys: list[str]) -> str | None:
    for key in keys:
        value = safe_string(obj.get(key))

        if value:
            return value

    return None


def as_string_list(value: Any) -> list[str]:
    if value is None:
        return []

    if isinstance(value, str):
        return [value] if value.strip() else []

    if isinstance(value, list):
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]

    return []


def extract_template(obj: dict[str, Any]) -> dict[str, Any]:
    for key in ["template", "fields"]:
        value = obj.get(key)

        if isinstance(value, dict):
            return value

    node = obj.get("node")

    if isinstance(node, dict):
        value = node.get("template")

        if isinstance(value, dict):
            return value

    frontend_node = obj.get("frontend_node")

    if isinstance(frontend_node, dict):
        data = frontend_node.get("data")

        if isinstance(data, dict):
            node = data.get("node")

            if isinstance(node, dict):
                value = node.get("template")

                if isinstance(value, dict):
                    return value

    return {}


def extract_template_fields(template: dict[str, Any]) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []

    for field_name, field_meta in template.items():
        if field_name.startswith("_"):
            continue

        field: dict[str, Any] = {
            "name": field_name,
        }

        if isinstance(field_meta, dict):
            for key in [
                "display_name",
                "name",
                "type",
                "input_types",
                "field_type",
                "required",
                "advanced",
                "info",
                "value",
                "options",
                "placeholder",
                "show",
                "password",
                "is_list",
                "list",
                "multiline",
                "dynamic",
                "real_time_refresh",
                "tool_mode",
            ]:
                if key in field_meta:
                    field[key] = field_meta[key]
        else:
            field["value"] = field_meta

        fields.append(field)

    fields.sort(key=lambda item: item["name"])

    return fields


def extract_outputs(obj: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = [
        obj.get("outputs"),
        obj.get("output"),
        obj.get("output_types"),
    ]

    node = obj.get("node")

    if isinstance(node, dict):
        candidates.extend(
            [
                node.get("outputs"),
                node.get("output"),
                node.get("output_types"),
            ]
        )

    outputs: list[dict[str, Any]] = []

    for raw_outputs in candidates:
        if not raw_outputs:
            continue

        if isinstance(raw_outputs, list):
            for item in raw_outputs:
                if isinstance(item, dict):
                    output = dict(item)

                    if "name" not in output:
                        output["name"] = (
                            output.get("display_name")
                            or output.get("method")
                            or output.get("type")
                            or "output"
                        )

                    outputs.append(output)

                elif isinstance(item, str):
                    outputs.append({"name": item})

        elif isinstance(raw_outputs, dict):
            for name, meta in raw_outputs.items():
                if isinstance(meta, dict):
                    outputs.append({"name": name, **meta})
                else:
                    outputs.append({"name": name, "value": meta})

    deduped: dict[str, dict[str, Any]] = {}

    for output in outputs:
        name = output.get("name") or json.dumps(output, sort_keys=True)
        deduped[str(name)] = output

    return list(deduped.values())


def component_like_score(obj: dict[str, Any]) -> int:
    score = 0

    if isinstance(obj.get("template"), dict):
        score += 5

    if isinstance(obj.get("fields"), dict):
        score += 4

    if isinstance(obj.get("outputs"), list):
        score += 3

    if isinstance(obj.get("base_classes"), list):
        score += 3

    if isinstance(obj.get("display_name"), str):
        score += 2

    if isinstance(obj.get("description"), str):
        score += 1

    if isinstance(obj.get("documentation"), str):
        score += 1

    if isinstance(obj.get("category"), str):
        score += 1

    if isinstance(obj.get("code"), str):
        score += 2

    if isinstance(obj.get("field_order"), list):
        score += 1

    return score


def iter_dicts_with_context(
    value: Any,
    path: list[str] | None = None,
    parent_key: str | None = None,
) -> list[tuple[dict[str, Any], list[str], str | None]]:
    if path is None:
        path = []

    found: list[tuple[dict[str, Any], list[str], str | None]] = []

    if isinstance(value, dict):
        found.append((value, path, parent_key))

        for key, child in value.items():
            found.extend(
                iter_dicts_with_context(
                    child,
                    path + [str(key)],
                    str(key),
                )
            )

    elif isinstance(value, list):
        for index, item in enumerate(value):
            found.extend(
                iter_dicts_with_context(
                    item,
                    path + [str(index)],
                    parent_key,
                )
            )

    return found


def infer_category(path: list[str], obj: dict[str, Any]) -> str | None:
    explicit = first_string(obj, ["category", "group", "bundle", "module"])

    if explicit:
        return explicit

    # For /api/v1/all, category is often represented by a parent path key.
    ignored = {
        "data",
        "types",
        "components",
        "component",
        "all",
        "template",
        "frontend_node",
        "node",
    }

    for part in reversed(path[:-1]):
        if part.isdigit():
            continue

        if part in ignored:
            continue

        if looks_like_component_name(part):
            return part

    return None


def infer_component_type(
    obj: dict[str, Any],
    path: list[str],
    parent_key: str | None,
) -> str | None:
    explicit = first_string(
        obj,
        [
            "type",
            "component_type",
            "component_name",
            "class_name",
            "name",
        ],
    )

    if explicit and looks_like_component_name(explicit):
        return clean_component_type(explicit)

    # In many catalog structures, the component type is the dictionary key.
    candidates: list[str] = []

    if parent_key:
        candidates.append(parent_key)

    if path:
        candidates.append(path[-1])

    for candidate in candidates:
        if candidate and looks_like_component_name(candidate):
            return clean_component_type(candidate)

    return None


def normalize_component(
    obj: dict[str, Any],
    path: list[str],
    parent_key: str | None,
) -> dict[str, Any] | None:
    score = component_like_score(obj)

    # Require enough evidence to avoid normalizing every nested field object.
    if score < 5:
        return None

    component_type = infer_component_type(obj, path, parent_key)

    if not component_type:
        return None

    template = extract_template(obj)
    fields = extract_template_fields(template)

    # A component with no fields and no outputs is usually not useful here.
    outputs = extract_outputs(obj)

    if not fields and not outputs and not obj.get("base_classes"):
        return None

    display_name = (
        first_string(obj, ["display_name", "label"])
        or component_type.replace("_", " ").replace("-", " ").title()
    )

    description = first_string(
        obj,
        [
            "description",
            "documentation",
            "info",
        ],
    )

    base_classes = as_string_list(obj.get("base_classes"))

    return {
        "type": component_type,
        "display_name": display_name,
        "category": infer_category(path, obj),
        "description": description,
        "base_classes": base_classes,
        "fields": fields,
        "outputs": outputs,
        "catalog_path": ".".join(path),
    }


def normalize(raw: Any) -> list[dict[str, Any]]:
    objects = iter_dicts_with_context(raw)
    components_by_key: dict[str, dict[str, Any]] = {}

    for obj, path, parent_key in objects:
        normalized = normalize_component(obj, path, parent_key)

        if not normalized:
            continue

        component_type = normalized["type"]
        category = normalized.get("category") or "Uncategorized"
        key = f"{category}:{component_type}"

        existing = components_by_key.get(key)

        if not existing:
            components_by_key[key] = normalized
            continue

        # Prefer the richer record if duplicates exist.
        existing_richness = len(existing.get("fields") or []) + len(existing.get("outputs") or [])
        new_richness = len(normalized.get("fields") or []) + len(normalized.get("outputs") or [])

        if new_richness > existing_richness:
            components_by_key[key] = normalized

    components = list(components_by_key.values())

    components.sort(
        key=lambda item: (
            str(item.get("category") or "Uncategorized").lower(),
            str(item.get("display_name") or item.get("type")).lower(),
            str(item.get("type")).lower(),
        )
    )

    return components


def write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    tmp_path = path.with_suffix(".tmp.json")

    tmp_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True),
        encoding="utf-8",
    )

    tmp_path.replace(path)


def write_markdown_index(components: list[dict[str, Any]]) -> None:
    lines: list[str] = [
        "# Langflow Component Index",
        "",
        "Generated from the local Langflow component catalog.",
        "",
        f"Component count: {len(components)}",
        "",
        "## Components",
        "",
    ]

    current_category: str | None = None

    for component in components:
        category = component.get("category") or "Uncategorized"

        if category != current_category:
            lines.append(f"### {category}")
            lines.append("")
            current_category = category

        component_type = component["type"]
        display_name = component.get("display_name") or component_type
        description = component.get("description") or ""
        base_classes = component.get("base_classes") or []
        fields = component.get("fields") or []
        outputs = component.get("outputs") or []

        lines.append(f"#### `{component_type}`")
        lines.append("")
        lines.append(f"- Display name: {display_name}")

        if description:
            lines.append(f"- Description: {description}")

        if base_classes:
            base_classes_text = ", ".join(f"`{item}`" for item in base_classes)
            lines.append(f"- Base classes: {base_classes_text}")

        if fields:
            field_names = ", ".join(
                f"`{field.get('name')}`"
                for field in fields[:40]
                if field.get("name")
            )
            lines.append(f"- Fields: {field_names}")

        if outputs:
            output_names = ", ".join(
                f"`{output.get('name')}`"
                for output in outputs[:40]
                if output.get("name")
            )
            lines.append(f"- Outputs: {output_names}")

        catalog_path = component.get("catalog_path")

        if catalog_path:
            lines.append(f"- Catalog path: `{catalog_path}`")

        lines.append("")

    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    if not RAW_PATH.exists():
        print(f"ERROR: Missing raw catalog: {RAW_PATH}", file=sys.stderr)
        print(
            "Run refresh_component_catalog.py first while Langflow is running.",
            file=sys.stderr,
        )
        return 1

    try:
        raw = json.loads(RAW_PATH.read_text(encoding="utf-8"))
    except ValueError as exc:
        print(f"ERROR: Raw catalog is not valid JSON: {RAW_PATH}", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        return 1

    components = normalize(raw)

    if not components:
        print("ERROR: No components were detected in the raw catalog.", file=sys.stderr)
        print(
            "The Langflow catalog shape may have changed. Inspect catalog/components.raw.json.",
            file=sys.stderr,
        )
        return 1

    normalized_payload = {
        "source": str(RAW_PATH),
        "component_count": len(components),
        "components": components,
    }

    write_json_atomic(NORMALIZED_PATH, normalized_payload)
    write_markdown_index(components)

    print(f"Wrote normalized component catalog: {NORMALIZED_PATH}")
    print(f"Wrote component index: {INDEX_PATH}")
    print(f"Detected components: {len(components)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
