# A5 Pulse (sound material)

Rhythmic plucks and ticks. A pulse quickens with the movement's energy; every sudden movement
plucks at once; higher movement plays higher notes. Picker text: *"Rhythmic plucks that quicken
with the movement. Higher movement plays higher notes; sudden movements pluck at once."*

Code: `src/materials/sound/pulse/` (`meta.ts` properties, `params.ts` mapping, `program.ts`
control program, `pulse.ts` audio graph, `pluck.worklet.js` Karplus-Strong strings). Material
id `pulse`, version 1.

## What the wink sounds like (baseline)

Measured from an offline render of the synthetic wink (seed 1, not normalized): silence until
the close, an accented pluck exactly at the close's onset (0.701 s, A4, peak −8.4 dBFS), then
an accented pluck exactly at the open's onset (1.234 s, B4, −8.2 dBFS) followed by one more
(1.371 s, E5, −10.7 dBFS), then silence (−61 dB half a second after the movement ends). The
open plays higher than the close because the eye rises out of the cheek's lower movement.
Across seeds the accents always fall on the two onsets; the other plucks change with the seed.

## Properties

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

## Signature → sound

| Signature | Sound |
|---|---|
| Energy | pulse rate, between Range's slowest and fastest rate; also each pulse's velocity |
| Onsets | an accented pluck at the onset's exact time (always sounds); the pulse clock restarts from it |
| `density` feature | each pulse's chance of sounding (seeded by the pulse's grid step, so it is the same in preview and render) |
| Vertical centroid | pitch: higher movement plays higher notes (up = higher), snapped to the Scale as Rigidity rises |
| Horizontal centroid | pan, wider with Dispersion |
| Stillness (0.1 s) | the pulse clock rests and restarts with the next movement |

## Properties → sound

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

## Engine

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

## To revisit with Freeman

- How busy the pulse should be at baseline (Density and Range), and whether the close and open
  should each get more than one pluck.
- Whether pitch should also follow the direction of movement, not only where it is.
