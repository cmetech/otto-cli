import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const DeliverableType = Type.Union([
	Type.Literal("html-app"),
	Type.Literal("document"),
	Type.Literal("dataset"),
]);

const FileEntry = Type.Object({
	path: Type.String(),
	bytes: Type.Number(),
	modifiedAt: Type.String(),
});

const TurnEntry = Type.Object({
	index: Type.Number(),
	timestamp: Type.String(),
	filesTouched: Type.Array(Type.String()),
});

const ProvenanceEntry = Type.Object({
	conversation: Type.String(),
	turns: Type.Array(TurnEntry),
});

export const DeliverableMeta = Type.Object({
	id: Type.String(),
	slug: Type.String(),
	name: Type.String(),
	description: Type.String(),
	type: DeliverableType,
	primary: Type.Optional(Type.String()),
	createdAt: Type.String(),
	updatedAt: Type.String(),
	files: Type.Array(FileEntry),
	provenance: Type.Array(ProvenanceEntry),
});

export type DeliverableMetaT = Static<typeof DeliverableMeta>;
export type DeliverableTypeT = Static<typeof DeliverableType>;

export interface CreateInput {
	name: string;
	description: string;
	type: DeliverableTypeT;
	primary?: string;
}

export interface Deliverable {
	slug: string;
	path: string;
	meta: DeliverableMetaT;
}

export function slugify(name: string): string {
	return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "deliverable";
}

export class DeliverableStore {
	private readonly root: string;
	private lastTimestampMs = 0;

	constructor(root: string) {
		this.root = root;
		mkdirSync(this.root, { recursive: true });
	}

	async create(input: CreateInput, conversation: string, turnIndex: number): Promise<Deliverable> {
		const slug = this.uniqueSlug(slugify(input.name));
		const path = join(this.root, slug);
		mkdirSync(path, { recursive: true });

		const now = this.now();
		const meta = Value.Parse(DeliverableMeta, {
			id: randomUUID().slice(0, 8),
			slug,
			name: input.name,
			description: input.description,
			type: input.type,
			primary: input.primary,
			createdAt: now,
			updatedAt: now,
			files: [],
			provenance: [{ conversation, turns: [{ index: turnIndex, timestamp: now, filesTouched: [] }] }],
		});
		this.write(path, meta);
		return { slug, path, meta };
	}

	async recordTouch(slug: string, conversation: string, turnIndex: number, files: string[]): Promise<void> {
		const path = join(this.root, slug);
		const meta = this.read(path);
		const now = this.now();

		meta.files = this.scanFiles(path);
		let provenance = meta.provenance.find((entry) => entry.conversation === conversation);
		if (!provenance) {
			provenance = { conversation, turns: [] };
			meta.provenance.push(provenance);
		}
		provenance.turns.push({ index: turnIndex, timestamp: now, filesTouched: files });
		meta.updatedAt = now;
		this.write(path, meta);
	}

	async list(): Promise<DeliverableMetaT[]> {
		if (!existsSync(this.root)) return [];

		const metas: DeliverableMetaT[] = [];
		for (const entry of readdirSync(this.root, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const metaPath = join(this.root, entry.name, "metadata.json");
			if (existsSync(metaPath)) metas.push(this.read(join(this.root, entry.name)));
		}
		return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	private uniqueSlug(base: string): string {
		let slug = base;
		let index = 2;
		while (existsSync(join(this.root, slug))) {
			slug = `${base}-${index++}`;
		}
		return slug;
	}

	private now(): string {
		const current = Date.now();
		const next = current <= this.lastTimestampMs ? this.lastTimestampMs + 1 : current;
		this.lastTimestampMs = next;
		return new Date(next).toISOString();
	}

	private scanFiles(path: string): DeliverableMetaT["files"] {
		return readdirSync(path)
			.filter((file) => file !== "metadata.json")
			.map((file) => {
				const stat = statSync(join(path, file));
				return { path: file, bytes: stat.size, modifiedAt: new Date(stat.mtimeMs).toISOString() };
			});
	}

	private read(path: string): DeliverableMetaT {
		return Value.Parse(DeliverableMeta, JSON.parse(readFileSync(join(path, "metadata.json"), "utf-8")));
	}

	private write(path: string, meta: DeliverableMetaT): void {
		writeFileSync(join(path, "metadata.json"), JSON.stringify(meta, null, 2));
		writeFileSync(join(path, "README.md"), renderReadme(meta));
	}
}

function renderReadme(meta: DeliverableMetaT): string {
	return [
		`# ${meta.name}`,
		"",
		meta.description,
		"",
		`- **Type:** ${meta.type}`,
		`- **Created:** ${meta.createdAt}`,
		`- **Updated:** ${meta.updatedAt}`,
		meta.primary ? `- **Open:** ${meta.primary}` : "",
		"",
		"## Files",
		"",
		...meta.files.map((file) => `- ${file.path} (${file.bytes} bytes)`),
	].join("\n");
}
