/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@otto/pi-coding-agent";

const PROJECT_AGENT_DIR_CANDIDATES = [".otto/workflow", ".pi"] as const;

/**
 * Conventional agent folders used by other AI coding harnesses, mirroring the
 * harness skill-paths support in pi-coding-agent's skills.ts. Each entry maps
 * a harness id (used as a discriminator in logs and the agent's `source`
 * label) to its user-scope and project-scope conventional paths.
 *
 * When a Claude-style skill delegates to a subagent (`subagent_type: foo` /
 * `Task` tool call), OTTO's subagent tool resolves `foo` against everything
 * `discoverAgents` returns. Including these harness paths is what lets a
 * skill imported from `~/.claude/skills` find its companion agent in
 * `~/.claude/agents` rather than failing with "unknown agent."
 *
 * Caveats — independent of discovery — that may affect runtime success:
 *   - Claude agents commonly declare `tools: [Bash, Read, ...]` (capitalized).
 *     OTTO's tool names tend to be lowercase. If an agent's allowlist is
 *     enforced strictly by the harness it was written for, capitalized
 *     entries won't match OTTO's tool registry. Agents without a `tools`
 *     field (no restriction) work without issue.
 *   - Agent body prompts may reference harness-specific features
 *     (Claude's `/compact`, MCP server names hardcoded for `claude_desktop`,
 *     `~/.claude/...` paths). The agent still runs; those references may
 *     just be ineffective.
 */
const HARNESS_AGENT_PATHS: Record<
	string,
	{ userDir: string; projectSubdir: string }
> = {
	claude: {
		userDir: path.join(homedir(), ".claude", "agents"),
		projectSubdir: path.join(".claude", "agents"),
	},
	codex: {
		userDir: path.join(homedir(), ".codex", "agents"),
		projectSubdir: path.join(".codex", "agents"),
	},
	kiro: {
		userDir: path.join(homedir(), ".kiro", "agents"),
		projectSubdir: path.join(".kiro", "agents"),
	},
};

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	conflictsWith?: string[];
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

interface AgentFrontmatter extends Record<string, unknown> {
	name?: string;
	description?: string;
	tools?: string | string[];
	model?: string;
	conflicts_with?: string;
}

export function parseConflictsWith(value: string | undefined): string[] | undefined {
	if (typeof value !== "string") return undefined;
	const conflicts = value.split(",").map((s) => s.trim()).filter(Boolean);
	return conflicts.length > 0 ? conflicts : undefined;
}

/**
 * Maps capitalized tool names used by other AI coding harnesses (Claude, Codex,
 * Kiro) to OTTO's lowercase tool-registry names. Applied at agent-load time so
 * an agent imported from ~/.claude/agents/ with `tools: [Bash, Read]` ends up
 * with `tools: ["bash", "read"]` and actually has access to those tools.
 *
 * Tools without an explicit mapping fall through to .toLowerCase() — that's
 * enough for any name that's already aligned with OTTO's case-insensitive
 * convention. Tool names with no OTTO equivalent (TodoWrite, SlashCommand,
 * NotebookEdit) are kept (lowercased) and silently ignored by the runtime
 * allowlist check — so they don't block the rest of the agent's toolset.
 *
 * MCP tool patterns (mcp__server__name, mcp__server__*) are preserved
 * verbatim — they're already case-sensitive identifiers, and MCP servers
 * register their own tools at runtime.
 */
const HARNESS_TOOL_NAME_MAP: Record<string, string> = {
	Bash: "bash",
	Read: "read",
	Write: "write",
	Edit: "edit",
	Glob: "glob",
	Grep: "grep",
	AskUserQuestion: "ask_user_questions",
	Agent: "subagent",
	Task: "subagent",
	WebSearch: "web_search",
	WebFetch: "fetch_page",
	Skill: "skill",
};

function normalizeHarnessToolName(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("mcp__")) return trimmed;
	if (HARNESS_TOOL_NAME_MAP[trimmed]) return HARNESS_TOOL_NAME_MAP[trimmed];
	return trimmed.toLowerCase();
}

export function parseAgentTools(value: string | string[] | undefined): string[] | undefined {
	if (typeof value === "string") {
		const tools = value
			.split(",")
			.map((tool) => normalizeHarnessToolName(tool))
			.filter((tool): tool is string => Boolean(tool));
		const deduped = Array.from(new Set(tools));
		return deduped.length > 0 ? deduped : undefined;
	}

	if (Array.isArray(value)) {
		const tools = value
			.flatMap((tool) => typeof tool === "string" ? tool.split(",") : [])
			.map((tool) => normalizeHarnessToolName(tool))
			.filter((tool): tool is string => Boolean(tool));
		const deduped = Array.from(new Set(tools));
		return deduped.length > 0 ? deduped : undefined;
	}

	return undefined;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);

		if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
			continue;
		}

		const tools = parseAgentTools(frontmatter.tools);
		const conflictsWith = parseConflictsWith(frontmatter.conflicts_with);

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: frontmatter.model,
			conflictsWith,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		// Prefer the documented project-local location while preserving support
		// for older workarounds that placed agents under .pi/agents.
		for (const configDir of PROJECT_AGENT_DIR_CANDIDATES) {
			const candidate = path.join(currentDir, configDir, "agents");
			if (isDirectory(candidate)) return candidate;
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

/**
 * Walk up from cwd looking for harness project agent dirs (e.g. `.claude/agents`).
 * Returns ALL matching dirs found at the first ancestor that has at least one,
 * so a project root with both `.claude/agents` and `.codex/agents` surfaces
 * both. Stops at the first ancestor with any matches to avoid pulling in
 * stale agents from outer directories.
 */
function findNearestHarnessProjectAgentsDirs(cwd: string): string[] {
	let currentDir = cwd;
	while (true) {
		const matches: string[] = [];
		for (const { projectSubdir } of Object.values(HARNESS_AGENT_PATHS)) {
			const candidate = path.join(currentDir, projectSubdir);
			if (isDirectory(candidate)) matches.push(candidate);
		}
		if (matches.length > 0) return matches;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return [];
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);
	const harnessProjectAgentsDirs = findNearestHarnessProjectAgentsDirs(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	// Harness agents — user scope: ~/.claude/agents, ~/.codex/agents, ~/.kiro/agents.
	// Harness agents — project scope: nearest .claude/agents etc. up the cwd tree.
	// Both go into the same scope buckets as OTTO's own agents; collisions are
	// resolved by the existing Map-write-wins order below (project wins user).
	const harnessUserAgents: AgentConfig[] = [];
	if (scope !== "project") {
		for (const { userDir: harnessUserDir } of Object.values(HARNESS_AGENT_PATHS)) {
			harnessUserAgents.push(...loadAgentsFromDir(harnessUserDir, "user"));
		}
	}
	const harnessProjectAgents: AgentConfig[] = [];
	if (scope !== "user") {
		for (const dir of harnessProjectAgentsDirs) {
			harnessProjectAgents.push(...loadAgentsFromDir(dir, "project"));
		}
	}

	const agentMap = new Map<string, AgentConfig>();

	// Order: OTTO user → harness user → OTTO project → harness project.
	// Later writes win on name collision, so OTTO's own agents take precedence
	// at each scope, and project always overrides user. Same precedence as the
	// existing logic, just with harness sources slotted in beneath.
	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of harnessUserAgents) {
			if (!agentMap.has(agent.name)) agentMap.set(agent.name, agent);
		}
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
		for (const agent of harnessProjectAgents) {
			if (!agentMap.has(agent.name)) agentMap.set(agent.name, agent);
		}
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of harnessUserAgents) {
			if (!agentMap.has(agent.name)) agentMap.set(agent.name, agent);
		}
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
		for (const agent of harnessProjectAgents) {
			if (!agentMap.has(agent.name)) agentMap.set(agent.name, agent);
		}
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
