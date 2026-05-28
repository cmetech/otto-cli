// Project/App: OTTO
// File Purpose: Regression tests for the interactive terminal footer renderer.

import test from "node:test";
import assert from "node:assert/strict";
import { stripVTControlCharacters } from "node:util";
import {
  FooterComponent,
  shouldUseFooterEmoji,
} from "../../packages/pi-coding-agent/src/modes/interactive/components/footer.ts";
import { initTheme, theme } from "../../packages/pi-coding-agent/src/modes/interactive/theme/theme.ts";

initTheme("dark", false);

test("FooterComponent renders a rounded operations-console footer with extension statuses", () => {
  const footer = new FooterComponent(
    {
      state: {
        model: { id: "test-model", provider: "test", contextWindow: 1000 },
      },
      sessionManager: {
        getUsageTotals: () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }),
        getSessionName: () => undefined,
      },
      getContextUsage: () => ({ percent: 12.5, contextWindow: 1000 }),
      getLastTurnCost: () => 0,
      modelRegistry: {
        isUsingOAuth: () => false,
        getProviderAuthMode: () => "apiKey",
      },
    } as any,
    {
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map([["one", "ready"], ["two", "synced"]]),
      getAvailableProviderCount: () => 1,
      getGatewayStatus: () => null,
    } as any,
  );

  const lines = footer.render(160).map((line) => stripVTControlCharacters(line));

  assert.equal(lines.length, 3);
  assert.match(lines[0], /^╭─+╮$/);
  assert.match(lines[1], /^\│/);
  assert.match(lines[1], /\(main\)/);
  assert.match(lines[1], /ready · synced\s*│$/);
  assert.match(lines[1], /● OTTO/);
  assert.match(lines[1], /● OTTO  │  .* \(main\)  │  /);
  assert.match(lines[1], /12\.5%\/1\.0k/);
  assert.match(lines[2], /^╰─+╯$/);
});

test("FooterComponent renders gateway health and fallback states compactly", () => {
  const makeFooter = (gatewayStatus: unknown, provider = "anthropic") => new FooterComponent(
    {
      state: {
        model: { id: "claude-sonnet-4", provider, api: "anthropic-messages", contextWindow: 200000 },
      },
      sessionManager: {
        getUsageTotals: () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }),
        getSessionName: () => undefined,
      },
      getContextUsage: () => ({ percent: 1, contextWindow: 200000 }),
      getLastTurnCost: () => 0,
      modelRegistry: {
        isUsingOAuth: () => false,
        getProviderAuthMode: () => "apiKey",
      },
    } as any,
    {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map(),
      getAvailableProviderCount: () => 1,
      getGatewayStatus: () => gatewayStatus,
    } as any,
  );

  assert.match(stripVTControlCharacters(makeFooter({ mode: "gateway", health: "healthy" }).render(160)[1]), /GW routed/);
  assert.match(stripVTControlCharacters(makeFooter({ mode: "gateway", health: "healthy" }, "claude-code").render(160)[1]), /GW bypass/);
  assert.match(stripVTControlCharacters(makeFooter({ mode: "gateway", health: "unhealthy" }).render(160)[1]), /GW down/);
  assert.match(stripVTControlCharacters(makeFooter({ mode: "fallback", health: "unhealthy" }).render(160)[1]), /GW fallback/);
});

test("FooterComponent separates gateway, thinking, LangFlow, and notification statuses", () => {
  const footer = new FooterComponent(
    {
      state: {
        model: { id: "claude-sonnet-4-6", provider: "claude-code", api: "claude-code", contextWindow: 200000, reasoning: true },
        thinkingLevel: "off",
      },
      sessionManager: {
        getUsageTotals: () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }),
        getSessionName: () => undefined,
      },
      getContextUsage: () => ({ percent: 1, contextWindow: 200000 }),
      getLastTurnCost: () => 0,
      modelRegistry: {
        isUsingOAuth: () => false,
        getProviderAuthMode: () => "cli",
      },
    } as any,
    {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map([
        ["otto-langflow", "LangFlow offline"],
        ["zz-notifications", "🔔 2 unread"],
      ]),
      getAvailableProviderCount: () => 1,
      getGatewayStatus: () => ({ mode: "gateway", health: "healthy" }),
    } as any,
  );

  const line = stripVTControlCharacters(footer.render(180)[1]);
  assert.match(line, /GW bypass · claude-sonnet-4-6 · 🧠 off · LF offline · 🔔 2 unread/);
  assert.doesNotMatch(line, /thinking off/);
  assert.doesNotMatch(line, /LangFlow offline/);
});

test("FooterComponent colors LangFlow status labels semantically", () => {
  const makeFooterLine = (status: string) => new FooterComponent(
    {
      state: {
        model: { id: "test-model", provider: "test", contextWindow: 1000 },
      },
      sessionManager: {
        getUsageTotals: () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }),
        getSessionName: () => undefined,
      },
      getContextUsage: () => ({ percent: 1, contextWindow: 1000 }),
      getLastTurnCost: () => 0,
      modelRegistry: {
        isUsingOAuth: () => false,
        getProviderAuthMode: () => "apiKey",
      },
    } as any,
    {
      getGitBranch: () => null,
      getExtensionStatuses: () => new Map([["otto-langflow", status]]),
      getAvailableProviderCount: () => 1,
      getGatewayStatus: () => null,
    } as any,
  ).render(160)[1];

  const okLine = makeFooterLine("LangFlow ok v1.9.4");
  assert.match(stripVTControlCharacters(okLine), /LF ok v1\.9\.4/);
  assert.ok(okLine.includes(`${theme.getFgAnsi("success")}LF ok v1.9.4`));

  const offlineLine = makeFooterLine("LangFlow offline");
  assert.match(stripVTControlCharacters(offlineLine), /LF offline/);
  assert.ok(offlineLine.includes(`${theme.getFgAnsi("warning")}LF offline`));
});

test("FooterComponent uses text fallbacks when footer emoji is disabled", () => {
  const previous = process.env.OTTO_TUI_EMOJI;
  process.env.OTTO_TUI_EMOJI = "0";
  try {
    const footer = new FooterComponent(
      {
        state: {
          model: { id: "claude-sonnet-4-6", provider: "claude-code", api: "claude-code", contextWindow: 200000, reasoning: true },
          thinkingLevel: "off",
        },
        sessionManager: {
          getUsageTotals: () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }),
          getSessionName: () => undefined,
        },
        getContextUsage: () => ({ percent: 1, contextWindow: 200000 }),
        getLastTurnCost: () => 0,
        modelRegistry: {
          isUsingOAuth: () => false,
          getProviderAuthMode: () => "cli",
        },
      } as any,
      {
        getGitBranch: () => null,
        getExtensionStatuses: () => new Map([
          ["otto-langflow", "LangFlow offline"],
          ["zz-notifications", "🔔 2 unread"],
        ]),
        getAvailableProviderCount: () => 1,
        getGatewayStatus: () => ({ mode: "gateway", health: "healthy" }),
      } as any,
    );

    const line = stripVTControlCharacters(footer.render(180)[1]);
    assert.match(line, /GW bypass · claude-sonnet-4-6 · think off · LF offline · 2 unread/);
    assert.doesNotMatch(line, /🧠|🔔/);
  } finally {
    if (previous === undefined) delete process.env.OTTO_TUI_EMOJI;
    else process.env.OTTO_TUI_EMOJI = previous;
  }
});

test("shouldUseFooterEmoji defaults conservatively on Windows and WSL", () => {
  assert.equal(shouldUseFooterEmoji("win32", {}), false);
  assert.equal(shouldUseFooterEmoji("linux", { WSL_DISTRO_NAME: "Ubuntu" }), false);
  assert.equal(shouldUseFooterEmoji("linux", { OTTO_TUI_EMOJI: "1", WSL_DISTRO_NAME: "Ubuntu" }), true);
  assert.equal(shouldUseFooterEmoji("darwin", {}), true);
});
