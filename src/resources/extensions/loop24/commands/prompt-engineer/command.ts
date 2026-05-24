/**
 * /loop24 prompt-engineer <description>
 *
 * One-shot LLM call. Takes a rough developer task description, returns a
 * polished prompt suitable for handing to a coding agent. Prints the
 * polished prompt to stdout (the deliverable) and saves a copy to
 * ~/.loop24/prompts/<YYYY-MM-DD>-<slug>.md (user-scoped history).
 *
 * Compliance: honors LOOP24_GATEWAY_URL when set so all LLM traffic exits
 * through the LOOP24 gateway. Without a gateway, requires ANTHROPIC_API_KEY.
 *
 * Model: defaults to claude-haiku-4-5-20251001 (fast, cheap, ideal for a
 * polish task). Override with LOOP24_PROMPT_ENGINEER_MODEL.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@loop24/pi-coding-agent";
import type { ClientOptions } from "@anthropic-ai/sdk";
import type { TextBlock } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { PROMPT_ENGINEER_SYSTEM } from "./_template.js";
import { savePromptHistory } from "./_storage.js";

const USAGE = `Usage: /loop24 prompt-engineer <rough task description>

Examples:
  /loop24 prompt-engineer add caching to the search endpoint
  /loop24 prompt-engineer refactor auth module to remove session tokens

Output: polished prompt printed to stdout; copy saved to ~/.loop24/prompts/.`;

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 4096;

interface PromptEngineerResult {
  polished: string;
  modelId: string;
}

async function runPromptEngineer(description: string): Promise<PromptEngineerResult> {
  const mod = await import("@anthropic-ai/sdk");
  const Anthropic = mod.default;

  const baseURL = process.env.LOOP24_GATEWAY_URL?.trim() || undefined;
  const gatewayToken = process.env.LOOP24_GATEWAY_TOKEN?.trim() || undefined;
  const directApiKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;

  let clientOpts: ClientOptions;
  if (baseURL) {
    clientOpts = gatewayToken
      ? { baseURL, authToken: gatewayToken, apiKey: "unused" }
      : { baseURL, apiKey: "unused" };
  } else {
    if (!directApiKey) {
      throw new Error(
        "No LLM credentials configured. Set LOOP24_GATEWAY_URL (gateway mode) " +
          "or ANTHROPIC_API_KEY (direct mode). See `loop24 config` for setup.",
      );
    }
    clientOpts = { apiKey: directApiKey };
  }

  const client = new Anthropic(clientOpts);
  const modelId = process.env.LOOP24_PROMPT_ENGINEER_MODEL?.trim() || DEFAULT_MODEL;

  const response = await client.messages.create({
    model: modelId,
    max_tokens: MAX_TOKENS,
    system: PROMPT_ENGINEER_SYSTEM,
    messages: [{ role: "user", content: description }],
  });

  const polished = response.content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (!polished) {
    throw new Error("LLM returned an empty response. Try rephrasing your request.");
  }

  return { polished, modelId };
}

export function registerPromptEngineerCommand(pi: ExtensionAPI): void {
  pi.registerCommand("prompt-engineer", {
    description: "Polish a rough task description into a structured prompt for a coding agent",
    handler: async (args: string, _ctx: ExtensionCommandContext) => {
      const description = args.trim();
      if (!description) {
        process.stderr.write(USAGE + "\n");
        return;
      }

      let result: PromptEngineerResult;
      try {
        result = await runPromptEngineer(description);
      } catch (err) {
        process.stderr.write(`[loop24 prompt-engineer] ${(err as Error).message}\n`);
        return;
      }

      process.stdout.write(result.polished + "\n");

      try {
        const savedPath = await savePromptHistory({
          description,
          polished: result.polished,
          modelId: result.modelId,
        });
        process.stderr.write(`[loop24 prompt-engineer] saved → ${savedPath}\n`);
      } catch (err) {
        process.stderr.write(
          `[loop24 prompt-engineer] save failed: ${(err as Error).message}\n`,
        );
      }
    },
  });
}
