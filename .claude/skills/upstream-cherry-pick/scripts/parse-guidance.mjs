#!/usr/bin/env node
/**
 * parse-guidance.mjs — required-section schema for otto-cli port guidance.
 *
 * §2.1 of the Phase-2 design. A new-format guidance file declares
 * `strategy: <value>` on its first line and must carry the four human
 * sections below; essence-reimplement must additionally state the essence to
 * preserve. Legacy `verdict:`-only files are GRANDFATHERED (accepted as-is, no
 * section enforcement) so re-runs over historical guidance dirs do not break.
 * Missing/empty guidance is invalid — run-audit fails fast unless
 * --skip-guidance-check.
 */
import { parseStrategy } from "../../_common/scripts/fix-strategy.mjs";

/** The four required human sections (the strategy line is validated separately). */
export const REQUIRED_SECTIONS = [
  { key: "intent", label: "Upstream intent / root cause", re: /upstream intent|root cause/i },
  { key: "relevance", label: "Fork relevance", re: /fork relevance/i },
  { key: "divergence", label: "Divergence", re: /divergence/i },
  { key: "approach", label: "Concrete approach", re: /concrete approach|essence to preserve/i },
];

/**
 * Validate a guidance file's text against the Phase-2 schema.
 * @param {string|null} text
 * @param {{path?: string}} [opts]
 * @returns {{strategy: string|null, source: "strategy"|"verdict"|null, valid: boolean, errors: string[]}}
 */
export function validateGuidance(text, { path } = {}) {
  const at = path ? ` (${path})` : "";
  if (!text || !text.trim()) {
    return { strategy: null, source: null, valid: false, errors: [`guidance missing or empty${at}`] };
  }

  const { strategy, source } = parseStrategy(text);
  const errors = [];

  if (!strategy) {
    errors.push(`no machine-readable \`strategy:\` (or legacy \`verdict:\`) line${at}`);
  }

  // Grandfather: enforce required sections ONLY on the new strategy: format.
  if (source === "strategy") {
    for (const sec of REQUIRED_SECTIONS) {
      if (!sec.re.test(text)) errors.push(`missing required section "${sec.label}"${at}`);
    }
    if (strategy === "essence-reimplement" && !/essence to preserve/i.test(text)) {
      errors.push(`strategy is essence-reimplement but no "Essence to preserve" statement${at}`);
    }
  }

  return { strategy, source, valid: errors.length === 0, errors };
}
