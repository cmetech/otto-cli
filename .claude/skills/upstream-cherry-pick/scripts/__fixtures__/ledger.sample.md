# Upstream Sync Ledger

## Vendored package divergence status

| Package | Diverged? | Risk to sync | Notes |
| --- | --- | --- | --- |
| `packages/pi-coding-agent` | **Heavy** | High | Core runtime |
| `packages/pi-tui` | **Moderate** | Medium | Autocomplete tags |
| `packages/pi-ai` | Minimal | Low | Branding only |

## File-level patch log (post-LOOP24, ongoing)

### `packages/pi-coding-agent/src/index.ts`

- **Theme switching re-exports** (commit: TBD)

### `packages/pi-coding-agent/src/core/skills.ts`

- **Harness source labeling** (commit: TBD)

### `packages/pi-coding-agent/src/core/settings-manager.ts`

- **`quietExtensions`** (commit: 52ac5eb)

### `packages/pi-tui/src/components/select-list.ts`

- **`tag` field** (commit: 003b430)
