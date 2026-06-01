import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SessionSidecar {
  schema_version: 1;
  session_id: string;
  current_name: string;
  attached_at: string;
}

export function sessionSidecarPath(rootDir: string, sessionId: string): string {
  return join(rootDir, '_sessions', `sidecar_${sessionId}.json`);
}

export function readSessionSidecar(path: string): SessionSidecar | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SessionSidecar>;
    if (
      parsed.schema_version === 1 &&
      typeof parsed.session_id === 'string' &&
      typeof parsed.current_name === 'string' &&
      typeof parsed.attached_at === 'string'
    ) {
      return parsed as SessionSidecar;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSessionSidecar(path: string, payload: SessionSidecar): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, path);
}

export function deleteSessionSidecar(path: string): void {
  rmSync(path, { force: true });
}

export const SIDECAR_GC_STALE_DAYS = 7;

export function sweepStaleSidecars(rootDir: string, currentSessionId: string, now: number): number {
  const dir = join(rootDir, '_sessions');
  if (!existsSync(dir)) return 0;
  let deleted = 0;
  const staleMs = SIDECAR_GC_STALE_DAYS * 24 * 60 * 60 * 1000;
  for (const f of readdirSync(dir)) {
    if (!f.startsWith('sidecar_')) continue; // safety: only touch known-format files
    const path = join(dir, f);
    try {
      const sc = readSessionSidecar(path);
      if (!sc) continue;
      if (sc.session_id === currentSessionId) continue;
      const scratchpadMeta = join(rootDir, sc.current_name, 'meta.json');
      const scratchpadGone = !existsSync(scratchpadMeta);
      const tooOld = (now - statSync(path).mtimeMs) > staleMs;
      if (scratchpadGone || tooOld) {
        rmSync(path, { force: true });
        deleted++;
      }
    } catch { /* per-file isolation */ }
  }
  return deleted;
}
