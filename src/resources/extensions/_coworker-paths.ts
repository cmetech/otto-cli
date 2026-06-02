import { homedir } from 'node:os';
import { join } from 'node:path';

export function getCoworkerGlobalDir(): string {
  return process.env.OTTO_COWORKER_GLOBAL_DIR ?? join(homedir(), '.otto');
}

export function getScratchpadsRoot(): string {
  return process.env.OTTO_SCRATCHPAD_ROOT ?? join(homedir(), '.otto', 'scratchpads');
}
