# OTTO Extension SDK

// OTTO Extension SDK — Entry point and overview for extension development

The authoritative guide for building OTTO extensions. All extension contributors must follow this SDK. Extensions add tools, commands, event hooks, UI components, and custom behaviors to OTTO without modifying core code.

---

## Table of Contents

- [Manifest Spec](manifest-spec.md) — Extension manifest format, tiers, validation
- [API Reference](api-reference.md) — ExtensionAPI and ExtensionContext surfaces
- [Building Extensions](building-extensions.md) — Tools, commands, events, UI, state management
- [Testing](testing.md) — Mock patterns, test conventions
- [Rules](rules.md) — Non-negotiable rules, gotchas, contribution requirements

---

## Quick Start

### 1. Create the extension directory

```
mkdir -p ~/.otto/agent/extensions/my-extension
```

### 2. Create `extension-manifest.json`

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  "description": "A minimal OTTO extension",
  "tier": "community",
  "requires": { "platform": ">=2.29.0" },
  "provides": {
    "tools": ["hello_world"]
  }
}
```

### 3. Create `index.ts`

```typescript
import type { ExtensionAPI } from "@otto/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "hello_world",
    label: "Hello World",
    description: "Returns a greeting",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
      };
    },
  });
}
```

### 4. Test it

Reload extensions in a running session with `/reload`, or launch OTTO with a direct path:

```
otto -e ~/.otto/agent/extensions/my-extension
```

---

## Extension Structure

```
my-extension/
├── extension-manifest.json   # Required — declares capabilities and metadata
├── index.ts                  # Entry point (must export default function)
├── [additional .ts files]    # Optional modules (tools, utils, etc.)
└── package.json              # Only if npm dependencies are needed
```

The entry point must be `index.ts` and must use a default export that receives `ExtensionAPI`.

---

## Available Imports

| Package | Purpose |
|---------|---------|
| `@otto/pi-coding-agent` | `ExtensionAPI`, `ExtensionContext`, event types, utilities |
| `@sinclair/typebox` | Schema definitions for tool parameters (`Type.Object`, `Type.String`, etc.) |
| `@otto/pi-ai` | `StringEnum` (required for string enum parameters) |
| `@otto/pi-tui` | TUI components (`Text`, `Box`, `SelectList`, etc.) |
| Node.js built-ins | `node:fs`, `node:path`, `node:child_process`, etc. |

---

## Extension Locations

| Location | Path | Scope |
|----------|------|-------|
| Global | `~/.otto/agent/extensions/` | Available in all OTTO sessions |
| Project-local | `.otto/workflow/extensions/` | Available only in the current project |
| Bundled | `src/resources/extensions/` | Ships with OTTO (core extensions) |

Extensions are discovered at startup. Global and project-local extensions load alongside bundled ones. See [Manifest Spec](manifest-spec.md) for how load order and tiers work.
