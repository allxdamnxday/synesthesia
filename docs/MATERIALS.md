# Materials

What each material is, its properties, and how the signature's movement drives it
(SPEC 9.3: mappings are coded per material and documented here). Every material honours
the shared vocabulary (SPEC 9.2): a property means the same thing for sight and sound, so
one slider can move both.

The signature gives every material two kinds of information at each moment:

- **The field**: a grid of motion vectors (where things move, which way, how fast).
- **Features** of the whole movement (SPEC 8.2): energy (speed), peak, flow and direction,
  coherence, expansion/contraction (divergence), rotation (curl), acceleration, surge
  (gathering or releasing), jerk and continuity, density, centroid (where the movement is),
  spread, and onsets (moments of sudden gathering).

Each material's section below gives its idea, how the wink reads through it, its properties, and the feature → parameter mapping. The same text lives in `docs/materials/` next to each material's author notes.

## Visual materials

| | Material | In a sentence |
|---|---|---|
| V0 | Signature | The bare wake: a short stroke per grid cell, pointing the way that part moves, brighter where it moves faster. Diagnostic; used on Prepare and selectable in the Studio. |
| V1 | Water | Colored dye in clear water, seen from below. |
| V2 | Honey | The same fluid as Water, made thick: it lags, sags, domes and holds. |
| V3 | Smoke | Pale smoke on dark: the movement gives off smoke that rises, curls and thins. |
| V4 | Descending bubbles | Clear bubbles falling like snow, shoved and flared by the movement. |
| V5 | Filaments | Strands like hair or kelp that sweep and paint fading veils of light. |

### V1 Water

A stable-fluids simulation (adapted from Pavel Dobryakov's WebGL-Fluid-Simulation, MIT).
The signature's field pushes the water wherever it moves; dye is released there in
proportion to speed, colored by the direction of movement (so a close and an open read as
two colors), and fades by Persistence. Primary: Viscosity, Persistence, Dispersion,
Brightness, Intensity, Density. More: Range, Palette, Surface light. Hidden: Elasticity,
Rigidity (water doesn't spring back or hold a shape).

| Property | Solver parameter |
|---|---|
| Viscosity | ν (low range, 0–3e-3), Jacobi iterations, drag, slight lag |
| Persistence | dye fade rate (3/s → 0.08/s) |
| Dispersion | vorticity confinement + seeded scatter of the push |
| Brightness | exposure and saturation of the dye (highlights glow white) |
| Intensity | force gain (how much of the movement's speed the water gets) |
| Density | dye released per unit of movement |
| Range | projection scale (compressed ↔ magnified) |
| Palette | direction → dye color (Deep water, Ink, Prism) |
| Surface light | shading, refraction and glints from the dye's thickness |

| Signature | Water |
|---|---|
| Field (per cell) | force on the water; dye emission ∝ local speed (the spatial form of `energy`) |
| Direction of each cell's movement | dye color (palette) |

### V2 Honey

A bowl of honey seen from below: the same fluid as Water, made thick. The movement drags
the honey slowly and broadly; it lags behind, comes to rest soon after the push ends, and
keeps the colors folded into it. With Elasticity it springs back toward where it was.
Together with Water it is Freeman's bowl analogy made literal: the same wink, two
substances.

**How the wink reads.** Color appears at the moment of the close (deep amber, falling)
and of the open (pale gold, rising), drawn out into strands along the push. Behind the
color, the honey sags as one heavy mass during the close and lifts into a dome with the
open, then settles and holds its shape, where Water's dye keeps swirling, drifting and
fading.

Code: `src/materials/visual/honey/` (pure mapping in `mapping.ts`, Gaussian kernel in
`kernel.ts`, viscous diffusion and spring in `viscoElastic.ts`).

#### Properties

| Property | Shown | Baseline | Meaning in Honey |
|---|---|---|---|
| Viscosity | Primary | 0.5 | How thick the honey is: thicker honey drags more of itself along, lags further behind and stops sooner. |
| Elasticity | Primary | 0.3 | How much the honey springs back toward where it was, and overshoots. |
| Persistence | Primary | 0.5 | How long the colors folded into the honey stay before they fade. |
| Dispersion | Primary | 0.5 | How unevenly the honey is pushed, so the wake spreads and folds. |
| Brightness | Primary | 0.5 | How luminous and saturated the colors are. |
| Intensity | Primary | 0.5 | How strongly the movement drags the honey. |
| Density | More | 0.5 | How much color the movement folds into the honey. |
| Range | More | 0.5 | How large the movement is in the honey: small and centered, or magnified past the edges. |
| Palette | More | Amber | Amber, Dark honey or Pale gold. Each direction of movement has its own shade. |
| Surface light | More | 0.6 | The glossy sheen of light on the honey, as if looking up through the bowl. |

Hidden: **Rigidity**. Honey has no hard edges to make crisp, and its resistance to
flow is already Viscosity.

#### Signature → Honey

| Signature | Honey |
|---|---|
| Field (per-cell motion) | Pushes the honey, low-passed by the lag time: the honey's steady speed is the push × mobility, spread by viscous diffusion and stopped by drag. Elasticity pulls displaced honey back. |
| Per-cell speed (the spatial `energy`) | Color released ∝ speed × Density, from the field as it arrives (not the lagged push), so the color marks the moment of movement. |
| Direction of the push | Color, by palette: down = deep amber, up = pale gold, sideways = honey orange and gold. Each spot's release is drawn out into a stroke along the push. |
| Stillness | Nothing moves and no color is released: the bowl stays black. |

#### Properties → parameters

Lengths are in canvas short sides and times in seconds, so every quality tier shows the
same honey.

| Property | Parameter (0 → 0.5 → 1) |
|---|---|
| Viscosity | Kinematic viscosity ν = 0.012·8^v (0.012 → 0.034 → 0.096 short sides²/s), applied each step as a Gaussian blur of velocity with σ² = 2·ν·dt (the exact heat kernel; Jacobi can't converge at these values). Drag 2.5·4^v (2.5 → 5 → 10 /s). Lag of the push 0.05 + 0.55·v² (0.05 → 0.19 → 0.6 s). Mobility (push gain ÷ drag) 6·0.4^v (6 → 3.8 → 2.4). Share of color from spots 0.55 − 0.25·v. |
| Elasticity | Spring stiffness 70·e² (0 → 17.5 → 70 /s²) on a displacement field carried with the flow; the honey forgets where it was at 0.05 + 0.5·(1 − e)² /s. The spring overshoots when drag < 2·√stiffness: at baseline viscosity from Elasticity 0.3 up (damping ratio 0.3 at full elasticity); thicker honey damps it. |
| Persistence | Color fade 0.12·8^(1 − 2p) (0.96 → 0.12 → 0.015 /s). |
| Dispersion | Seeded scatter of the push: rotation 0.8·d² rad, offset 0.04·d² short sides; a faint swirl 0.08·d·(1 − viscosity). |
| Brightness | Exposure 1.3·2^(2.4·(b − 0.5)); saturation 0.8 + 0.5·b. |
| Intensity | Push gain × 4^(2i − 1) (¼× → 1× → 4×). |
| Density | Color released 2.5·3^(2d − 1) per unit of push; spot coverage 0.3 + 0.5·d. |
| Range | Projection of the movement: 0.4× (compressed) → fitted → 2.5× (magnified). |
| Palette | Direction → color table (Amber, Dark honey, Pale gold). |
| Surface light | Shading, refraction and glints from the color's thickness. |

Fixed: stroke length 0.06 short sides; speed limit 3 short sides/s; displacement limit
0.6 short sides.

### V3 Smoke

Pale smoke on dark air. The movement pushes the air and gives off smoke and heat where it
moves; an expanding movement gives off a wider puff, a contracting one a tighter puff.
Warm smoke rises in curls and eddies (with Rise below the middle it is heavy and sinks),
spreads under the top of the frame and thins away.

**How the wink reads.** The close gives off a cool grey-blue puff pushed downward; the
open a warm ivory puff pushed upward, brighter in the middle of the first. Then the whole
cloud lifts and billows upward, curling at its edges: the two moments stay visible as two
tints and two pushes inside one rising cloud.

Code: `src/materials/visual/smoke/` (pure mapping in `mapping.ts`, emission, heat,
buoyancy and eddies in `plume.ts` and `shaders.ts`).

#### Properties

| Property | Shown | Baseline | Meaning in Smoke |
|---|---|---|---|
| Viscosity | Primary | 0.5 | How thick the air is: thicker air moves slowly and smooths away the curls. |
| Persistence | Primary | 0.5 | How long the smoke hangs in the air before it thins away. |
| Dispersion | Primary | 0.5 | How much the smoke curls, eddies and breaks into turbulence. |
| Brightness | Primary | 0.5 | How luminous the smoke is. |
| Intensity | Primary | 0.5 | How strongly the movement pushes the smoke. |
| Rise | Primary | 0.7 | How strongly the warm smoke rises; below the middle it is heavy and sinks instead. |
| Density | More | 0.5 | How much smoke the movement gives off. |
| Range | More | 0.5 | How large the movement is in the air: small and centered, or magnified past the edges. |

Hidden: **Elasticity** (smoke has no shape to spring back to) and **Rigidity** (smoke
has no edges to make crisp).

#### Signature → Smoke

| Signature | Smoke |
|---|---|
| Field (per-cell motion) | Pushes the air. |
| Per-cell speed (the spatial `energy`) | Smoke and heat given off ∝ speed. Most smoke leaves from a seeded pattern of small vents, drawn out along the push, so it comes off in threads the flow draws into wisps. |
| `divergence` (normalized −1..1) | Burst radius: smoke and heat are given off wherever the movement is within the radius base·2^(1.6·divergence), about ⅓× (contracting) to 3× (expanding) the base of 0.05 short sides. |
| Direction of the push | Tint: cool grey-blue falling, warm ivory rising, neutral sideways. |
| Heat (given off with the smoke) | Buoyancy: warm smoke rises (Rise), heat cools at 0.5/s; seeded eddies stir wherever it is warm. |
| Stillness | No smoke: the air stays black. |

#### Properties → parameters

Lengths are in canvas short sides and times in seconds. Smoke's flow is solved on a
64-cell grid with 64 pressure iterations at every quality tier (only the smoke's own
detail follows the tier), so a Standard preview and a High render show the same flow.

| Property | Parameter (0 → 0.5 → 1) |
|---|---|
| Viscosity | ν = 0.004·(300^v − 1)/299 (0 → 0.00022 → 0.004 short sides²/s, Jacobi); drag 0.1 + 1.4·v² /s; lag of the push 0.1·v² s; curls × (1 − 0.7·v); eddies × (1 − 0.6·v). |
| Persistence | Smoke fade 0.3·7^(1 − 2p) (2.1 → 0.3 → 0.04 /s). |
| Dispersion | Vorticity confinement (0.12 + 0.36·d)·(1 − 0.7·viscosity) short sides; seeded curl-noise eddies 2.4·d·(1 − 0.6·viscosity) short sides/s² per unit of heat, 3 eddies per short side. |
| Brightness | Exposure 2^(2.4·(b − 0.5)); saturation 0.6 + 0.5·b. |
| Intensity | Push gain 6·4^(2i − 1) (1.5 → 6 → 24 /s). |
| Rise | Buoyancy 5·(2r − 1) short sides/s² per unit of heat: −5 (sinks) → 0 (hangs) at 0.5 → +5 (rises); baseline 0.7 → +2. |
| Density | Smoke given off 2.5·3^(2d − 1) per unit of push; vents open 0.3 + 0.5·d. |
| Range | Projection of the movement (0.4× → fitted → 2.5×); the burst radius scales with it. |

Fixed: heat 2 per unit of push (at most 4); 80% of the smoke from vents (30 per short
side), wisps 0.05 short sides long; speed limit 4 short sides/s.

### V4 Descending bubbles

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

#### Properties

| Property | Shown | Baseline | Meaning in Descending bubbles |
|---|---|---|---|
| Viscosity | Primary | 0.5 | How thick the water is: bubbles are held back, move less and stop sooner. |
| Elasticity | Primary | 0.5 | How much each bubble wobbles and springs back after the movement pushes it. |
| Persistence | Primary | 0.5 | How long bubbles last, and how long the glow of the movement stays on them. |
| Dispersion | Primary | 0.5 | How widely the bubbles are scattered and how much they wander as they fall. |
| Brightness | Primary | 0.5 | How luminous the rims and highlights of the bubbles are. |
| Intensity | Primary | 0.5 | How strongly the movement pushes the bubbles. |
| Density | More | 0.5 | How many bubbles fall at once. |
| Range | More | 0.5 | How large the movement is among the bubbles: small and centered, or magnified past the edges. |
| Fall speed | More | 0.5 | How fast the bubbles sink through the water. |
| Size | More | 0.5 | How big the bubbles are. |

Hidden: **Rigidity**. A bubble has nothing to bend, and how its shape gives and springs
back after a push is already Elasticity.

#### Signature → Descending bubbles

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

#### Properties → parameters

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

Fixed: glow is full at 0.35 short sides/s of pushed speed; motion stretch 2 per short
side per second; new bubbles start 0.05–0.11 above the top edge; smaller bubbles are a
little dimmer (depth). Bubbles are drawn as instanced quads, anti-aliased over one device
pixel; bubbles under about 3 px across become soft dots with the same light.

#### Quality tiers

The baseline count (894) is the same at every tier, so a Draft preview and a High render
show the same bubbles. Above Density ≈ 0.62 a Draft preview is capped at 1,500 bubbles
(Standard at 4,000 above ≈ 0.84) while the render (High) shows up to 8,000.

#### Randomness and determinism

`reset(seed)` recreates the seeded PRNG, which draws the spawn keys; each step draws
exactly one more value (the key for that step's wandering). Every per-bubble value (size,
start, fragility, wandering) is a counter-based hash of (key, slot, generation), so it
never depends on how many bubbles exist or which popped first. The first step fills the
water as if bubbles had been falling for a long time. Same seed, properties and signature
→ identical bubble arrays (unit tested).

#### Cost

Measured on the builder's machine (the wink's active part looped, 1× = 960×540, 2× =
1920×1080): 60 fps at every tier and scale, display-paced. A whole frame (one step and a
draw, waited on by a 1-pixel read) takes 1.1–1.8 ms at baseline; at Density 1 it takes
1.7–2.0 ms (Draft, 1,500 bubbles), 2.6–3.4 ms (Standard, 4,000) and 4.1–5.5 ms (High,
8,000). The simulation is about 0.3 ms per step at baseline and 1.8 ms at 8,000 bubbles.

### V5 Filaments

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

#### Properties

| Property | Shown | Baseline | Meaning in Filaments |
|---|---|---|---|
| Viscosity | Primary | 0.5 | How thick the water is: strands move less, lag behind the movement and stop sooner. |
| Elasticity | Primary | 0.5 | How strongly the strands spring back to where they rest, overshooting as they settle. |
| Persistence | Primary | 0.5 | How long the ribbons of light that moving strands paint take to fade. |
| Rigidity | Primary | 0.5 | How stiff the strands are: soft ones curl with the flow, stiff ones swing like rods. |
| Brightness | Primary | 0.5 | How luminous the strands and their ribbons of light are. |
| Intensity | Primary | 0.5 | How strongly the movement pushes the strands. |
| Dispersion | More | 0.5 | How tangled the strands lie, and how much the movement scatters them. |
| Density | More | 0.5 | How many strands there are. |
| Range | More | 0.5 | How large the movement is among the strands: small and centered, or magnified past the edges. |
| Length | More | 0.5 | How long each strand is. |
| Thickness | More | 0.5 | How thick each strand and its ribbon of light are. |

Every shared property applies. **Rigidity** is promoted to primary (how stiff the strands
are is their most telling quality) and **Dispersion** moves under More to keep six
primaries.

#### Signature → Filaments

| Signature | Filaments |
|---|---|
| Field (per-cell motion), sampled at each of a strand's 20 points through the Range projection | Pushes the point (low-passed by the lag, scattered by Dispersion); drag slows it; the strand's constraints (fixed root, segments that don't stretch, a resting curve held by Rigidity) turn the push into bending and swinging. |
| Where a segment sweeps sideways | Paints the exact area it swept this step into the ribbon buffer (each step's piece tiles with the next, so fast and slow sweeps leave the same light), colored by the direction of the sweep. Painting fades in between 0.025 and 0.4 short sides/s of sideways speed, so drifting and springing back paint faintly. |
| Direction of the sweep | Ribbon color: down = violet-ultramarine, up = sea-glass, right = teal, left = blue (Water's "Deep water" palette, evened out in lightness so the close and the open read equally strongly). |
| Speed of each point | The strand itself glows in its direction's color (fully at 0.25 short sides/s). |
| Stillness | Nothing moves or paints: dim strands at rest on black. |

#### Properties → parameters

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

Fixed: 20 points per strand, 6 constraint iterations per step; strands rest at 40%
light, fainter toward the tip; ribbon buffer at most 540 / 1080 / 2160 px on its short
side (Draft / Standard / High, never finer than the canvas), half-float with an 8-bit
fallback (with a fade floor so it still returns to black) for GPUs that can't blend into
float targets.

Why the strands point every way at baseline: on strands that all hang down, a push
toward the root only buckles them and a push away only pulls them taut, which made a
wink's close and open look unequal. A flow that points every way favors no direction of
movement.

#### Quality tiers

The baseline count (126) is the same at every tier, so a Draft preview and a High render
show the same strands. Above Density ≈ 0.55 a Draft preview is capped at 150 strands
(Standard at 400 above ≈ 0.81) while the render (High) shows up to 800.

#### Randomness and determinism

`reset(seed)` recreates the seeded PRNG, which draws the shape key and the offset of the
low-discrepancy sequence that spreads the roots evenly; each step draws exactly one more
value (the key for that step's turbulence). Per-strand and per-point values are
counter-based hashes, so a strand never depends on how many others exist. The ribbons
are GPU state advanced only in `step()` (fade, then paint), never in `draw()`. Same seed,
properties and signature → identical strand arrays (unit tested).

#### Cost

A strand that is still, unpushed and not pulled by its spring sleeps (skips the
constraint solve) until the movement reaches it; this halves the cost over the wink and
makes the tail nearly free, within 0.4 px (at 1080p) of solving every strand. Measured on
the builder's machine (the wink's active part looped, 1× = 960×540, 2× = 1920×1080): 60 fps
at every tier and scale, display-paced. A whole frame (one step, with its ribbon painting,
and a draw, waited on by a 1-pixel read) takes 2.5–4.1 ms at baseline; at Density 1 it
takes 2.6–3.2 ms (Draft, 150 strands), 2.8–5.2 ms (Standard, 400) and 8.1–8.5 ms (High,
800). The CPU side of a step is about 0.8 ms at baseline and 4.5 ms at 800 strands.

## Sound materials

| | Material | In a sentence |
|---|---|---|
| A1 | Water | Quick, bright, rising: "Breee-weet!" |
| A2 | Honey | Low, slow, stuttering: "Broo-roo-roo-rooo-oot." |
| A3 | Breath | Air drawn in and let out: expansion inhales, contraction exhales. |
| A4 | Resonance | Struck and bowed bodies: glass, wood, metal. |
| A5 | Pulse | Rhythmic plucks that quicken with the movement. |

Common to every sound material (SPEC 9.5): pan follows where the movement is (horizontal
centroid, width scaled by Dispersion); Intensity → loudness and drive; Brightness →
filter cutoff or harmonic content; Persistence → release and reverb (a procedural,
seeded room whose decay follows Persistence).

### A1 Water

One to three sine voices with FM brightness. Pitch follows the movement's vertical travel
(a running total of upward movement that drifts home only once vertical movement stops),
so rising movement keeps rising and ends high: "-weet!". Loudness follows energy with a
fast attack; onsets add short rising "droplets".

| Property | Water |
|---|---|
| Viscosity | glide 12–160 ms; attack 2–30 ms; darker (low-pass down 1.5 octaves, FM index −30%); slower droplets |
| Elasticity | glide overshoot (resonant glide, Q 0.5–2.5); vibrato on jolts up to ±0.9 semitones |
| Persistence | release 25–700 ms; reverb send and decay 0.4–6 s; longer droplets |
| Dispersion | voices detuned up to ±24 cents and spread in stereo; pan follows the movement more widely |
| Brightness | FM index 0.15–2.75; onset buzz; low-pass cutoff |
| Intensity | level −15 / 0 / +9 dB at 0 / 0.5 / 1, and drive (soft saturation) |
| Range | pitch travel 2–24 semitones |
| Density | one to three voices; droplet level |
| Rigidity | pitch snaps to a pentatonic scale; sharper attack, shorter release (baseline 0) |
| Register | base pitch A3 / A4 / A5 (Low, Middle, High) |

| Signature | Water |
|---|---|
| Upward flow (−flowY), accumulated | pitch rises and holds |
| Energy | loudness (fast attack), a small pitch lift, FM brightness |
| Surge (sudden gathering) | brightness kick and flutter ("Br") |
| Onsets | droplets at the exact onset times |
| Acceleration (jolts) | vibrato, with Elasticity |
| Centroid X | pan |

### A2 Honey

A low, slow hum that lags and stutters, like a finger drawn through honey: "Broo-roo-roo-
roo-rooo-oot." A saw/triangle hum around A2 (110 Hz, two octaves below Water) through a
resonant low-pass, broken into "roo" syllables by a smooth-square stutter. The honey has
its own motion: it gathers with the movement, lags behind it, and keeps moving (and
sounding) after the movement stops, its syllables slowing as it settles and its pitch
sinking into a final "oot". Faster movement stutters faster. Together with Water it is
Freeman's bowl analogy in sound: the same wink, two substances.

**How the wink reads** (measured on offline renders of the synthetic wink at baseline).
The close starts a "Broo-roo" (syllable peaks −14 dB RMS) that sags as the eyelid comes
down, and its last, quieter syllable falls in pitch through the pause: the close's own
"oot". The open is marked by a brief closure, the "B" (the level drops 17 dB just before
it), then a new "Broo-roo-roo" (−15 dB) that rises in pitch about 4½ semitones, a third
of a second behind the movement. After the open the honey draws the sound out for about a
second: syllables slow from 6 per second to under 4 ("rooo… rooo") and the pitch falls
3½ semitones below where the open took it. Next to Water on the same wink: the same shape
(falling on the close, rising on the open), but two octaves lower, far darker (spectral
centroid ~420 Hz against ~1.2 kHz), and still sounding well after Water has stopped.

Code: `src/materials/sound/honey/` (pure mapping in `params.ts`, control program in
`program.ts`, audio graph in `honey.ts`).

#### Properties

| Property | Shown | Baseline | Meaning in Honey |
|---|---|---|---|
| Viscosity | Primary | 0.5 | How thick the honey is: the sound lags further behind the movement, glides more slowly and turns darker. |
| Elasticity | Primary | 0.5 | How much the tone rings: a more resonant, vowel-like hum with a little bounce. |
| Persistence | Primary | 0.5 | How long each sound is drawn out: a longer release and a longer reverb tail. |
| Brightness | Primary | 0.5 | How bright the tone is: from a soft, dark hum to a buzzier, more open sound. |
| Intensity | Primary | 0.5 | How loud and driven the sound is. |
| Stutter depth | Primary | 0.5 | How strongly the sound breaks into repeated "roo" syllables: a smooth hum at zero, separate syllables at the top. |
| Dispersion | More | 0.5 | How far the sound spreads: stacked voices drift apart in pitch and across the stereo field. |
| Density | More | 0.5 | How many voices are stacked, from one to four (the fourth an octave below). |
| Range | More | 0.5 | How far the pitch travels with the movement, and how deep the fall at the end of each movement. |

Hidden: **Rigidity**. Honey has no rigid state; snapping its pitch to a scale or making its
envelopes percussive would fight the slow glide that defines it. Stutter depth takes the
articulation role instead. **Dispersion** moves under "More" to make room for Stutter
depth, Honey's defining behaviour.

#### Signature → Honey

| Signature | Honey |
|---|---|
| `energy` (normalized) | The movement itself (a quick follower, soft attack from Viscosity): the main part of the level (weight 0.75) and 80% of the filter's opening. The honey's own motion ("flow", a slow follower that keeps going after the movement): the drawn-out part of the level (weight 0.3), the stutter rate, a small pitch lift. |
| `surge` (normalized) | A sudden gathering (above 0.45, re-armed below 0.15) starts a new syllable at once: a 50 ms closure (the "B"), then a louder, brighter syllable (the accent). |
| Falling flow after a movement | The pitch sinks below the movement's peak (the "oot"); it relaxes back only once the sound has faded, so it is never heard rising again. |
| `flowY` (upward = −flowY) | Vertical travel (a leaky running total of upward flow): moving up raises the pitch, moving down lowers it, through a slow resonant glide. |
| `centroidX` | Pan (width from Dispersion); holds when the movement stops. |
| Stillness | Silence. The stutter keeps its phase, silently, so the next movement's syllables continue the rhythm. |

#### Properties → parameters

| Property | Parameter (0 → 0.5 → 1) |
|---|---|
| Viscosity | Pitch glide 0.12 → 0.42 → 1.5 s; the flow gathers in 0.03 → 0.09 → 0.3 s and settles in 0.15 → 0.55 → 2 s; attack 10 → 45 → 200 ms; low-pass down up to 1.5 octaves; stutter ×1.3 → ×1 → ×0.7. |
| Elasticity | Filter resonance Q 0.7 → 3.5 → 8.7; glide overshoot (glide Q 0.5 → 0.83 → 1.8). |
| Persistence | Release 20 → 118 → 700 ms; reverb send and decay 0.4 → 1.55 → 6 s (shared). |
| Dispersion | Stacked voices spread ±0.7 in stereo; above 0.5 they also detune, up to ±22 cents (a slow chorus); pan follows the movement ±25% → ±100% (shared). |
| Brightness | Low-pass base cutoff 0.28 × the shared brightness curve (≈ 120 Hz → 590 Hz → 3 kHz at baseline Viscosity); saw/triangle mix 15% → 50% → 85% saw; the movement opens the filter by 0.9 → 1.2 → 1.5 octaves. |
| Intensity | Level −15 / 0 / +9 dB; drive (tanh saturation) 0.3 → 0.8 → 3.2. |
| Range | Pitch travel 2 → 8 → 14 semitones; the fall ("oot") is 0.8 of it below the movement's peak. |
| Density | Voices: the hum; + an octave above (from 0.2); + a fifth above (from 0.45); + an octave below (from 0.7). Stacked on harmonics, not in unison, so they don't beat. Power stays level. |
| Stutter depth | Dip between syllables 1 − (1 − s)^1.7: 0 → 69% → 100%; the filter closes by up to 0.8 octave and the pitch scoops 0.7 semitone into each syllable, both scaled by the dip. Stutter rate 2 Hz (settled) → 7 Hz (full movement), before Viscosity's scaling and a ±8% per seed. |

#### Notes

- The stutter, the "B" and the accents run in the control program (200 points per second),
  not in an oscillator, so preview and render stutter at exactly the same moments and a loop
  wrap carries the rhythm on.
- Voices are mixed in pairs (`shared/graph.ts` `mixPairwise`): with three or more sources on
  one input, Chrome's summing order varies between runs and renders differ in the last bits.
- After a seek or a scheduler resync the level dips for about 40 ms while pitch and filter
  glide to their new values (`shared/seekDip.ts`), and its control buses anchor held values
  (`ControlBus`, which anchors its held value when cancelled), so a starved scheduler can't click.

### A3 Breath

Air drawn in and let out. Seeded noise through a band of air (plus optional vowel
formants): it is heard only while something moves. Movement that spreads out (expansion)
breathes in: the breath swells and its band opens, rising and widening. Movement that
gathers (contraction) closes it down: the band sinks and narrows. The band also sits where
the movement is, higher for movement higher in the frame, and it is broad when the
movement is spread out. At the top of Elasticity a whistle rises out of the air and traces
the same opening and closing.

**How the wink reads** (measured on offline renders of the synthetic wink at baseline).
Two breaths with a clear pause between them: the close (−17 dB RMS) and the open (−15 dB),
13 dB above the pause. The close gathers the eyelid and cheek together (a contraction), so
it sounds as a breath closing down: its band sinks about 7 semitones and narrows, a darker
"hhuh" (spectral centroid ~2.3 kHz). The open is nearly neutral in expansion on the
synthetic wink, so it sounds as the air opening again, brighter (~2.9 kHz). Played
backwards (pingpong), the same close becomes an expansion and sounds as an inhale: 4 dB
louder and far brighter (~4 kHz) at exactly the same energy. A real eye that opens wide
should read as an expansion too, and swell.

Code: `src/materials/sound/breath/` (pure mapping in `params.ts`, control program in
`program.ts`, audio graph in `breath.ts`).

#### Properties

| Property | Shown | Baseline | Meaning in Breath |
|---|---|---|---|
| Viscosity | Primary | 0.5 | How slowly the breath follows the movement: slower swells, softer onsets and a darker sound. |
| Elasticity | Primary | 0.5 | How much the air rings: a narrower band that bounces as it moves, whistling at the top. |
| Persistence | Primary | 0.5 | How long each breath lingers: a longer release and a longer reverb tail. |
| Dispersion | Primary | 0.5 | How widely the breath spreads: a broader band of air (broader still when the movement is spread out) and a wider stereo image. |
| Brightness | Primary | 0.5 | How high and airy the breath sounds, from a low hush to a bright hiss. |
| Intensity | Primary | 0.5 | How loud and driven the breath is. |
| Range | More | 0.5 | How far the band of air travels with the movement: with its height in the frame, and as it opens and closes. |
| Density | More | 0.5 | How many layers of air sound together: one band, then a lower chest layer, then a high hiss. |
| Formant | More | None | The shape of the mouth the air passes through: none (plain air), "ah" (open) or "oo" (rounded). |

Hidden: **Rigidity**. Breath has no rigid form, a band of noise has no pitch to snap to a
scale, and sharp onsets are already there with Viscosity at zero.

#### Signature → Breath

| Signature | Breath |
|---|---|
| `energy` (normalized) | Level: silent below 0.012, then energy^0.6, with a soft attack (Viscosity) and a release (Persistence). |
| `divergence` (normalized, from the local expansion fit) | Followed (Viscosity) and trusted only while enough moves. Expansion (> 0) raises the band and widens it (up to ×2) and swells the level (up to +3.5 dB): the inhale. Contraction (< 0) lowers and narrows it: the breath closes. |
| `centroidY` | The band sits higher for movement higher in the frame (up to ± half the Range); it holds where it was when the movement stops. |
| `spread` × Dispersion | Bandwidth: a spread-out movement with high Dispersion widens the band up to ×2.2. |
| `centroidX` | Pan (width from Dispersion); holds when the movement stops. |
| Stillness | Silence. |

#### Properties → parameters

| Property | Parameter (0 → 0.5 → 1) |
|---|---|
| Viscosity | Attack 15 → 61 → 250 ms; the band glides 30 → 122 → 500 ms and follows the movement's shape over 20 → 71 → 250 ms; the band's resting centre down 0 → ½ → 1 octave. |
| Elasticity | Band Q ×1.2 → ×1.56 → ×3.4 (narrower, more resonant); glide overshoot (glide Q 0.5 → 0.95 → 2.3); above 0.5 a whistle (a band-pass of Q 60 at the band's centre) rises out of the air, full at 0.95, as the air thins to a fifth. |
| Persistence | Release 30 → 155 → 800 ms; reverb send and decay 0.4 → 1.55 → 6 s (shared). |
| Dispersion | Bandwidth ×(1 + 1.2 · spread · d); the two decorrelated air streams spread ±0 → ±0.37 → ±0.85 in stereo; pan follows the movement ±25% → ±100% (shared). |
| Brightness | Resting band centre 500 Hz → 1.6 kHz → 5 kHz (before Viscosity's darkening; ≈ 350 Hz → 1.1 kHz → 3.5 kHz at baseline Viscosity); vowel formants move by half as many octaves. |
| Intensity | Level −15 / 0 / +9 dB; drive (tanh saturation) 0.3 → 0.8 → 3. |
| Range | Band travel 4 → 14 → 24 semitones, split between height in the frame (0.5) and opening/closing (0.55). |
| Density | Layers: the band; + a chest layer an octave below (from 0.2); + a hiss 1.5 octaves above (from 0.45). Loudness stays level. |
| Formant | None: plain air. "Ah": formants at 730 / 1090 / 2440 Hz (0 / −4 / −14 dB). "Oo": 300 / 870 / 2240 Hz (0 / −10 / −25 dB). With a vowel the plain band drops to 30%; formants follow half the band's movement and half its change in width. |

#### Notes

- Noise is seeded pink noise (two decorrelated channels, 5 s loop). It starts with the
  material's first schedule window at the buffer position of that composition time, so a
  preview played from the start and the render hear the same noise; after that it runs on
  continuously, never restarting on a seek or resync (a restart would click)
  (`shared/timelineNoise.ts`).
- Band levels are compensated for width (pink noise has the same power in every octave), so
  a narrow band isn't quieter just for being narrow; a closing breath loses only a little.
- Bands are mixed in pairs (`shared/graph.ts` `mixPairwise`), so renders are bit-identical.
- Each band's level comes before its filter, so a band at level zero (the whistle and the
  formants at baseline) gets silent input and Chrome stops running its filter. That halved
  Breath's render cost; at baseline it now costs about what Water does (a 10 s timeline in
  ~0.9 s on the builder's machine, ~11× real time).
- After a seek or a scheduler resync the level dips for about 40 ms while the band glides to
  its new place (`shared/seekDip.ts`), and its control buses anchor held values
  (`ControlBus`, which anchors its held value when cancelled): on noise, a leap in level or band would click.

### A4 Resonance

Struck and bowed bodies of glass, wood and metal. The signature's onsets strike the body; while
the movement lasts, it sings softly, as if bowed; when the movement stops, a damper settles on
it. Picker text: *"A body of glass, wood or metal, struck at each sudden movement and singing
softly while the movement lasts."*

Code: `src/materials/sound/resonance/` (`meta.ts` properties, `params.ts` mapping and body
tables, `program.ts` control program, `resonance.ts` audio graph, `modal.worklet.js` resonator
bank). Material id `resonance`, version 1.

#### What the wink sounds like (baseline)

Measured from offline renders of the synthetic wink (seed 1, not normalized):

| Body | Close strike (0.700 s) | Before the open | Open strike (1.233 s) | Tone |
|---|---|---|---|---|
| Glass | −12.9 dB RMS, peak −4.9 dBFS | −32.2 dB | −12.8 dB (+19 dB) | high and bright (centroid 1.4 kHz), rings about 2.6 s |
| Wood | −13.4 dB | −38.6 dB | −13.8 dB (+25 dB) | a dry knock (centroid 0.5 kHz), gone within half a second |
| Metal | −14.5 dB | −31.1 dB | −15.1 dB (+16 dB) | a low, dense hum (centroid 0.5 kHz), rings about 5 s |

Each body gives exactly two attacks, at the close and at the open. The pitch bounces with the
direction of the movement: glass's fundamental reads 777.6 Hz just after the downward close,
789.5 Hz just after the upward open, and settles at 781 Hz. The singing during the gestures is
soft (about −45 dB before the close strike), because a glass or bell takes time to swell; on
long movements it reaches about −20 dB.

#### Properties

| Property | Shown | Baseline | Description (as in Help) |
|---|---|---|---|
| Body | primary | Glass | What is struck: glass rings high and pure, wood knocks short and dry, metal hums long and shimmering. |
| Rigidity | primary | 0.5 | How stiff the body is: soft bodies ring in tune, stiff ones clang with out-of-tune overtones and harder strikes. |
| Elasticity | primary | 0.5 | How freely the body rings and springs: from a dead knock to a long ring that bounces in pitch when struck. |
| Viscosity | primary | 0.5 | How thick the medium around the body is: strikes are muffled, the ring is damped, and the singing follows the movement slowly. |
| Persistence | primary | 0.5 | How long the sound lingers after the movement stops: a longer release and a longer reverb tail. |
| Intensity | primary | 0.5 | How loud and driven the sound is. |
| Brightness | More | 0.5 | How bright the tone is: stronger high overtones and a more open filter. |
| Dispersion | More | 0.5 | How widely the sound spreads: overtones drift apart across the stereo field and shimmer against each other. |
| Density | More | 0.5 | How many resonances sound together, from a few pure tones to a rich, complex body. |
| Range | More | 0.5 | How far apart the body's resonances sit, from a tight cluster (compressed) to wide spacing (expanded). |

No shared property is hidden: each has a clear meaning for a resonating body. Rigidity is
promoted to primary (it is Resonance's headline mapping in SPEC 9.5) and Body is primary
because it changes the material most; Brightness and Dispersion move under "More" to stay
within six.

#### Signature → sound

| Signature | Sound |
|---|---|
| Onsets (sudden gathering) | a strike at the onset's exact time; velocity 0.45–1 from the onset's surge; the pitch bounces up or down with the direction of the movement (up = up) |
| Energy | bowed "singing": seeded noise excites the modes in proportion to energy (silent below a small gate) |
| Energy falling to stillness | the damper settles (release time from Persistence); the ring dies |
| Horizontal centroid | pan, wider with Dispersion; holds when the movement stops |
| Vertical movement at an onset | the direction of the pitch bounce |

#### Properties → sound

| Property | Resonance |
|---|---|
| Body | glass (G5, 784 Hz, long bright ring), wood (F4, 349 Hz, short dry knock), metal (A3, 220 Hz, long dense hum) |
| Rigidity | inharmonicity: modes on the harmonic series at 0, at the body's natural ratios at 0.5, twice as far off at 1; harder, brighter strikes |
| Elasticity | ring time ×0.12 … ×3.5 (the modes' Q); pitch bounce per strike 0 … ±90 cents |
| Viscosity | damping (ring ×1.4 … ×0.3, high modes most); muffled strikes (longer mallet); slower singing; darker filter |
| Persistence | damper release 0.12–10 s once the movement stops; reverb send and decay 0.4–6 s |
| Intensity | level −15 / 0 / +9 dB at 0 / 0.5 / 1, and drive (soft saturation) |
| Brightness | spectral tilt of the modes; brighter singing; low-pass cutoff |
| Dispersion | twin resonators per mode detuned 0–16 cents (shimmer) and spread across the stereo field, each mode balanced left/right; pan follows the movement more widely |
| Density | 6 … 12 sounding modes: the body's six core modes, then in-between modes |
| Range | spread of the modes around the fundamental: compressed cluster (log ratios ×0.45) … expanded (×1.45) |

How Rigidity and Range bend the modes: each natural ratio *b* has a harmonic reference *h* (the
nearest whole number, kept increasing); ratio = exp(*s* · (ln *h* + *a* · (ln *b* − ln *h*)))
with *a* = 2 × Rigidity and *s* from Range. Measured on glass, Rigidity 0.15 → 0.85 raises the
strike's spectral centroid from 1.2 to 1.45 kHz; Viscosity 0.15 → 0.85 lowers it from 1.9 to
1.1 kHz; Persistence 0.15 → 0.85 lifts the level 0.7 s after the movement from −101 to
−39 dB; Elasticity 0.15 → 0.85 lifts the close's ring just before the open from −36 to −27 dB;
Dispersion 0.15 → 0.85 raises the side/mid ratio from −16.5 to −11.5 dB.

#### Bodies

Twelve modes each, all within hearing; six core modes always sound and Density adds the
in-between ones.

| Body | Core ratios | In-between ratios | Ring (T60) at baseline | High-mode damping |
|---|---|---|---|---|
| Glass | 1, 2.32, 4.25, 6.63, 9.38, 12.5 (a wine glass's bending modes) | 1.52, 3.08, 5.36, 7.95, 11.1, 14.6 | 2.6 s | ratio^−0.45 |
| Wood | 1, 2.13, 3.99, 5.52, 9.2, 13.7 (a marimba bar's tuned partials and torsional modes) | 2.61, 4.72, 7.15, 10.9, 16.8, 20.1 | 0.55 s | ratio^−1.05 |
| Metal | 1, 1.97, 2.76, 4.08, 5.4, 8.93 (a free bar and a bell's octaves) | 1.52, 2.44, 3.27, 4.52, 6.19, 7.11 | 5 s | ratio^−0.3 |

#### Engine

- `modal.worklet.js` (`sp-modal-bank`): 12 modes × 2 complex one-pole resonators
  (z ← r·e^{iθ}·z + g·x, output Im z). A complex resonator keeps amplitude and phase continuous
  when its frequency changes, so the pitch bounce and live edits glide without clicks, and a
  strike starts each mode in sine phase. Mode frequency, ring time and gain are k-rate
  parameters; `damp` adds a decay rate. Strikes are `strike` trigger events (see
  `shared/triggers.ts`) carrying velocity, mallet time (a unit-area Hann pulse, 0.08–1.6 ms)
  and the bounce; `reset` fades every mode out in 2 ms. Bowed noise enters through the node's
  input, scaled per mode by √(1 − r²) so the singing level doesn't depend on the ring time.
  The processor is driven only through AudioParams; it stops when the material sets `alive` to
  0 on dispose.
- The control program (200 Hz grid) runs the singing envelope, the damper and the pan; strikes
  are ControlTimeline events at `sampler.onsetsBetween`.
- The bow noise is a looped, seeded buffer restarted at the position matching composition
  time, so the same moment is always bowed by the same noise: in a render, and in preview
  after any jump (preview follows the render with a loudness correlation of 1.000 and within
  0.03 dB).
- After a seek (including the engine's resync of a starved scheduler, which doesn't fade) the
  output dips (`shared/seekDipGain.ts`: out in 4 ms, silent to 25 ms, back in by 40 ms); the
  body is reset and the noise realigned under the dip, and the control buses glide from where
  they froze (`ControlBus` anchoring, `shared/seekDip.ts`). A render never seeks, so never dips.
- The twelve modes are summed inside the worklet in a fixed order, and no Web Audio input
  takes more than two sounding sources (see `mixPairwise`), so renders are bit-identical also
  at Density 1 and at the property extremes.
- Cost: the resonator bank uses about 2–2.5% of one core on the build machine (12 modes,
  bowed and struck); a 10 s timeline renders offline in about 1.4 s, 60 s in about 10 s.

#### To revisit with Freeman

- The balance between strike and singing, and how long glass and metal ring at baseline.
- Whether the pitch bounce (Elasticity) should follow the movement's direction or always dip
  after a strike, as real bells and gongs do.

### A5 Pulse

Rhythmic plucks and ticks. A pulse quickens with the movement's energy; every sudden movement
plucks at once; higher movement plays higher notes. Picker text: *"Rhythmic plucks that quicken
with the movement. Higher movement plays higher notes; sudden movements pluck at once."*

Code: `src/materials/sound/pulse/` (`meta.ts` properties, `params.ts` mapping, `program.ts`
control program, `pulse.ts` audio graph, `pluck.worklet.js` Karplus-Strong strings). Material
id `pulse`, version 1.

#### What the wink sounds like (baseline)

Measured from an offline render of the synthetic wink (seed 1, not normalized): silence until
the close, an accented pluck exactly at the close's onset (0.701 s, A4, peak −8.4 dBFS), then
an accented pluck exactly at the open's onset (1.234 s, B4, −8.2 dBFS) followed by one more
(1.371 s, E5, −10.7 dBFS), then silence (−61 dB half a second after the movement ends). The
open plays higher than the close because the eye rises out of the cheek's lower movement.
Across seeds the accents always fall on the two onsets; the other plucks change with the seed.

#### Properties

| Property | Shown | Baseline | Description (as in Help) |
|---|---|---|---|
| Rigidity | primary | 0.5 | At zero, pitch and timing float freely; raise it and the notes lock to the scale, then the pulses lock to a steady beat, with sharper attacks. |
| Range | primary | 0.5 | How much the pulse speeds up and the pitch travels with the movement, from steady and narrow to wide. |
| Density | primary | 0.5 | How many pulses sound: from sparse, scattered plucks to every pulse firing. |
| Persistence | primary | 0.5 | How long each pluck rings, and how long the reverb tail lasts. |
| Viscosity | primary | 0.5 | How thick the plucking feels: softer, darker plucks that follow the movement slowly. |
| Intensity | primary | 0.5 | How loud and driven the sound is. |
| Scale | More | Pentatonic | The notes the plucks may use: free pitch, a five-note scale, or a whole-tone scale. |
| Elasticity | More | 0.5 | How much each pluck twangs: its pitch bounces and settles like a plucked band. |
| Brightness | More | 0.5 | How bright the plucks are: more high overtones and a more open filter. |
| Dispersion | More | 0.5 | How widely the plucks spread: across the stereo field, and a little apart in tuning and in time. |

No shared property is hidden: each has a clear meaning for plucked strings. The primary six
are the controls SPEC 9.5 builds Pulse around (Rigidity, Range, Density, Persistence) plus
Viscosity and Intensity.

#### Signature → sound

| Signature | Sound |
|---|---|
| Energy | pulse rate, between Range's slowest and fastest rate; also each pulse's velocity |
| Onsets | an accented pluck at the onset's exact time (always sounds); the pulse clock restarts from it |
| `density` feature | each pulse's chance of sounding (seeded by the pulse's grid step, so it is the same in preview and render) |
| Vertical centroid | pitch: higher movement plays higher notes (up = higher), snapped to the Scale as Rigidity rises |
| Horizontal centroid | pan, wider with Dispersion |
| Stillness (0.1 s) | the pulse clock rests and restarts with the next movement |

#### Properties → sound

| Property | Pulse |
|---|---|
| Rigidity | pitch locks to the scale (from 0.15, fully at 0.45); timing locks to a steady grid (from 0.55, fully at 0.9); sharper, brighter plucks |
| Range | pulse rate span 4.9–7.3 Hz (narrow) … 1.7–20.8 Hz (wide), 2.9–12.4 Hz at baseline; pitch span 5 … 24 semitones; the grid is the fastest rate |
| Density | each pulse's chance of sounding: the movement's density × 0.15 … × 1.5 (plucks at onsets always sound) |
| Persistence | pluck ring time (T60 0.07–3.2 s at A4, a little shorter for higher notes); reverb send and decay 0.4–6 s |
| Viscosity | softer attacks (0.3–12 ms), darker plucks, slower rate and pitch following |
| Intensity | level −15 / 0 / +9 dB at 0 / 0.5 / 1, and drive (soft saturation) |
| Scale | Free (no snapping), major pentatonic, whole-tone (around A4) |
| Elasticity | pitch twang per pluck: starts up to 2.2 semitones sharp and bounces back at 9 … 6 Hz |
| Brightness | pluck brightness (string loop filter and pick noise); low-pass cutoff |
| Dispersion | plucks scatter across the stereo field around the movement's position; detune up to ±30 cents; delay up to 15 ms (less as the grid locks) |

Measured on the synthetic sweep: Density 0.15 → 0.85 raises the pulses per second from 0.8 to
4.6; Range 0.15 → 0.85 widens the pitch span from about 7 to 22 semitones and doubles the
pulse rate of fast movement; Viscosity 0.15 → 0.85 lowers the spectral centroid from 3.0 to
1.7 kHz and slows attacks; Persistence 0.15 → 0.85 lifts the level after the movement from
silence to −36 dB. At Rigidity 1 every pluck falls on the 80.8 ms grid (baseline Range); at
0.5 the accents fall exactly on the onsets.

#### Engine

- The control program (200 Hz grid, `program.ts`) decides every pluck: a pulse clock whose
  phase advances with the rate; onsets (looked up in the sampler for each step's slice of
  time, the same assignment the ControlTimeline uses for events) fire accents at their exact
  time; each pulse's time is kept to the sample, pulled toward the grid by Rigidity. All
  randomness is `hash32(seed, step, stream)`: no generator state, so seeks, live edits and
  offline renders draw the same values. Each step reports up to two plucks.
- `pulse.ts` writes each pluck as a `TriggerLane` event (see `shared/triggers.ts`) at the
  pluck's exact context time. At the first grid point after a start, seek or live edit, plucks
  before the window start are skipped (in the past, or already scheduled).
- `pluck.worklet.js` (`sp-pluck`): 16 Karplus-Strong strings, up to 12 sounding; a pluck's
  excitation is a seeded noise burst (one period plus the attack, low-passed by tone, combed at
  a pick position, windowed), the loop has a one-zero low-pass and a loss set from the ring
  time, the delay is read with 4-point Hermite interpolation (in tune within 6 cents from 110
  to 1320 Hz), and a string that gives way to a new pluck fades out over 4 ms. `reset` fades
  every string out in 2 ms. The processor is driven only through AudioParams; it stops when the
  material sets `alive` to 0 on dispose.
- After a seek (including the engine's resync of a starved scheduler, which doesn't fade) the
  output dips (`shared/seekDipGain.ts`: out in 4 ms, silent to 25 ms, back in by 40 ms) and the
  strings still ringing are reset under the dip. A render never seeks, so never dips.
- The seek fast-forward reaches 60 s back (the clock remembers its phase while movement goes
  on; it rests after any stillness anyway).
- The strings are summed inside the worklet in a fixed order and no Web Audio input takes more
  than two sounding sources (see `mixPairwise`), so renders are bit-identical also at Density 1
  and at the property extremes; preview follows the render with a loudness correlation of 1.000.
- Cost: the strings use about 0.5% of one core per ringing string and about 2.4% at the worst
  case measured (12 strings ringing, 20 plucks a second) on the build machine; a 10 s timeline
  renders offline in about 1.2 s, 60 s in about 4 s.

#### To revisit with Freeman

- How busy the pulse should be at baseline (Density and Range), and whether the close and open
  should each get more than one pluck.
- Whether pitch should also follow the direction of movement, not only where it is.

