/**
 * OTTO e2e harness: temporary project scaffolding.
 *
 * Creates a fresh isolated tmp dir for an e2e test, optionally seeded
 * with a git repo and/or a minimal `.otto/workflow/` skeleton. Caller wires cleanup
 * via t.after() per the project testing standards (no try/finally).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalTmpdir } from "./spawn.ts";

export interface TmpProjectOptions {
	/** Run `git init` and create an initial empty commit. */
	git?: boolean;
	/** Create an empty `.otto/workflow/` directory (does not create milestones). */
	ottoWorkflowSkeleton?: boolean;
	/** Files to write into the project before any test action. */
	files?: Record<string, string>;
}

export interface TmpProject {
	dir: string;
	cleanup: () => void;
	writeFile: (relPath: string, content: string) => void;
}

/**
 * Create an isolated tmp project. Returns the absolute path and a cleanup
 * function. Always wrap with `t.after(project.cleanup)`.
 */
export function createTmpProject(opts: TmpProjectOptions = {}): TmpProject {
	const dir = mkdtempSync(join(canonicalTmpdir(), "otto-e2e-"));

	if (opts.ottoWorkflowSkeleton) {
		mkdirSync(join(dir, ".otto", "workflow"), { recursive: true });
	}

	if (opts.files) {
		for (const [rel, content] of Object.entries(opts.files)) {
			const abs = join(dir, rel);
			mkdirSync(join(abs, ".."), { recursive: true });
			writeFileSync(abs, content);
		}
	}

	if (opts.git) {
		// --initial-branch is required on modern Git in CI; bare `git init`
		// produces inconsistent default branch names across environments.
		execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir, stdio: "pipe" });
		execFileSync("git", ["config", "user.email", "e2e@otto.test"], { cwd: dir, stdio: "pipe" });
		execFileSync("git", ["config", "user.name", "OTTO E2E"], { cwd: dir, stdio: "pipe" });
		execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir, stdio: "pipe" });
	}

	return {
		dir,
		cleanup: () => {
			rmSync(dir, { recursive: true, force: true });
		},
		writeFile: (relPath, content) => {
			const abs = join(dir, relPath);
			mkdirSync(join(abs, ".."), { recursive: true });
			writeFileSync(abs, content);
		},
	};
}
