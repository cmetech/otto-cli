"OTTO Client Architecture — Runtime Core + Extension Surface"
Subtitle: "A laptop-native agent. Session orchestration, built-in tools, ~20 extensions, and a unified LLM API — one client, four layers, one outbound surface."

Audience: Enterprise executives, platform leadership, engineering leadership. Reads in under 15 seconds. Non-technical-executive friendly.

Style: Premium executive dark-mode infographic, clean and spacious, high contrast, minimal text. Visually consistent with the OTTO architecture and activity flow infographics.
Palette: background #1E1E2E, text #FAFAFA, secondary gray #A0A0A0, panel gray #3A3A4A.
OTTO Brown #8E5A33 = OTTO shell + core runtime layers.
Yellow #FAD22D = OTTO extension surface (focal).
Blue #1174E6 = OTTO Gateway exit tile.
Green #0FC373 = Approved paths + responses.
Orange #FF8C0A = Guardrails glyph (gateway only).
Muted Gray #6B6B7C = LLM provider chips.

Main message: "OTTO = core runtime (session, tools, LLM API) + extension surface (~20 extensions). One client, two layers, one outbound surface."

LAYOUT: Vertical, four horizontal bands stacked inside a large rounded outer container labeled "OTTO — Orchestrated Task & Tooling Operator." A small OTTO mascot vignette holding a ">_" terminal tile sits in the top-left of the container. A yellow arrow on the LEFT edge traces the user prompt down through the bands; a thin green arrow on the RIGHT edge traces the streamed response back up. Marker chips ① ② ③ ④ sit on the band labels.

BAND ① — PRESENTATION (OTTO brown):
Label: "Presentation — Terminal UI."
Three tiles: "Prompt + Markdown" · "25 built-in slash commands" (compact mini-grid of command pills) · "Hotkeys + Themes."

BAND ② — AGENT CORE (OTTO brown):
Label: "Agent Core — runtime."
Four tiles: "Session Tree" · "Tool Dispatch" · "Compaction" · "Message Stream" (thoughts · tool_calls · plans).

BAND ③ — EXECUTION (the widest, focal band, three sub-columns):
Label: "Execution — three parallel surfaces."

LEFT sub-column "Built-in Tools" (OTTO brown):
Header: "Core tools."
Chips: read · write · edit · bash · grep · find · ls. Sub-group: "hashline-edit · hashline-read" (advanced edit variants).
Subtitle: "Stable. Sandboxed."

CENTER sub-column "OTTO Extension Surface" (YELLOW, focal — slightly elevated and taller):
Header: "Extensions · ~20."
Four labeled clusters (yellow-bordered sub-panels):
• Agent control: async-jobs · bg-shell · subagent · workflow · slash-commands · remote-questions
• External tools: browser-tools · web-search · mcp-client · ttsr · voice · visual-brief
• Platform integrations: aws-auth · claude-code · cmux · context7 · github-sync · mac-tools · ollama · universal-config
• Brand: otto
Sticker callout: "Where OTTO customization lives."

RIGHT sub-column "LLM API" (OTTO brown):
Header: "Unified LLM API."
Muted-gray provider pills: Anthropic · OpenAI · Bedrock · Vertex · Mistral · Google GenAI · Ollama.
Subtitle: "20+ providers. Mid-session switching."

Band caption: "The agent core in ② chooses which surface a step invokes."

BAND ④ — OUTBOUND (OTTO brown shell, blue exit tile):
Single centered blue tile: "OTTO Gateway — single outbound surface" with a small orange hexagonal guardrails glyph in the upper-right corner. Two thin green arrows leave the tile crossing the OTTO boundary: "ACP → kiro-cli (local inference)" and "ACP → OSCAR (remote ops data)."
Caption: "OTTO has one foot out the door. Governance happens at the gateway."

LEGEND (full-width bottom strip):
OTTO Brown = OTTO + core runtime · Yellow = OTTO extensions · Blue = OTTO Gateway · Green = Approved paths · Orange = Guardrails · Gray = LLM providers · Solid arrow = request · Thin arrow = response.

TOP-RIGHT CALLOUTS (muted gray):
• OTTO ships a unified runtime (Terminal UI, Agent Core, LLM API) under one client.
• ~20 OTTO extensions add customization, governance, and integrations — without touching the agent core.
• OTTO Gateway is the only outbound surface; guardrails govern every call.

AESTHETICS: plenty of negative space; consistent tile sizes and corner radius; band ③ is widest, with the yellow extension column slightly elevated and taller as the focal point; thin (~2px) rounded arrows with chevron terminations; sans-serif type (Inter or IBM Plex Sans). The OTTO container is a soft brown rounded rectangle with a 1px inner glow — the diagram visually sits "inside OTTO." The blue gateway tile is the only blue element, serving as a visual handoff to the OTTO Architecture infographic.
