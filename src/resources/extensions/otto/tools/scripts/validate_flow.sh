#!/usr/bin/env bash
set -euo pipefail

FLOW_FILE="${1:-}"

if [[ -z "$FLOW_FILE" ]]; then
  echo "Usage: validate_flow.sh <flow-json-file>" >&2
  exit 1
fi

if [[ ! -f "$FLOW_FILE" ]]; then
  echo "ERROR: Flow file not found: $FLOW_FILE" >&2
  exit 1
fi

echo "Validating JSON syntax: $FLOW_FILE"

python -m json.tool "$FLOW_FILE" >/dev/null

echo "JSON syntax: OK"

echo "Validating LangFlow graph edges..."

python - "$FLOW_FILE" <<'PY'
import json
import sys

flow_file = sys.argv[1]
with open(flow_file, "r", encoding="utf-8") as f:
    flow = json.load(f)

data = flow.get("data") or {}
nodes = data.get("nodes") or []
edges = data.get("edges") or []
node_by_id = {node.get("id"): node for node in nodes if node.get("id")}
errors = []

def node_type(node):
    return ((node.get("data") or {}).get("type")
            or (((node.get("data") or {}).get("node") or {}).get("name"))
            or node.get("type")
            or "")

def node_payload(node):
    return ((node.get("data") or {}).get("node") or {})

def template(node):
    return node_payload(node).get("template") or {}

def outputs(node):
    return node_payload(node).get("outputs") or []

def output_by_name(node, name):
    for out in outputs(node):
        if out.get("name") == name:
            return out
    return None

def compatible(source_types, target_types):
    if not source_types or not target_types:
        return True
    return bool(set(source_types).intersection(set(target_types)))

for edge in edges:
    edge_id = edge.get("id") or "<missing-id>"
    source_id = edge.get("source")
    target_id = edge.get("target")
    if not edge.get("id"):
        errors.append("edge is missing id")
    if not source_id or source_id not in node_by_id:
        errors.append(f"{edge_id}: source node does not exist: {source_id}")
        continue
    if not target_id or target_id not in node_by_id:
        errors.append(f"{edge_id}: target node does not exist: {target_id}")
        continue

    if not edge.get("sourceHandle"):
        errors.append(f"{edge_id}: missing sourceHandle")
    if not edge.get("targetHandle"):
        errors.append(f"{edge_id}: missing targetHandle")

    edge_data = edge.get("data") or {}
    source_handle = edge_data.get("sourceHandle")
    target_handle = edge_data.get("targetHandle")
    if not isinstance(source_handle, dict):
        errors.append(f"{edge_id}: missing data.sourceHandle")
        source_handle = {}
    if not isinstance(target_handle, dict):
        errors.append(f"{edge_id}: missing data.targetHandle")
        target_handle = {}

    source_node = node_by_id[source_id]
    target_node = node_by_id[target_id]
    source_data_type = source_handle.get("dataType")
    expected_source_type = node_type(source_node)
    if source_data_type and expected_source_type and source_data_type != expected_source_type:
        errors.append(
            f"{edge_id}: source handle dataType {source_data_type!r} does not match source node type {expected_source_type!r}"
        )
    if source_handle.get("id") and source_handle.get("id") != source_id:
        errors.append(f"{edge_id}: source handle id does not match source node id")

    source_output_name = source_handle.get("name")
    source_output = output_by_name(source_node, source_output_name)
    if source_output_name and source_output is None:
        errors.append(f"{edge_id}: source output {source_output_name!r} does not exist on {source_id}")

    target_field = target_handle.get("fieldName")
    target_template = template(target_node)
    target_field_meta = target_template.get(target_field) if target_field else None
    if target_handle.get("id") and target_handle.get("id") != target_id:
        errors.append(f"{edge_id}: target handle id does not match target node id")
    if target_field and target_field_meta is None:
        errors.append(f"{edge_id}: target field {target_field!r} does not exist on {target_id}")

    if isinstance(target_field_meta, dict):
        expected_type = target_field_meta.get("type")
        actual_type = target_handle.get("type")
        if expected_type and actual_type and expected_type != actual_type:
            errors.append(
                f"{edge_id}: target handle type {actual_type!r} does not match {target_id}.{target_field} type {expected_type!r}"
            )
        source_types = source_handle.get("output_types") or source_output.get("types") if source_output else source_handle.get("output_types")
        target_types = target_handle.get("inputTypes") or target_field_meta.get("input_types")
        if source_types and target_types and not compatible(source_types, target_types):
            errors.append(
                f"{edge_id}: source output types {source_types!r} are not compatible with target input types {target_types!r}"
            )

chat_inputs = [node for node in nodes if node_type(node) == "ChatInput"]
chat_outputs = [node for node in nodes if node_type(node) == "ChatOutput"]

for node in chat_inputs:
    node_id = node.get("id")
    outgoing_message = [
        edge for edge in edges
        if edge.get("source") == node_id
        and ((edge.get("data") or {}).get("sourceHandle") or {}).get("name") == "message"
    ]
    if not outgoing_message:
        errors.append(f"{node_id}: ChatInput has no outgoing edge from message output")

for node in chat_outputs:
    node_id = node.get("id")
    incoming_input = [
        edge for edge in edges
        if edge.get("target") == node_id
        and ((edge.get("data") or {}).get("targetHandle") or {}).get("fieldName") == "input_value"
    ]
    if not incoming_input:
        errors.append(f"{node_id}: ChatOutput has no incoming edge to input_value")

if errors:
    print("Graph edge validation failed:", file=sys.stderr)
    for error in errors:
        print(f"  - {error}", file=sys.stderr)
    sys.exit(1)

print("Graph edge validation: OK")
PY

if command -v lfx >/dev/null 2>&1; then
  echo "Running Langflow validation with system lfx..."
  lfx validate "$FLOW_FILE"
  echo "Langflow validation: OK"
  exit 0
fi

if [[ -x ".venv/bin/lfx" ]]; then
  echo "Running Langflow validation with .venv/bin/lfx..."
  .venv/bin/lfx validate "$FLOW_FILE"
  echo "Langflow validation: OK"
  exit 0
fi

echo "WARNING: lfx was not found." >&2
echo "JSON syntax validation passed, but Langflow-specific validation was skipped." >&2
echo "Activate your virtual environment or install lfx, then run:" >&2
echo "  lfx validate $FLOW_FILE" >&2

exit 0
