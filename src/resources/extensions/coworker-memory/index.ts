// src/resources/extensions/coworker-memory/index.ts
//
// Coworker Memory production activator. Wires the Phase 3 memory primitives
// (createMemoryBundle, runMemorize, runRecall, runMemoryCommand, buildLayerAContext)
// into pi's ExtensionAPI so /memory, memorize+recall tools, before_agent_start
// Layer A injection, and agent_start auto-retain of user turns all light up in a
// live Otto session. Closes Phase 3 Task 20 (recordTurn auto-retain).
//
// Cross-pillar surface: the scratchpad activator imports getMemoryRecorder()
// from this module to gate its onDataLoad → recordFileLoad hop (Phase 3.1 Task 4).
import type { ExtensionAPI } from '@otto/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import {
  buildLayerAContext,
  type MemoryRecorder,
  type LayerAKind,
  type DrawerKind,
} from '@otto/coworker-memory';
import { createMemoryBundle, type MemoryBundle, type MemoryBundleOptions } from './memory-singleton.js';
import { runMemorize } from './memorize-tool.js';
import { runRecall, type RecallToolArgs } from './recall-tool.js';
import { runMemoryCommand } from './memory-command.js';
import { onSessionShutdown } from './session-hooks.js';
import { createCurrentScratchpadProvider } from '../coworker-scratchpad/sp-command.js';
import { getCoworkerGlobalDir, getScratchpadsRoot } from '../shared/coworker-paths.js';

export { createMemoryBundle };
export type { MemoryBundle, MemoryBundleOptions };

// Cross-pillar export. Scratchpad's onDataLoad closure imports this and calls
// it lazily — returns null before session_start or after session_shutdown,
// which is the correct "no-op" signal.
let activeRecorder: MemoryRecorder | null = null;
export function getMemoryRecorder(): MemoryRecorder | null {
  return activeRecorder;
}

const MEMORIZE_PARAMS = Type.Object({
  text: Type.String({ description: 'The note text to store in Layer A memory.' }),
  kind: Type.Union(
    [Type.Literal('profile'), Type.Literal('rule'), Type.Literal('lesson')],
    { description: "Layer A kind: 'profile' (about the user), 'rule' (must-do), or 'lesson' (learned)." },
  ),
  scope: Type.Optional(Type.Union(
    [Type.Literal('global'), Type.Literal('workspace')],
    { description: "Defaults to 'workspace' when omitted." },
  )),
});

const RECALL_PARAMS = Type.Object({
  query: Type.String({ description: 'Free-text query to search verbatim drawers.' }),
  kind: Type.Optional(Type.Union([
    Type.Literal('turn'), Type.Literal('paste'), Type.Literal('file_load'),
    Type.Literal('ticket'), Type.Literal('email'), Type.Literal('rca'), Type.Literal('note'),
  ])),
  wing: Type.Optional(Type.String()),
  room: Type.Optional(Type.String()),
  days_back: Type.Optional(Type.Number()),
  max_results: Type.Optional(Type.Number()),
});

export default function coworkerMemoryExtension(api: ExtensionAPI): void {
  let bundle: MemoryBundle | null = null;
  let unavailable = false;
  let pendingPrompt: string | undefined;
  // One notify per session covers both before_agent_start inject failures and
  // agent_start recordTurn failures — both are best-effort and must not break
  // the chat loop. Spec §3.7.
  let writeFailureNotified = false;

  api.on('session_start', async (_event, ctx) => {
    try {
      bundle = await createMemoryBundle({
        globalDir: getCoworkerGlobalDir(),
        workspaceDir: ctx.cwd,
        scopeMode: 'per-project-tagged',
        currentScratchpadName: createCurrentScratchpadProvider({
          scratchpadsRoot: getScratchpadsRoot(),
        }),
      });
      activeRecorder = bundle.recorder;
      unavailable = false;
    } catch (err) {
      unavailable = true;
      bundle = null;
      activeRecorder = null;
      ctx.ui.notify(`memory unavailable: ${(err as Error).message}`, 'warning');
    }
  });

  api.on('before_agent_start', async (event, ctx) => {
    if (!bundle) return undefined;
    // Capture the prompt for the paired agent_start so we can record it even
    // when there is no Layer A content to inject (block.length === 0).
    pendingPrompt = event.prompt;
    try {
      const block = await buildLayerAContext({
        mode: bundle.scopeMode,
        globalStore: bundle.globalLayerA,
        workspaceStore: bundle.workspaceLayerA,
        tokenLimit: 3000,
      });
      if (block.length === 0) return undefined;
      return { systemPrompt: event.systemPrompt + '\n\n' + block };
    } catch (err) {
      if (!writeFailureNotified) {
        ctx.ui.notify(`memory context inject failed: ${(err as Error).message}`, 'warning');
        writeFailureNotified = true;
      }
      return undefined;
    }
  });

  api.on('agent_start', async (event, ctx) => {
    if (!bundle || !pendingPrompt || !event.sessionId || !event.turnId) {
      pendingPrompt = undefined;
      return;
    }
    const userText = pendingPrompt;
    const sessionId = event.sessionId;
    const turnId = event.turnId;
    pendingPrompt = undefined;
    try {
      await bundle.recorder.recordTurn({ sessionId, userText, turnId });
    } catch (err) {
      if (!writeFailureNotified) {
        ctx.ui.notify(`memory write failed: ${(err as Error).message}`, 'warning');
        writeFailureNotified = true;
      }
    }
  });

  // Union TDetails so TS accepts both error and success branches of execute().
  type MemorizeDetails =
    | { error: string; stored?: false }
    | { error?: undefined; stored: true; layer_a_file: string };

  api.registerTool<typeof MEMORIZE_PARAMS, MemorizeDetails>({
    name: 'memorize',
    label: 'Memorize',
    description: 'Save a profile note, rule, or lesson into Layer A memory.',
    parameters: MEMORIZE_PARAMS,
    async execute(_toolCallId, params) {
      if (!bundle) {
        return {
          content: [{ type: 'text', text: 'memory unavailable; cannot memorize.' }],
          details: { error: 'memory unavailable' },
        };
      }
      try {
        const out = await runMemorize(bundle, {
          text: params.text,
          kind: params.kind as LayerAKind,
          scope: params.scope as 'global' | 'workspace' | undefined,
        });
        return {
          content: [{ type: 'text', text: `stored in ${out.layer_a_file}` }],
          details: out,
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `memorize failed: ${(err as Error).message}` }],
          details: { error: (err as Error).message },
        };
      }
    },
  });

  type RecallDetails =
    | { error: string; result_count?: undefined }
    | { error?: undefined; result_count: number };

  api.registerTool<typeof RECALL_PARAMS, RecallDetails>({
    name: 'recall',
    label: 'Recall',
    description: 'Search verbatim drawers in memory (Layer B). Returns markdown with drawer URIs.',
    parameters: RECALL_PARAMS,
    async execute(_toolCallId, params) {
      if (!bundle) {
        return {
          content: [{ type: 'text', text: 'memory unavailable; cannot recall.' }],
          details: { error: 'memory unavailable' },
        };
      }
      try {
        const args: RecallToolArgs = {
          query: params.query,
          kind: params.kind as DrawerKind | undefined,
          wing: params.wing,
          room: params.room,
          days_back: params.days_back,
          max_results: params.max_results,
        };
        const out = await runRecall(bundle, args);
        return {
          content: [{ type: 'text', text: out.markdown }],
          details: { result_count: out.results.length },
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `recall failed: ${(err as Error).message}` }],
          details: { error: (err as Error).message },
        };
      }
    },
  });

  api.registerCommand('memory', {
    description: 'Inspect and manage co-worker memory (Layer A rules/lessons + Layer B drawers).',
    getArgumentCompletions: (prefix) => {
      const subcommands = [
        { label: 'note', description: 'Append a lesson: /memory note <text>' },
        { label: 'show', description: 'Show Layer A: /memory show [profile|rules|lessons] [--scope workspace|global]' },
        { label: 'recall', description: 'Search Layer B drawers: /memory recall <query> [--kind|--room|--wing|--limit|--days_back]' },
        { label: 'status', description: 'Show workspace_wing, drawer_count, db path' },
        { label: 'clear', description: 'Clear drawers: /memory clear --wing <wing> --confirm' },
        { label: 'wing', description: 'Set session wing override: /memory wing <name>' },
        { label: 'room', description: 'Set session room override: /memory room <name>' },
        { label: 'seed', description: 'Re-apply persona seed on next session_start' },
      ];
      return subcommands
        .filter((s) => s.label.startsWith(prefix))
        .map((s) => ({ value: s.label, label: s.label, description: s.description }));
    },
    handler: async (args, ctx) => {
      if (!bundle) {
        ctx.ui.notify(
          unavailable ? 'memory unavailable; chat continues without it.' : 'memory not ready yet.',
          'warning',
        );
        return;
      }
      const argv = args.trim().split(/\s+/).filter(Boolean);
      try {
        const result = await runMemoryCommand(bundle, argv);
        ctx.ui.notify(result.message, 'info');
      } catch (err) {
        ctx.ui.notify(`/memory failed: ${(err as Error).message}`, 'error');
      }
    },
  });

  api.on('session_shutdown', async () => {
    if (bundle) {
      try {
        await onSessionShutdown(bundle);
      } catch {
        // dispose is best-effort; LocalSqliteBackend.close() handles double-close.
      }
    }
    bundle = null;
    activeRecorder = null;
    pendingPrompt = undefined;
    // writeFailureNotified persists across sessions intentionally — one notify
    // per Otto process lifetime is enough to avoid spam.
  });
}
