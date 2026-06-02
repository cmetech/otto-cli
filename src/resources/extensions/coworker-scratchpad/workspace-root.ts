import { execSync } from 'node:child_process';

export function detectWorkspaceRoot(cwd: string): string {
  try {
    const out = execSync('git rev-parse --show-toplevel', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 500,
    }).trim();
    if (out) return out;
  } catch {
    /* not a git repo, git not installed, or timeout — fall through */
  }
  return cwd;
}
