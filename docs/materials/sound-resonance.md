# A4 Resonance (sound material)

Struck and bowed bodies of glass, wood and metal. The signature's onsets strike the body; while
the movement lasts, it sings softly, as if bowed; when the movement stops, a damper settles on
it. Picker text: *"A body of glass, wood or metal, struck at each sudden movement and singing
softly while the movement lasts."*

Code: `src/materials/sound/resonance/` (`meta.ts` properties, `params.ts` mapping and body
tables, `program.ts` control program, `resonance.ts` audio graph, `modal.worklet.js` resonator
bank). Material id `resonance`, version 1.

## What the wink sounds like (baseline)

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

## Properties

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

## Signature → sound

| Signature | Sound |
|---|---|
| Onsets (sudden gathering) | a strike at the onset's exact time; velocity 0.45–1 from the onset's surge; the pitch bounces up or down with the direction of the movement (up = up) |
| Energy | bowed "singing": seeded noise excites the modes in proportion to energy (silent below a small gate) |
| Energy falling to stillness | the damper settles (release time from Persistence); the ring dies |
| Horizontal centroid | pan, wider with Dispersion; holds when the movement stops |
| Vertical movement at an onset | the direction of the pitch bounce |

## Properties → sound

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

## Bodies

Twelve modes each, all within hearing; six core modes always sound and Density adds the
in-between ones.

| Body | Core ratios | In-between ratios | Ring (T60) at baseline | High-mode damping |
|---|---|---|---|---|
| Glass | 1, 2.32, 4.25, 6.63, 9.38, 12.5 (a wine glass's bending modes) | 1.52, 3.08, 5.36, 7.95, 11.1, 14.6 | 2.6 s | ratio^−0.45 |
| Wood | 1, 2.13, 3.99, 5.52, 9.2, 13.7 (a marimba bar's tuned partials and torsional modes) | 2.61, 4.72, 7.15, 10.9, 16.8, 20.1 | 0.55 s | ratio^−1.05 |
| Metal | 1, 1.97, 2.76, 4.08, 5.4, 8.93 (a free bar and a bell's octaves) | 1.52, 2.44, 3.27, 4.52, 6.19, 7.11 | 5 s | ratio^−0.3 |

## Engine

- `modal.worklet.js` (`sp-modal-bank`): 12 modes × 2 complex one-pole resonators
  (z ← r·e^{iθ}·z + g·x, output Im z). A complex resonator keeps amplitude and phase continuous
  when its frequency changes, so the pitch bounce and live edits glide without clicks, and a
  strike starts each mode in sine phase. Mode frequency, ring time and gain are k-rate
  parameters; `damp` adds a decay rate. Strikes are `strike` trigger events (see
  `shared/triggers.ts`) carrying velocity, mallet time (a unit-area Hann pulse, 0.08–1.6 ms)
  and the bounce; `reset` fades every mode out in 2 ms under the engine's fade when playback
  starts or jumps. Bowed noise enters through the node's input, scaled per mode by √(1 − r²)
  so the singing level doesn't depend on the ring time.
- The control program (200 Hz grid) runs the singing envelope, the damper and the pan; strikes
  are ControlTimeline events at `sampler.onsetsBetween`.
- The bow noise is a looped, seeded buffer restarted on every start and seek at the position
  matching composition time, so the same moment is always bowed by the same noise: in a
  render, and in preview after any jump.
- Cost: the resonator bank uses about 2–2.5% of one core on the build machine (12 modes,
  bowed and struck); a 10 s timeline renders offline in about 1.4 s, 60 s in about 10 s.
- Deterministic: offline renders are bit-identical across runs and scheduling windows.

## To revisit with Freeman

- The balance between strike and singing, and how long glass and metal ring at baseline.
- Whether the pitch bounce (Elasticity) should follow the movement's direction or always dip
  after a strike, as real bells and gongs do.
