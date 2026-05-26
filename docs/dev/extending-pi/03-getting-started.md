# Getting Started


### Minimal Extension

Create `~/.otto/agent/extensions/my-extension.ts`:

```typescript
import type { ExtensionAPI } from "@otto/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });
}
```

### Testing

```bash
# Quick test (doesn't need to be in extensions dir)
pi -e ./my-extension.ts

# Or just place it in the extensions dir and start pi
pi
```

### Hot Reload

Extensions in auto-discovered locations (`~/.otto/agent/extensions/` or `.otto/workflow/extensions/`) can be hot-reloaded:

```
/reload
```

---
