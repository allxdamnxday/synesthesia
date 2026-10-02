## V5 Filaments

Fine strands like kelp or hair, rooted all over the water and lying along slow whorls,
dim silver-blue on black. The movement sweeps the strands it reaches, and wherever a
strand sweeps it paints a translucent ribbon of light in the color of its direction. The
ribbons fade (Persistence) while the strands spring back (Elasticity), so the wake is a
long exposure of the movement drawn by the strands themselves.

**How the wink reads.** At the close, the strands over the eye are swept down and paint
violet veils; at the open they are swept back up and paint sea-glass veils over the
violet, so the two moments stay visible as two colors layered in one place. The strands
spring back with a small overshoot and the veils fade over two or three seconds, leaving
the resting strands.

Code: `src/materials/visual/filaments/` (pure mapping in `mapping.ts`, the CPU strand
simulation in `FilamentSim.ts`, ribbons and strands in `shaders.ts` and
`FilamentsMaterial.ts`). Shared with Descending bubbles:
`src/materials/visual/shared/fieldSampling.ts`, `hashNoise.ts` and `wakePalette.ts`.

### Properties

| Property | Shown | Baseline | Meaning in Filaments |
|---|---|---|---|
| Viscosity | Primary | 0.5 | How thick the water is: strands move less, lag behind the movement and stop sooner. |
| Elasticity | Primary | 0.5 | How strongly the strands spring back to where they rest, overshooting as they settle. |
| Persistence | Primary | 0.5 | How long the ribbons of light that moving strands paint take to fade. |
| Rigidity | Primary | 0.5 | How stiff the strands are: soft ones curl with the flow, stiff ones swing like rods. |
| Brightness | Primary | 0.5 | How luminous the strands and their ribbons of light are. |
| Intensity | Primary | 0.5 | How strongly the movement pushes the strands. |
| Hue | Primary | 0.5 | Turns the colors of the strands and their ribbons of light around the color wheel; the middle keeps them as they are. |
| Dispersion | More | 0.5 | How tangled the strands lie, and how much the movement scatters them. |
| Density | More | 0.5 | How many strands there are. |
| Range | More | 0.5 | How large the movement is among the strands: small and centered, or magnified past the edges. |
| Length | More | 0.5 | How long each strand is. |
| Thickness | More | 0.5 | How thick each strand and its ribbon of light are. |

Every shared property applies. **Rigidity** is promoted to primary (how stiff the strands
are is their most telling quality) and **Dispersion** moves under More to keep six
primaries; **Hue** is shown beside them.

### Signature → Filaments

| Signature | Filaments |
|---|---|
| Field (per-cell motion), sampled at each of a strand's 20 points through the Range projection | Pushes the point (low-passed by the lag, scattered by Dispersion); drag slows it; the strand's constraints (fixed root, segments that don't stretch, a resting curve held by Rigidity) turn the push into bending and swinging. |
| Where a segment sweeps sideways | Paints the exact area it swept this step into the ribbon buffer (each step's piece tiles with the next, so fast and slow sweeps leave the same light), colored by the direction of the sweep. Painting fades in between 0.025 and 0.4 short sides/s of sideways speed, so drifting and springing back paint faintly. |
| Direction of the sweep | Ribbon color: down = violet-ultramarine, up = sea-glass, right = teal, left = blue (Water's "Deep water" palette, evened out in lightness so the close and the open read equally strongly). |
| Speed of each point | The strand itself glows in its direction's color (fully at 0.25 short sides/s). |
| Stillness | Nothing moves or paints: dim strands at rest on black. |

### Properties → parameters

Lengths are in canvas short sides and times in seconds, so every quality tier and every
canvas size shows the same strands.

| Property | Parameter (0 → 0.5 → 1) |
|---|---|
| Viscosity | Drag 4·2.2^(2v − 1) (1.8 → 4 → 8.8 /s): thin water lets strands whip and coast, thick water holds them. Push gain 2.4·(1.15 − 0.3·v) (2.8 → 2.4 → 2.0 /s). Lag of the push 0.12·v² (0 → 0.03 → 0.12 s). |
| Elasticity | Spring toward each point's resting place 60·e² (0 → 15 → 60 /s²): about 0.6 Hz at baseline, 1.2 Hz at 1, where it overshoots (damping ratio ≈ 0.26 at baseline Viscosity). At 0 displaced strands stay where the movement left them. |
| Persistence | Ribbon fade 1.2·6^(1 − 2p) (7.2 → 1.2 → 0.2 /s). |
| Rigidity | Bending stiffness toward the resting curve 0.03 + 0.97·r^1.5 per step (0.03 → 0.37 → 1), independent of the iteration count. |
| Brightness | Exposure 2^(2.4·(b − 0.5)) (0.44× → 1× → 2.3×); saturation 0.7 + 0.65·b; strands and ribbons alike. |
| Intensity | Push gain × 4^(2i − 1) (¼× → 1× → 4×). |
| Dispersion | How the strands lie: 0.12 + 1.76·d. Low: combed into a hanging curtain; from about 0.5 they follow smooth seeded whorls that point every way; toward 1 the whorls get smaller (a tangle). The push is deflected per point by up to ±1.12·d² rad, plus fresh seeded turbulence of 0.28·d² of the push each step. |
| Density | Count 20·40^d (20 → 126 → 800), capped by quality tier at 150 / 400 / 800 (Draft / Standard / High). New strands fade in over 0.6 s. |
| Range | Projection of the movement: 0.4× (compressed) → fitted → 2.5× (magnified), the same as every material. |
| Length | 0.28·2.5^(2L − 1) short sides (0.11 → 0.28 → 0.7). |
| Thickness | Strand width 0.002·3^(2t − 1) short sides (about 0.7 → 2.2 → 6.5 px at 1080p; never drawn under a pixel, dimmer instead), tapering to 45% at the tip. Ribbons are box-filtered over the same width and gain light × (width ÷ baseline width)^0.7. The strands' width shows at once while paused. |
| Hue | Turn of the colors about grey (half a turn back → none → half a turn on), strands and ribbons alike. The ribbon buffer keeps the strands' own colors and is turned where it is shown, so ribbons already painted turn too. Display only: it shows at once while paused. |

Fixed: 20 points per strand, 6 constraint iterations per step; strands rest at 40%
light, fainter toward the tip; ribbon buffer at most 540 / 1080 / 2160 px on its short
side (Draft / Standard / High, never finer than the canvas), half-float with an 8-bit
fallback (with a fade floor so it still returns to black) for GPUs that can't blend into
float targets.

Why the strands point every way at baseline: on strands that all hang down, a push
toward the root only buckles them and a push away only pulls them taut, which made a
wink's close and open look unequal. A flow that points every way favors no direction of
movement.

### Quality tiers

The baseline count (126) is the same at every tier, so a Draft preview and a High render
show the same strands. Above Density ≈ 0.55 a Draft preview is capped at 150 strands
(Standard at 400 above ≈ 0.81) while the render (High) shows up to 800.

### Randomness and determinism

`reset(seed)` recreates the seeded PRNG, which draws the shape key and the offset of the
low-discrepancy sequence that spreads the roots evenly; each step draws exactly one more
value (the key for that step's turbulence). Per-strand and per-point values are
counter-based hashes, so a strand never depends on how many others exist. The ribbons
are GPU state advanced only in `step()` (fade, then paint), never in `draw()`. Same seed,
properties and signature → identical strand arrays (unit tested).

### Cost

A strand that is still, unpushed and not pulled by its spring sleeps (skips the
constraint solve) until the movement reaches it; this halves the cost over the wink and
makes the tail nearly free, within 0.4 px (at 1080p) of solving every strand. Measured on
the builder's machine (the wink's active part looped, 1× = 960×540, 2× = 1920×1080): 60 fps
at every tier and scale, display-paced. A whole frame (one step, with its ribbon painting,
and a draw, waited on by a 1-pixel read) takes 2.5–4.1 ms at baseline; at Density 1 it
takes 2.6–3.2 ms (Draft, 150 strands), 2.8–5.2 ms (Standard, 400) and 8.1–8.5 ms (High,
800). The CPU side of a step is about 0.8 ms at baseline and 4.5 ms at 800 strands.
