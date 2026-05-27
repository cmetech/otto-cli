# Langflow Flow JSON Rules

This file defines the rules Claude Code should follow when generating Langflow flow JSON.

The goal is to generate JSON files that can be imported into Langflow, validated, reviewed, and committed if desired.

## High-level flow shape

A Langflow flow JSON file should generally contain:

    {
      "name": "Flow Name",
      "description": "Flow description",
      "data": {
        "nodes": [],
        "edges": [],
        "viewport": {
          "x": 0,
          "y": 0,
          "zoom": 1
        }
      }
    }

The exact node and edge shape should be based on:

1. existing exported flows
2. `flows/templates/`
3. `flows/imported/`
4. `catalog/components.normalized.json`

Claude Code should not generate flow JSON from memory alone.

## Required top-level fields

Every generated flow should include:

- `name`
- `description`
- `data`
- `data.nodes`
- `data.edges`
- `data.viewport`

Recommended top-level shape:

    {
      "name": "Readable Flow Name",
      "description": "What this flow does.",
      "data": {
        "nodes": [],
        "edges": [],
        "viewport": {
          "x": 0,
          "y": 0,
          "zoom": 1
        }
      }
    }

## Flow naming

Use clear names.

Good examples:

- `Simple OpenAI Chat`
- `Presidio Anonymization Chat`
- `Toxicity Gated Local LLM Chat`
- `Elasticsearch RAG Chat`
- `SOW Generation Flow`

Generated filenames should use lowercase kebab-case:

    flows/generated/simple-openai-chat.json
    flows/generated/presidio-anonymization-chat.json
    flows/generated/toxicity-gated-local-llm-chat.json
    flows/generated/elasticsearch-rag-chat.json

## Node rules

Every node should have:

- `id`
- `type`
- `position`
- `data`
- `data.id`
- `data.type`
- `data.node`

A node usually has this general shape:

    {
      "id": "ChatInput-chat-input",
      "type": "genericNode",
      "position": {
        "x": 100,
        "y": 100
      },
      "data": {
        "id": "ChatInput-chat-input",
        "type": "ChatInput",
        "node": {
          "display_name": "Chat Input",
          "description": "Input message from the user.",
          "base_classes": [
            "Message"
          ],
          "template": {}
        }
      }
    }

The actual `data.node` content should come from the local component catalog or a known-good exported flow.

## Flow compliance checklist

Every generated flow should be reviewed as a graph, not just as JSON.

Minimum compliance requirements:

- There is a clear valid user-entry path, usually Chat Input.
- There is at least one terminal output path, usually Chat Output.
- Chat Output must be connected to the final response-producing component.
- Required processing, model, parser, retriever, and output components are not disconnected.
- The primary happy path is traceable from input to output.
- Chat Input should normally expose a `message` output. Connect that output to the next component's compatible input field, usually `input_value` when the target accepts `Message`.
- Chat Output should normally receive the final response on its `input_value` field. In current Langflow exports, ChatOutput `input_value` is commonly a `HandleInput` with template `type: "other"` and `input_types` including `Message`.
- Do not generate a ChatOutput target handle with `type: "str"` when the ChatOutput template says `type: "other"`. Langflow may import the JSON but silently remove that connection.
- Any branch that handles blocked, invalid, or failed work has a terminal output or a documented sink.
- External calls such as model, gateway, HTTP, database, or retrieval calls include failure handling when catalog-valid components support it.
- If the local catalog has no router, try/catch, fallback, or error-output component that can express failure handling, document that limitation in the summary instead of inventing one.
- Validate and repair invalid edges until Langflow will not remove connections on import.

## Node ID rules

Use readable and stable node IDs.

Preferred pattern:

    <ComponentType>-<purpose>

Examples:

    ChatInput-chat-input
    Prompt-template
    OpenAIModel-llm
    ChatOutput-chat-output
    Parser-json-parser
    CustomComponent-presidio-anonymizer
    CustomComponent-toxicity-gate

Avoid random IDs unless they are required by Langflow validation.

Do not reuse the same node ID twice in one flow.

## Node positioning

Use simple left-to-right positions.

Recommended pattern:

- input nodes at x = 100
- processing nodes at x = 400
- model nodes at x = 700
- output nodes at x = 1000

Example:

    ChatInput-chat-input:
      x: 100
      y: 100

    Prompt-template:
      x: 400
      y: 100

    OpenAIModel-llm:
      x: 700
      y: 100

    ChatOutput-chat-output:
      x: 1000
      y: 100

For branches, increase y positions:

    safety-gate:
      x: 400
      y: 300

    fallback-output:
      x: 1000
      y: 300

## Template field rules

Do not invent template fields.

Every template field should come from one of these sources:

1. the selected component in `catalog/components.normalized.json`
2. a known-good exported flow
3. a known-good template flow
4. direct feedback from Langflow validation/import errors

If the catalog exposes required fields, fill them with safe defaults or placeholders.

For secrets, use placeholders. Never use literal secrets.

Examples:

    ${OPENAI_API_KEY}
    ${ANTHROPIC_API_KEY}
    ${AZURE_OPENAI_API_KEY}
    ${ELASTICSEARCH_URL}
    ${QDRANT_URL}
    ${WEAVIATE_URL}
    ${PRESIDIO_ANALYZER_URL}
    ${PRESIDIO_ANONYMIZER_URL}

## Edge rules

Every edge should have:

- `id`
- `source`
- `target`
- `sourceHandle`
- `targetHandle`
- `data`
- `data.sourceHandle`
- `data.targetHandle`

An edge generally connects one node output to another node input.

Example shape:

    {
      "id": "edge-ChatInput-chat-input-Prompt-template",
      "source": "ChatInput-chat-input",
      "target": "Prompt-template",
      "sourceHandle": "...",
      "targetHandle": "...",
      "data": {
        "sourceHandle": {},
        "targetHandle": {}
      }
    }

The exact handle content must come from existing examples, exported flows, or catalog metadata.

For each edge, validate handle metadata against the two node definitions:

- `data.sourceHandle.id` equals the source node id.
- `data.sourceHandle.name` exists in the source node `outputs[].name`.
- `data.sourceHandle.output_types` is compatible with the selected source output `types`.
- `data.targetHandle.id` equals the target node id.
- `data.targetHandle.fieldName` exists in the target node `template`.
- `data.targetHandle.inputTypes` is compatible with the target template field `input_types`.
- `data.targetHandle.type` matches the target template field `type` when that field provides a type.

If a connection disappears after import, the edge is not valid even if JSON syntax passed. Regenerate that edge from the component metadata and revalidate.

Do not invent handles.

## Edge ID rules

Use readable edge IDs.

Preferred pattern:

    edge-<source-node-id>-<target-node-id>

Example:

    edge-ChatInput-chat-input-Prompt-template
    edge-Prompt-template-OpenAIModel-llm
    edge-OpenAIModel-llm-ChatOutput-chat-output

If multiple edges connect the same nodes, append a purpose:

    edge-Agent-agent-Tool-weather-tool
    edge-Agent-agent-Tool-database-tool

## Data type compatibility

Before connecting nodes, verify type compatibility.

Common Langflow data types include:

- Message
- Data
- DataFrame
- LanguageModel
- Embeddings
- Retriever
- VectorStore
- Tool
- Text
- JSON

Examples:

- Chat input output should usually connect to a prompt or model input expecting message/text.
- Prompt output should usually connect to a model input expecting prompt/message/text.
- Model output should usually connect to chat output or parser input.
- Retriever output should usually connect to prompt/context input.
- Embedding model output should usually connect to vector store embedding input.
- Vector store output may connect to retriever or search components.
- Tools should connect to agents or tool-compatible components.

## Secret handling

Never put real secrets into flow JSON.

Bad:

    "api_key": "sk-real-secret-key"

Good:

    "api_key": "${OPENAI_API_KEY}"

Also acceptable when supported by the component:

    "api_key": {
      "type": "global",
      "value": "OPENAI_API_KEY"
    }

Claude Code should document all required variables in the final response.

## Provider configuration rules

For model providers, do not assume exact field names.

Inspect the selected component fields first.

Potential provider fields may include:

- API key
- base URL
- model name
- deployment name
- temperature
- max tokens
- streaming
- timeout

Only set fields that exist in the selected component.

## RAG flow rules

A RAG flow usually contains:

1. input
2. retriever or vector search
3. prompt template
4. model
5. output

Common RAG node sequence:

    ChatInput
    Retriever or VectorStore
    Prompt
    ChatModel
    ChatOutput

Required variables may include:

- model API key
- model base URL
- embedding model config
- vector database URL
- vector database API key
- collection name
- index name

## Safety or guardrail flow rules

A safety/guardrail flow may contain:

1. input
2. anonymizer
3. toxicity classifier
4. policy gate
5. model
6. output

Common sequence:

    ChatInput
    PresidioAnonymizer or CustomComponent
    ToxicityGate or CustomComponent
    Prompt
    ChatModel
    ChatOutput

If the required safety component does not exist in the catalog, propose a custom component.

## Custom component flow rules

If using custom components, the flow JSON should still reference only components actually available to Langflow.

If the custom component has not yet been created or loaded into Langflow, Claude Code should not pretend it exists.

Instead, Claude Code should either:

1. generate the custom component first
2. tell the user that the component must be added and catalog refreshed
3. generate a design plan only

## Validation rules

After writing a flow file, run:

    .claude/skills/langflow-flow-builder/scripts/validate_flow.sh flows/generated/<flow-name>.json

Validation must check at least JSON syntax.

If `lfx` is available, validation should also run:

    lfx validate flows/generated/<flow-name>.json

If validation fails, repair and retry.

Do not claim success if validation did not pass.

## Import rules

Only import when explicitly requested.

Import command:

    python .claude/skills/langflow-flow-builder/scripts/import_flow.py flows/generated/<flow-name>.json

If import fails, inspect the API response and fix the flow only if the issue is caused by generated JSON.

Do not hide missing credential errors.

Do not hide missing dependency errors.

Do not hide missing external service errors.

## Output summary rules

After generating a flow, Claude Code should summarize:

- generated flow file
- flow purpose
- main nodes
- required environment variables or Langflow globals
- validation result
- import result, if applicable
- smoke test result, if applicable
- assumptions

Example:

    Generated flow:
    - flows/generated/presidio-toxicity-gated-chat.json

    Purpose:
    - Accept chat input, anonymize PII, check toxicity, send safe text to the model, and return a chat response.

    Components:
    - ChatInput
    - PresidioAnonymizer
    - ToxicityGate
    - Prompt
    - OpenAI-compatible model
    - ChatOutput

    Required variables:
    - PRESIDIO_ANALYZER_URL
    - PRESIDIO_ANONYMIZER_URL
    - OPENAI_API_BASE
    - OPENAI_API_KEY

    Validation:
    - Passed

## Failure rules

If Claude Code cannot generate a valid flow, it should clearly explain:

- what it tried
- what is missing
- which component or metadata is unavailable
- what the user should do next

Do not hallucinate flow JSON around missing catalog data.
