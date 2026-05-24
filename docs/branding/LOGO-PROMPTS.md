# loop24 — Logo Prompts (Text-to-Image)

Prompts tuned for Midjourney / DALL·E / Imagen / Stable Diffusion / Ideogram. Each candidate has:

- **Concept** — the visual idea and *why* it fits the name
- **Color palette** — hex suggestions
- **Style** — typography + form language
- **Primary prompt** — paste-ready, long-form
- **Short prompt variant** — for tools with tight prompt budgets (Midjourney, Ideogram)
- **Negative prompt** — for SD/SDXL/Flux pipelines that support it
- **Aspect ratio + parameters** — what to ask the tool for

> **Tip:** Generate the mark *without text* first, then composite the wordmark in Figma. Text-to-image tools are unreliable with typography. The prompts below explicitly request *symbol only* unless noted.

> **Primary direction:** **OTTER** (see `NAMES.md`). Three concept variants below. The five acronym candidates that follow (OTTO, SAGE, IRIS, ECHO, ADA) are kept as the fallback bench.

---

# Primary: OTTER

**Shared palette across all three concepts:**
- Otter brown `#6B4226` (primary fur)
- Warm umber `#8E5A33` (highlight fur)
- Cream `#F5EBD8` (background)
- Slate teal `#3E5C6B` (water / accent)
- Rust orange `#C8632D` (tool / spark accent — used sparingly)

**Shared style:** Geometric minimal vector mascot, single-weight stroke or clean filled shapes, no rendered texture. Think modern fintech mascot or Apple-quality icon — friendly and clever, never cartoony or 90s clip-art. The otter should read as a *competent tool-using worker*, not a children's book character.

---

## OTTER — Concept A: Tool-Carrier

**Concept:** Side-profile otter, head and shoulders only, holding a small geometric "rock" in its paws — but the rock is rendered as a terminal-prompt glyph (`>_`) or a stylized hexagon. Says *tool-using worker* in one glance. Strongest single-product-pitch mark of the three.

### Primary prompt
```
A minimalist vector logo mark, symbol only, no text. A side-profile sea
otter shown from chest up, drawn in clean geometric flat shapes with no
texture or rendered fur. The otter is warm otter brown (#6B4226) with a
lighter umber muzzle and chest (#8E5A33), a single circular black eye, a
small triangular nose, and rounded ears. The otter holds in both front
paws a small dark slate teal (#3E5C6B) rectangular tile with a glowing
rust-orange (#C8632D) terminal-prompt glyph reading ">_" centered on it,
as if the otter is presenting a code terminal. Cream background
(#F5EBD8). The mark suggests a clever tool-using worker, a coding
assistant. Modern geometric mascot mark in the style of high-end fintech
or developer-tool brands, flat design, crisp vector edges, balanced
negative space, no gradients, no shadows, no painterly rendering.
```

### Short prompt
```
Minimalist vector logo, geometric side-profile sea otter from chest up,
warm brown with umber muzzle, holding a slate-teal tile with a glowing
rust-orange ">_" terminal prompt glyph in its paws, cream background,
flat modern mascot style, symbol only no text --ar 1:1 --style raw --v 6
```

### Negative prompt (SD/Flux)
```
text outside the terminal glyph, additional letters, words, watermark,
photorealistic otter, rendered fur, whiskers in detail, full body, tail,
3D render, painterly, watercolor, cartoonish, 90s clip art, drop shadow,
gradient on the otter body, multiple otters
```

### Output target
- Aspect: 1:1 square
- 2048×2048 minimum
- SVG-friendly

---

## OTTER — Concept B: Raft Loop (sibling to OSCAR)

**Concept:** Two otters floating on their backs, paws joined at the center, their bodies and tails curving outward to form a horizontal *figure-eight / infinity loop* silhouette. Direct visual tie to *loop24*. If OSCAR has a single-mascot mark, this gives OTTER a "we work together" mark that reads as the natural sibling.

### Primary prompt
```
A minimalist vector logo mark, symbol only, no text. Two sea otters
floating on their backs, viewed from directly above, their bodies and
tails curving outward and meeting at their joined front paws in the
center to form a perfect horizontal figure-eight infinity loop
silhouette. Both otters are warm otter brown (#6B4226) with lighter
umber bellies (#8E5A33) facing the viewer. Small slate teal (#3E5C6B)
curved lines beneath the otters suggest water ripples. Cream background
(#F5EBD8). The mark suggests connection, a loop, otters rafting
together, "the loop holds." Modern geometric mascot mark, flat design,
crisp vector edges, perfectly symmetrical composition, no gradients, no
shadows, no rendered texture. Negative space within the figure-eight
should be clean and balanced.
```

### Short prompt
```
Minimalist vector logo, two sea otters floating on backs seen from above,
front paws joined in the center, bodies curving outward to form a
horizontal infinity / figure-eight silhouette, warm brown with umber
bellies, slate teal water ripples, cream background, flat geometric
symmetrical mascot style, symbol only no text --ar 1:1 --style raw --v 6
```

### Negative prompt (SD/Flux)
```
text, letters, words, watermark, photorealistic otters, rendered fur,
detailed faces, 3D render, painterly, watercolor, cartoonish,
asymmetrical composition, more than two otters, side profile, drop
shadow, complex water rendering, splashes
```

### Output target
- Aspect: 1:1 square
- 2048×2048 minimum
- SVG-friendly

---

## OTTER — Concept C: Anchored Locally (kelp loop)

**Concept:** A single otter wrapped in one continuous strand of kelp that loops back on itself around the otter — anchored in place. Maps to "runs locally on your laptop, stays in the loop, doesn't drift." Most subtle of the three; best for an app icon that still reads at 32×32.

### Primary prompt
```
A minimalist vector logo mark, symbol only, no text. A single sea otter
shown floating on its back, head and chest only, framed inside a
continuous oval loop made of a single stylized kelp strand that wraps
around the otter once and ties back to itself at the bottom. The otter
is warm otter brown (#6B4226) with a lighter umber chest (#8E5A33), a
small circular black eye, and rounded paws crossed over its chest. The
kelp loop is slate teal (#3E5C6B), drawn as a single smooth stroke with
two or three small leaf-like fronds branching off. Cream background
(#F5EBD8). The mark suggests being anchored locally, staying in the
loop, a worker that doesn't drift. Modern geometric mascot mark, flat
design, crisp vector edges, no gradients, no shadows, generous negative
space inside the kelp loop.
```

### Short prompt
```
Minimalist vector logo, single sea otter floating on back with paws
crossed, framed inside a continuous oval kelp-strand loop that ties
back to itself, warm brown otter, slate teal kelp with small fronds,
cream background, flat geometric mascot style, symbol only no text
--ar 1:1 --style raw --v 6
```

### Negative prompt (SD/Flux)
```
text, letters, words, watermark, photorealistic otter, rendered fur,
3D render, painterly, watercolor, cartoonish, multiple otters, busy
kelp forest, dense foliage, drop shadow, full body of otter, tail
prominently visible, broken kelp strand
```

### Output target
- Aspect: 1:1 square
- 2048×2048 minimum
- SVG-friendly. Best of the three for tiny rendering (favicon, app icon).

---

# Fallback bench

The five acronym candidates below remain available if OTTER hits a trademark or naming issue. Kept verbatim from the original shortlist.

---

## 1. OTTO — *Orchestrated Task & Tooling Operator*

**Concept:** OTTO is a palindrome — the word loops back on itself. The mark should *also* loop back on itself. Two interlocking circles forming a figure-eight / infinity / Möbius silhouette. Friendly, mechanical, warm.

**Color palette:**
- Deep navy `#0F1B3D` (trust, engineering)
- Warm orange `#FF8A3D` (warmth, energy, automation)
- Cream background `#F7F2E8`

**Style:** Geometric minimal, slight rounded terminals, evokes a friendly robot operator. Bauhaus-adjacent.

### Primary prompt
```
A minimalist vector logo mark, symbol only, no text. Two perfectly interlocking
circles forming a horizontal infinity / figure-eight loop, drawn with a single
continuous rounded stroke. The stroke is deep navy blue (#0F1B3D) with a warm
orange accent (#FF8A3D) highlighting the crossing point where the loops meet.
Cream off-white background (#F7F2E8). The shape suggests a friendly mechanical
operator, an automated loop, perpetual motion. Bauhaus-inspired geometric
precision, modern tech brand mark, flat design, no gradients, no shadows,
crisp vector edges, balanced negative space, suitable for a software product
logo. Generous padding around the mark.
```

### Short prompt
```
Minimalist vector logo, interlocking infinity loop made of two circles,
single continuous rounded stroke, deep navy with warm orange accent at the
crossing point, cream background, flat geometric Bauhaus style, symbol only
no text --ar 1:1 --style raw --v 6
```

### Negative prompt (SD/Flux)
```
text, letters, words, typography, watermark, signature, photorealistic,
3D render, drop shadow, gradient, gloss, complex illustration, multiple
objects, clutter, low contrast, blurry
```

### Output target
- Aspect: 1:1 square
- 2048×2048 minimum
- SVG-friendly (flat, single-line, no gradients)

---

## 2. SAGE — *Scholarly Agent Guiding Engineers*

**Concept:** A stylized sage leaf merged with a circuit-board node — the natural and the engineered fused into one mark. Implies wisdom (the herb), knowledge (the scholar), and code (the circuit). Refined, slightly classical.

**Color palette:**
- Forest sage green `#5C7A5C` (wisdom, growth)
- Antique gold `#C9A14A` (scholarship, value)
- Parchment background `#F5EEDC`

**Style:** Refined geometric, slight herbal/botanical line-art feel, scholarly. Think university crest meets modern tech.

### Primary prompt
```
A minimalist vector logo mark, symbol only, no text. A single stylized sage
leaf, drawn with clean geometric lines, where the central vein of the leaf
transforms into a horizontal circuit-board trace ending in three small
circular nodes. The leaf is forest sage green (#5C7A5C) with the circuit
trace and nodes in antique gold (#C9A14A). Parchment off-white background
(#F5EEDC). The mark fuses nature and engineering, herbal wisdom and software,
suggesting a scholarly assistant. Refined, balanced, slightly classical
proportions, modern tech brand mark, flat design, no gradients, crisp vector
edges, generous negative space.
```

### Short prompt
```
Minimalist vector logo, single sage leaf where the center vein becomes a
circuit trace with three nodes, sage green and antique gold, parchment
background, flat refined geometric style, scholarly tech brand, symbol only
no text --ar 1:1 --style raw --v 6
```

### Negative prompt (SD/Flux)
```
text, letters, words, typography, watermark, photorealistic leaf,
3D render, painterly, sketch, watercolor, multiple leaves, busy pattern,
shadows, gradients
```

### Output target
- Aspect: 1:1 square
- 2048×2048 minimum
- SVG-friendly

---

## 3. IRIS — *Investigative Research & Iteration Synthesizer*

**Concept:** Concentric arcs forming a camera aperture / human iris — which is *also* a loop. Layered rings imply iteration, research depth, observation. Greek messenger goddess Iris carried messages between realms → maps to the kiro-cli ↔ Langflow routing.

**Color palette:**
- Deep indigo `#1E2A5E` (depth, focus)
- Iridescent gradient accent: teal `#3DD6D0` → violet `#7B4FE0` → amber `#F4A24C` (the iridescent "iris" rainbow)
- Off-white background `#FAFAF7`

**Style:** Modern geometric, sharp concentric forms, subtle iridescence on one ring only. Optical / scientific instrument vibe.

### Primary prompt
```
A minimalist vector logo mark, symbol only, no text. A stylized camera
aperture / human iris made of six identical curved blades arranged in a
perfect circle, leaving a small hexagonal opening at the center. Five blades
are solid deep indigo (#1E2A5E). One blade carries a subtle iridescent
gradient from teal (#3DD6D0) through violet (#7B4FE0) to amber (#F4A24C),
suggesting a refracting prism or iris of an eye. Off-white background
(#FAFAF7). The mark suggests precision optics, observation, research,
iteration through concentric forms. Modern geometric tech brand mark, flat
design except the single gradient blade, crisp vector edges, balanced
negative space, suitable for a software product logo.
```

### Short prompt
```
Minimalist vector logo, camera aperture made of six curved blades around a
hexagonal center opening, five blades deep indigo and one blade with
iridescent teal-violet-amber gradient, off-white background, flat modern
geometric style, symbol only no text --ar 1:1 --style raw --v 6
```

### Negative prompt (SD/Flux)
```
text, letters, words, typography, watermark, photorealistic eye, eyeball,
eyelashes, camera body, lens flare, 3D render, painterly, complex
illustration, shadows, harsh gradients on multiple blades
```

### Output target
- Aspect: 1:1 square
- 2048×2048 minimum
- SVG-friendly (one ring may need raster export for the gradient)

---

## 4. ECHO — *Engineered Coding Helper & Orchestrator*

**Concept:** Three or four concentric arcs expanding outward from a single anchor point — the visual primitive of an echo, a sonar ping, a ripple, a *loop* propagating. Subtly evokes a stylized "E" lying on its side. Implies signal, relay, response.

**Color palette:**
- Deep navy `#0A1F44` (anchor, depth)
- Electric cyan `#2EE6E6` (signal, energy)
- Pure white background `#FFFFFF`

**Style:** Geometric minimal, monoline arcs of equal stroke weight, slight progressive transparency on outer arcs to imply propagation. Sonar / wave / signal aesthetic.

### Primary prompt
```
A minimalist vector logo mark, symbol only, no text. Four concentric
quarter-circle arcs of identical stroke weight, all sharing the same center
point at the bottom-left corner of the composition, radiating outward toward
the upper-right like ripples or a sonar ping. The innermost arc is solid
electric cyan (#2EE6E6). The next three arcs are deep navy (#0A1F44),
progressively reducing in opacity from 100% to 60% to 30% as they radiate
outward, implying a propagating signal or echo dissipating. Pure white
background (#FFFFFF). The mark suggests sound waves, a relay, a loop
propagating outward, a stylized sideways letter E. Modern geometric tech
brand mark, flat design, rounded line caps, crisp vector edges, balanced
negative space.
```

### Short prompt
```
Minimalist vector logo, four concentric quarter-circle arcs radiating from
bottom-left corner like a sonar ping, innermost arc electric cyan, outer
arcs deep navy with decreasing opacity, white background, flat geometric
style, rounded line caps, symbol only no text --ar 1:1 --style raw --v 6
```

### Negative prompt (SD/Flux)
```
text, letters, words, typography, watermark, photorealistic sound waves,
speaker, microphone, 3D render, complex illustration, full circles,
shadows, gradients within a single arc
```

### Output target
- Aspect: 1:1 square
- 2048×2048 minimum
- SVG-friendly

---

## 5. ADA — *Analytical Discovery Assistant*

**Concept:** A stylized capital "A" whose crossbar is replaced by a horizontal row of punched holes — a nod to Ada Lovelace's analytical engine and punch cards. Heritage, analysis, and computation in one glyph. The only top-5 mark that *is* a letterform, because the name itself is short enough to function as the mark.

**Color palette:**
- Deep burgundy `#6B1F3A` (heritage, Victorian)
- Antique gold `#D4A24C` (analytical engine brass)
- Ivory background `#F8F1E4`

**Style:** Geometric serif-influenced letter mark, classical proportions with modern execution. Slight nod to Victorian engineering aesthetics without being kitschy.

### Primary prompt
```
A minimalist vector logo mark featuring a single capital letter A as the
symbol, drawn with clean geometric proportions, slightly serif-influenced
but modern. Instead of a solid horizontal crossbar, the A's crossbar is a
horizontal row of five small evenly-spaced punched circular holes,
referencing punch cards and Charles Babbage's analytical engine. The letter
is deep burgundy (#6B1F3A) and the punched holes are filled with antique
gold (#D4A24C). Ivory background (#F8F1E4). The mark honors Ada Lovelace
and signals analysis, computation, and heritage. Classical proportions
executed in a modern flat style, no gradients, crisp vector edges, balanced
negative space, suitable for a software product logo.
```

### Short prompt
```
Minimalist vector logo, capital letter A with a horizontal row of five
punched circular holes replacing the crossbar like punch cards, deep
burgundy letter with antique gold hole fills, ivory background, geometric
serif-influenced flat style, single letter only --ar 1:1 --style raw --v 6
```

### Negative prompt (SD/Flux)
```
text below or beside the A, additional letters, words, typography labels,
watermark, photorealistic punch card, Victorian illustration, ornate
flourishes, 3D render, gradients, drop shadows, multiple A's, lowercase
```

### Output target
- Aspect: 1:1 square
- 2048×2048 minimum
- SVG-friendly

> **Note:** ADA is the one exception to "no text in the mark" — the *name itself* is so short the letter-as-mark approach is the strongest direction. If you want a non-letter symbol option, ask for: *"a stylized gear whose teeth are alternating punched holes and brass cogs, deep burgundy and antique gold."*

---

## General tips for all five

1. **Generate at 2048×2048 or higher** so you have headroom to crop/rework.
2. **Run each prompt 8–12 times** — pick the cleanest geometry, not the prettiest first result.
3. **Trace the winner in Figma / Illustrator** for a true SVG. Text-to-image output is raster.
4. **Test the mark at 16×16, 32×32, and 256×256** — favicon, app icon, header. If the geometry breaks at 16px, the mark is too detailed.
5. **Always generate a monochrome version** (pure black on white) before locking color — a logo that doesn't work in one color doesn't work.
6. **Avoid prompts that mix the mark and a wordmark** — generate them separately and composite.
