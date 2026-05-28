import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { Agent } from "@otto/pi-agent-core";
import { AgentSession } from "./agent-session.js";
import { AuthStorage } from "./auth-storage.js";
import { ModelRegistry } from "./model-registry.js";
import { DefaultResourceLoader } from "./resource-loader.js";
import { SessionManager } from "./session-manager.js";
import { SettingsManager } from "./settings-manager.js";

let testDir: string;

async function createSession(): Promise<AgentSession> {
	const agentDir = join(testDir, "agent-home");
	const authStorage = AuthStorage.inMemory({});
	const modelRegistry = new ModelRegistry(authStorage, join(agentDir, "models.json"));
	const settingsManager = SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd: testDir,
		agentDir,
		settingsManager,
		noExtensions: true,
		noPromptTemplates: true,
		noThemes: true,
	});
	await resourceLoader.reload();

	return new AgentSession({
		agent: new Agent(),
		sessionManager: SessionManager.inMemory(testDir),
		settingsManager,
		cwd: testDir,
		resourceLoader,
		modelRegistry,
	});
}

describe("AgentSession streaming queue defaults", () => {
	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "agent-session-streaming-"));
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("queues prompts as follow-up by default while the agent is streaming", async () => {
		const session = await createSession();
		(session as any).agent.state.isStreaming = true;

		const followUps: string[] = [];
		const steers: string[] = [];
		(session as any)._queueFollowUp = async (text: string) => {
			followUps.push(text);
		};
		(session as any)._queueSteer = async (text: string) => {
			steers.push(text);
		};

		await session.prompt('skill:btw "what is 2+2"');

		assert.deepEqual(followUps, ['skill:btw "what is 2+2"']);
		assert.deepEqual(steers, []);
	});

	it("still honors explicit steer while the agent is streaming", async () => {
		const session = await createSession();
		(session as any).agent.state.isStreaming = true;

		const followUps: string[] = [];
		const steers: string[] = [];
		(session as any)._queueFollowUp = async (text: string) => {
			followUps.push(text);
		};
		(session as any)._queueSteer = async (text: string) => {
			steers.push(text);
		};

		await session.prompt("change direction", { streamingBehavior: "steer" });

		assert.deepEqual(followUps, []);
		assert.deepEqual(steers, ["change direction"]);
	});
});
