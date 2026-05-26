import test from "node:test";
import assert from "node:assert/strict";
import { renderDashboard } from "./renderer.ts";

test("renderDashboard inlines the chart lib, data, and an init call", () => {
	const html = renderDashboard({
		title: "Revenue by Region",
		echartsJs: "/* ECHARTS_STUB */",
		option: { xAxis: { data: ["North", "South"] }, series: [{ type: "bar", data: [2500, 2000] }] },
	});
	assert.match(html, /<!doctype html>/i);
	assert.match(html, /Revenue by Region/);
	assert.match(html, /\/\* ECHARTS_STUB \*\//);
	assert.match(html, /echarts\.init/);
	assert.match(html, /"North"/);
	assert.doesNotMatch(html, /https?:\/\//);
});
