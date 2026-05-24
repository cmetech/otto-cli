"OTTO Gateway Architecture — One Canonical Engine, Many API Standards"
Subtitle: "Inbound chat APIs decode to one canonical request, pass guardrails, and route to a warm pool of ACP workers. One process, one port, one governance surface."

Audience: Enterprise executives and platform/engineering leadership. Reads in under 15 seconds.

Style: Premium executive dark-mode infographic, clean, high contrast, minimal text. Visually consistent with the OTTO client architecture infographic.
Palette: background #1E1E2E, text #FAFAFA, secondary gray #A0A0A0, panel gray #3A3A4A.
Blue #1174E6 = OTTO Gateway components (dominant accent).
Yellow #FAD22D = inbound client requests + API surfaces.
Orange #FF8C0A = guardrails / policy chain (focal).
Green #0FC373 = ACP workers + approved paths.
Red #FF3232 = rejected requests (blocked at guardrails).
LIVE vs ROADMAP: LIVE = full-color, solid border, small green dot. ROADMAP = ~50% opacity, dashed border, "roadmap" tag.

Main message: "Two live API standards today, more by design. Every request becomes one canonical shape, governed once, routed to pooled ACP workers."

LAYOUT: Vertical, four horizontal bands inside a large rounded blue-tinted container labeled "OTTO Gateway — single binary, single port." A yellow arrow on the LEFT edge traces an inbound request down through the bands; a thin green arrow on the RIGHT edge traces the response back up; a thin red arrow curves out from band ② for rejected requests. Marker chips ① ② ③ ④ on the band labels.

BAND ① — INBOUND API SURFACES (yellow inbound, blue adapter tiles):
Label: "API surfaces — thin adapters."
Three adapter tiles side by side: "Ollama adapter — /api/chat, /api/generate, /api/tags" (LIVE) · "Anthropic adapter — /v1/messages" (LIVE) · "OpenAI adapter — /v1/chat/completions" (ROADMAP, dashed). Inbound yellow arrows land on each adapter. Caption: "Each adapter decodes to ONE canonical request — existing client code keeps working."

BAND ② — GUARDRAILS / POLICY CHAIN (orange, focal, slightly taller):
Label: "Guardrails — applied once, to every surface."
Horizontal row of hexagonal hook tiles: "Access log + Request ID" (LIVE) · "Bearer / API-key auth" (LIVE) · "IP allowlist" (LIVE) · "Body size limit 4 MiB" (LIVE) · "Content moderation" (ROADMAP) · "Schema validation" (ROADMAP) · "Audit hooks — Pre/Post seam" (ROADMAP).
Two outcomes leave this band: PASS (green arrow) continues down, label "Approved." REJECT (thin red arrow) curves up-left with a "blocked" badge, label "Policy violation — 4xx. Workers never invoked."

BAND ③ — CANONICAL ENGINE (blue, the hero band):
Label: "Canonical engine — one request lifecycle."
Five sub-tiles in a row: "Canonical ChatRequest — text · image · tool · thinking" · "Working-dir resolver" · "Block builder — canonical → ACP" · "Session lifecycle — new · set_model · prompt" · "Stream collector." A dashed sub-tile at the edge: "Pre/Post hooks" (ROADMAP).
Caption: "All surfaces share one engine — policy, sessions, and streaming behave identically."

BAND ④ — SESSION POOL + ACP WORKERS (blue pool, green worker exit tiles):
Label: "Session pool + ACP workers — the outbound surface."
Left: blue tile "Warm session pool" — sub-label "Stateless requests pull a warm slot; stateful sessions (X-Session-Id) hold a dedicated slot until TTL." Right: a 2×2 grid of green "kiro-cli acp" worker tiles, each with a subprocess icon and idle/busy dot. Channel label above the grid: "JSON-RPC 2.0 over stdio · heartbeat." A dimmed tile sits apart: "Local embeddings" (ROADMAP). These workers sit at the container's boundary — the exit point.

BOTTOM STRIP — response path: thin RIGHT-to-LEFT green arrow. Label: "Streamed responses — SSE for Anthropic, NDJSON for Ollama. Same canonical chunks, surface-specific encoding."

LEGEND (full-width bottom strip):
Blue = OTTO Gateway · Yellow = Inbound API surfaces · Orange = Guardrails · Green = ACP workers + approved paths · Red = Rejected · Solid+green dot = live · Dashed+tag = roadmap.

TOP-RIGHT CALLOUTS (muted gray):
• Single static Go binary, no cgo, cross-compiled for Linux + Windows. Loopback-by-default (127.0.0.1:11434).
• Two live API standards (Ollama + Anthropic) in one process; OpenAI by design.
• Guardrails are the single place to add governance — covering every API surface at once.

AESTHETICS: plenty of negative space; consistent tile sizes and corner radius; the orange guardrails band (②) is slightly taller as the focal point; the canonical engine band (③) is the blue-accented anchor; thin (~2px) rounded arrows with chevron terminations; reject path subordinate to the approved path; sans-serif type (Inter or IBM Plex Sans). ROADMAP tiles read clearly dimmer than LIVE. The diagram sits inside a soft blue-tinted rounded container — the visual sibling of the OTTO client architecture infographic, where this gateway appeared as a single blue exit tile.
