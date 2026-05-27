// Project/App: OTTO
// File Purpose: Regression coverage for the public npm package identity.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const projectRoot = process.cwd();

function readPackageJson(path: string): {
	name?: string;
	version?: string;
	optionalDependencies?: Record<string, string>;
	bin?: Record<string, string> | string;
	scripts?: Record<string, string>;
} {
	return JSON.parse(readFileSync(join(projectRoot, path), "utf8"));
}

function workspacePackageJsonPaths(): string[] {
	const paths: string[] = ["package.json", "extensions/google-search/package.json"];
	for (const dir of readdirSync(join(projectRoot, "packages"), { withFileTypes: true })) {
		if (dir.isDirectory()) paths.push(`packages/${dir.name}/package.json`);
	}
	for (const dir of readdirSync(join(projectRoot, "native", "npm"), { withFileTypes: true })) {
		if (dir.isDirectory()) paths.push(`native/npm/${dir.name}/package.json`);
	}
	return paths;
}

test("published npm package names use the @cmetech scope", () => {
	const rootPackage = readPackageJson("package.json");
	assert.equal(rootPackage.name, "@cmetech/otto");

	const platforms = [
		"darwin-arm64",
		"darwin-x64",
		"linux-arm64-gnu",
		"linux-x64-gnu",
		"win32-x64-msvc",
	];

	for (const platform of platforms) {
		const nativePackage = readPackageJson(`native/npm/${platform}/package.json`);
		const expectedName = `@cmetech/otto-engine-${platform}`;
		assert.equal(nativePackage.name, expectedName);
		assert.equal(
			rootPackage.optionalDependencies?.[expectedName],
			rootPackage.version,
			`root package must install the ${expectedName} native optional dependency`,
		);
	}
});

test("publish-facing package metadata does not expose legacy names", () => {
	const legacyVendor = "loop" + "24";
	for (const path of workspacePackageJsonPaths()) {
		const pkg = readPackageJson(path);
		assert.doesNotMatch(pkg.name ?? "", new RegExp(`@gsd|${legacyVendor}|gsd-pi`, "i"), `${path} package name is rebranded`);

		if (pkg.bin && typeof pkg.bin === "object") {
			for (const name of Object.keys(pkg.bin)) {
				assert.doesNotMatch(name, /^gsd-|^gsd$/i, `${path} bin name is rebranded`);
			}
		}
	}
});

test("published installer uses OTTO home directory by default", () => {
	const installScript = readFileSync(join(projectRoot, "scripts", "install.js"), "utf8");
	assert.match(installScript, /join\(homedir\(\), ['"]\.otto['"]\)/);
	assert.doesNotMatch(installScript, /join\(homedir\(\), ['"]\.gsd['"]\)/);
});

test("prepublish gate verifies branding, extension typecheck, native packages, and tarball install", () => {
	const rootPackage = readPackageJson("package.json");
	const prepublish = rootPackage.scripts?.prepublishOnly ?? "";

	assert.match(prepublish, /npm run branding:check/);
	assert.match(prepublish, /npm run typecheck:extensions/);
	assert.match(prepublish, /npm run verify:native-platform-packages/);
	assert.match(prepublish, /npm run validate-pack/);
});

test("tarball install validator targets the OTTO package and command names", () => {
	const validator = readFileSync(join(projectRoot, "scripts", "validate-pack.js"), "utf8");
	assert.match(validator, /'@cmetech', 'otto'/);
	assert.match(validator, /otto -v/);
	assert.doesNotMatch(validator, /@ericsson|gsd -v|Running gsd/);
});
