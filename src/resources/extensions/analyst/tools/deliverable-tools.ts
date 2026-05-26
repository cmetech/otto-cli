import type { ToolDefinition } from "@loop24/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { DeliverableStore } from "../deliverables/store.js";

const createSchema = Type.Object({
	name: Type.String({ description: "Human-readable deliverable name (the folder slug derives from this)." }),
	description: Type.String({ description: "Short description shown to the user." }),
	type: Type.Union([Type.Literal("html-app"), Type.Literal("document"), Type.Literal("dataset")]),
	primary: Type.Optional(Type.String({ description: "Entry-point filename you will write, such as dashboard.html." })),
});

const listSchema = Type.Object({});

export interface TurnRef {
	conversation: string;
	turn: number;
}

export function createDeliverableTools(
	getStore: () => DeliverableStore,
	getTurn: () => TurnRef,
) {
	const createDeliverable: ToolDefinition<typeof createSchema> = {
		name: "create_deliverable",
		label: "Create deliverable",
		description:
			"Claim a folder for a user-facing output (dashboard, report, or dataset) and get the absolute path to write files into. " +
			"Call this before writing the files. The folder lives under the user's deliverables directory and is auto-tracked.",
		promptSnippet: "Claim a folder for a dashboard/report/dataset; returns the path to write into.",
		parameters: createSchema,
		async execute(_id, params) {
			const ref = getTurn();
			const deliverable = await getStore().create(params, ref.conversation, ref.turn);
			return {
				content: [{
					type: "text",
					text: `Created deliverable **${deliverable.slug}**.\nWrite files into: ${deliverable.path}`,
				}],
				details: undefined,
			};
		},
	};

	const listDeliverables: ToolDefinition<typeof listSchema> = {
		name: "list_deliverables",
		label: "List deliverables",
		description: "List all deliverables in the user's deliverables directory, newest first.",
		promptSnippet: "List existing deliverables.",
		parameters: listSchema,
		async execute() {
			const all = await getStore().list();
			if (all.length === 0) {
				return { content: [{ type: "text", text: "No deliverables yet." }], details: undefined };
			}

			const lines = all.map((meta) => `- **${meta.slug}** (${meta.type}) - ${meta.name}: ${meta.description}`);
			return { content: [{ type: "text", text: ["## Deliverables", ...lines].join("\n") }], details: undefined };
		},
	};

	return { createDeliverable, listDeliverables };
}
