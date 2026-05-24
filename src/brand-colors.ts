/**
 * LOOP24 Brand Colors — single source of truth.
 *
 * Loader-fast: no runtime parsing, no fs reads, no async — just exported
 * constants. Safe to import from `src/loader.ts` and other early-boot files.
 *
 * If you change a color here, every visual surface that imports from this
 * module updates on rebuild. Two surfaces remain out of band and must be
 * kept in sync manually:
 *   1. `src/resources/extensions/loop24/theme/loop24.json` — the canonical
 *      JSON palette consumed by the TUI's theme system (cross-package
 *      boundary prevents direct import; see Known Deferred Cleanups item 4).
 *   2. `packages/pi-coding-agent/src/modes/interactive/theme/themes.ts:loop24`
 *      — the inlined TypeScript theme const (same boundary problem).
 *   3. `scripts/install.sh` — bash, can't import TypeScript; hex values
 *      annotated inline with comments to make drift obvious in diffs.
 *
 * To regenerate the ANSI escapes for a new hex: `\x1b[38;2;<R>;<G>;<B>m`
 * where R/G/B are decimal 0-255 from the hex bytes.
 */

// ── Brand palette (hex) ─────────────────────────────────────────────────────

export const BRAND_BLACK_HEX = "#0C0C0C";   // background
export const BRAND_WHITE_HEX = "#FAFAFA";   // foreground / text
export const BRAND_YELLOW_HEX = "#FAD22D";  // primary / accent / LOOP24 mark
export const BRAND_BLUE_HEX = "#4D97ED";    // secondary / links / in-progress
export const BRAND_PURPLE_HEX = "#AF78D2";  // tertiary / .planning/ artifacts
export const BRAND_GREEN_HEX = "#3FCE8E";   // success
export const BRAND_ORANGE_HEX = "#FF8C0A";  // warning
export const BRAND_RED_HEX = "#FF5B5B";     // error
export const BRAND_GRAY2_HEX = "#767676";   // muted
export const BRAND_GRAY3_HEX = "#A0A0A0";   // dim

// ── ANSI escapes (24-bit foreground) ────────────────────────────────────────
// Pre-computed for callers that emit raw escapes (loader, onboarding, etc.).

export const ANSI_RESET = "\x1b[0m";
export const ANSI_DIM = "\x1b[2m";

export const ANSI_BRAND_BLACK = "\x1b[38;2;12;12;12m";
export const ANSI_BRAND_WHITE = "\x1b[38;2;250;250;250m";
export const ANSI_BRAND_YELLOW = "\x1b[38;2;250;210;45m";
export const ANSI_BRAND_BLUE = "\x1b[38;2;77;151;237m";
export const ANSI_BRAND_PURPLE = "\x1b[38;2;175;120;210m";
export const ANSI_BRAND_GREEN = "\x1b[38;2;63;206;142m";
export const ANSI_BRAND_ORANGE = "\x1b[38;2;255;140;10m";
export const ANSI_BRAND_RED = "\x1b[38;2;255;91;91m";
export const ANSI_BRAND_GRAY2 = "\x1b[38;2;118;118;118m";
export const ANSI_BRAND_GRAY3 = "\x1b[38;2;160;160;160m";

/**
 * Wrap text in a brand color and reset. Equivalent to `chalk.hex(color)(text)`
 * but with no chalk dependency — usable from the synchronous loader-fast path.
 */
export function brandWrap(ansiOpen: string, text: string): string {
  return `${ansiOpen}${text}${ANSI_RESET}`;
}
