# Component Catalog Rules

This file defines how Claude Code should use the Langflow component catalog when generating flow JSON.

The component catalog is the source of truth for available Langflow nodes in the local Langflow instance.

## Catalog files

Raw catalog:

    catalog/components.raw.json

Normalized catalog:

    catalog/components.normalized.json

Human-readable component index:

    catalog/component-index.md

## Core rule

Claude Code must generate flows only from components available in the local catalog, unless the user explicitly asks to create a new custom component.

Do not invent:

- component types
- component display names
- input fields
- output fields
- template fields
- edge handles
- provider-specific settings
- undocumented parameters

## Catalog refresh

If the normalized catalog does not exist, Claude Code should run:

    python .claude/skills/langflow-flow-builder/scripts/refresh_component_catalog.py
    python .claude/skills/langflow-flow-builder/scripts/normalize_component_catalog.py

If the raw catalog exists but the normalized catalog does not, Claude Code may run only:

    python .claude/skills/langflow-flow-builder/scripts/normalize_component_catalog.py

If the catalog refresh fails because Langflow is not running, Claude Code should continue only if an existing normalized catalog is available.

## Component selection priority

Claude Code should select components in this order:

1. Components already used in known-good templates under `flows/templates/`
2. Components already used in imported/exported flows under `flows/imported/`
3. Exact component type matches from `catalog/components.normalized.json`
4. Semantic matches from `catalog/components.normalized.json`
5. Proposed custom component under `custom_components/`

## When to use exact matches

Use exact matches when the requested flow clearly maps to a component type.

Examples:

- Chat input should use a ChatInput-like component.
- Chat output should use a ChatOutput-like component.
- Prompt templating should use a Prompt-like component.
- OpenAI-compatible models should use an OpenAI-compatible model component from the catalog.
- Vector retrieval should use a vector store or retriever component from the catalog.
- Tool execution should use a Tool-compatible component from the catalog.

## When to use semantic matches

Use semantic matches when the user describes a capability instead of a component name.

Examples:

- "PII anonymization" may map to Presidio, anonymizer, privacy, or custom components.
- "toxicity check" may map to moderation, toxicity, classifier, guardrail, or custom components.
- "retrieve documents" may map to retriever, vector store, document search, or embedding components.
- "local model" may map to Ollama, OpenAI-compatible, LM Studio, vLLM, or local provider components.

Semantic matches must still resolve to actual components from the catalog.

## Required component metadata

When choosing a component, Claude Code should inspect:

- component type
- display name
- description
- category
- base classes
- fields
- field types
- required fields
- input types
- output types
- outputs

If the metadata is incomplete, Claude Code should prefer examples from working flows.

## Missing components

If the user requests functionality that is not available in the catalog, Claude Code should not fake it.

Instead, it should propose one of these options:

1. Create a custom Langflow component under `custom_components/`
2. Use a generic Python/custom component if available in the catalog
3. Ask the user to install the missing Langflow integration
4. Generate only a design plan and explain what component is missing

## Custom component behavior

If a custom component is needed, Claude Code should propose:

- component name
- input fields
- output fields
- expected data types
- Python package requirements
- environment variables
- where the component file should live
- how it would connect into the flow

Preferred location:

    custom_components/

Example custom components:

    custom_components/presidio_anonymizer.py
    custom_components/toxicity_gate.py
    custom_components/privacy_vault.py
    custom_components/policy_guardrail.py

## Catalog search behavior

Claude Code can inspect the catalog using:

    python .claude/skills/langflow-flow-builder/scripts/inspect_component.py <search-term>

Examples:

    python .claude/skills/langflow-flow-builder/scripts/inspect_component.py chat
    python .claude/skills/langflow-flow-builder/scripts/inspect_component.py openai
    python .claude/skills/langflow-flow-builder/scripts/inspect_component.py prompt
    python .claude/skills/langflow-flow-builder/scripts/inspect_component.py qdrant
    python .claude/skills/langflow-flow-builder/scripts/inspect_component.py presidio
    python .claude/skills/langflow-flow-builder/scripts/inspect_component.py toxicity

## Flow generation behavior

Before writing JSON, Claude Code should identify the selected components and explain why they were chosen.

The flow design should include:

- selected component type
- selected display name
- purpose in the flow
- required fields
- expected outputs
- expected downstream connections

## Do not rely on memory

Claude Code should not rely on its training data for Langflow component names.

Langflow component names and JSON shapes may change across versions.

The running local Langflow instance and the local catalog are authoritative.

## Catalog versioning

The normalized catalog may be committed to the repo if the team wants deterministic generation.

For this repo, `.claude/` is local-only, but the catalog can still be kept in the repo if desired.

Recommended tracked files:

    catalog/components.normalized.json
    catalog/component-index.md
    catalog/README.md

Optional tracked file:

    catalog/components.raw.json

If the raw catalog is large or noisy, it may stay local-only.

## Failure behavior

If Claude Code cannot find a required component, it should report:

- requested capability
- searched terms
- closest matching components
- why the matches are insufficient
- recommended next step

Claude Code must not create fake component names just to complete the flow.
