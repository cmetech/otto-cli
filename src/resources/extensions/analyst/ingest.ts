import { basename, extname } from "node:path";
import { DuckDbSession, quoteIdent, type ColumnDef } from "./duckdb-session.ts";
import { permissiveReadConfig } from "./secure-config.ts";

export interface IngestResult {
	table: string;
	rowCount: number;
	columns: ColumnDef[];
	sample: Record<string, unknown>[];
}

const READERS: Record<string, (pathLiteral: string) => string> = {
	".csv": (pathLiteral) => `read_csv_auto('${pathLiteral}')`,
	".parquet": (pathLiteral) => `read_parquet('${pathLiteral}')`,
	".json": (pathLiteral) => `read_json_auto('${pathLiteral}')`,
	".ndjson": (pathLiteral) => `read_json_auto('${pathLiteral}')`,
};

/** Derive a SQL-safe table name from a file name. */
export function tableNameFor(filePath: string): string {
	const stem = basename(filePath, extname(filePath));
	const safe = stem.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^(\d)/, "_$1");
	return safe || "data";
}

/**
 * Load a local data file into the locked session DB.
 *
 * Filesystem reading happens in a separate, short-lived in-memory privileged
 * instance that runs only fixed readers. Rows are then copied into the locked
 * session DB through JS so later LLM SQL cannot access files.
 */
export async function ingestFile(sessionDb: DuckDbSession, filePath: string): Promise<IngestResult> {
	if (/:\/\//.test(filePath)) {
		throw new Error("Remote paths are not allowed; provide a local file.");
	}

	const ext = extname(filePath).toLowerCase();
	const reader = READERS[ext];
	if (!reader) {
		throw new Error(`Unsupported file type "${ext}". Supported: ${Object.keys(READERS).join(", ")}`);
	}

	const escapedPath = filePath.replace(/'/g, "''");
	const table = tableNameFor(filePath);
	const reading = await DuckDbSession.open(":memory:", permissiveReadConfig());

	let columns: ColumnDef[];
	let rows: Record<string, unknown>[];
	try {
		await reading.exec(`CREATE TABLE staging AS SELECT * FROM ${reader(escapedPath)}`);
		columns = (await reading.query(
			"SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_name = 'staging' ORDER BY ordinal_position",
		)) as unknown as ColumnDef[];
		rows = await reading.query("SELECT * FROM staging");
	} finally {
		await reading.close();
	}

	await sessionDb.loadRows(table, columns, rows);
	const sample = await sessionDb.query(`SELECT * FROM ${quoteIdent(table)} LIMIT 20`);
	return { table, rowCount: rows.length, columns, sample };
}
