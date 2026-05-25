export type DuckConfig = Record<string, string>;

/** Locked-down config for instances that run LLM-generated SQL. */
export function secureConfig(overrides: DuckConfig = {}): DuckConfig {
	return {
		enable_external_access: "false",
		allow_community_extensions: "false",
		allow_unsigned_extensions: "false",
		memory_limit: "2GB",
		threads: "4",
		max_temp_directory_size: "4GB",
		lock_configuration: "true",
		...overrides,
	};
}

/**
 * Permissive config for the short-lived in-memory instance that only runs the
 * fixed file reader during ingest. Never run LLM-generated SQL here.
 */
export function permissiveReadConfig(): DuckConfig {
	return {
		enable_external_access: "true",
		memory_limit: "1GB",
		threads: "2",
	};
}
