import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface DashboardInput {
	title: string;
	/** Full ECharts JS source, inlined so the page is self-contained/offline. */
	echartsJs: string;
	/** An ECharts option object describing the chart. */
	option: Record<string, unknown>;
}

/** Produce a single self-contained HTML page that renders an ECharts chart. */
export function renderDashboard(input: DashboardInput): string {
	const optionJson = JSON.stringify(input.option);
	const safeTitle = escapeHtml(input.title);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; }
  h1 { font-size: 1.25rem; }
  #chart { width: 100%; height: 70vh; }
</style>
</head>
<body>
<h1>${safeTitle}</h1>
<div id="chart"></div>
<script>${input.echartsJs}</script>
<script>
  const option = ${optionJson};
  const chart = echarts.init(document.getElementById("chart"));
  chart.setOption(option);
  window.addEventListener("resize", () => chart.resize());
</script>
</body>
</html>`;
}

let cachedEcharts: string | undefined;

export function loadEchartsJs(): string {
	if (cachedEcharts === undefined) {
		cachedEcharts = readFileSync(
			fileURLToPath(new URL("../vendor/echarts.min.js", import.meta.url)),
			"utf-8",
		);
	}
	return cachedEcharts;
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
