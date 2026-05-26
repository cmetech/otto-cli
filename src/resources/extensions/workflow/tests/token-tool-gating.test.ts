// Project/App: OTTO
// File Purpose: Tests for opt-in OTTO tool surface reduction.

import assert from "node:assert/strict";
import test from "node:test";

import { DISCUSS_TOOLS_ALLOWLIST } from "../constants.ts";
import { buildMinimalAutoWorkflowToolSet, buildMinimalWorkflowToolSet, buildMinimalWorkflowWorkflowToolSet, buildRequestScopedWorkflowToolSet, MINIMAL_AUTO_BASE_TOOL_NAMES, MINIMAL_OTTO_TOOL_NAMES, restoreWorkflowWorkflowTools, scopeWorkflowWorkflowToolsForDispatch } from "../bootstrap/register-hooks.ts";

test("buildMinimalWorkflowToolSet preserves non-OTTO tools and replaces broad OTTO surface", () => {
  const result = buildMinimalWorkflowToolSet([
    "bash",
    "read",
    "browser_open",
    "otto_plan_milestone",
    "otto_task_complete",
    "otto_exec",
    "otto_exec_search",
    "otto_resume",
    "otto_milestone_status",
    "otto_checkpoint_db",
    "memory_query",
    "capture_thought",
    "otto_graph",
  ]);

  assert.ok(result.includes("bash"));
  assert.ok(result.includes("read"));
  assert.ok(result.includes("browser_open"));
  for (const toolName of MINIMAL_OTTO_TOOL_NAMES) {
    assert.ok(result.includes(toolName), `expected ${toolName}`);
  }
  assert.ok(!result.includes("otto_plan_milestone"));
  assert.ok(!result.includes("otto_task_complete"));
  assert.ok(!result.includes("otto_graph"));
});

test("buildMinimalWorkflowToolSet deduplicates preserved and minimal tools", () => {
  const result = buildMinimalWorkflowToolSet(["bash", "bash", "memory_query"]);

  assert.deepEqual(result.filter((toolName) => toolName === "bash"), ["bash"]);
  assert.deepEqual(result.filter((toolName) => toolName === "memory_query"), ["memory_query"]);
});

test("buildMinimalWorkflowToolSet does not reintroduce provider-filtered OTTO tools", () => {
  const result = buildMinimalWorkflowToolSet(["bash", "read", "memory_query"]);

  assert.deepEqual(result, ["bash", "read", "memory_query"]);
  assert.ok(!result.includes("otto_exec"));
});

test("buildMinimalAutoWorkflowToolSet keeps unit-specific completion tools without aliases", () => {
  const result = buildMinimalAutoWorkflowToolSet([
    "ask_user_questions",
    "bash",
    "read",
    "lsp",
    "browser_click",
    "otto_task_complete",
    "otto_complete_task",
    "otto_exec",
    "otto_exec_search",
    "otto_resume",
    "otto_milestone_status",
    "otto_checkpoint_db",
    "otto_slice_complete",
    "otto_complete_slice",
    "memory_query",
    "capture_thought",
  ], "execute-task");

  assert.ok(result.includes("ask_user_questions"));
  assert.ok(result.includes("bash"));
  assert.ok(result.includes("read"));
  assert.ok(result.includes("otto_task_complete"));
  assert.ok(result.includes("memory_query"));
  assert.ok(!result.includes("lsp"));
  assert.ok(!result.includes("browser_click"));
  assert.ok(!result.includes("otto_complete_task"));
  assert.ok(!result.includes("otto_slice_complete"));
  assert.ok(!result.includes("otto_complete_slice"));
});

test("buildMinimalAutoWorkflowToolSet keeps only the auto base non-OTTO tools", () => {
  const result = buildMinimalAutoWorkflowToolSet([
    "ask_user_questions",
    "bash",
    "bg_shell",
    "browser_wait_for",
    "edit",
    "glob",
    "grep",
    "lsp",
    "ls",
    "mac_find",
    "read",
    "subagent",
    "write",
    "otto_exec",
    "otto_exec_search",
    "otto_resume",
    "otto_milestone_status",
    "otto_checkpoint_db",
    "memory_query",
    "capture_thought",
  ], "execute-task");

  for (const toolName of MINIMAL_AUTO_BASE_TOOL_NAMES) {
    assert.ok(result.includes(toolName), `expected ${toolName}`);
  }
  assert.ok(!result.includes("browser_wait_for"));
  assert.ok(!result.includes("lsp"));
  assert.ok(!result.includes("mac_find"));
  assert.ok(!result.includes("subagent"));
});

test("buildMinimalAutoWorkflowToolSet preserves browser tools for run-uat", () => {
  const result = buildMinimalAutoWorkflowToolSet([
    "bash",
    "read",
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_assert",
    "browser_screenshot",
    "browser_wait_for",
    "otto_summary_save",
    "otto_task_complete",
    "memory_query",
    "capture_thought",
  ], "run-uat");

  assert.ok(result.includes("browser_navigate"));
  assert.ok(result.includes("browser_click"));
  assert.ok(result.includes("browser_type"));
  assert.ok(result.includes("browser_assert"));
  assert.ok(result.includes("browser_screenshot"));
  assert.ok(result.includes("browser_wait_for"));
  assert.ok(result.includes("otto_summary_save"));
  assert.ok(!result.includes("otto_task_complete"));
});

test("buildMinimalAutoWorkflowToolSet includes closeout tool for complete-slice", () => {
  const result = buildMinimalAutoWorkflowToolSet([
    "bash",
    "read",
    "subagent",
    "otto_exec",
    "otto_exec_search",
    "otto_resume",
    "otto_milestone_status",
    "otto_checkpoint_db",
    "otto_task_complete",
    "otto_task_reopen",
    "otto_replan_slice",
    "otto_slice_complete",
    "otto_complete_slice",
    "memory_query",
    "capture_thought",
  ], "complete-slice");

  assert.ok(result.includes("otto_slice_complete"));
  assert.ok(result.includes("otto_task_reopen"));
  assert.ok(result.includes("otto_replan_slice"));
  assert.ok(result.includes("subagent"));
  assert.ok(result.includes("capture_thought"));
  assert.ok(!result.includes("otto_task_complete"));
  assert.ok(!result.includes("otto_complete_slice"));
});

test("buildMinimalAutoWorkflowToolSet preserves workflow MCP-namespaced closeout tools", () => {
  const result = buildMinimalAutoWorkflowToolSet([
    "bash",
    "read",
    "mcp__otto-workflow__otto_task_reopen",
    "mcp__otto-workflow__otto_replan_slice",
    "mcp__otto-workflow__otto_slice_complete",
    "mcp__otto-workflow__otto_complete_slice",
    "mcp__otto-workflow__otto_exec",
    "mcp__otto-workflow__memory_query",
    "mcp__otto-workflow__capture_thought",
  ], "complete-slice");

  assert.ok(result.includes("mcp__otto-workflow__otto_task_reopen"));
  assert.ok(result.includes("mcp__otto-workflow__otto_replan_slice"));
  assert.ok(result.includes("mcp__otto-workflow__otto_slice_complete"));
  assert.ok(!result.includes("mcp__otto-workflow__otto_complete_slice"));
  assert.ok(result.includes("mcp__otto-workflow__otto_exec"));
  assert.ok(result.includes("mcp__otto-workflow__memory_query"));
  assert.ok(result.includes("mcp__otto-workflow__capture_thought"));
});

test("buildMinimalAutoWorkflowToolSet covers execute-task-simple", () => {
  const result = buildMinimalAutoWorkflowToolSet([
    "bash",
    "read",
    "otto_task_complete",
    "otto_decision_save",
    "otto_plan_task",
    "memory_query",
    "capture_thought",
  ], "execute-task-simple");

  assert.ok(result.includes("otto_task_complete"));
  assert.ok(result.includes("otto_decision_save"));
  assert.ok(!result.includes("otto_plan_task"));
});

test("buildMinimalWorkflowWorkflowToolSet keeps workflow OTTO tools but drops broad non-OTTO tools", () => {
  const result = buildMinimalWorkflowWorkflowToolSet([
    "ask_user_questions",
    "bash",
    "bg_shell",
    "browser_wait_for",
    "edit",
    "lsp",
    "mac_find",
    "read",
    "subagent",
    "write",
    "otto_plan_milestone",
    "otto_complete_milestone",
    "otto_task_complete",
    "otto_summary_save",
    "memory_query",
    "capture_thought",
    "otto_exec",
    "otto_exec_search",
    "otto_resume",
    "otto_milestone_status",
    "otto_checkpoint_db",
    "otto_graph",
  ]);

  assert.ok(result.includes("ask_user_questions"));
  assert.ok(result.includes("bash"));
  assert.ok(result.includes("bg_shell"));
  assert.ok(result.includes("read"));
  assert.ok(result.includes("write"));
  assert.ok(result.includes("otto_plan_milestone"));
  assert.ok(result.includes("otto_complete_milestone"));
  assert.ok(result.includes("otto_task_complete"));
  assert.ok(result.includes("otto_summary_save"));
  assert.ok(!result.includes("browser_wait_for"));
  assert.ok(!result.includes("lsp"));
  assert.ok(!result.includes("mac_find"));
  assert.ok(!result.includes("subagent"));
  assert.ok(!result.includes("otto_graph"));
});

test("buildRequestScopedWorkflowToolSet scopes queued workflow custom-message requests", () => {
  const result = buildRequestScopedWorkflowToolSet([
    "ask_user_questions",
    "bash",
    "browser_wait_for",
    "lsp",
    "read",
    "write",
    "otto_plan_milestone",
    "otto_complete_milestone",
    "otto_task_complete",
    "otto_graph",
    "memory_query",
    "capture_thought",
  ], [{ customType: "gsd-run" }, { customType: "gsd-memory" }]);

  assert.ok(result);
  assert.ok(result.includes("ask_user_questions"));
  assert.ok(result.includes("bash"));
  assert.ok(result.includes("read"));
  assert.ok(result.includes("write"));
  assert.ok(result.includes("otto_plan_milestone"));
  assert.ok(result.includes("otto_complete_milestone"));
  assert.ok(!result.includes("browser_wait_for"));
  assert.ok(!result.includes("lsp"));
  assert.ok(!result.includes("otto_graph"));
});

test("buildRequestScopedWorkflowToolSet ignores stale workflow messages outside the current request tail", () => {
  assert.equal(buildRequestScopedWorkflowToolSet(["bash", "otto_plan_milestone"], []), undefined);
});

test("discuss-milestone dispatch keeps required headless milestone tools after two-stage scoping", () => {
  let activeTools = [
    "ask_user_questions",
    "bash",
    "read",
    "write",
    "otto_summary_save",
    "otto_decision_save",
    "otto_requirement_save",
    "otto_requirement_update",
    "otto_plan_milestone",
    "otto_milestone_generate_id",
    "otto_complete_milestone",
    "otto_task_complete",
  ];

  activeTools = activeTools.filter((toolName) =>
    !toolName.startsWith("otto_") ||
    DISCUSS_TOOLS_ALLOWLIST.includes(toolName)
  );

  scopeWorkflowWorkflowToolsForDispatch({
    getActiveTools: () => activeTools,
    setActiveTools: (tools) => {
      activeTools = tools;
    },
  }, "discuss-milestone");

  assert.ok(activeTools.includes("ask_user_questions"));
  assert.ok(activeTools.includes("otto_summary_save"));
  assert.ok(activeTools.includes("otto_requirement_save"));
  assert.ok(activeTools.includes("otto_requirement_update"));
  assert.ok(activeTools.includes("otto_plan_milestone"));
  assert.ok(activeTools.includes("otto_milestone_generate_id"));
  assert.ok(!activeTools.includes("otto_task_complete"));
  assert.ok(!activeTools.includes("otto_complete_milestone"));
});

test("scopeWorkflowWorkflowToolsForDispatch applies and restores per-unit skill visibility", () => {
  const calls: Array<{ kind: "tools" | "skills"; value: string[] | undefined }> = [];
  let activeTools = [
    "bash",
    "read",
    "lsp",
    "otto_plan_milestone",
    "otto_decision_save",
    "memory_query",
    "capture_thought",
  ];
  let visibleSkills: string[] | undefined = ["previous-skill"];

  const state = scopeWorkflowWorkflowToolsForDispatch({
    getActiveTools: () => activeTools,
    setActiveTools: (names) => {
      activeTools = names;
      calls.push({ kind: "tools", value: names });
    },
    getVisibleSkills: () => visibleSkills,
    setVisibleSkills: (names) => {
      visibleSkills = names;
      calls.push({ kind: "skills", value: names });
    },
  }, "plan-milestone");

  assert.ok(state);
  assert.deepEqual(visibleSkills, [
    "write-milestone-brief",
    "decompose-into-slices",
    "design-an-interface",
    "grill-me",
    "write-docs",
    "api-design",
    "tdd",
    "verify-before-complete",
  ]);
  assert.ok(!activeTools.includes("lsp"));

  restoreWorkflowWorkflowTools({
    setActiveTools: (names) => {
      activeTools = names;
      calls.push({ kind: "tools", value: names });
    },
    setVisibleSkills: (names) => {
      visibleSkills = names;
      calls.push({ kind: "skills", value: names });
    },
  }, state);

  assert.deepEqual(activeTools, [
    "bash",
    "read",
    "lsp",
    "otto_plan_milestone",
    "otto_decision_save",
    "memory_query",
    "capture_thought",
  ]);
  assert.deepEqual(visibleSkills, ["previous-skill"]);
  assert.equal(calls.filter((call) => call.kind === "skills").length, 2);
});
