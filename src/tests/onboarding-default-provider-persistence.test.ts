import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const resolveTsPath = join(process.cwd(), "src", "resources", "extensions", "gsd", "tests", "resolve-ts.mjs")

function runOnboardingFlow(workflowHome: string, answers: string[]): void {
  execFileSync(
    process.execPath,
    [
      "--import",
      resolveTsPath,
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      `
        const answers = ${JSON.stringify(answers)};
        const { runLlmStep } = await import(${JSON.stringify(join(process.cwd(), "src", "onboarding.ts"))});
        const p = {
          select: async () => answers.shift(),
          password: async () => answers.shift(),
          text: async () => answers.shift() ?? "",
          isCancel: () => false,
          log: { success() {}, info() {}, warn() {}, step() {} },
          spinner: () => ({ start() {}, stop() {} }),
        };
        const pc = new Proxy({}, { get: () => (value) => value });
        const authStorage = {
          getOAuthProviders: () => [{ id: "openai-codex", name: "OpenAI Codex", usesCallbackServer: false }],
          hasAuth: () => false,
          async login(providerId) {
            if (providerId !== "openai-codex") throw new Error("unexpected OAuth provider " + providerId);
          },
          set(providerId, value) {
            if (!providerId || !value?.key) throw new Error("api-key auth not stored");
          },
        };
        const configured = await runLlmStep(p, pc, authStorage);
        if (!configured) throw new Error("onboarding flow did not complete");
      `,
    ],
    { env: { ...process.env, GSD_HOME: workflowHome }, stdio: "pipe" },
  )
}

test("onboarding persists defaultProvider for OAuth flow", (t) => {
  const workflowHome = mkdtempSync(join(tmpdir(), "gsd-onboarding-oauth-"))
  t.after(() => rmSync(workflowHome, { recursive: true, force: true }))

  runOnboardingFlow(workflowHome, ["browser", "openai-codex"])

  const settings = JSON.parse(readFileSync(join(workflowHome, "agent", "settings.json"), "utf-8"))
  assert.equal(settings.defaultProvider, "openai-codex")
})

test("onboarding persists defaultProvider for API-key flow", (t) => {
  const workflowHome = mkdtempSync(join(tmpdir(), "gsd-onboarding-api-key-"))
  t.after(() => rmSync(workflowHome, { recursive: true, force: true }))

  runOnboardingFlow(workflowHome, ["api-key", "openai", "sk-test"])

  const settings = JSON.parse(readFileSync(join(workflowHome, "agent", "settings.json"), "utf-8"))
  assert.equal(settings.defaultProvider, "openai")
})
