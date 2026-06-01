import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@otto/pi-coding-agent';
import { ScratchpadManager } from '@otto/coworker-scratchpad';
import { registerSpCommand } from './sp-command.js';
import { registerScratchpadTool } from './scratchpad-tool.js';

interface SessionCtx extends ExtensionContext {
  cwd: string;
  sessionManager?: { getSessionFile?: () => string | undefined };
}

function deriveScratchpadRoot(): string {
  // Test override; production uses the standard user-global location per spec §3.3.
  return process.env.OTTO_SCRATCHPAD_ROOT ?? join(homedir(), '.otto', 'scratchpads');
}

function deriveSessionId(ctx: SessionCtx): string {
  const file = ctx.sessionManager?.getSessionFile?.();
  if (!file) return 'default';
  // The session file is something like /.../session-<id>.jsonl. Strip the extension; if none, use the basename as-is.
  const base = basename(file);
  return base.endsWith('.jsonl') ? base.slice(0, -6) : base;
}

export default function coworkerScratchpadExtension(pi: ExtensionAPI): void {
  let manager: ScratchpadManager | null = null;
  let workspaceCwd: string | null = null;
  let sessionId: string | null = null;
  let currentName: string | null = null;
  const root = deriveScratchpadRoot();

  const getManager = (): ScratchpadManager => {
    if (!manager) {
      if (!workspaceCwd) throw new Error('scratchpad: manager requested before session_start');
      manager = new ScratchpadManager({
        workspace: workspaceCwd,
        root,
        sessionId: sessionId ?? 'default',
      });
    }
    return manager;
  };
  const getCurrentName = (): string | null => currentName;
  const setCurrentName = (n: string | null): void => { currentName = n; };
  const rootDir = (): string => root;

  // Register surface up-front (closures capture the lazy accessors).
  registerSpCommand(pi, { getManager, getCurrentName, setCurrentName, rootDir });
  registerScratchpadTool(pi, { getManager, getCurrentName, setCurrentName, rootDir });

  pi.on('session_start', async (_event, ctx) => {
    const sessionCtx = ctx as SessionCtx;
    workspaceCwd = sessionCtx.cwd;
    sessionId = deriveSessionId(sessionCtx);
  });

  pi.on('session_shutdown', async () => {
    if (manager) {
      await manager.disposeAll();
      manager = null;
    }
  });
}
