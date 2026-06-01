import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@otto/pi-coding-agent';
import { ScratchpadManager } from '@otto/coworker-scratchpad';
import { registerSpCommand } from './sp-command.js';
import { registerScratchpadTool } from './scratchpad-tool.js';
import { sessionSidecarPath, readSessionSidecar, deleteSessionSidecar, sweepStaleSidecars } from './session-sidecar.js';
import { detectWorkspaceRoot } from './workspace-root.js';
import { workspaceHash, workspacePointerPath, readWorkspacePointer, isPointerFresh } from './workspace-pointer.js';
import { formatRelativeAge } from './format-age.js';

function deriveScratchpadRoot(): string {
  return process.env.OTTO_SCRATCHPAD_ROOT ?? join(homedir(), '.otto', 'scratchpads');
}

function deriveSessionId(ctx: ExtensionContext): string {
  const file = ctx.sessionManager.getSessionFile() as string | undefined;
  if (!file) return 'default';
  const base = basename(file);
  return base.endsWith('.jsonl') ? base.slice(0, -6) : base;
}

/**
 * Computes restore precedence with sidecar-fallback. Returns the scratchpad to restore
 * (if any) and the notice string to surface to the user. Does NOT call ctx.ui.notify —
 * the caller does.
 *
 * Side-effect: deletes a broken sidecar (one whose referenced scratchpad no longer
 * exists) so subsequent fresh sessions don't repeatedly re-check it. Not a pure
 * function — a cleanup-closure refactor was considered and rejected as over-engineering
 * for a single in-process call site.
 *
 * Precedence:
 *   (a) per-session sidecar — wins when its scratchpad still exists on disk.
 *   (b) broken sidecar — silently deleted, falls through to (c).
 *   (c) workspace pointer — fresh (≤ 7d) AND its scratchpad still exists on disk.
 *   (d) no restore.
 */
export function tryRestoreCurrentName(
  root: string,
  sessionId: string,
  cwd: string,
  now: number,
): { name: string | null; notice: string | null } {
  // (a) Sidecar restore
  const sidecarPath = sessionSidecarPath(root, sessionId);
  const sidecar = readSessionSidecar(sidecarPath);
  if (sidecar) {
    const meta = join(root, sidecar.current_name, 'meta.json');
    if (existsSync(meta)) {
      return { name: sidecar.current_name, notice: `attached to ${sidecar.current_name} (restored)` };
    }
    deleteSessionSidecar(sidecarPath); // broken sidecar — clean up silently and fall through
  }

  // (b) Workspace-pointer fallback
  const wsRoot = detectWorkspaceRoot(cwd);
  const ptr = readWorkspacePointer(workspacePointerPath(root, workspaceHash(wsRoot)));
  if (ptr && isPointerFresh(ptr, now)) {
    const meta = join(root, ptr.last_current_name, 'meta.json');
    if (existsSync(meta)) {
      const rel = formatRelativeAge(now - Date.parse(ptr.last_attached_at));
      return {
        name: ptr.last_current_name,
        notice: `attached to ${ptr.last_current_name} (from workspace, last used ${rel})`,
      };
    }
  }

  // (c) No restore
  return { name: null, notice: null };
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
  const getWorkspaceCwd = (): string => workspaceCwd ?? process.cwd();

  registerSpCommand(pi, { getManager, getCurrentName, setCurrentName, rootDir, getSessionId, getWorkspaceCwd });
  registerScratchpadTool(pi, { getManager, getCurrentName, setCurrentName, rootDir });

  pi.on('session_start', async (_event, ctx) => {
    workspaceCwd = ctx.cwd;
    sessionId = deriveSessionId(ctx);

    const restore = tryRestoreCurrentName(root, sessionId, ctx.cwd ?? process.cwd(), Date.now());
    if (restore.name) {
      currentName = restore.name;
      ctx.ui.notify(restore.notice!, 'info');
    }
    // When neither sidecar nor fresh pointer resolves to an existing scratchpad,
    // we stay silent — the user gets a clean session_start with no noise.
    try { sweepStaleSidecars(root, sessionId, Date.now()); } catch { /* sweep failures are silent */ }
  });

  pi.on('session_shutdown', async () => {
    if (manager) {
      await manager.disposeAll();
      manager = null;
    }
    // Sidecar deliberately NOT deleted here — survives so /resume restores.
  });
}
