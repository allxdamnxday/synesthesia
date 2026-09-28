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

Material-by-material pages live in `docs/materials/`. The two first materials are below.

## Visual materials

| | Material | In a sentence |
|---|---|---|
| V0 | Signature | The bare wake: a short stroke per grid cell, pointing the way that part moves, brighter where it moves faster. Diagnostic; used on Prepare and selectable in the Studio. |
| V1 | Water | Colored dye in clear water, seen from below. |
| V2 | Honey | See `docs/materials/visual-honey.md`. |
| V3 | Smoke | See `docs/materials/visual-smoke.md`. |
| V4 | Descending bubbles | See `docs/materials/visual-bubbles.md`. |
| V5 | Filaments | See `docs/materials/visual-filaments.md`. |

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

## Sound materials

| | Material | In a sentence |
|---|---|---|
| A1 | Water | Quick, bright, rising: "Breee-weet!" |
| A2 | Honey | See `docs/materials/sound-honey.md`. |
| A3 | Breath | See `docs/materials/sound-breath.md`. |
| A4 | Resonance | See `docs/materials/sound-resonance.md`. |
| A5 | Pulse | See `docs/materials/sound-pulse.md`. |

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
