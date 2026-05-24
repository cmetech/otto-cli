// LOOP24 + Visual Brief bundled extension marker

import type { ExtensionAPI } from "@loop24/pi-coding-agent";

export default function visualBrief(_pi: ExtensionAPI) {
	// Visual Brief is invoked through /loop24 brief. This module keeps the bundled
	// extension discoverable without adding a second top-level slash command.
}
