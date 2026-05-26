/**
 * Re-export native clipboard utilities from @otto/native.
 *
 * This module exists for backward compatibility. Prefer importing
 * directly from "@otto/native/clipboard" in new code.
 */
export {
	copyToClipboard,
	readTextFromClipboard,
	readImageFromClipboard,
} from "@otto/native/clipboard";
