import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { DefaultPackageManager } from "./package-manager.js";
import { SettingsManager } from "./settings-manager.js";

function makeDirs(prefix: string, t: { after: (fn: () => void) => void }) {
	const root = mkdtempSync(join(tmpdir(), `otto-package-manager-${prefix}-`));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	return { root, cwd, agentDir };
}

function writeFile(path: string, content = ""): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, content, "utf-8");
}

describe("DefaultPackageManager OTTO package contract", () => {
	it("loads package resources declared with the otto manifest key", async (t) => {
		const { cwd, agentDir, root } = makeDirs("otto-manifest", t);
		const pkgDir = join(root, "package");
		writeFile(join(pkgDir, "package.json"), JSON.stringify({
			name: "otto-package",
			otto: {
				extensions: ["pkg-extension"],
				skills: ["pkg-skill"],
				prompts: ["pkg-prompt"],
				themes: ["pkg-theme"],
			},
		}));
		writeFile(join(pkgDir, "pkg-extension", "index.js"), "export default function () {}");
		writeFile(join(pkgDir, "pkg-skill", "demo", "SKILL.md"), "# Demo");
		writeFile(join(pkgDir, "pkg-prompt", "review.md"), "Review this");
		writeFile(join(pkgDir, "pkg-theme", "dark.json"), "{}");

		const settings = SettingsManager.create(cwd, agentDir);
		settings.setPackages([pkgDir]);
		const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });

		const resolved = await manager.resolve();

		assert.ok(resolved.extensions.some((r) => r.path === join(pkgDir, "pkg-extension", "index.js")));
		assert.ok(resolved.skills.some((r) => r.path === join(pkgDir, "pkg-skill", "demo", "SKILL.md")));
		assert.ok(resolved.prompts.some((r) => r.path === join(pkgDir, "pkg-prompt", "review.md")));
		assert.ok(resolved.themes.some((r) => r.path === join(pkgDir, "pkg-theme", "dark.json")));
	});

	it("resolves user npm packages from the OTTO-managed npm directory", (t) => {
		const { cwd, agentDir } = makeDirs("managed-npm", t);
		const packagePath = join(agentDir, "npm", "node_modules", "@acme", "otto-demo");
		mkdirSync(packagePath, { recursive: true });
		const settings = SettingsManager.create(cwd, agentDir);
		const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });

		assert.equal(manager.getInstalledPath("npm:@acme/otto-demo", "user"), packagePath);
	});

	it("resolves every checked-in sample package resource type", async (t) => {
		const { cwd, agentDir } = makeDirs("examples", t);
		const examplesRoot = join(process.cwd(), "examples", "packages");
		const packages = [
			"extension-only",
			"skill-only",
			"prompt-only",
			"theme-only",
			"mixed",
		].map((name) => join(examplesRoot, name));
		for (const pkg of packages) {
			assert.ok(existsSync(join(pkg, "package.json")), `missing sample package: ${pkg}`);
		}

		const settings = SettingsManager.create(cwd, agentDir);
		settings.setPackages(packages);
		const manager = new DefaultPackageManager({ cwd, agentDir, settingsManager: settings });

		const resolved = await manager.resolve();

		assert.ok(resolved.extensions.some((r) => r.path.endsWith("extension-only/extensions/sample-extension/index.js")));
		assert.ok(resolved.skills.some((r) => r.path.endsWith("skill-only/skills/sample-skill/SKILL.md")));
		assert.ok(resolved.prompts.some((r) => r.path.endsWith("prompt-only/prompts/sample-review.md")));
		assert.ok(resolved.themes.some((r) => r.path.endsWith("theme-only/themes/sample-theme.json")));
		assert.ok(resolved.extensions.some((r) => r.path.endsWith("mixed/extensions/mixed-sample/index.js")));
		assert.ok(resolved.skills.some((r) => r.path.endsWith("mixed/skills/mixed-skill/SKILL.md")));
		assert.ok(resolved.prompts.some((r) => r.path.endsWith("mixed/prompts/mixed-summary.md")));
		assert.ok(resolved.themes.some((r) => r.path.endsWith("mixed/themes/mixed-theme.json")));
	});
});
