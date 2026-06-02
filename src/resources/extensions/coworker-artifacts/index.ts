// src/resources/extensions/coworker-artifacts/index.ts
//
// Coworker Artifacts production activator. Wires the Phase 4 artifact
// primitives (createArtifactsBundle, runListArtifacts, runOpenArtifact,
// runArtifactsCommand) into pi's ExtensionAPI so /artifacts, the
// list_artifacts + open_artifact tools, and the artifact://<slug> store
// light up in a live Otto session.
//
// Cross-pillar surface: the scratchpad activator imports getArtifactStore()
// from this module so its onArtifactCreate closure can resolve artifact://
// URIs and bind them to the active scratchpad turn (Phase 4 Task 12).
import type { ExtensionAPI } from '@otto/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { ArtifactStore } from '@otto/coworker-artifacts';
import { createArtifactsBundle, type ArtifactsBundle } from './artifacts-singleton.js';
import { runListArtifacts } from './list-tool.js';
import { runOpenArtifact } from './open-tool.js';
import { runArtifactsCommand } from './artifacts-command.js';

export { createArtifactsBundle };
export type { ArtifactsBundle, ArtifactsBundleOptions } from './artifacts-singleton.js';

// Cross-pillar export — null before session_start or after session_shutdown.
let activeStore: ArtifactStore | null = null;
export function getArtifactStore(): ArtifactStore | null {
  return activeStore;
}

const LIST_PARAMS = Type.Object({});
const OPEN_PARAMS = Type.Object({
  slug: Type.String({ description: 'The artifact slug (e.g. "report" or "report-2") to read.' }),
});

// Union TDetails so TS accepts both error and success branches of execute().
type ListDetails =
  | { error: string; result_count?: undefined }
  | { error?: undefined; result_count: number };
type OpenDetails =
  | { error: string; slug?: undefined }
  | { error?: undefined; slug: string };

export default function coworkerArtifactsExtension(api: ExtensionAPI): void {
  let bundle: ArtifactsBundle | null = null;
  let unavailable = false;

  api.on('session_start', async (_event, ctx) => {
    try {
      bundle = await createArtifactsBundle({ workspaceDir: ctx.cwd });
      activeStore = bundle.store;
      unavailable = false;
    } catch (err) {
      unavailable = true;
      bundle = null;
      activeStore = null;
      ctx.ui.notify(`artifacts unavailable: ${(err as Error).message}`, 'warning');
    }
  });

  api.registerTool<typeof LIST_PARAMS, ListDetails>({
    name: 'list_artifacts',
    label: 'List artifacts',
    description: 'List all artifacts in the current workspace.',
    parameters: LIST_PARAMS,
    async execute() {
      if (!bundle) {
        return {
          content: [{ type: 'text', text: 'artifacts unavailable' }],
          details: { error: 'unavailable' },
        };
      }
      try {
        const out = await runListArtifacts(bundle.store);
        return {
          content: [{ type: 'text', text: out.markdown }],
          details: { result_count: out.artifacts.length },
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `list failed: ${(err as Error).message}` }],
          details: { error: (err as Error).message },
        };
      }
    },
  });

  api.registerTool<typeof OPEN_PARAMS, OpenDetails>({
    name: 'open_artifact',
    label: 'Open artifact',
    description: 'Read the contents of an artifact by slug. Returns markdown body + recent provenance.',
    parameters: OPEN_PARAMS,
    async execute(_toolCallId, params) {
      if (!bundle) {
        return {
          content: [{ type: 'text', text: 'artifacts unavailable' }],
          details: { error: 'unavailable' },
        };
      }
      try {
        const out = await runOpenArtifact(bundle.store, params);
        return {
          content: [{ type: 'text', text: out.markdown }],
          details: { slug: params.slug },
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `open failed: ${(err as Error).message}` }],
          details: { error: (err as Error).message },
        };
      }
    },
  });

  api.registerCommand('artifacts', {
    description: 'Inspect artifacts: /artifacts list | show <slug> | remove <slug> --confirm',
    getArgumentCompletions: (prefix) => {
      const subs = [
        { label: 'list', description: 'List all artifacts' },
        { label: 'show', description: 'Show artifact body + provenance: /artifacts show <slug>' },
        { label: 'remove', description: 'Delete artifact: /artifacts remove <slug> --confirm' },
      ];
      return subs
        .filter((s) => s.label.startsWith(prefix))
        .map((s) => ({ value: s.label, label: s.label, description: s.description }));
    },
    handler: async (args, ctx) => {
      if (!bundle) {
        ctx.ui.notify(
          unavailable ? 'artifacts unavailable; chat continues without it.' : 'artifacts not ready yet.',
          'warning',
        );
        return;
      }
      const argv = args.trim().split(/\s+/).filter(Boolean);
      try {
        const result = await runArtifactsCommand(bundle.store, argv);
        ctx.ui.notify(result.message, 'info');
      } catch (err) {
        ctx.ui.notify(`/artifacts failed: ${(err as Error).message}`, 'error');
      }
    },
  });

  api.on('session_shutdown', async () => {
    if (bundle) {
      try {
        await bundle.dispose();
      } catch {
        /* best effort */
      }
    }
    bundle = null;
    activeStore = null;
  });
}
