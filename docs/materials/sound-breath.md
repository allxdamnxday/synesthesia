## A3 Breath

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

### Properties

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

### Signature → Breath

| Signature | Breath |
|---|---|
| `energy` (normalized) | Level: silent below 0.012, then energy^0.6, with a soft attack (Viscosity) and a release (Persistence). |
| `divergence` (normalized, from the local expansion fit) | Followed (Viscosity) and trusted only while enough moves. Expansion (> 0) raises the band and widens it (up to ×2) and swells the level (up to +3.5 dB): the inhale. Contraction (< 0) lowers and narrows it: the breath closes. |
| `centroidY` | The band sits higher for movement higher in the frame (up to ± half the Range); it holds where it was when the movement stops. |
| `spread` × Dispersion | Bandwidth: a spread-out movement with high Dispersion widens the band up to ×2.2. |
| `centroidX` | Pan (width from Dispersion); holds when the movement stops. |
| Stillness | Silence. |

### Properties → parameters

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

### Notes

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
