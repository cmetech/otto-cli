// OTTO + Visual Brief bundled extension marker

import type { ExtensionAPI } from "@otto/pi-coding-agent";

export default function visualBrief(_pi: ExtensionAPI) {
	// Visual Brief is invoked through /otto brief. This module keeps the bundled
	// extension discoverable without adding a second top-level slash command.
}
