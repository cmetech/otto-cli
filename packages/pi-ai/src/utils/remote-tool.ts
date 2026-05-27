import type { ToolCall } from "../types.js";

export interface RemoteToolClassificationContext {
	gatewayRouted?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractLocations(args: Record<string, unknown>): Array<{ path?: string; line?: number; column?: number }> | undefined {
	const direct = args.locations;
	if (Array.isArray(direct)) {
		const locations = direct
			.filter(isRecord)
			.map((entry) => ({
				path: typeof entry.path === "string" ? entry.path : undefined,
				line: typeof entry.line === "number" ? entry.line : undefined,
				column: typeof entry.column === "number" ? entry.column : undefined,
			}))
			.filter((entry) => entry.path || entry.line !== undefined || entry.column !== undefined);
		if (locations.length > 0) return locations;
	}

	const operations = args.operations;
	if (!Array.isArray(operations)) return undefined;
	const locations = operations
		.filter(isRecord)
		.map((entry) => ({
			path: typeof entry.path === "string" ? entry.path : undefined,
		}))
		.filter((entry) => entry.path);
	return locations.length > 0 ? locations : undefined;
}

function looksLikeKiroRawInput(args: Record<string, unknown>): boolean {
	return (
		Array.isArray(args.operations) ||
		Array.isArray(args.locations) ||
		typeof args.__tool_use_purpose === "string" ||
		isRecord(args.rawInput)
	);
}

export function classifyRemoteToolCall(
	toolCall: ToolCall,
	context: RemoteToolClassificationContext = {},
): ToolCall {
	if (toolCall.executionDomain === "remote") return toolCall;
	if (!context.gatewayRouted) return toolCall;
	if (!looksLikeKiroRawInput(toolCall.arguments)) return toolCall;

	const purpose =
		typeof toolCall.arguments.__tool_use_purpose === "string" ? toolCall.arguments.__tool_use_purpose : undefined;

	return {
		...toolCall,
		executionDomain: "remote",
		remote: {
			source: "kiro-acp",
			kind: toolCall.name,
			locations: extractLocations(toolCall.arguments),
			rawInput: toolCall.arguments,
			purpose,
		},
	};
}

export function formatRemoteToolResultText(toolCall: ToolCall): string {
	const remote = toolCall.remote;
	const source = remote?.source ?? "remote-agent";
	const label = remote?.title ?? `${remote?.kind ?? toolCall.name} (${toolCall.id})`;
	const lines = [`Remote tool reported by ${source}: ${label}`];
	if (remote?.purpose) lines.push(`agent stated purpose: ${remote.purpose}`);
	if (remote?.locations?.length) {
		lines.push("locations:");
		for (const location of remote.locations) {
			const suffix = [
				location.line !== undefined ? `:${location.line}` : "",
				location.column !== undefined ? `:${location.column}` : "",
			].join("");
			lines.push(`- ${location.path ?? "(unknown)"}${suffix}`);
		}
	}
	return lines.join("\n");
}
