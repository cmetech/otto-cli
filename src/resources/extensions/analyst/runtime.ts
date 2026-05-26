import type { DuckDbSession } from "./duckdb-session.js";

export interface Cell {
	code: string;
	lang: "sql" | "ts";
	description: string;
	estMs: number;
	background?: boolean;
}

export interface TablePreview {
	columns: string[];
	rows: unknown[][];
	truncated: boolean;
}

export interface CellResult {
	stdout: string;
	tables?: TablePreview[];
	error?: string;
}

/** Pluggable execution backend. WorkerRuntime can implement this seam later. */
export interface ScratchpadRuntime {
	exec(cell: Cell, signal: AbortSignal): Promise<CellResult>;
	view(): Cell[];
}

const PREVIEW_ROW_CAP = 100;
const DEFAULT_TIMEOUT_MS = 30_000;

export class LocalRuntime implements ScratchpadRuntime {
	private readonly cells: Cell[] = [];
	private readonly db: DuckDbSession;
	private readonly timeoutMs: number;

	constructor(db: DuckDbSession, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
		this.db = db;
		this.timeoutMs = timeoutMs;
	}

	view(): Cell[] {
		return [...this.cells];
	}

	async exec(cell: Cell, signal: AbortSignal): Promise<CellResult> {
		this.cells.push(cell);
		if (cell.lang !== "sql") {
			return { stdout: "", error: "Only SQL cells are supported in the current build." };
		}
		if (signal.aborted) {
			return { stdout: "", error: "Aborted before execution." };
		}

		let timer: ReturnType<typeof setTimeout> | undefined;
		const onAbort = () => this.db.interrupt();
		signal.addEventListener("abort", onAbort, { once: true });

		let queryPromise: Promise<Record<string, unknown>[]> | undefined;
		let timedOut = false;
		try {
			const timeoutPromise = new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					timedOut = true;
					this.db.interrupt();
					reject(new Error(`Cell timed out after ${this.timeoutMs}ms.`));
				}, this.timeoutMs);
			});

			queryPromise = this.db.query(cell.code);
			const rows = await Promise.race([queryPromise, timeoutPromise]);
			const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
			const capped = rows.slice(0, PREVIEW_ROW_CAP);
			const preview: TablePreview = {
				columns,
				rows: capped.map((row) => columns.map((column) => row[column])),
				truncated: rows.length > PREVIEW_ROW_CAP,
			};
			return { stdout: `${rows.length} row(s)`, tables: [preview] };
		} catch (err) {
			if (timedOut && queryPromise) {
				try {
					await queryPromise;
				} catch {
					// The interrupt usually rejects the active query; drain it so the
					// native handle settles before tests or callers close the database.
				}
			}
			return { stdout: "", error: err instanceof Error ? err.message : String(err) };
		} finally {
			if (timer) clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
		}
	}
}
