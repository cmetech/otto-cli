---
name: langflow
description: Use when the user asks to build, list, show, import, export, delete, run, check, or manage LangFlow flows in natural language.
---

<objective>
Turn natural-language LangFlow requests into observable `otto__langflow` tool calls. Do not ask the user to retype a slash command when the typed tool can perform the action.
</objective>

<intent_mapping>
Use `otto__langflow` with these actions:

- `build_flow`: User wants to create/build/generate a LangFlow flow from a description.
- `list_flows`: User wants to list flows, see all flows, or filter flows by name/prefix such as "starting with otto".
- `show_flow`: User wants to inspect/show/view a specific server flow JSON.
- `import_flow`: User wants to import/re-import/update/replace a flow JSON into LangFlow.
- `export_flow`: User wants to export/download/save a server flow JSON locally.
- `delete_flow`: User wants to delete/remove a server flow.
- `run_flow`: User wants to execute/run/test a flow with input text.
- `status`: User wants to check LangFlow health or connection status.
</intent_mapping>

<required_behavior>
- For natural-language LangFlow work, call `otto__langflow` so the TUI shows the LangFlow tool call and arguments.
- For `build_flow`, pass the user's full requested flow behavior in `description`.
- For `list_flows` phrases such as "starting with X", set `prefix` to `X`.
- For `import_flow`, set `file` to the provided path or flow file name. Set `update`, `replace`, or `createNew` only when the user asked for that behavior.
- For `export_flow`, set `flow` to the provided id/name/endpoint. Set `overwrite` only when the user asked to overwrite.
- For `delete_flow`, set `confirmDelete: true` only when the user clearly asked to delete/remove the flow. If deletion intent is ambiguous, ask one concise confirmation question.
- For `run_flow`, set `flow` and `input`.
- If required fields are missing and cannot be inferred, ask one concise clarification question.
- If `otto__langflow` reports that LangFlow is not connected or authentication is missing, do not retry the tool call. Tell the user to run `/otto langflow connect`, provide the LangFlow URL/API key if prompted, then retry their request.
</required_behavior>

<examples>
User: "I want to build a langflow flow that sends chat input to OTTO gateway"
Tool: `otto__langflow({ "action": "build_flow", "description": "sends chat input to OTTO gateway" })`

User: "Show me all flows starting with otto"
Tool: `otto__langflow({ "action": "list_flows", "prefix": "otto" })`

User: "Import .otto/langflow/generated/otto-hello-world.json and update the existing flow"
Tool: `otto__langflow({ "action": "import_flow", "file": ".otto/langflow/generated/otto-hello-world.json", "update": true })`

User: "Export otto-hello-world and overwrite the local json"
Tool: `otto__langflow({ "action": "export_flow", "flow": "otto-hello-world", "overwrite": true })`

User: "Run otto-hello-world with hello from otto"
Tool: `otto__langflow({ "action": "run_flow", "flow": "otto-hello-world", "input": "hello from otto" })`
</examples>
