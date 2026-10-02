## V4 Descending bubbles

Clear, rim-lit bubbles sinking through dark water, bigger ones nearer and faster. The
movement shoves the bubbles in its path: pushed bubbles stretch with their speed, glow in
the color of the direction they were pushed, wobble after the push, and carry the shape
of the movement down with them as they keep falling. Everything else just sinks, so the
water is never empty and the wake is always something happening *to* the bubbles.

**How the wink reads.** At the close, the bubbles over the eye are shoved downward: they
stretch into falling ovals and flare violet, leaving a thinned patch above and a violet
ridge where they pile up below. At the open, the bubbles are pushed back up: they flare
sea-glass and stretch upward, so for a moment an eye-shaped ring hangs in the water,
violet below, sea-glass above. The glow fades over a second or two, and the imprint (the
thinned and bunched bubbles) sinks away with the fall.

Code: `src/materials/visual/bubbles/` (pure mapping in `mapping.ts`, the CPU simulation
in `BubbleSim.ts`, the instanced bubble shader in `shaders.ts`). Shared with Filaments:
`src/materials/visual/shared/fieldSampling.ts` (where the movement lands, the same Range
projection as the fluids), `hashNoise.ts` (seeded per-bubble randomness) and
`wakePalette.ts` (Water's direction colors).

### Properties

| Property | Shown | Baseline | Meaning in Descending bubbles |
|---|---|---|---|
| Viscosity | Primary | 0.5 | How thick the water is: bubbles are held back, move less and stop sooner. |
| Elasticity | Primary | 0.5 | How much each bubble wobbles and springs back after the movement pushes it. |
| Persistence | Primary | 0.5 | How long bubbles last, and how long the glow of the movement stays on them. |
| Dispersion | Primary | 0.5 | How widely the bubbles are scattered and how much they wander as they fall. |
| Brightness | Primary | 0.5 | How luminous the rims and highlights of the bubbles are. |
| Intensity | Primary | 0.5 | How strongly the movement pushes the bubbles. |
| Hue | Primary | 0.5 | Turns the colors of the bubbles and their glow around the color wheel; the middle keeps them as they are. |
| Density | More | 0.5 | How many bubbles fall at once. |
| Range | More | 0.5 | How large the movement is among the bubbles: small and centered, or magnified past the edges. |
| Fall speed | More | 0.5 | How fast the bubbles sink through the water. |
| Size | More | 0.5 | How big the bubbles are. |

Hidden: **Rigidity**. A bubble has nothing to bend, and how its shape gives and springs
back after a push is already Elasticity.

### Signature → Descending bubbles

Each bubble follows its own falling path (it sinks and wanders a little) plus a
displacement that only the movement causes.

| Signature | Descending bubbles |
|---|---|
| Field (per-cell motion), sampled at each bubble through the Range projection | A push on the bubble's displacement from its path (low-passed by the lag, deflected per bubble by Dispersion). Drag slows the displacement; Elasticity's spring pulls it back to the path. |
| Speed of the pushed motion | Glow: the bubble brightens (up to 4.5× at full glow) and turns the color of its direction; the glow rises within a few frames and fades by Persistence. At low Persistence it also wears the bubble out: it pops, then re-forms on its path. |
| Direction of the pushed motion | Color: down = violet-ultramarine, up = sea-glass, right = teal, left = blue (Water's "Deep water" palette), so the close and the open read in two colors. |
| Acceleration of the pushed motion | Wobble: the bubble stretches along the acceleration and rings like a spring (Elasticity). |
| Velocity as seen (push + wandering + fall) | Motion stretch along the velocity, up to 3.2×. |
| Stillness | Nothing is pushed and nothing glows: the bubbles simply sink. |

### Properties → parameters

Lengths are in canvas short sides and times in seconds, so every quality tier and every
canvas size shows the same water.

| Property | Parameter (0 → 0.5 → 1) |
|---|---|
| Viscosity | Drag on the pushed motion 4·2.6^(2v − 1) (1.5 → 4 → 10 /s): thin water coasts on for a second, thick water stops with the push. Push gain 1.68·(1.15 − 0.3·v), so the reach (gain ÷ drag) falls 1.3 → 0.42 → 0.14. Lag of the push 0.12·v² (0 → 0.03 → 0.12 s). |
| Elasticity | Spring back to the path 40·e⁴ (0 → 2.5 → 40 /s²). Wobble at 2.2 + 2.4·e Hz (2.2 → 3.4 → 4.6), damping ratio 0.55 − 0.47·e (0.55 → 0.32 → 0.08), stretch per unit of acceleration 0.1·e·(1.4 − 0.6·viscosity); stretch limited to −45% … +70%. |
| Persistence | Glow fade 1.5·6^(1 − 2p) (9 → 1.5 → 0.25 /s). Wear of pushed bubbles 4·12^(−2p)·(1 − p³) per second at full glow speed (4 → 0.29 → 0): a worn-out bubble pops (swells, flashes, fades over 0.3 s) and re-forms on its undisturbed path (0.5 s). Untouched bubbles live until they sink out of view. |
| Dispersion | Where bubbles start: strings at seeded places (6.5 per short side of width) blending to an even fall by 0.7 (smoothstep). Wandering 0.004 + 0.05·d² short sides/s, each direction lasting about 0.9 s. Push deflected per bubble by up to ±1.2·d² rad. |
| Brightness | Exposure 2^(2.4·(b − 0.5)) (0.44× → 1× → 2.3×); saturation 0.7 + 0.65·b. |
| Intensity | Push gain × 4^(2i − 1) (¼× → 1× → 4×). |
| Density | Count 100·80^d (100 → 894 → 8,000), capped by quality tier at 1,500 / 4,000 / 8,000 (Draft / Standard / High). |
| Range | Projection of the movement: 0.4× (compressed) → fitted → 2.5× (magnified), the same as every material. |
| Fall speed | 0.11·4^(2f − 1) short sides/s (0.03 → 0.11 → 0.44); each bubble × (0.55 + 0.45·its size), so bigger bubbles sink faster. |
| Size | Mean radius 0.01·2.4^(2s − 1) short sides (0.004 → 0.01 → 0.024: about 4.5 → 11 → 26 px at 1080p); each bubble × 0.55 … 1.85, mostly small. Display only: changes show at once while paused. |
| Hue | Turn of the rims' colors about grey (half a turn back → none → half a turn on): the pearl of resting bubbles and the direction colors of pushed ones turn together; the highlight stays white. Display only: it shows at once while paused. |

Fixed: glow is full at 0.35 short sides/s of pushed speed; motion stretch 2 per short
side per second; new bubbles start 0.05–0.11 above the top edge; smaller bubbles are a
little dimmer (depth). Bubbles are drawn as instanced quads, anti-aliased over one device
pixel; bubbles under about 3 px across become soft dots with the same light.

### Quality tiers

The baseline count (894) is the same at every tier, so a Draft preview and a High render
show the same bubbles. Above Density ≈ 0.62 a Draft preview is capped at 1,500 bubbles
(Standard at 4,000 above ≈ 0.84) while the render (High) shows up to 8,000.

### Randomness and determinism

`reset(seed)` recreates the seeded PRNG, which draws the spawn keys; each step draws
exactly one more value (the key for that step's wandering). Every per-bubble value (size,
start, fragility, wandering) is a counter-based hash of (key, slot, generation), so it
never depends on how many bubbles exist or which popped first. The first step fills the
water as if bubbles had been falling for a long time. Same seed, properties and signature
→ identical bubble arrays (unit tested).

### Cost

Measured on the builder's machine (the wink's active part looped, 1× = 960×540, 2× =
1920×1080): 60 fps at every tier and scale, display-paced. A whole frame (one step and a
draw, waited on by a 1-pixel read) takes 1.1–1.8 ms at baseline; at Density 1 it takes
1.7–2.0 ms (Draft, 1,500 bubbles), 2.6–3.4 ms (Standard, 4,000) and 4.1–5.5 ms (High,
8,000). The simulation is about 0.3 ms per step at baseline and 1.8 ms at 8,000 bubbles.
