import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { workflowHome } from "./home.js";

export interface WorktreeSegment {
  workflowIdx: number;
  afterWorktrees: number;
}

export function normalizeWorktreePathForCompare(path: string): string {
  let normalized: string;
  try {
    normalized = realpathSync(path);
  } catch {
    normalized = resolve(path);
  }
  const slashed = normalized.replaceAll("\\", "/");
  const trimmed = slashed.replace(/\/+$/, "");
  return process.platform === "win32" ? (trimmed || "/").toLowerCase() : (trimmed || "/");
}

/**
 * Find the workflow worktree segment in both direct project layout and the
 * symlink-resolved external-state layout used by ~/.otto/projects/<hash>.
 */
export function findWorktreeSegment(normalizedPath: string): WorktreeSegment | null {
  const directMarker = "/.otto/workflow/worktrees/";
  const directIdx = normalizedPath.indexOf(directMarker);
  if (directIdx !== -1) {
    return { workflowIdx: directIdx, afterWorktrees: directIdx + directMarker.length };
  }

  const externalRe = /\/\.otto\/workflow\/projects\/[^/]+\/worktrees\//;
  const externalMatch = normalizedPath.match(externalRe);
  if (externalMatch && externalMatch.index !== undefined) {
    return {
      workflowIdx: externalMatch.index,
      afterWorktrees: externalMatch.index + externalMatch[0].length,
    };
  }

  return null;
}

export function isWorktreePath(path: string): boolean {
  return findWorktreeSegment(path.replaceAll("\\", "/")) !== null;
}

/**
 * Resolve the canonical project root for worktree operations.
 *
 * `originalBasePath` wins when available because session state already knows the
 * root. `OTTO_PROJECT_ROOT` is the next strongest signal for worker processes.
 * Otherwise, derive the root from direct `.otto/workflow/worktrees` paths, or recover it
 * from the worktree `.git` file for symlink-resolved ~/.otto/project paths.
 */
export function resolveWorktreeProjectRoot(
  basePath: string,
  originalBasePath?: string | null,
): string {
  const explicitOriginal = originalBasePath?.trim();
  if (explicitOriginal) return resolveProjectRootFromPath(explicitOriginal);

  const envProjectRoot = (process.env.OTTO_PROJECT_ROOT ?? process.env.OTTO_PROJECT_ROOT)?.trim();
  if (envProjectRoot && isWorktreePath(basePath)) {
    return resolveProjectRootFromPath(envProjectRoot);
  }

  return resolveProjectRootFromPath(basePath || envProjectRoot || process.cwd());
}

function resolveProjectRootFromPath(path: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const segment = findWorktreeSegment(normalizedPath);
  if (!segment) {
    return resolveNearestBootstrappedWorkflowRoot(path) ?? resolveGitWorkingTreeRoot(path) ?? path;
  }

  const sepChar = path.includes("\\") ? "\\" : "/";
  const workflowMarker = `${sepChar}.otto${sepChar}workflow${sepChar}`;
  const markerIdx = path.indexOf(workflowMarker);
  const candidate = markerIdx !== -1
    ? path.slice(0, markerIdx)
    : path.slice(0, segment.workflowIdx);

  const workflowHomeNorm = normalizeWorktreePathForCompare(workflowHome());
  const candidateWorkflowPath = normalizeWorktreePathForCompare(join(candidate, ".otto/workflow"));

  if (candidateWorkflowPath === workflowHomeNorm || candidateWorkflowPath.startsWith(`${workflowHomeNorm}/`)) {
    const realRoot = resolveProjectRootFromGitFile(path);
    return realRoot ?? path;
  }

  return candidate;
}

function resolveNearestBootstrappedWorkflowRoot(path: string): string | null {
  try {
    let dir = existsSync(path) && !statSync(path).isDirectory()
      ? resolve(path, "..")
      : path;
    const externalStateParent = normalizeWorktreePathForCompare(resolve(workflowHome(), ".."));

    for (let i = 0; i < 30; i++) {
      if (normalizeWorktreePathForCompare(dir) === externalStateParent) return null;
      if (hasWorkflowBootstrapArtifacts(join(dir, ".otto/workflow"))) return dir;

      const gitPath = join(dir, ".git");
      if (existsSync(gitPath)) return null;

      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Non-fatal: callers fall back to git root resolution.
  }
  return null;
}

function hasWorkflowBootstrapArtifacts(workflowPath: string): boolean {
  return existsSync(workflowPath) &&
    (existsSync(join(workflowPath, "PREFERENCES.md")) ||
      existsSync(join(workflowPath, "preferences.md")) ||
      existsSync(join(workflowPath, "milestones")));
}

function resolveGitWorkingTreeRoot(path: string): string | null {
  try {
    let dir = existsSync(path) && !statSync(path).isDirectory()
      ? resolve(path, "..")
      : path;
    const externalStateParent = normalizeWorktreePathForCompare(resolve(workflowHome(), ".."));

    for (let i = 0; i < 30; i++) {
      if (normalizeWorktreePathForCompare(dir) === externalStateParent) return null;
      const gitPath = join(dir, ".git");
      if (existsSync(gitPath)) return dir;

      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Non-fatal: callers either keep the original path or fail closed.
  }
  return null;
}

function resolveProjectRootFromGitFile(worktreePath: string): string | null {
  try {
    let dir = worktreePath;
    for (let i = 0; i < 30; i++) {
      const gitPath = join(dir, ".git");
      if (existsSync(gitPath)) {
        const content = readFileSync(gitPath, "utf8").trim();
        if (content.startsWith("gitdir: ")) {
          const gitDir = resolve(dir, content.slice(8));
          const dotGitDir = resolve(gitDir, "..", "..");
          if (dotGitDir.endsWith(".git") || dotGitDir.endsWith(".git/") || dotGitDir.endsWith(".git\\")) {
            return resolve(dotGitDir, "..");
          }

          const commonDirPath = join(gitDir, "commondir");
          if (existsSync(commonDirPath)) {
            const commonDir = readFileSync(commonDirPath, "utf8").trim();
            const resolvedCommonDir = resolve(gitDir, commonDir);
            return resolve(resolvedCommonDir, "..");
          }
        }
        break;
      }

      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Non-fatal: callers either keep the original path or fail closed.
  }
  return null;
}
