/**
 * /release-notes — browse OTTO's "what's new" history.
 *
 * Usage:
 *   /release-notes               → interactive selector across all versions
 *   /release-notes <version>     → show that version directly (e.g. 1.0.7 or v1.0.7)
 *   /release-notes latest        → alias for the newest version
 *   /release-notes list          → non-interactive index (one line per version)
 *
 * UX modelled after Claude Code's /release-notes: a top-level list with a
 * count badge per entry, then full detail on selection. Output is written
 * to stdout so it lands in the chat transcript.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@otto/pi-coding-agent";
import {
	RELEASE_NOTES,
	countItems,
	findReleaseByVersion,
	getLatestRelease,
	type ReleaseNote,
} from "./_data.js";

const USAGE = `Usage:
  /release-notes               Browse all releases interactively
  /release-notes <version>     Show a specific release (e.g. 1.0.7)
  /release-notes latest        Show the newest release
  /release-notes list          Print a one-line index of every release`;

function formatSelectorLabel(release: ReleaseNote): string {
	const total = countItems(release);
	const headline = release.headline ? ` — ${release.headline}` : "";
	const badge = total === 1 ? "1 item" : `${total} items`;
	return `v${release.version}  (${release.date}, ${badge})${headline}`;
}

function renderSection(title: string, items: string[] | undefined): string {
	if (!items || items.length === 0) return "";
	const bulleted = items.map((line) => `- ${line}`).join("\n");
	return `\n### ${title}\n${bulleted}\n`;
}

function renderRelease(release: ReleaseNote): string {
	const header = `# OTTO v${release.version} — ${release.date}`;
	const headline = release.headline ? `\n_${release.headline}_\n` : "";
	const body = [
		renderSection("Added", release.added),
		renderSection("Fixed", release.fixed),
		renderSection("Changed", release.changed),
		renderSection("Notes", release.notes),
	].join("");
	const tail = `\n---\n${RELEASE_NOTES.length} releases tracked. Use \`/release-notes\` to browse, \`/release-notes <version>\` for any other release.`;
	return `${header}${headline}${body}${tail}\n`;
}

function renderIndex(): string {
	const rows = RELEASE_NOTES.map((r) => {
		const total = countItems(r);
		const badge = total === 1 ? "1 item" : `${total} items`;
		const headline = r.headline ? ` — ${r.headline}` : "";
		return `- v${r.version}  (${r.date}, ${badge})${headline}`;
	}).join("\n");
	return `# OTTO release index\n\n${rows}\n\nView any release with \`/release-notes <version>\`.\n`;
}

function findByVersionToken(token: string): ReleaseNote | undefined {
	if (token === "latest") return getLatestRelease();
	return findReleaseByVersion(token);
}

const CUSTOM_TYPE = "otto-release-notes";

function postToChat(pi: ExtensionAPI, content: string): void {
	// Routes through the session's custom-message stream so the content lands
	// inside a chat response card instead of stdout (which the TUI redraws on
	// top of, producing the interleaved-text bug from the first cut).
	pi.sendMessage({ customType: CUSTOM_TYPE, content, display: true });
}

export function registerReleaseNotesCommand(pi: ExtensionAPI): void {
	pi.registerCommand("release-notes", {
		description: "Browse OTTO release notes — what's new, fixed, and changed",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();

			// ── Direct version / latest ──────────────────────────────────
			if (trimmed && trimmed !== "list") {
				const match = findByVersionToken(trimmed);
				if (!match) {
					postToChat(
						pi,
						`**No release found for \`${trimmed}\`**\n\nKnown versions: ${RELEASE_NOTES.map((r) => `v${r.version}`).join(", ")}`,
					);
					return;
				}
				postToChat(pi, renderRelease(match));
				return;
			}

			// ── Index dump ───────────────────────────────────────────────
			if (trimmed === "list") {
				postToChat(pi, renderIndex());
				return;
			}

			// ── Interactive selector ─────────────────────────────────────
			if (!ctx.hasUI || typeof ctx.ui?.select !== "function") {
				// Headless / piped: print to stdout (no TUI to corrupt) so the
				// content is still recoverable in scripted / mcp / rpc modes.
				process.stdout.write(renderRelease(getLatestRelease()));
				process.stdout.write("\n" + renderIndex());
				return;
			}

			const options = RELEASE_NOTES.map(formatSelectorLabel);
			let pick: string | string[] | undefined;
			try {
				pick = await ctx.ui.select(
					`OTTO release notes — ${RELEASE_NOTES.length} versions available`,
					options,
				);
			} catch (err) {
				postToChat(
					pi,
					`**release-notes error:** ${(err as Error).message}\n\n${USAGE}`,
				);
				return;
			}

			if (!pick) return; // user cancelled — nothing to do
			const picked = Array.isArray(pick) ? pick[0] : pick;
			const index = options.indexOf(picked);
			const release = index >= 0 ? RELEASE_NOTES[index] : undefined;
			if (!release) {
				postToChat(pi, `**No match for** \`${picked}\``);
				return;
			}
			postToChat(pi, renderRelease(release));
		},
	});
}
