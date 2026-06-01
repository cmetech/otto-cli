// Lease helper for global background tasks.
// Spec §6.4.
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

export interface LeaseOptions {
  ttlMs: number;
  holder?: string;
}

interface LeaseData {
  pid: number;
  host: string;
  acquired_at: string;
  ttl_ms: number;
  holder?: string;
}

function isExpired(data: LeaseData): boolean {
  const acquired = Date.parse(data.acquired_at);
  if (Number.isNaN(acquired)) return true;
  return Date.now() > acquired + data.ttl_ms;
}

function pidAlive(pid: number, host: string): boolean {
  // We can only check pids on the same host.
  if (host !== os.hostname()) return true;       // assume alive on other hosts
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLease(path: string): Promise<LeaseData | null> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    return JSON.parse(raw) as LeaseData;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function acquireLease(path: string, opts: LeaseOptions): Promise<boolean> {
  const existing = await readLease(path);
  if (existing && !isExpired(existing) && pidAlive(existing.pid, existing.host)) {
    return false;
  }
  const data: LeaseData = {
    pid: process.pid,
    host: os.hostname(),
    acquired_at: new Date().toISOString(),
    ttl_ms: opts.ttlMs,
    holder: opts.holder,
  };
  await fs.writeFile(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  return true;
}

export async function releaseLease(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function isLeaseHeld(path: string): Promise<boolean> {
  const data = await readLease(path);
  if (!data) return false;
  if (isExpired(data)) return false;
  if (!pidAlive(data.pid, data.host)) return false;
  return true;
}
