# Langflow Flow Builder Workflow

This file defines the standard workflow Claude Code should follow when creating Langflow flow JSON in this repository.

The goal is to let a developer describe a desired Langflow flow in natural language and receive a valid JSON file that can be imported into Langflow.

## Standard lifecycle

Claude Code should follow this lifecycle every time it builds or modifies a Langflow flow:

1. Understand the requested flow.
2. Ask only the minimum required clarification questions.
3. Inspect the local component catalog.
4. Select valid Langflow components.
5. Prefer existing templates and imported working flows.
6. Generate flow JSON under `flows/generated/`.
7. Validate the flow JSON.
8. Repair validation errors if possible.
9. Optionally import the flow into Langflow.
10. Optionally smoke test the flow.
11. Return a concise result summary.

## Expected command

A developer should invoke the skill like this:

    /langflow-flow-builder "Create a RAG flow that accepts a chat question, retrieves context from local documents, sends the context to an OpenAI-compatible model, and returns a chat answer."

Another example:

    /langflow-flow-builder "Create a flow that anonymizes PII with Presidio, checks toxicity, and only sends clean text to a local OpenAI-compatible model."

## Repository paths

Generated flows:

    flows/generated/

Reusable flow templates:

    flows/templates/

Imported or exported reference flows:

    flows/imported/

Local custom components:

    custom_components/

Raw Langflow component catalog:

    catalog/components.raw.json

Normalized Langflow component catalog:

    catalog/components.normalized.json

Human-readable component index:

    catalog/component-index.md

Skill scripts:

    .claude/skills/langflow-flow-builder/scripts/

Skill reference docs:

    .claude/skills/langflow-flow-builder/reference/

## Required behavior

Claude Code must prefer correctness over speed.

Before creating a flow, Claude Code should inspect the normalized component catalog.

Claude Code must not invent:

- component names
- input names
- output names
- template fields
- edge handles
- provider-specific fields
- secret variable names that were not requested or clearly implied

If a required component does not exist, Claude Code should propose a custom component instead of fabricating an unavailable Langflow node.

## Clarification behavior

Claude Code should only ask clarification questions when the missing information blocks a valid flow design.

Good clarification questions include:

- What should the input type be?
- Which model provider should the flow use?
- Which vector database or retrieval source should be used?
- Should the flow use memory?
- Should the output be text, JSON, a table, or a file?
- Should I only generate JSON, or also import and test it?
- Are there custom components I should use?

Claude Code should not ask unnecessary questions when reasonable defaults are already available.

## Default assumptions

If the user does not specify otherwise, assume:

- input type: chat
- output type: chat
- generated flow location: `flows/generated/`
- local Langflow URL: `http://127.0.0.1:7860`
- if a local OTTO gateway is configured or reachable, LLM-backed flows should prefer the OTTO gateway
- OTTO gateway default base URL: `http://127.0.0.1:18080`
- OTTO gateway default API shape: Anthropic Messages (`/v1/messages`), not Ollama and not OpenAI chat completions
- OTTO gateway model default: `claude-sonnet-4`
- OTTO gateway credential placeholder: `${OTTO_GATEWAY_TOKEN}`
- catalog file: `catalog/components.normalized.json`
- raw catalog file: `catalog/components.raw.json`
- secrets should be placeholders or Langflow globals
- generated JSON should not be imported unless explicitly requested

## Component selection order

Claude Code should select components in this order:

1. Known-good templates in `flows/templates/`
2. Known-good imported/exported flows in `flows/imported/`
3. Exact matches from `catalog/components.normalized.json`
4. Semantic matches from `catalog/components.normalized.json`
5. Proposed custom component under `custom_components/`

## Validation behavior

After generating a flow, Claude Code should run:

    .claude/skills/langflow-flow-builder/scripts/validate_flow.sh flows/generated/<flow-name>.json

If validation fails, Claude Code should:

1. read the error message
2. identify the broken node, field, or edge
3. repair the JSON
4. validate again

Claude Code should not claim the flow is valid unless validation passes.

If validation cannot run because tooling is missing, Claude Code should clearly say that only JSON syntax validation was completed.

The OTTO `otto__validate_flow` tool also performs local static graph checks even when `lfx` is unavailable. Those checks are part of the builder contract:

- every edge source and target must exist in `data.nodes`
- every edge must include `sourceHandle`, `targetHandle`, `data.sourceHandle`, and `data.targetHandle`
- every source handle output name must exist in the source component outputs
- every target handle field name must exist in the target component template
- when a target template field exposes a `type`, `data.targetHandle.type` must match it
- Chat Input nodes must have a downstream edge from their `message` output for normal chat flows
- Chat Output nodes must have an incoming edge to their `input_value` field

If validation reports an edge mismatch, Claude Code should repair the edge from component metadata instead of mutating random handle strings.

## Flow compliance checklist

Before declaring a generated flow complete, Claude Code must verify basic flow compliance:

- The graph has one clear valid user-entry path, usually Chat Input.
- The graph has at least one terminal output path, usually Chat Output.
- Chat Output must be connected to the final response-producing component.
- Required components must not be left disconnected.
- Every edge source and target must exist in `data.nodes`.
- Every edge must use catalog-confirmed, exported-flow-confirmed, or validation-confirmed handles.
- For Chat Input, connect the `message` output from the ChatInput node to a compatible downstream `input_value` or message field.
- For Chat Output, connect the final response component's Message-producing output, often `text_output` or `message`, to ChatOutput `input_value`.
- ChatOutput `input_value` is usually a `HandleInput` whose template field type is `other`; the target handle must use `type: other`, not `type: str`, unless the exported component metadata explicitly differs.
- The flow should validate and repair any invalid edge until Langflow will not remove connections on import.
- If Langflow imports the flow but reports that connections were removed, treat that as failed validation. Inspect the removed connection, regenerate that edge from the source output and target template metadata, revalidate, and re-import only after the edge metadata matches.
- External calls such as model, gateway, HTTP, database, or retrieval calls should have failure handling when catalog-valid components support it.
- If catalog-valid failure handling cannot be represented, Claude Code should document that limitation instead of inventing unavailable router/error components.

## Import behavior

Claude Code should only import a flow if explicitly requested.

Import command:

    python .claude/skills/langflow-flow-builder/scripts/import_flow.py flows/generated/<flow-name>.json

If import fails, Claude Code should inspect the Langflow API response and repair the flow only when the issue is caused by generated JSON.

## Smoke test behavior

Claude Code should only run a smoke test if explicitly requested.

Smoke test command:

    python .claude/skills/langflow-flow-builder/scripts/smoke_test_flow.py <flow-id-or-name> "test input"

Claude Code should not treat missing credentials, missing vector databases, unavailable model providers, or stopped services as JSON-generation failures.

## Final response format

Claude Code should return:

- generated file path
- short flow summary
- components used
- required variables
- validation result
- import result, if imported
- smoke test result, if tested
- remaining assumptions or unresolved issues

## Failure behavior

If Claude Code cannot generate a valid flow, it should explain exactly why.

Acceptable failure reasons include:

- Langflow is not running
- component catalog is missing
- required component does not exist
- catalog does not expose enough handle metadata
- validation tooling is unavailable
- required provider details are missing
- required credentials are not configured

Claude Code must not hallucinate around missing catalog data.
