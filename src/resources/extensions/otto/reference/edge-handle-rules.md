# Edge Handle Rules

This file defines how Claude Code should handle Langflow edges when generating flow JSON.

Edges are one of the easiest parts of Langflow JSON to break because they connect specific node outputs to specific node inputs.

## Core rule

Claude Code must not invent edge handles.

A valid edge should be based on one of these sources:

1. a known-good exported flow
2. a known-good template flow
3. the local component catalog
4. validation or import feedback from Langflow

## Required edge fields

Every generated edge should include:

- id
- source
- target
- sourceHandle
- targetHandle
- data
- data.sourceHandle
- data.targetHandle

General edge shape:

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

The exact sourceHandle and targetHandle values must come from real metadata.

## Edge ID naming

Use readable edge IDs.

Preferred pattern:

    edge-<source-node-id>-<target-node-id>

Examples:

    edge-ChatInput-chat-input-Prompt-template
    edge-Prompt-template-OpenAIModel-llm
    edge-OpenAIModel-llm-ChatOutput-chat-output
    edge-Retriever-docs-Prompt-template
    edge-EmbeddingModel-embeddings-VectorStore-vector-store

If multiple edges connect the same pair of nodes, append a purpose:

    edge-Agent-agent-Tool-weather-tool
    edge-Agent-agent-Tool-database-tool
    edge-Router-router-ChatOutput-safe-output
    edge-Router-router-ChatOutput-blocked-output

## Source and target rules

The source must be the ID of the upstream node.

The target must be the ID of the downstream node.

Example:

    "source": "ChatInput-chat-input"
    "target": "Prompt-template"

The source node must exist in data.nodes.

The target node must exist in data.nodes.

## Handle compatibility

Claude Code should only connect compatible data types.

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

Examples of reasonable connections:

- ChatInput output to Prompt input
- ChatInput output to ChatModel input
- Prompt output to ChatModel input
- ChatModel output to ChatOutput input
- Retriever output to Prompt context input
- VectorStore output to Retriever input
- EmbeddingModel output to VectorStore embedding input
- Tool output to Agent tool input
- Parser output to structured output component

Examples of suspicious connections:

- ChatOutput output to ChatInput input
- LanguageModel output directly to Embeddings input
- Tool output directly to unrelated text field without conversion
- VectorStore output directly to ChatOutput without retrieval or formatting
- Raw JSON output to Message input without parser/formatter support

## Preferred handle generation strategy

When generating a new flow, Claude Code should use this strategy:

1. Find a similar known-good flow in flows/templates or flows/imported.
2. Copy the edge handle structure from the known-good flow.
3. Replace node IDs carefully.
4. Preserve source output names, target field names, and type metadata.
5. Validate the flow.
6. If validation fails, repair based on the validation error.

## Do not stringify guessed handles

Some Langflow edge handles may be JSON-like strings.

Claude Code must not manually invent these strings.

Bad behavior:

    Creating a sourceHandle string from guessed field names.

Good behavior:

    Copying a known-good handle from an exported flow that uses the same component types.

## Source handle guidance

The sourceHandle usually describes the output side of a connection.

It may include information such as:

- source node ID
- output name
- output types
- data type
- component type

Claude Code should inspect existing examples before creating source handles.

## Target handle guidance

The targetHandle usually describes the input side of a connection.

It may include information such as:

- target node ID
- field name
- input types
- field type
- component type

Claude Code should inspect existing examples before creating target handles.

## Edges for chat flows

A simple chat flow usually has this logical structure:

    ChatInput -> Prompt -> ChatModel -> ChatOutput

or:

    ChatInput -> ChatModel -> ChatOutput

Claude Code should inspect the catalog and examples to determine whether the local model component expects:

- Message input
- text input
- prompt input
- chat history
- model configuration
- system message
- user message

### Chat Input handles

For standard chat flows, Chat Input usually emits a Message output:

    data.sourceHandle:
      dataType: ChatInput
      id: <chat-input-node-id>
      name: message
      output_types: [Message]

The target handle should be built from the downstream component template field, not guessed. If the target field is `input_value` and accepts `Message`, use that field metadata exactly.

### Chat Output handles

For standard chat flows, Chat Output usually receives the final response on `input_value`.

Current Langflow exports commonly define ChatOutput `input_value` as a HandleInput with:

    data.targetHandle:
      fieldName: input_value
      id: <chat-output-node-id>
      inputTypes: [Data, JSON, DataFrame, Table, Message]
      type: other

Do not set ChatOutput target handle `type` to `str` when the ChatOutput template field says `type: "other"`. Langflow may import the file but remove the visual edge.

For model-to-output edges, the model source handle should use the source component output metadata. Common model response outputs look like:

    data.sourceHandle:
      dataType: <ModelComponentType>
      id: <model-node-id>
      name: text_output
      output_types: [Message]

Some components use `message` or another output name; inspect `outputs[].name` and `outputs[].types` before generating the edge.

## Edges for RAG flows

A RAG flow usually has this logical structure:

    ChatInput -> Prompt
    Retriever -> Prompt
    Prompt -> ChatModel
    ChatModel -> ChatOutput

or:

    ChatInput -> Retriever
    Retriever -> Prompt
    Prompt -> ChatModel
    ChatModel -> ChatOutput

The exact structure depends on available components.

Claude Code should verify whether the retriever accepts the query directly, or whether it expects a string, message, or data object.

## Edges for guardrail flows

A guardrail flow may have this logical structure:

    ChatInput -> Anonymizer
    Anonymizer -> ToxicityGate
    ToxicityGate -> Prompt
    Prompt -> ChatModel
    ChatModel -> ChatOutput

or:

    ChatInput -> ToxicityGate
    ToxicityGate -> Router
    Router -> ChatModel
    Router -> BlockedResponse
    ChatModel -> ChatOutput
    BlockedResponse -> ChatOutput

Claude Code should only generate these connections if the required components exist in the catalog or templates.

## Edges for agent/tool flows

An agent/tool flow may have this logical structure:

    ChatInput -> Agent
    ChatModel -> Agent
    ToolA -> Agent
    ToolB -> Agent
    Agent -> ChatOutput

Claude Code should confirm whether the agent component expects:

- tools
- language model
- memory
- prompt
- input message
- chat history

Do not guess tool edge handles.

## Branching and router edges

If a flow branches, Claude Code should clearly name the branch edges.

Examples:

    edge-ToxicityGate-gate-ChatOutput-blocked-output
    edge-ToxicityGate-gate-Prompt-safe-prompt
    edge-Router-router-ChatOutput-error-output
    edge-Router-router-ChatModel-llm

For branch logic, Claude Code should prefer existing router or conditional components from the catalog.

If no router/conditional component exists, propose a custom component.

## Repair strategy

If edge validation fails, Claude Code should:

1. identify the source node
2. identify the target node
3. inspect both components in the catalog
4. inspect known-good flows using the same components
5. repair sourceHandle or targetHandle
6. validate again

Do not randomly mutate handles.

If Langflow imports a flow and reports that connections were removed, treat that as an edge validation failure even when the import API returned success. Repair the specific removed connection by comparing:

- source node `data.type`
- source node `data.node.outputs[].name`
- source node `data.node.outputs[].types`
- target node `data.type`
- target node `data.node.template[<fieldName>].input_types`
- target node `data.node.template[<fieldName>].type`

Then regenerate only `id`, `sourceHandle`, `targetHandle`, `data.sourceHandle`, and `data.targetHandle` for the failing edge.

## Import feedback strategy

If Langflow import fails due to edge handles, Claude Code should:

1. read the Langflow API error response
2. identify the bad edge
3. confirm that source and target node IDs exist
4. confirm that the target field exists
5. confirm that the source output exists
6. repair only the failing edge
7. retry validation before retrying import

## When handle metadata is insufficient

If the catalog does not expose enough handle metadata, Claude Code should say so.

Recommended response:

    I found the required components, but the catalog does not expose enough edge handle metadata to safely generate importable edges. I can either clone a similar exported flow template, or generate a node-only draft that should be wired in Langflow and exported back as a template.

## Node-only fallback

When edge handles cannot be safely generated, Claude Code may create a node-only draft if the user agrees or if it is the best available partial result.

A node-only draft should include:

- all required nodes
- readable positions
- configured template fields
- no guessed edges
- clear explanation that wiring must be completed or repaired after import

## Final edge checklist

Before declaring a generated flow complete, Claude Code should verify:

- every edge source node exists
- every edge target node exists
- every edge has an id
- every edge has sourceHandle
- every edge has targetHandle
- every edge has data.sourceHandle
- every edge has data.targetHandle
- source and target data types are compatible
- every source handle output name exists in source `outputs`
- every target handle field name exists in target `template`
- every target handle type matches the target template field type when present
- Chat Input has a downstream edge on `message` in normal chat flows
- Chat Output has an incoming edge to `input_value` in normal chat flows
- no handles were invented from memory
