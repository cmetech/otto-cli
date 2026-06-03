// OTTO + Subagent launch contract and child process safety helpers.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { SessionManager } from "@otto/pi-coding-agent";
import type { AgentConfig } from "./agents.js";

export const SUBAGENT_CHILD_ENV_VAR = "OTTO_SUBAGENT_CHILD";
export const SUBAGENT_CHILD_ENV_VALUE = "1";
export const SUBAGENT_SCRATCHPAD_ENV_VAR = "OTTO_SUBAGENT_SCRATCHPAD";

const MAX_SCRATCHPAD_AGENT_PART = 32;

export function mintSubagentScratchpadName(agentName: string): string {
	const hex = crypto.randomBytes(3).toString("hex");
	// Sanitize: NFKD + strip combining marks + lowercase + non-[a-z0-9] → '-' + collapse + trim.
	let sanitized = agentName
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (sanitized.length > MAX_SCRATCHPAD_AGENT_PART) {
		sanitized = sanitized.slice(0, MAX_SCRATCHPAD_AGENT_PART).replace(/-+$/, "");
	}
	if (!sanitized) return `subagent-${hex}`;
	return `subagent-${sanitized}-${hex}`;
}

export type SubagentContextMode = "fresh" | "fork";

export type SubagentSessionArgs =
	| { mode: "fresh" }
	| { mode: "fork"; sessionFile: string; sessionDir?: string };

export interface SubagentParentSessionManager {
	getSessionFile(): string | undefined;
	getLeafId(): string | null;
	getSessionDir(): string;
}

export interface SubagentLaunchInput {
	agent: AgentConfig;
	task: string;
	tmpPromptPath: string | null;
	modelOverride?: string;
	contextMode?: SubagentContextMode;
	parentSessionManager?: SubagentParentSessionManager;
	session?: SubagentSessionArgs;
	cwd?: string;
	defaultCwd: string;
	scratchpadName?: string;
}

export interface SubagentLaunchPlan {
	args: string[];
	env: NodeJS.ProcessEnv;
	cwd: string;
	session: SubagentSessionArgs;
}

export function isSubagentChildProcess(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[SUBAGENT_CHILD_ENV_VAR] === SUBAGENT_CHILD_ENV_VALUE;
}

export function buildSubagentProcessEnv(
	env: NodeJS.ProcessEnv = process.env,
	scratchpadName?: string,
): NodeJS.ProcessEnv {
	const next: NodeJS.ProcessEnv = {
		...env,
		[SUBAGENT_CHILD_ENV_VAR]: SUBAGENT_CHILD_ENV_VALUE,
	};
	if (scratchpadName) {
		next[SUBAGENT_SCRATCHPAD_ENV_VAR] = scratchpadName;
	}
	return next;
}

export function buildShellEnvAssignments(env: NodeJS.ProcessEnv = process.env): string[] {
	const out: string[] = [];
	const childValue = env[SUBAGENT_CHILD_ENV_VAR];
	if (childValue) {
		out.push(`${SUBAGENT_CHILD_ENV_VAR}=${JSON.stringify(childValue)}`);
	}
	const scratchpadValue = env[SUBAGENT_SCRATCHPAD_ENV_VAR];
	if (scratchpadValue) {
		out.push(`${SUBAGENT_SCRATCHPAD_ENV_VAR}=${JSON.stringify(scratchpadValue)}`);
	}
	return out;
}

export function buildSubagentProcessArgs(
	agent: AgentConfig,
	task: string,
	tmpPromptPath: string | null,
	modelOverride?: string,
	session: SubagentSessionArgs = { mode: "fresh" },
): string[] {
	const args: string[] = ["--mode", "json", "-p"];
	if (session.mode === "fork") {
		args.push("--session", session.sessionFile);
		if (session.sessionDir) args.push("--session-dir", session.sessionDir);
	} else {
		args.push("--no-session");
	}
	const effectiveModel = modelOverride ?? agent.model;
	if (effectiveModel) args.push("--model", effectiveModel);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
	if (tmpPromptPath) args.push("--append-system-prompt", tmpPromptPath);
	args.push(`Task: ${task}`);
	return args;
}

export function resolveSubagentSessionArgs(
	contextMode: SubagentContextMode = "fresh",
	parentSessionManager?: SubagentParentSessionManager,
): SubagentSessionArgs {
	if (contextMode === "fresh") return { mode: "fresh" };

	if (!parentSessionManager) {
		throw new Error("Forked subagent context requires a parent session manager.");
	}

	const parentSessionFile = parentSessionManager.getSessionFile();
	if (!parentSessionFile) {
		throw new Error("Forked subagent context requires a persisted parent session file; current session is in-memory.");
	}
	if (!fs.existsSync(parentSessionFile)) {
		throw new Error(`Forked subagent context could not read parent session file: ${parentSessionFile}`);
	}

	const leafId = parentSessionManager.getLeafId();
	if (!leafId) {
		throw new Error("Forked subagent context requires a parent session leaf to branch from.");
	}

	const sessionDir = parentSessionManager.getSessionDir?.();
	const parentSession = SessionManager.open(parentSessionFile, sessionDir);
	const childSessionFile = parentSession.createBranchedSession(leafId);
	if (!childSessionFile) {
		throw new Error("Forked subagent context could not create a branched child session.");
	}

	return {
		mode: "fork",
		sessionFile: childSessionFile,
		...(sessionDir ? { sessionDir: path.resolve(sessionDir) } : {}),
	};
}

export function createSubagentLaunchPlan(input: SubagentLaunchInput): SubagentLaunchPlan {
	const session = input.session ?? resolveSubagentSessionArgs(input.contextMode ?? "fresh", input.parentSessionManager);
	return {
		args: buildSubagentProcessArgs(
			input.agent,
			input.task,
			input.tmpPromptPath,
			input.modelOverride,
			session,
		),
		env: buildSubagentProcessEnv(process.env, input.scratchpadName),
		cwd: input.cwd ?? input.defaultCwd,
		session,
	};
}
