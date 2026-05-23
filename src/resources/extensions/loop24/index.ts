/**
 * LOOP24 Extension
 *
 * Owns:
 *   - Brand banner and theme files (already in branding/ and theme/)
 *   - Gateway connection probe — surfaces 'gateway: routed → <host>' or 'gateway: direct'
 *     on the line after the loader banner.
 *
 * Future additions (Phase 3): declarative LangFlow flow-trigger commands.
 */

import type { ExtensionAPI } from "@gsd/pi-coding-agent";

export default function Loop24(pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    const yellow = '\x1b[38;2;250;210;45m';
    const green  = '\x1b[38;2;63;206;142m';
    const dim    = '\x1b[2m';
    const reset  = '\x1b[0m';

    const gwUrl = process.env.LOOP24_GATEWAY_URL?.trim();
    if (gwUrl) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 1500);
        const r = await fetch(`${gwUrl.replace(/\/$/, "")}/health`, { signal: ctl.signal });
        clearTimeout(timer);
        const ok = r.ok;
        const host = new URL(gwUrl).host;
        process.stderr.write(`  ${yellow}gateway:${reset} ${ok ? green : dim}routed → ${host}${reset}\n`);
      } catch {
        const host = new URL(gwUrl).host;
        process.stderr.write(`  ${yellow}gateway:${reset} ${dim}routed → ${host} (unreachable)${reset}\n`);
      }
    } else {
      process.stderr.write(`  ${yellow}gateway:${reset} ${dim}direct (no LOOP24_GATEWAY_URL set)${reset}\n`);
    }
  });
}
