import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@otto/pi-coding-agent';
import { ScratchpadManager } from '@otto/coworker-scratchpad';
import { registerSpCommand } from './sp-command.js';
import { registerScratchpadTool } from './scratchpad-tool.js';
import { sessionSidecarPath, readSessionSidecar, deleteSessionSidecar } from './session-sidecar.js';

function deriveScratchpadRoot(): string {
  return process.env.OTTO_SCRATCHPAD_ROOT ?? join(homedir(), '.otto', 'scratchpads');
}

function deriveSessionId(ctx: ExtensionContext): string {
  const file = ctx.sessionManager.getSessionFile() as string | undefined;
  if (!file) return 'default';
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
  const getSessionId = (): string => sessionId ?? 'default';

  registerSpCommand(pi, { getManager, getCurrentName, setCurrentName, rootDir, getSessionId });
  registerScratchpadTool(pi, { getManager, getCurrentName, setCurrentName, rootDir });

  pi.on('session_start', async (_event, ctx) => {
    workspaceCwd = ctx.cwd;
    sessionId = deriveSessionId(ctx);

    const sidecarPath = sessionSidecarPath(root, sessionId);
    const sidecar = readSessionSidecar(sidecarPath);
    if (!sidecar) return;

    const targetMeta = join(root, sidecar.current_name, 'meta.json');
    if (!existsSync(targetMeta)) {
      deleteSessionSidecar(sidecarPath);
      ctx.ui.notify(`previous scratchpad '${sidecar.current_name}' is gone; not restored`, 'info');
      return;
    }
    currentName = sidecar.current_name;
    ctx.ui.notify(`attached to ${sidecar.current_name} (restored)`, 'info');
  });

  pi.on('session_shutdown', async () => {
    if (manager) {
      await manager.disposeAll();
      manager = null;
    }
    // Sidecar deliberately NOT deleted here — survives so /resume restores.
  });
}
