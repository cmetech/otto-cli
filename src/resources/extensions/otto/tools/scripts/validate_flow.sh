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
