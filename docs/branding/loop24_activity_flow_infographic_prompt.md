"Loop24 Activity Flow — OTTER on Your Laptop, OSCAR on the Network"
Subtitle: "OTTER speaks chat API to the Gateway, REST to Langflow. Gateway translates to ACP — kiro-cli inference, OSCAR ops data."

Audience: Enterprise executives, platform leadership, end-users. Reads in under 15 seconds. Non-technical-executive friendly.

Style: Premium executive dark-mode infographic, clean and spacious, high contrast, minimal text. Visually consistent with the Loop24 architecture infographic.
Palette: background #1E1E2E, text #FAFAFA, secondary gray #A0A0A0, panel gray #3A3A4A.
Blue #1174E6 = Loop24 Gateway (ACP manager + inference router).
Yellow #FAD22D = end-user personas + chat API arrows.
Otter Brown #8E5A33 = OTTER (laptop entrypoint).
Copper Amber #D88438 = OSCAR (remote ops agent, ACP interface).
Violet #8B5CF6 = Langflow (local automation orchestrator).
Green #0FC373 = kiro-cli ACP workers + ACP / approved paths.
Muted Gray #6B6B7C = external systems.

Main message: "OTTER speaks chat API + REST. Gateway translates to ACP — for kiro-cli (inference) and OSCAR (ops data). All local except OSCAR."

LAYOUT: Left-to-right, three zones — PERSONAS → USER'S LAPTOP (dominant boundary box) → REMOTE (OSCAR + EXTERNAL SYSTEMS). Thin reverse arrow along the bottom for the streamed answer. Numbered markers ① ② ③ ④ ⑤ overlay the primary flow.

LEFT — PERSONAS (yellow), three stacked tiles with silhouette icons:
"Developer" — "Refactor this module and run the tests."
"Administrator" — "Why did node-07 page last night?"
"Project Manager" — "Summarize this week's open tickets."
Caption: "Three roles. One entrypoint." Marker ① on the outbound arrow.

CENTER — USER'S LAPTOP (large dashed-border container labeled "User's laptop"). Four components in a 2×2 sub-grid inside the boundary:

Top-left: OTTER (otter brown) — OTTER mascot on a stylized laptop, holding a terminal-prompt tile (">_"). Label: "OTTER — Orchestrating Tools, Tasks, Execution & Research." Below: four task chips — "Code" · "Research" · "Ops" · "Automate."

Top-right: Loop24 Gateway (blue, slightly elevated) — tile labeled "Loop24 Gateway — ACP manager + inference router." Sub-label: "Anthropic-, OpenAI-, and Ollama-compatible. Guardrails on every call." Small orange hexagon guardrail glyph in the corner.

Bottom-left: Langflow (violet) — tile labeled "Langflow — Automation Orchestrator." Sub-label: "REST API from OTTER. Stitches data into flows."

Bottom-right: kiro-cli pool (green) — tile labeled "kiro-cli ACP workers." Sub-label: "Pooled subprocesses. JSON-RPC over stdio."

Arrows inside the laptop boundary:
• OTTER → Gateway (yellow, "Chat API: Anthropic / OpenAI / Ollama"). Marker ②.
• OTTER → Langflow (violet, "REST API: automation flows").
• Gateway ↔ kiro-cli pool (green, "Local ACP, stdio"). Marker ③.
• Langflow → Gateway (thin yellow, "Chat API for inference inside flows").

RIGHT — REMOTE (outside the laptop boundary):

Top: OSCAR (copper amber) — tile labeled "OSCAR — Operational Data Agent." Sub-label: "Remote. ACP interface. Holds network credentials." A green ACP arrow crosses the laptop boundary from the Gateway into OSCAR, labeled "ACP over network." Marker ④. This boundary-crossing arrow is the focal trans-network connection.

Bottom: EXTERNAL SYSTEMS (muted gray), 2×2 grid — "Production servers" · "Lab environments" · "Ticket systems" · "Knowledge bases." A green arrow from OSCAR fans out to all four; a thin return arrow carries data back. Caption: "Only OSCAR reaches external systems. OTTER never touches credentials." Marker ⑤.

BOTTOM STRIP — response path: thin RIGHT-to-LEFT green arrow spanning the full width, terminating at OTTER inside the laptop boundary. Label: "Streamed answer — OTTER renders the result on the laptop."

LEGEND (full-width bottom strip):
Yellow = Personas · Otter Brown = OTTER · Blue = Gateway · Violet = Langflow · Green = kiro-cli + ACP paths · Copper Amber = OSCAR (remote) · Gray = External · Solid arrow = request · Thin arrow = response.

TOP-RIGHT CALLOUTS (muted gray):
• Three on-laptop components: OTTER, Gateway, Langflow (plus kiro-cli pool).
• OTTER speaks chat API (Anthropic/OpenAI/Ollama) to the Gateway and REST to Langflow. Only the Gateway speaks ACP.
• Gateway translates chat API → ACP: kiro-cli (local) for inference, OSCAR (remote) for data. All Gateway calls go through Loop24 guardrails.

AESTHETICS: plenty of negative space; consistent tile sizes and corner radius; the dashed laptop boundary is the dominant container, framing most of the diagram. Thin (~2px) rounded arrows with chevron terminations; sans-serif type (Inter or IBM Plex Sans); numbered markers are small panel-gray circles with white numerals on arrows. The Gateway→OSCAR ACP arrow crossing the laptop boundary is the focal connection. OTTER/OSCAR warm (browns/coppers), Gateway/kiro-cli cool — agents work, the Gateway thinks.
