/**
 * /theme — list and switch the active OTTO theme at runtime.
 *
 * Usage:
 *   /theme               → interactive picker over built-ins + ~/.otto/agent/themes/*.json
 *   /theme <name>        → switch directly (e.g. /theme cool-mint)
 *   /theme list          → print a one-line list of available themes
 *
 * Switch is for the current session. To persist across launches, also set
 * `"theme": "<name>"` in ~/.otto/agent/settings.json.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@otto/pi-coding-agent";
import { getAvailableThemesWithPaths, setTheme } from "@otto/pi-coding-agent";

const CUSTOM_TYPE = "otto-theme";

function postToChat(pi: ExtensionAPI, content: string): void {
	pi.sendMessage({ customType: CUSTOM_TYPE, content, display: true });
}

function renderList(): string {
	const themes = getAvailableThemesWithPaths();
	const lines = themes.map((t) => {
		const origin = t.path ? ` _(${t.path})_` : " _(built-in)_";
		return `- \`${t.name}\`${origin}`;
	});
	return `**Available themes (${themes.length})**\n\n${lines.join("\n")}\n\nUse \`/theme <name>\` to switch. Persist with \`"theme": "<name>"\` in \`~/.otto/agent/settings.json\`.`;
}

function applyTheme(pi: ExtensionAPI, name: string): void {
	const result = setTheme(name);
	if (result.success) {
		postToChat(
			pi,
			`**Theme switched to \`${name}\`** for this session.\n\nTo persist, set \`"theme": "${name}"\` in \`~/.otto/agent/settings.json\`.`,
		);
	} else {
		const available = getAvailableThemesWithPaths().map((t) => t.name).join(", ");
		postToChat(
			pi,
			`**Theme switch failed:** ${result.error ?? "unknown error"}\n\nAvailable: ${available}`,
		);
	}
}

export function registerThemeCommand(pi: ExtensionAPI): void {
	pi.registerCommand("theme", {
		description: "List or switch the active OTTO theme",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();

			if (trimmed === "list") {
				postToChat(pi, renderList());
				return;
			}

			if (trimmed) {
				applyTheme(pi, trimmed);
				return;
			}

			// Interactive picker
			if (!ctx.hasUI || typeof ctx.ui?.select !== "function") {
				postToChat(pi, renderList());
				return;
			}

			const themes = getAvailableThemesWithPaths();
			const options = themes.map((t) => (t.path ? `${t.name}  (custom)` : `${t.name}  (built-in)`));
			let pick: string | string[] | undefined;
			try {
				pick = await ctx.ui.select(`Choose theme — ${themes.length} available`, options);
			} catch (err) {
				postToChat(pi, `**theme picker error:** ${(err as Error).message}`);
				return;
			}
			if (!pick) return;
			const picked = Array.isArray(pick) ? pick[0] : pick;
			const index = options.indexOf(picked);
			const chosen = index >= 0 ? themes[index] : undefined;
			if (!chosen) {
				postToChat(pi, `**No match for** \`${picked}\``);
				return;
			}
			applyTheme(pi, chosen.name);
		},
	});
}
