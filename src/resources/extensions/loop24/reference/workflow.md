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
