import assert from "node:assert/strict";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

import type { ResolvedPaths } from "../../../core/package-manager.js";
import { ConfigSelectorComponent } from "./config-selector.js";

function makeResolvedPaths(baseDir: string, resourcePath: string): ResolvedPaths {
	return {
		extensions: [],
		skills: [
			{
				path: resourcePath,
				enabled: true,
				metadata: {
					source: "auto",
					scope: "project",
					origin: "top-level",
					baseDir,
				},
			},
		],
		prompts: [],
		themes: [],
	};
}

describe("ResourceList.getResourcePattern", () => {
	it("honors item.metadata.baseDir when present", () => {
		const cwd = "/work/project";
		const agentDir = "/home/user/.pi/agent";
		// The resource lives under an explicit baseDir distinct from the
		// top-level base dir (cwd/.pi). The pattern must be relative to baseDir.
		const baseDir = "/work/project/nested/base";
		const resourcePath = join(baseDir, "skills", "my-skill", "SKILL.md");

		const component = new ConfigSelectorComponent(
			makeResolvedPaths(baseDir, resourcePath),
			{} as any,
			cwd,
			agentDir,
			() => {},
			() => {},
			() => {},
		);

		const resourceList = component.getResourceList() as any;
		const item = resourceList.groups[0].subgroups[0].items[0];

		const pattern: string = resourceList.getResourcePattern(item);

		// Expected: relative to the explicit baseDir, NOT to cwd/.pi top-level dir.
		assert.equal(pattern, relative(baseDir, resourcePath));
		// Sanity: the buggy behaviour (relative to top-level base dir) would
		// produce a path that climbs out of cwd/.pi with leading "../".
		assert.ok(!pattern.startsWith(".."), `pattern should not climb out of baseDir, got: ${pattern}`);
	});
});
