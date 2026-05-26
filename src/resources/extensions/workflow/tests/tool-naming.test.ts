// Project/App: OTTO
// File Purpose: Verifies canonical and alias DB tool registration plus legacy alias telemetry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerDbTools } from '../bootstrap/db-tools.ts';
import { getLegacyTelemetry, resetLegacyTelemetry } from '../legacy-telemetry.ts';


// ─── Mock PI ──────────────────────────────────────────────────────────────────

function makeMockPi() {
  const tools: any[] = [];
  return {
    registerTool: (tool: any) => tools.push(tool),
    tools,
  } as any;
}

// ─── Rename map ───────────────────────────────────────────────────────────────

const RENAME_MAP: Array<{ canonical: string; alias: string }> = [
  { canonical: "otto_decision_save", alias: "otto_save_decision" },
  { canonical: "otto_requirement_update", alias: "otto_update_requirement" },
  { canonical: "otto_requirement_save", alias: "otto_save_requirement" },
  { canonical: "otto_summary_save", alias: "otto_save_summary" },
  { canonical: "otto_milestone_generate_id", alias: "otto_generate_milestone_id" },
  { canonical: "otto_task_complete", alias: "otto_complete_task" },
  { canonical: "otto_slice_complete", alias: "otto_complete_slice" },
  { canonical: "otto_plan_milestone", alias: "otto_milestone_plan" },
  { canonical: "otto_plan_slice", alias: "otto_slice_plan" },
  { canonical: "otto_plan_task", alias: "otto_task_plan" },
  { canonical: "otto_replan_slice", alias: "otto_slice_replan" },
  { canonical: "otto_reassess_roadmap", alias: "otto_roadmap_reassess" },
  { canonical: "otto_complete_milestone", alias: "otto_milestone_complete" },
  { canonical: "otto_validate_milestone", alias: "otto_milestone_validate" },
  { canonical: "otto_task_reopen", alias: "otto_reopen_task" },
  { canonical: "otto_slice_reopen", alias: "otto_reopen_slice" },
  { canonical: "otto_milestone_reopen", alias: "otto_reopen_milestone" },
];

// ─── Registration count ──────────────────────────────────────────────────────

console.log('\n── Tool naming: registration count ──');

const pi = makeMockPi();
registerDbTools(pi);

assert.deepStrictEqual(
  pi.tools.length,
  RENAME_MAP.length * 2 + 2,
  'Should register canonical/alias tool pairs plus 1 gate tool and 1 otto_skip_slice',
);

// ─── Both names exist for each pair ──────────────────────────────────────────

console.log('\n── Tool naming: canonical and alias names exist ──');

for (const { canonical, alias } of RENAME_MAP) {
  const canonicalTool = pi.tools.find((t: any) => t.name === canonical);
  const aliasTool = pi.tools.find((t: any) => t.name === alias);

  assert.ok(canonicalTool !== undefined, `Canonical tool "${canonical}" should be registered`);
  assert.ok(aliasTool !== undefined, `Alias tool "${alias}" should be registered`);
}

// ─── Execute function wrapping ───────────────────────────────────────────────

console.log('\n── Tool naming: alias execute wrapper ──');

for (const { canonical, alias } of RENAME_MAP) {
  const canonicalTool = pi.tools.find((t: any) => t.name === canonical);
  const aliasTool = pi.tools.find((t: any) => t.name === alias);

  if (canonicalTool && aliasTool) {
    assert.ok(
      canonicalTool.execute !== aliasTool.execute,
      `"${alias}" should wrap "${canonical}" so alias usage can be counted`,
    );
  }
}

test("alias execute increments legacy MCP alias telemetry before delegating", async () => {
  const canonicalTool = pi.tools.find((t: any) => t.name === "otto_decision_save");
  const aliasTool = pi.tools.find((t: any) => t.name === "otto_save_decision");
  assert.ok(canonicalTool);
  assert.ok(aliasTool);

  const originalCanonicalExecute = canonicalTool.execute;
  try {
    resetLegacyTelemetry();
    let delegated = false;
    canonicalTool.execute = async () => {
      delegated = true;
      return { content: [{ type: "text", text: "ok" }], details: { ok: true } };
    };

    await aliasTool.execute("call-1", {}, undefined, undefined, undefined);

    assert.equal(delegated, true);
    assert.equal(getLegacyTelemetry()["legacy.mcpAliasUsed"], 1);
  } finally {
    canonicalTool.execute = originalCanonicalExecute;
    resetLegacyTelemetry();
  }
});

// ─── Alias descriptions include "(alias for ...)" ───────────────────────────

console.log('\n── Tool naming: alias descriptions ──');

for (const { canonical, alias } of RENAME_MAP) {
  const aliasTool = pi.tools.find((t: any) => t.name === alias);

  if (aliasTool) {
    assert.ok(
      aliasTool.description.includes(`alias for ${canonical}`),
      `Alias "${alias}" description should include "alias for ${canonical}"`,
    );
  }
}

// ─── Canonical tools have proper promptGuidelines ────────────────────────────

console.log('\n── Tool naming: canonical promptGuidelines use canonical name ──');

for (const { canonical } of RENAME_MAP) {
  const canonicalTool = pi.tools.find((t: any) => t.name === canonical);

  if (canonicalTool) {
    const guidelinesText = canonicalTool.promptGuidelines.join(' ');
    assert.ok(
      guidelinesText.includes(canonical),
      `Canonical tool "${canonical}" promptGuidelines should reference its own name`,
    );
  }
}

// ─── Alias promptGuidelines direct to canonical ──────────────────────────────

console.log('\n── Tool naming: alias promptGuidelines redirect to canonical ──');

for (const { canonical, alias } of RENAME_MAP) {
  const aliasTool = pi.tools.find((t: any) => t.name === alias);

  if (aliasTool) {
    const guidelinesText = aliasTool.promptGuidelines.join(' ');
    assert.ok(
      guidelinesText.includes(`Alias for ${canonical}`),
      `Alias "${alias}" promptGuidelines should say "Alias for ${canonical}"`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
