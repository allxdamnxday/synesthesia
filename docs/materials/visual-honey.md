## V2 Honey

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

### Properties

| Property | Shown | Baseline | Meaning in Honey |
|---|---|---|---|
| Viscosity | Primary | 0.5 | How thick the honey is: thicker honey drags more of itself along, lags further behind and stops sooner. |
| Elasticity | Primary | 0.3 | How much the honey springs back toward where it was, and overshoots. |
| Persistence | Primary | 0.5 | How long the colors folded into the honey stay before they fade. |
| Dispersion | Primary | 0.5 | How unevenly the honey is pushed, so the wake spreads and folds. |
| Brightness | Primary | 0.5 | How luminous and saturated the colors are. |
| Intensity | Primary | 0.5 | How strongly the movement drags the honey. |
| Hue | Primary | 0.5 | Turns the colors of the honey around the color wheel; the middle keeps the palette as it is. |
| Density | More | 0.5 | How much color the movement folds into the honey. |
| Range | More | 0.5 | How large the movement is in the honey: small and centered, or magnified past the edges. |
| Palette | More | Amber | Amber, Dark honey or Pale gold. Each direction of movement has its own shade. |
| Surface light | More | 0.6 | The glossy sheen of light on the honey, as if looking up through the bowl. |

Hidden: **Rigidity**. Honey has no hard edges to make crisp, and its resistance to
flow is already Viscosity.

### Signature → Honey

| Signature | Honey |
|---|---|
| Field (per-cell motion) | Pushes the honey, low-passed by the lag time: the honey's steady speed is the push × mobility, spread by viscous diffusion and stopped by drag. Elasticity pulls displaced honey back. |
| Per-cell speed (the spatial `energy`) | Color released ∝ speed × Density, from the field as it arrives (not the lagged push), so the color marks the moment of movement. |
| Direction of the push | Color, by palette: down = deep amber, up = pale gold, sideways = honey orange and gold. Each spot's release is drawn out into a stroke along the push. |
| Stillness | Nothing moves and no color is released: the bowl stays black. |

### Properties → parameters

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
| Hue | Turn of the colors about grey where the honey is drawn (half a turn back → none → half a turn on): amber becomes green a third of a turn on, violet a third back. The sheen stays white. Display only: it shows at once while paused. |

Fixed: stroke length 0.06 short sides; speed limit 3 short sides/s; displacement limit
0.6 short sides.
