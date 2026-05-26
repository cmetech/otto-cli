/**
 * External State Migration
 *
 * Migrates legacy in-project `.otto/workflow/` directories to the external
 * `~/.otto/projects/<hash>/` state directory. After migration, a
 * symlink replaces the original directory so all paths remain valid.
 */

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, cpSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { externalWorkflowRoot, isInsideWorktree } from "./repo-identity.js";
import { getErrorMessage } from "./error-utils.js";
import { hasGitTrackedWorkflowFiles } from "./gitignore.js";
import { GIT_NO_PROMPT_ENV } from "./git-constants.js";

export interface MigrationResult {
  migrated: boolean;
  error?: string;
}

/**
 * Migrate a legacy in-project `.otto/workflow/` directory to external storage.
 *
 * Algorithm:
 * 1. If `<project>/.otto/workflow` is a symlink or doesn't exist -> skip
 * 2. If `<project>/.otto/workflow` is a real directory:
 *    a. Compute external path from repoIdentity
 *    b. mkdir -p external dir
 *    c. Rename `.otto/workflow` -> `.otto/workflow.migrating` (atomic on same FS, acts as lock)
 *    d. Copy contents to external dir (skip `worktrees/` subdirectory)
 *    e. Create symlink `.otto/workflow -> external path`
 *    f. Remove `.otto/workflow.migrating`
 * 3. On failure: rename `.otto/workflow.migrating` back to `.otto/workflow` (rollback)
 */
export function migrateToExternalState(basePath: string): MigrationResult {
  // Worktrees get their .otto/workflow via syncWorkflowStateToWorktree(), not migration.
  // Migration inside a worktree would compute the same external hash as the
  // main repo (externalWorkflowRoot hashes remoteUrl + gitRoot), creating a broken
  // junction and orphaning .otto/workflow.migrating (#2970).
  if (isInsideWorktree(basePath)) {
    return { migrated: false };
  }

  const localGsd = join(basePath, ".otto/workflow");

  // Skip if doesn't exist
  if (!existsSync(localGsd)) {
    return { migrated: false };
  }

  // Skip if already a symlink
  try {
    const stat = lstatSync(localGsd);
    if (stat.isSymbolicLink()) {
      return { migrated: false };
    }
    if (!stat.isDirectory()) {
      return { migrated: false, error: ".otto/workflow exists but is not a directory or symlink" };
    }
  } catch (err) {
    return { migrated: false, error: `Cannot stat .otto/workflow: ${getErrorMessage(err)}` };
  }

  // Skip if .otto/workflow/ contains git-tracked files — the project intentionally
  // keeps .otto/workflow/ in version control and migration would destroy that.
  if (hasGitTrackedWorkflowFiles(basePath)) {
    return { migrated: false };
  }

  // Skip if .otto/workflow/worktrees/ has active worktree directories (#1337).
  // On Windows, active git worktrees hold OS-level directory handles that
  // prevent rename/delete. Attempting migration causes EBUSY and data loss.
  const worktreesDir = join(localGsd, "worktrees");
  if (existsSync(worktreesDir)) {
    try {
      const entries = readdirSync(worktreesDir, { withFileTypes: true });
      if (entries.some(e => e.isDirectory())) {
        return { migrated: false };
      }
    } catch {
      // Can't read worktrees dir — skip migration to be safe
      return { migrated: false };
    }
  }

  const externalPath = externalWorkflowRoot(basePath);
  const migratingPath = join(basePath, ".otto", "workflow.migrating");

  try {
    // mkdir -p the external dir
    mkdirSync(externalPath, { recursive: true });

    // Rename .otto/workflow -> .otto/workflow.migrating (atomic lock).
    // On Windows, NTFS may reject rename with EPERM if file descriptors are
    // open (VS Code watchers, antivirus on-access scan). Fall back to
    // copy+delete (#1292).
    try {
      renameSync(localGsd, migratingPath);
    } catch (renameErr: any) {
      if (renameErr?.code === "EPERM" || renameErr?.code === "EBUSY") {
        try {
          cpSync(localGsd, migratingPath, { recursive: true, force: true });
          rmSync(localGsd, { recursive: true, force: true });
        } catch (copyErr) {
          // If copy succeeded but delete failed (e.g. EPERM file lock), remove
          // the migrated copy so we don't leave an orphaned .otto/workflow.migrating.
          if (existsSync(localGsd) && existsSync(migratingPath)) {
            try { rmSync(migratingPath, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
          }
          return { migrated: false, error: `Migration rename/copy failed: ${copyErr instanceof Error ? copyErr.message : String(copyErr)}` };
        }
      } else {
        throw renameErr;
      }
    }

    // Copy contents to external dir, skipping worktrees/
    const entries = readdirSync(migratingPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "worktrees") continue; // worktrees stay local

      const src = join(migratingPath, entry.name);
      const dst = join(externalPath, entry.name);

      try {
        if (entry.isDirectory()) {
          cpSync(src, dst, { recursive: true, force: true });
        } else {
          cpSync(src, dst, { force: true });
        }
      } catch {
        // Non-fatal: continue with other files
      }
    }

    // Create symlink .otto/workflow -> external path
    symlinkSync(externalPath, localGsd, "junction");

    // Verify the symlink resolves correctly before removing the backup (#1377).
    // On Windows, junction creation can silently succeed but resolve to the wrong
    // target, or the external dir may not be accessible. If verification fails,
    // restore from the backup.
    try {
      const resolved = realpathSync(localGsd);
      const resolvedExternal = realpathSync(externalPath);
      if (resolved !== resolvedExternal) {
        // Symlink points to wrong target — restore backup
        try { rmSync(localGsd, { force: true }); } catch { /* may not exist */ }
        renameSync(migratingPath, localGsd);
        return { migrated: false, error: `Migration verification failed: symlink resolves to ${resolved}, expected ${resolvedExternal}` };
      }
      // Verify we can read through the symlink
      readdirSync(localGsd);
    } catch (verifyErr) {
      // Symlink broken or unreadable — restore backup
      try { rmSync(localGsd, { force: true }); } catch { /* may not exist */ }
      try { renameSync(migratingPath, localGsd); } catch { /* best-effort restore */ }
      return { migrated: false, error: `Migration verification failed: ${getErrorMessage(verifyErr)}` };
    }

    // Clean the git index — any .otto/workflow/* files tracked before migration now
    // sit behind the symlink and git can't follow it, causing them to show
    // as deleted. Remove them from the index so the working tree stays clean.
    // --ignore-unmatch makes this a no-op on fresh projects with no tracked .otto/workflow/.
    try {
      execFileSync("git", ["rm", "-r", "--cached", "--ignore-unmatch", ".otto/workflow"], {
        cwd: basePath,
        stdio: ["ignore", "pipe", "ignore"],
        env: GIT_NO_PROMPT_ENV,
        timeout: 10_000,
      });
    } catch {
      // Non-fatal — git may be unavailable or nothing was tracked
    }

    // Remove .otto/workflow.migrating only after symlink is verified and index is clean
    rmSync(migratingPath, { recursive: true, force: true });

    return { migrated: true };
  } catch (err) {
    // Rollback: rename .otto/workflow.migrating back to .otto/workflow
    try {
      if (existsSync(migratingPath) && !existsSync(localGsd)) {
        renameSync(migratingPath, localGsd);
      }
    } catch {
      // Rollback failed -- leave .otto/workflow.migrating for doctor to detect
    }

    return {
      migrated: false,
      error: `Migration failed: ${getErrorMessage(err)}`,
    };
  }
}

/**
 * Recover from a failed migration (`.otto/workflow.migrating` exists).
 * Moves `.otto/workflow.migrating` back to `.otto/workflow` if `.otto/workflow` doesn't exist.
 */
export function recoverFailedMigration(basePath: string): boolean {
  const localGsd = join(basePath, ".otto/workflow");
  const migratingPath = join(basePath, ".otto", "workflow.migrating");

  if (!existsSync(migratingPath)) return false;
  if (existsSync(localGsd)) return false; // both exist -- ambiguous, don't touch

  try {
    renameSync(migratingPath, localGsd);
    return true;
  } catch {
    return false;
  }
}
