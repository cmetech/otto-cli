import type { ExtensionAPI } from "@otto/pi-coding-agent";
import { getDeliverablesDir } from "@otto/pi-coding-agent";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { AsyncJobManager } from "../async-jobs/job-manager.js";
import { DuckDbSession } from "./duckdb-session.js";
import { secureConfig } from "./secure-config.js";
import { LocalRuntime, type ScratchpadRuntime } from "./runtime.js";
import { DeliverableStore } from "./deliverables/store.js";
import { createIngestTool } from "./tools/ingest-tool.js";
import { createScratchpadTool } from "./tools/scratchpad-tool.js";
import { createDeliverableTools, type TurnRef } from "./tools/deliverable-tools.js";

type SessionCtx = {
	cwd: string;
	sessionManager: { getSessionFile?: () => string | undefined };
};

export default function Analyst(pi: ExtensionAPI) {
	let db: DuckDbSession | null = null;
	let runtime: ScratchpadRuntime | null = null;
	let manager: AsyncJobManager | null = null;
	let store: DeliverableStore | null = null;
	let conversation = "default";
	let turn = 0;
	let latestCwd = process.cwd();

	const getDb = () => {
		if (!db) throw new Error("Analyst DB not ready. Wait for session_start.");
		return db;
	};
	const getRuntime = () => {
		if (!runtime) throw new Error("Analyst runtime not ready.");
		return runtime;
	};
	const getManager = () => manager;
	const getStore = () => {
		if (!store) throw new Error("Deliverable store not ready.");
		return store;
	};
	const getTurn = (): TurnRef => ({ conversation, turn });
	const getAllowedRoots = () => [latestCwd];

	pi.on("session_start", async (_event, ctx) => {
		const sessionCtx = ctx as SessionCtx;
		latestCwd = sessionCtx.cwd;

		const path = sessionDbPath(sessionCtx);
		const sessionFile = sessionCtx.sessionManager.getSessionFile?.();
		conversation = sessionFile ? basename(dirname(path)) : "default";
		turn = 0;

		db = await DuckDbSession.open(path, secureConfig());
		runtime = new LocalRuntime(db);
		store = new DeliverableStore(getDeliverablesDir());
		manager = new AsyncJobManager({
			onJobComplete: (job) => {
				if (job.awaited) return;
				const status = job.status === "completed" ? "done" : "error";
				const body = job.status === "completed"
					? job.resultText ?? "(no output)"
					: `Error: ${job.errorText ?? "unknown"}`;
				pi.sendMessage(
					{
						customType: "analyst_job_result",
						content: `**Analysis ${status}: ${job.id}** (${job.label})\n\n${body}`,
						display: true,
					},
					{ deliverAs: "followUp" },
				);
			},
		});
	});

	pi.on("turn_start", async (event) => {
		turn = event.turnIndex;
	});

	pi.on("session_shutdown", async () => {
		if (manager) manager.shutdown();
		if (db) await db.close();
		db = null;
		runtime = null;
		manager = null;
		store = null;
	});

	pi.registerTool(createIngestTool(getDb, getAllowedRoots));
	pi.registerTool(createScratchpadTool(getRuntime, getManager));
	const { createDeliverable, listDeliverables } = createDeliverableTools(getStore, getTurn);
	pi.registerTool(createDeliverable);
	pi.registerTool(listDeliverables);

	pi.registerCommand("deliverables", {
		description: "List analyst deliverables",
		handler: async () => {
			const all = store ? await store.list() : [];
			const content = all.length === 0
				? "No deliverables yet."
				: ["## Deliverables", ...all.map((meta) => `- **${meta.slug}** (${meta.type}) - ${meta.name}`)].join("\n");
			pi.sendMessage({ customType: "analyst_deliverables", content, display: true });
		},
	});
}

function sessionDbPath(ctx: SessionCtx): string {
	const file = ctx.sessionManager.getSessionFile?.();
	if (file) {
		const dir = file.endsWith(".jsonl") ? file.slice(0, -6) : `${file}.analysis`;
		mkdirSync(dir, { recursive: true });
		return join(dir, "analysis.duckdb");
	}

	const dir = mkdtempSync(join(tmpdir(), "analyst-session-"));
	return join(dir, "analysis.duckdb");
}
