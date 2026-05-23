/**
 * Shared LOOP24 block-letter ASCII logo.
 *
 * Single source of truth — imported by:
 *   - scripts/postinstall.js (via dist/logo.js)
 *   - src/onboarding.ts (via ./logo.js)
 *
 * (Export name remains GSD_LOGO for backward compatibility with importers
 * that we don't want to thread a rename through.)
 */

/** Raw logo lines — no ANSI codes, no leading newline. */
export const GSD_LOGO: readonly string[] = [
  '██╗      ██████╗  ██████╗ ██████╗ ██████╗ ██╗  ██╗',
  '██║     ██╔═══██╗██╔═══██╗██╔══██╗╚════██╗██║  ██║',
  '██║     ██║   ██║██║   ██║██████╔╝ █████╔╝███████║',
  '██║     ██║   ██║██║   ██║██╔═══╝ ██╔═══╝ ╚════██║',
  '███████╗╚██████╔╝╚██████╔╝██║     ███████╗     ██║',
  '╚══════╝ ╚═════╝  ╚═════╝ ╚═╝     ╚══════╝     ╚═╝',
]

/**
 * Render the logo block with a color function applied to each line.
 *
 * @param color — e.g. `(s) => `\x1b[38;2;250;210;45m${s}\x1b[0m`` (brand yellow)
 * @returns Ready-to-write string with leading/trailing newlines.
 */
export function renderLogo(color: (s: string) => string): string {
  return '\n' + GSD_LOGO.map(color).join('\n') + '\n'
}
