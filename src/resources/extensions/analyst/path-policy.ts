import { existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

export type IngestDecision = "allow" | "confirm" | "reject";

export interface PathClassification {
	decision: IngestDecision;
	reason: string;
	resolved: string;
}

function isWithin(child: string, root: string): boolean {
	const normalizedRoot = resolve(root);
	const normalizedChild = resolve(child);
	return normalizedChild === normalizedRoot || normalizedChild.startsWith(
		normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep,
	);
}

/** Classify an ingest path: reject remote/non-files, allow inside roots, else confirm. */
export function classifyIngestPath(rawPath: string, allowedRoots: string[]): PathClassification {
	if (/:\/\//.test(rawPath)) {
		return {
			decision: "reject",
			reason: "Remote paths are not allowed; provide a local file.",
			resolved: rawPath,
		};
	}

	const resolved = resolve(rawPath);
	if (!existsSync(resolved) || !statSync(resolved).isFile()) {
		return {
			decision: "reject",
			reason: "Path is not an existing local file.",
			resolved,
		};
	}

	if (allowedRoots.some((root) => isWithin(resolved, root))) {
		return {
			decision: "allow",
			reason: "Within an allowed root.",
			resolved,
		};
	}

	return {
		decision: "confirm",
		reason: "Outside allowed roots; user confirmation required.",
		resolved,
	};
}
