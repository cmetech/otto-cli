# OTTER Mascot — Text-to-Image Prompt

Use this prompt with a text-to-image tool that supports **image references**. Attach the OSCAR logo (the baby-blue cartoon robot with the TV-screen face, three red lights on top, and "AI" on the base) as the **style reference image**. The prompt below tells the model to match OSCAR's illustration DNA exactly and translate it onto an otter character.

---

## The prompt

```
A cute cartoon mascot character logo in the EXACT same illustration style as
the attached reference image (the OSCAR robot). Match the reference's style
precisely:

- Lineal Color / Flaticon cartoon mascot style
- Bold uniform black outlines, same line weight as the reference
- Soft flat color fills with one slightly darker shade per element for depth
  (no gradients, no painterly shading)
- Friendly chibi proportions, head-heavy, square-ish overall silhouette
- Front-facing portrait composition, head fills the top ~2/3 of the frame
- Character sits on a small flat platform with a chunky text label on its
  front, identical placement to the reference's "AI" base
- White background, no scene, no drop shadow on the character body, only a
  subtle curved shadow beneath the base
- The character should read at small sizes (app icon, UI avatar) and have
  the same warm "friendly product persona" energy as the reference

The character is an OTTER (a cartoon sea otter), not a robot. It is the
sibling mascot of OSCAR — they should look like they were drawn by the same
illustrator for the same product family.

COMPOSITION — mirror the reference exactly:
- Where OSCAR has a square TV-screen face, OTTER has a round-square otter
  head (biological version of the same silhouette)
- Where OSCAR has two large round simple eyes (black with a single small
  white highlight), OTTER has the same eye style
- Where OSCAR has a simple curved smile, OTTER has the same smile
- Where OSCAR has three short horizontal "speaker" lines on each cheek,
  OTTER has three short whisker lines on each cheek
- Where OSCAR has small darker "speaker" accessory shapes on either side of
  the head, OTTER has small rounded otter ears in the same position
- Where OSCAR has three small red lights on top of its head, OTTER has
  three small light-blue water-droplet shapes on top of its head (signaling
  the otter's aquatic nature — same placement, same rhythm, cool accent
  instead of warm)
- Where OSCAR has a small triangular dark element below its chin, OTTER
  has a small triangular black otter nose
- The character sits on a small flat wooden log or stone slab labeled
  "OTTO" in the same chunky cartoon font and position as OSCAR's "AI"
- Paws rest at the chest, visible but not holding anything (matching
  OSCAR's no-prop pose)

PALETTE — translate OSCAR's cool blue palette into OTTER's warm earth tones,
keeping the same saturation level and the same value relationships:
- Otter Brown #8B5E3C — primary fur (replaces OSCAR's baby blue body)
- Cream #E8D5B7 — belly patch on the chest (replaces OSCAR's lighter
  face-panel color)
- Dark Brown #5A3825 — inner ears + base darker accent (replaces OSCAR's
  dark blue)
- Light Blue #B4D8E7 — the three water droplets on top of the head (only
  cool accent, balances against warm fur — parallel to OSCAR's red lights)
- Warm Tan #C9A26F — base/log color (replaces OSCAR's dark base)
- Black — all outlines, eyes, nose
- White — small eye highlights and background

OUTPUT FORMAT: 1:1 square, transparent or pure-white background, sized for
both app-icon use (will be exported down to 64×64) and full-resolution UI
avatar use. No text other than "OTTO" on the base.

The result MUST sit naturally next to the attached OSCAR reference and read
as a clear sibling — same illustration DNA, same chibi mascot energy, same
composition rules, same outline weight, same palette saturation. A user
seeing the two side by side should immediately understand they belong to
the same product family.
```

---

## What changes vs. OSCAR (quick reference)

| OSCAR element | OTTER equivalent |
|---|---|
| TV-screen face | Round-square otter face (biological) |
| Three red lights on top | Three light-blue water droplets |
| Dark-blue "speaker" ears | Small round otter ears |
| "Speaker" lines on cheeks | Whisker lines on cheeks |
| Triangular dark element under chin | Small triangular otter nose |
| Baby-blue body | Otter-brown fur with cream belly patch |
| Dark blue accents | Dark brown accents |
| Dark base | Warm tan wooden log / stone base |
| "AI" label | "OTTO" label |

Everything else — pose, line weight, eye style, smile, proportions, no-prop hands-at-chest stance, base shape, white background — stays identical to the OSCAR reference.

## If you want a tool-carrier variant later

For the activity-flow infographic, OTTER carries a small slate tile with a glowing `>_` terminal prompt (echoing "otters carry rocks as tools"). The brand-mascot version above deliberately omits that prop so the silhouette stays sibling-clean with OSCAR. Generate the prop variant from the same base character later if needed.
