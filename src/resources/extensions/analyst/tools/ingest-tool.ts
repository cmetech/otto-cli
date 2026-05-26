import type { ToolDefinition } from "@loop24/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { DuckDbSession } from "../duckdb-session.js";
import { ingestFile } from "../ingest.js";
import { classifyIngestPath } from "../path-policy.js";

const schema = Type.Object({
	path: Type.String({ description: "Absolute path to a local data file (.csv, .parquet, .json)." }),
});

type UiCtx = { ui?: { confirm?: (title: string, message: string) => Promise<boolean> } };

export function createIngestTool(
	getDb: () => DuckDbSession,
	getAllowedRoots: () => string[],
): ToolDefinition<typeof schema> {
	return {
		name: "ingest",
		label: "Ingest data file",
		description:
			"Load a local data file (CSV/Parquet/JSON) into the analysis database and return its schema, row count, and a sample. " +
			"Use this whenever the user references a data file they want analyzed or reported on.",
		promptSnippet: "Load a local data file into the analysis database; returns schema + sample.",
		parameters: schema,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const classification = classifyIngestPath(params.path, getAllowedRoots());
			if (classification.decision === "reject") {
				return { content: [{ type: "text", text: `Cannot ingest: ${classification.reason}` }], details: undefined };
			}

			if (classification.decision === "confirm") {
				const ok = await (ctx as UiCtx)?.ui?.confirm?.(
					"Confirm data access",
					`Read a file outside your workspace?\n${classification.resolved}`,
				);
				if (!ok) {
					return {
						content: [{
							type: "text",
							text: `Ingest declined: "${classification.resolved}" is outside the allowed roots.`,
						}],
						details: undefined,
					};
				}
			}

			const result = await ingestFile(getDb(), classification.resolved);
			const columns = result.columns.map((column) => `- ${column.name}: ${column.type}`).join("\n");
			return {
				content: [{
					type: "text",
					text: [
						`Loaded **${result.table}** (${result.rowCount} rows).`,
						"",
						"Columns:",
						columns,
						"",
						"Sample (first rows):",
						"```json",
						toJson(result.sample.slice(0, 5)),
						"```",
					].join("\n"),
				}],
				details: undefined,
			};
		},
	};
}

function toJson(value: unknown): string {
	return JSON.stringify(value, (_key, current) => typeof current === "bigint" ? current.toString() : current, 2);
}
