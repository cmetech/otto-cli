# OTTO Data Flow — Cinematic Hero Video Prompt (15s)

A 15-second cinematic hero clip that compresses the OTTO data-flow story — three personas converging on one laptop, OTTO acting on their behalf, a governed request fanning out to local inference and remote ops data, then a streamed answer returning home — into a single continuous unbroken shot.

---

## Tool guidance

**For Seedance AI and HappyHorse AI:** paste the prompt block below into the text input. If the model supports image conditioning, attach:
- `docs/branding/otto_mascot_face_reference.png` as the **character reference** (locks in the otto face).
- `docs/branding/otto_activity_flow_infographic_v3.png` as a **palette and composition reference** only. ⚠️ That PNG still uses the OTTO + OTTO branding; the prompt below explicitly overrides to OTTO. Do not let the model carry over text labels from that PNG.

If the tool supports image-to-video conditioning, the activity-flow PNG also works as a strong start frame. The prompt's camera move and beam choreography are written to flow naturally from that frame.

**Target:** 15 seconds, 16:9 cinematic, dark-mode aesthetic, premium executive register.

---

## The prompt

```
A 15-second cinematic hero video for OTTO — a laptop-native AI agent. One continuous unbroken take. Premium executive dark-mode aesthetic. Polished tech vignette. Tells the OTTO data-flow story in a single fluid camera move: three personas converge on one laptop, OTTO acts on their behalf, a governed request fans out to local intelligence and remote ops data, streamed answer returns.

[ STYLE & PALETTE ]
- Visual register: Apple product film calm meets Pixar establishing-shot intimacy. Confident, premium, deliberate. Not consumer-ad flashy, not sci-fi neon.
- Background: deep navy-charcoal #1E1E2E. Almost-black but warm, never pure black.
- Subtle very fine film grain. Soft volumetric lighting. Mild atmospheric haze around glowing elements (natural bloom).
- Exact palette — use these hex values:
  • #1E1E2E — background
  • #8E5A33 — OTTO Brown (otto mascot fur)
  • #FAD22D — Yellow (outbound request beam, persona accent rim)
  • #1174E6 — Blue (OTTO Gateway node)
  • #FF8C0A — Orange (guardrails pulse)
  • #0FC373 — Green (approved request + response beams, kiro-cli node)
  • #D88438 — Copper Amber (remote OSCAR node)
  • #FAFAFA — White (end card wordmark)
  • #A0A0A0 — Muted gray (end card tagline)

[ CAMERA LANGUAGE ]
- One continuous unbroken take. No cuts. No jump cuts. No scene changes.
- Lens: cinematic ~35mm equivalent. Shallow depth of field early, resolving to deeper focus as the camera widens.
- Movement: slow, continuous dolly back with subtle parallax. Starts close on personas, glides past them to the laptop, pulls back further to reveal the Gateway and remote nodes, holds final framing on the end card.
- Easing: gentle ease-in on camera starts, ease-out on holds. No abrupt accelerations. Gimbal-smooth, no handheld shake.
- Focus: rack focus as new elements enter frame — personas blur as we move past, laptop sharpens, then Gateway sharpens, then deep focus on the full system, then settles on the end card composition.

[ LIGHTING & ATMOSPHERE ]
- Key light: warm soft from upper-left, simulating an off-screen practical (lamp or window).
- Rim light: subtle cool teal from behind, separating subjects from the dark background.
- Practicals: the laptop screen glows warm and is responsible for illuminating the otto face. The Gateway, kiro-cli, and OSCAR nodes each emit their own colored light (blue, green, copper amber).
- Atmosphere: very subtle dust motes catching the warm light, slow drift. Mild bloom around glowing nodes for realism.
- Shadows: soft, gradient falloff. No hard shadows, no clipped blacks. Lifted blacks throughout.

[ BEAM / PARTICLE PHYSICS ]
- Beams are particle streams, not solid lines. Many small glowing particles flowing along a curved path with a soft connecting halo.
- Trail behavior: each particle leaves a short fading trail (~0.3s decay), creating a continuous-looking flow without being a hard line.
- Path: beams arc gracefully like Bezier curves. Slight gravity dip in the middle of long arcs. Never straight lines.
- Flow speed: steady, not rushing. About 30% slower than a typical sci-fi laser. The feeling is "intelligent transit," not "data attack."
- Glow: soft outer halo at ~30% opacity, falloff over a ~20px-equivalent radius.
- Color transitions: when a beam changes color (yellow → green at the Gateway), the transition is a ~0.4s crossfade along the particle stream — particle by particle, not an instant flip.
- Termination: when a beam arrives at a node, particles dissolve into a soft pulse at the contact point. No sparks. No explosions.

[ CHARACTER / MASCOT ANIMATION ]
- The OTTO mascot face on the laptop screen matches the attached reference image: semi-realistic 3D otto, warm chestnut-brown fur, large dark expressive eyes, gentle smile, soft cream muzzle, subtle whiskers, rounded triangular ears.
- Idle micro-animation: slow natural blink every ~3 seconds. Subtle chest-rise breathing motion (only suggested since only the face shows). Very subtle ear flick on the orange guardrail pulse moment.
- Eye saccades: very small lateral eye flick when first appearing on screen (a moment of "noticing"), then settled and present.
- Reaction beats: subtle nod when the return beam arrives at the laptop (acknowledges the answer). Slightly softer smile on the final hold before the end card.
- Register: intelligent and content. Not excited. Not exaggerated. The mascot reads as a competent, calm presence — not a hyperactive product mascot.

[ SHOT 1 — PERSONAS (0.0–3.0s) ]
0.0–1.0s: Camera opens close on three rim-lit human silhouettes in a row, slightly out of focus, illuminated only from behind by a warm key light. The silhouettes are stylized but recognizably human, with distinguishing accents: one with the soft glow of a developer's keyboard reflecting up onto their face (Developer); one with a subtle admin-style headset silhouette (Administrator); one holding a small tablet (Project Manager). A thin yellow accent rim edges each silhouette where they catch the off-screen key light.

1.0–2.0s: Camera glides smoothly left-to-right past the personas. Parallax reveals depth between them — they are arranged at slightly varied distances from camera. Personas remain background-blurred as focus begins to shift forward. A faint visual cue forms: three subtle yellow light points above each persona's head, beginning to converge toward a single point in the distance.

2.0–3.0s: Camera continues right and starts pulling back. The three converging light points merge into one as a single dark laptop emerges into focus, center-frame, on a clean desk surface. The personas blur out into soft bokeh on the left. Visual metaphor: "three roles, one entrypoint" — communicated entirely through composition and light, no text.

[ SHOT 2 — OTTO ON LAPTOP (3.0–5.0s) ]
3.0–3.7s: Camera settles into a medium-close framing on the laptop. The dark laptop sits on a clean wooden or matte-dark desk surface. Screen begins warming to glow.

3.7–4.4s: The OTTO otto face fades onto the screen from soft black. Large dark eyes open with a subtle eyelid animation, ears settle into resting position. Warm screen light spills outward, illuminating the desk surface in a soft warm pool.

4.4–5.0s: A small ">_" terminal prompt cursor materializes beside the otto face, blinking once gently. The otto does a very subtle small lateral eye saccade — a moment of "ready and noticing" — and settles into present, intelligent stillness.

[ SHOT 3 — REQUEST BEAM (5.0–7.5s) ]
5.0–5.5s: A small spark of yellow particles materializes just in front of the laptop screen, near the cursor.

5.5–6.5s: The yellow particle beam emerges from the laptop, arcing gracefully to the upper right of the frame. Camera begins a slow continuous pull-back, widening the frame to accommodate the beam's destination.

6.5–7.5s: As the beam travels, a glowing blue hexagonal node fades into existence in mid-frame right — the OTTO Gateway. The node has soft inner light, rotates very slowly on a subtle axis, and emits a gentle blue glow into the surrounding space. The yellow beam approaches the node, about to make contact.

[ SHOT 4 — GUARDRAILS (7.5–9.5s) ]
7.5–7.9s: The yellow beam contacts the Gateway node. A soft circular impact pulse radiates outward from the contact point, fading quickly.

7.9–8.3s: A small orange hexagonal glyph in the upper-right corner of the Gateway node pulses brightly once — the guardrails moment. Brief ambient brightening propagates across the scene from this orange flash. The otto on the laptop screen flicks one ear, just barely perceptible, registering the moment.

8.3–9.5s: The beam color transmutes from yellow to green along its length. The transition is a smooth crossfade traveling particle-by-particle through the stream, not an instant flip. The green beam continues onward, fully approved, exiting the Gateway to the right.

[ SHOT 5 — FAN-OUT (9.5–12.0s) ]
9.5–10.2s: The green beam exits the Gateway and immediately splits into two distinct paths. One path is short, curving back into the warm light around the laptop (local). The other path begins a long arc across the deep navy space toward the right edge of the frame.

10.2–11.0s: The short local beam terminates on a small green hexagonal node ("kiro-cli") near the laptop's right side. The node lights up with a soft green glow. Camera continues pulling back smoothly, framing both the laptop and the Gateway in view.

11.0–12.0s: The long-distance beam continues its arc. A copper-amber node ("OSCAR") fades into existence in the far right of the frame — physically distant from the laptop, visually establishing remoteness through depth, scale, and atmospheric haze. The green beam reaches OSCAR and the node lights up with a warm copper glow on contact.

[ SHOT 6 — RETURN (12.0–14.0s) ]
12.0–12.8s: Reverse particle flow begins. Thin green particle streams start returning along both paths simultaneously — one from kiro-cli, one from OSCAR — heading back toward the Gateway.

12.8–13.4s: The two return streams converge at the Gateway and continue back along the original beam path toward the laptop screen.

13.4–14.0s: The streams arrive at the laptop screen and dissolve into a soft pulse at the contact point. The otto face on the screen reacts: a small subtle nod, the smile softens by a hair — an acknowledgement that the answer has arrived. No exaggerated expression.

[ SHOT 7 — END CARD (14.0–15.0s) ]
14.0–14.4s: Camera holds. Background elements (Gateway, kiro-cli, OSCAR) gently fade to lower opacity and drift back into ambient bokeh, leaving the laptop and otto face at full presence center-frame.

14.4–14.8s: A clean white wordmark "OTTO" fades in, centered, positioned in the upper third of the frame above the laptop. Typeface: clean sans-serif (Inter, IBM Plex Sans, or similar), regular weight, generous letter-spacing (~10%), color #FAFAFA. No drop shadow, no glow.

14.8–15.0s: A small tagline fades in beneath the wordmark: "Your laptop. Your agent." Slightly smaller, lighter weight, color #A0A0A0. Hold on this composition through the end of the clip. No fade to black required — the final frame is the held composition with wordmark and tagline.

[ COLOR GRADING ]
- Lifted blacks throughout — background sits at #1E1E2E, never crushed to pure black.
- Warm-cool split: shadows lean cool/teal, highlights lean warm/amber.
- Midtones cool-leaning in the background, so warm elements (otto, OSCAR, laptop screen) visually sing.
- Highlights kept controlled — no blown-out whites except the end-card wordmark.
- Saturation: confident but not pushed. Premium product film, not consumer ad.
- Gentle bloom on all glowing elements (Gateway node, OSCAR node, beams, laptop screen, kiro-cli node).
- No vignette darkening at the frame edges — natural falloff only.

[ AUDIO DIRECTION (if supported) ]
- 0.0–3.0s: low ambient pad rising slowly from silence. Soft.
- 3.0–4.5s: subtle warm synth chime as the OTTO face appears on the laptop screen. Single soft note, no melody.
- 5.0–6.5s: very gentle particle-flow sweetener as the yellow beam emerges and travels. Almost subliminal.
- 7.9–8.3s: a brief warm low-pass-filtered "approval" tone on the orange guardrails pulse. Single soft note, not a sound effect — feels like a chord resolving.
- 9.5–12.0s: gentle harmonic layer added as the beam splits and reaches its destinations. Pad gains a small additional voice.
- 12.0–14.0s: pad resolves to a warm major chord as the return streams arrive. A sense of completion.
- 14.0–15.0s: pad holds steady through the end card. No drop, no flourish. No voiceover.
- Overall: ambient, warm, intelligent. Not cinematic-trailer dramatic. Closer to a Brian Eno generative piece than a movie score.

[ DO NOT INCLUDE ]
- No on-screen UI elements, no floating text labels on nodes, no tooltips, no overlaid diagrams or annotations.
- No glitch effects, no scan lines, no holographic stutter, no Matrix-style code rain.
- No laser-bright or neon-saturated beams — keep beams soft, particulate, and intelligent.
- No additional characters besides the OTTO mascot face on the laptop screen. No human faces — personas are silhouettes only.
- No other logos, no real-world brand names, no third-party product references. Only the OTTO wordmark on the end card.
- No hard cuts, no scene transitions, no fade-to-black mid-clip. One continuous take.
- No cluttered desk — keep the desk surface clean and intentional. No coffee cups, no notebooks, no peripherals beyond the laptop itself.
- No cinematic-trailer stock music swell, no whoosh sound effects, no impact stings.
- No motion-blur extremes — camera is smooth but the world stays legible at every frame.
- No persona faces visible — silhouettes and accent lighting only.
- No text labels on the Gateway, kiro-cli, or OSCAR nodes (the story is told through color and position, not labels).

[ STYLE ANCHORS / MOOD REFERENCES ]
- Pacing of an Apple product film opening: calm, confident, unhurried.
- Character intimacy of a Pixar establishing close-up.
- Composition cleanliness of a Loom or Linear marketing video.
- Lighting register of a high-end product photo, brought into motion.
- Tempo of a museum exhibit film — deliberate, intelligent, premium.
```

---

## Variant suggestions

**8-second tight cut** — drop SHOT 1 (personas) and SHOT 6 (return). Open directly on the laptop with OTTO's face, beam to Gateway, guardrails pulse, fan-out to kiro-cli and OSCAR, end card. Good for short-form social where the personas beat is too slow.

**Single-beat ambient loop (4s)** — just SHOT 3 + SHOT 4: yellow beam emerges from the laptop, hits the Gateway, orange guardrail pulses, beam transmutes to green and exits frame. Seamless loop. No end card, no text. Use as a deck background or web hero loop.

**30-second extended version** — insert a 6-second beat between SHOT 5 and SHOT 6 showing the OSCAR node connecting outward to a cluster of muted-gray distant nodes (External Systems: production servers, lab environments, ticket systems, knowledge bases). Reinforces the "OSCAR has the credentials, OTTO never touches them" privacy story. Add the wordmark earlier in the end card hold for breathing room.

---

## What this video pitches

- **Local-first.** OTTO lives on your laptop. The video opens and ends there.
- **Three roles, one entrypoint.** The personas converge into one light point that becomes the laptop — a visual metaphor, no text.
- **Governance is the focal moment.** The yellow→green transmutation at the Gateway, triggered by the orange guardrail pulse, is the brightest moment of the video. This is where the pitch lives: governance happens before anything reaches the work.
- **Clean separation of intelligence and ops data.** Green beam splits — short local arc to kiro-cli (inference), long remote arc to OSCAR (operations data). The visual distance between them is the pitch: OSCAR holds credentials, OTTO doesn't.
- **Streamed answers, securely.** The return flow visualizes responsiveness without showing any data — the answer comes back the same way it left, governed by the same surface.
- **One continuous flow, no awkward stops.** One unbroken camera move mirrors the actual product experience: from prompt to answer with no friction visible to the user.
