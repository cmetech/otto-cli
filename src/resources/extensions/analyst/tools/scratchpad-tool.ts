import type { ToolDefinition } from "@loop24/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AsyncJobManager } from "../../async-jobs/job-manager.ts";
import type { CellResult, ScratchpadRuntime } from "../runtime.ts";

const schema = Type.Object({
	code: Type.String({ description: "SQL to run against the analysis database." }),
	description: Type.String({ description: "One-line description of what this cell does." }),
	estimated_execution_time_seconds: Type.Number({ description: "Estimate; cells over 5s run in the background." }),
});

const BACKGROUND_THRESHOLD_MS = 5_000;

function formatResult(result: CellResult): string {
	if (result.error) return `Error: ${result.error}`;
	const table = result.tables?.[0];
	if (!table) return result.stdout || "(no output)";

	const header = table.columns.join(" | ");
	const body = table.rows.slice(0, 20).map((row) => row.map(String).join(" | ")).join("\n");
	const more = table.truncated ? "\n... (preview truncated)" : "";
	return `${result.stdout}\n\n${header}\n${body}${more}`;
}

export function createScratchpadTool(
	getRuntime: () => ScratchpadRuntime,
	getManager: () => AsyncJobManager | null,
): ToolDefinition<typeof schema> {
	return {
		name: "scratchpad",
		label: "Analysis scratchpad",
		description:
			"Run a SQL cell against the analysis database to compute results, aggregate, or shape data for a report. " +
			"Use this whenever the user wants to analyze, summarize, or report on ingested data. " +
			"Long cells (estimate > 5s) run in the background and return a job ID so you can keep working.",
		promptSnippet: "Run a SQL analysis cell against the ingested data.",
		promptGuidelines: [
			"Ingest a file first, then query its table by name.",
			"Prefer SQL aggregation over returning raw rows.",
			"For long scans, set a realistic estimate so the run goes to the background.",
		],
		parameters: schema,
		async execute(_id, params, signal) {
			const runtime = getRuntime();
			const estMs = Math.round(params.estimated_execution_time_seconds * 1000);
			const cell = { code: params.code, lang: "sql" as const, description: params.description, estMs };
			const manager = getManager();

			if (manager && estMs > BACKGROUND_THRESHOLD_MS) {
				const jobId = manager.register("analysis", params.description, async (jobSignal) =>
					formatResult(await runtime.exec(cell, jobSignal)),
				);
				return {
					content: [{
						type: "text",
						text: `Analysis started in the background: **${jobId}**. Use await_job for results, or keep working.`,
					}],
					details: undefined,
				};
			}

			const fallback = new AbortController();
			const result = await runtime.exec(cell, signal ?? fallback.signal);
			return { content: [{ type: "text", text: formatResult(result) }], details: undefined };
		},
	};
}
