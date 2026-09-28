## V3 Smoke

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

### Properties

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

### Signature → Smoke

| Signature | Smoke |
|---|---|
| Field (per-cell motion) | Pushes the air. |
| Per-cell speed (the spatial `energy`) | Smoke and heat given off ∝ speed. Most smoke leaves from a seeded pattern of small vents, drawn out along the push, so it comes off in threads the flow draws into wisps. |
| `divergence` (normalized −1..1) | Burst radius: smoke and heat are given off wherever the movement is within the radius base·2^(1.6·divergence), about ⅓× (contracting) to 3× (expanding) the base of 0.05 short sides. |
| Direction of the push | Tint: cool grey-blue falling, warm ivory rising, neutral sideways. |
| Heat (given off with the smoke) | Buoyancy: warm smoke rises (Rise), heat cools at 0.5/s; seeded eddies stir wherever it is warm. |
| Stillness | No smoke: the air stays black. |

### Properties → parameters

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
