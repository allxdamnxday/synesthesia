## A2 Honey

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

### Properties

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

### Signature → Honey

| Signature | Honey |
|---|---|
| `energy` (normalized) | The movement itself (a quick follower, soft attack from Viscosity): the main part of the level (weight 0.75) and 80% of the filter's opening. The honey's own motion ("flow", a slow follower that keeps going after the movement): the drawn-out part of the level (weight 0.3), the stutter rate, a small pitch lift. |
| `surge` (normalized) | A sudden gathering (above 0.45, re-armed below 0.15) starts a new syllable at once: a 50 ms closure (the "B"), then a louder, brighter syllable (the accent). |
| Falling flow after a movement | The pitch sinks below the movement's peak (the "oot"); it relaxes back only once the sound has faded, so it is never heard rising again. |
| `flowY` (upward = −flowY) | Vertical travel (a leaky running total of upward flow): moving up raises the pitch, moving down lowers it, through a slow resonant glide. |
| `centroidX` | Pan (width from Dispersion); holds when the movement stops. |
| Stillness | Silence. The stutter keeps its phase, silently, so the next movement's syllables continue the rhythm. |

### Properties → parameters

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

### Notes

- The stutter, the "B" and the accents run in the control program (200 points per second),
  not in an oscillator, so preview and render stutter at exactly the same moments and a loop
  wrap carries the rhythm on.
- Voices are mixed in pairs (`shared/graph.ts` `mixPairwise`): with three or more sources on
  one input, Chrome's summing order varies between runs and renders differ in the last bits.
- After a seek or a scheduler resync the level dips for about 40 ms while pitch and filter
  glide to their new values (`shared/seekDip.ts`), and its control buses anchor held values
  (`ControlBus`, which anchors its held value when cancelled), so a starved scheduler can't click.
