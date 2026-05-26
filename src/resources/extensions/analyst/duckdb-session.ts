import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckConfig } from "./secure-config.js";

type Row = Record<string, unknown>;

export interface ColumnDef {
	name: string;
	type: string;
}

type DuckInstance = Awaited<ReturnType<typeof DuckDBInstance.create>>;
type DuckConnection = Awaited<ReturnType<DuckInstance["connect"]>>;

export class DuckDbSession {
	private readonly instance: DuckInstance;
	private readonly connection: DuckConnection;
	readonly path: string;

	private constructor(instance: DuckInstance, connection: DuckConnection, path: string) {
		this.instance = instance;
		this.connection = connection;
		this.path = path;
	}

	static async open(path: string, config: DuckConfig = {}): Promise<DuckDbSession> {
		const instance = await DuckDBInstance.create(path, config);
		const connection = await instance.connect();
		return new DuckDbSession(instance, connection, path);
	}

	async exec(sql: string): Promise<void> {
		await this.connection.run(sql);
	}

	async query(sql: string): Promise<Row[]> {
		const reader = await this.connection.runAndReadAll(sql);
		return reader.getRowObjects() as Row[];
	}

	/** Best-effort interrupt of the running query, used by timeout/abort paths. */
	interrupt(): void {
		this.connection.interrupt();
	}

	/**
	 * Create a table and insert JS rows without filesystem access. Ingest uses
	 * this to move data into the locked session instance.
	 */
	async loadRows(table: string, columns: ColumnDef[], rows: Row[]): Promise<void> {
		const colDefs = columns.map((c) => `${quoteIdent(c.name)} ${c.type}`).join(", ");
		await this.exec(`CREATE OR REPLACE TABLE ${quoteIdent(table)} (${colDefs})`);
		if (rows.length === 0) return;

		const names = columns.map((c) => c.name);
		const batchSize = 500;
		for (let i = 0; i < rows.length; i += batchSize) {
			const chunk = rows.slice(i, i + batchSize);
			const values = chunk
				.map((row) => `(${names.map((name) => sqlLiteral(row[name])).join(", ")})`)
				.join(", ");
			await this.exec(`INSERT INTO ${quoteIdent(table)} VALUES ${values}`);
		}
	}

	async close(): Promise<void> {
		this.connection.closeSync();
		this.instance.closeSync();
	}
}

/** Quote a SQL identifier and double embedded double-quotes. */
export function quoteIdent(name: string): string {
	return `"${String(name).replace(/"/g, '""')}"`;
}

/** Serialize a JS value as a SQL literal for our own ingested data. */
export function sqlLiteral(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
	if (value instanceof Date) return `'${value.toISOString()}'`;
	return `'${String(value).replace(/'/g, "''")}'`;
}
