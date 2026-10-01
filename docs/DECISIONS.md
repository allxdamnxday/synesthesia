# Decisions log

Record every non-trivial decision: date, decision, why, alternatives considered.
Freeman reviews this after handover.

## 2026-09-28: Input method for v0 is a recorded clip
- **Decision:** v0 accepts recorded clips only; live camera is deferred.
- **Why:** the first investigation holds one captured signature constant; recorded input
  is reproducible, debuggable, and matches the album workflow.
- **Alternatives:** live camera feed (deferred to a later signature source).
- **Revisit with Freeman:** yes.

## 2026-09-28: Platform is a browser app, not TouchDesigner
- **Decision:** static web app (Vite + React + WebGL2 + Web Audio + WebCodecs) in Chrome.
- **Why:** $0 budget; identical on Windows (builder) and macOS (artist); no license
  change if the album is ever sold; MP4 export works on Mac without an Nvidia GPU.
- **Alternatives:** TouchDesigner (free tier resolution-capped and non-commercial;
  realtime H.264 export needs Nvidia); Max/MuBu (paid, second app to learn).

## 2026-09-28: Toolchain versions (TypeScript 6, Vitest 4, Node 25 for now)
- **Decision:** pin TypeScript 6.0.3 (not 7.x) and Vitest 4.1.11 (not 5.x). Develop on the
  builder's installed Node 25; `.nvmrc` recommends Node 24 LTS.
- **Why:** `typescript@latest` is 7.0 (the Go port), but typescript-eslint 8.71 supports only
  TypeScript `<6.1`. Vitest 5 does not support Node 25 (its engines allow `^22.12 || ^24 ||
  >=26`), while Vitest 4.1 does. Node 25 reached end-of-life in June 2026, so the builder
  should move to Node 24 LTS; once on 24 or 26, Vitest can move to 5.
- **Alternatives:** TypeScript 7 with no type-aware linting (loses floating-promise checks,
  which matter in heavily async WebCodecs/Web Audio code); forcing Vitest 5 on an
  unsupported Node.

## 2026-09-28: End-to-end tests drive installed Google Chrome, not bundled Chromium
- **Decision:** Playwright uses `channel: 'chrome'`.
- **Why:** Playwright's bundled Chromium lacks proprietary codecs (H.264, AAC), which clip
  import and MP4 export depend on. Google Chrome is also what Freeman uses. On the
  builder's machine, headless Chrome 153 runs on the real GPU (NVIDIA GTX 1660 SUPER via
  ANGLE/D3D11) and supports H.264 encode at 1080p and 720p, AAC and Opus encode, and H.264
  and HEVC decode, so headless runs are faithful.
- **Alternatives:** bundled Chromium (can't test codecs); Chrome for Testing downloads.

## 2026-09-28: OpenCV.js 4.13.0, the official single-file build
- **Decision:** vendor `https://docs.opencv.org/4.13.0/opencv.js` (10,964,323 bytes, SHA-256
  in `docs/THIRD_PARTY.md`) at `public/vendor/opencv/`.
- **Why:** SPEC asks for a pinned official 4.x build. 4.13.0 is the only pinned 4.x build
  OpenCV still hosts (the 4.10–4.12 URLs now return 404). Its JS export list includes
  `calcOpticalFlowFarneback`. It embeds the WebAssembly and uses no threads, so it needs
  no special server headers (GitHub Pages and Vercel both work).
- **Alternatives:** OpenCV 5.x (outside the SPEC's 4.x pin, 16 MB); npm repackagings such as
  `@techstark/opencv-js` (not the official build).

## 2026-09-28: Hash-based routing with no router library
- **Decision:** screens are addressed as `#/studio/<id>` etc. by a ~60-line router in
  `src/app/router.ts`.
- **Why:** no router is on the approved dependency list; hash URLs work on any static host
  without rewrite rules; the app has only a handful of screens.
- **Alternatives:** React Router (unapproved dependency); history-API routing (needs a
  404 fallback on GitHub Pages).

## 2026-09-28: Chrome 150 is the feature floor
- **Decision:** don't rely on web platform features newer than Chrome 150.
- **Why:** Chrome 150 was the last release for macOS 12 Monterey; Chrome 151+ needs macOS 13.
  If Freeman's MacBook Pro runs macOS 12, its Chrome is frozen at 150. (A 2017 MacBook Pro
  can run macOS 13, which keeps Chrome current.) Diagnostics reports both versions.
- **Alternatives:** target only current Chrome (risks a blank feature on Freeman's Mac).

## 2026-09-28: Accessible secondary text colour ("Mist")
- **Decision:** add `--color-mist #9AABB5` for secondary text and `--color-alert #E8806A` for
  failed checks and errors. Silt stays for dividers and decoration.
- **Why:** SPEC 13.2's Silt (#5E6F7A) is only 3.4:1 on Deep, below the SPEC's own WCAG AA
  floor for text. Mist is 7.4:1 on Deep and 6.5:1 on Basin; Alert is 6.5:1 on Deep.
- **Alternatives:** use Silt for text anyway (fails AA).

## 2026-09-28: Spike and harness pages ship in development builds only
- **Decision:** `spikes/<name>/index.html` and `dev/<name>/index.html` are built as extra
  pages unless `SP_RELEASE=1`, so they can be opened on a test Mac from a static host.
- **Why:** WebCodecs, AudioWorklet, the clipboard and folder saving need a secure context
  (HTTPS or localhost), so a Mac can't simply open the dev server over the LAN.
- **Alternatives:** separate build config for spikes (more to maintain).

## 2026-09-28: Capability checks run real tests, and the startup gate blocks only on certainty
- **Decision:** Diagnostics confirms H.264 export (720p, 1080p, square) and AAC with tiny
  real encodes (packets must come out), not only `isConfigSupported`. Half-float support
  means RGBA16F is renderable, keeps values outside 0..1, and filters linearly (checked by
  readback). The startup gate blocks only when WebGL2, half-float targets or Web Audio +
  AudioWorklet definitely fail; a check that throws or times out is a warning.
  Diagnostics stays reachable while blocked. Safari/Firefox get a dismissible notice.
- **Why:** hardware encoders can accept a configuration and still fail; extension lists
  can lie; a false lockout on Freeman's Mac would be worse than a warning.
- **Alternatives:** trust support queries and extension lists; block on any non-pass.

## 2026-09-28: AAC bitrate and render quality
- **Decision:** try AAC at 192, 160, 128, 96 kbps and use the first that encodes (Windows'
  Media Foundation accepts only those four). Fall back to Opus with a warning that
  QuickTime may not play the audio. Video uses Mediabunny `Quality('high')` (quantizer
  mode where supported); the Diagnostics check uses the same settings the render will.
- **Why:** measured on the builder's machine: 192 kbps works; 64, 256 and 320 are refused.
  Spike 3 files: H.264 High, 90 frames, AAC-LC 48 kHz stereo, `moov` before `mdat`,
  flash and click aligned to 0.0 ms.
- **Alternatives:** fixed 128 kbps; explicit video bitrates (more predictable file sizes).
- **Watch on the Mac:** Chrome on macOS encodes AAC with AudioToolbox, which usually primes
  2112 samples (~44 ms). If spike 3 shows about +44 ms there, the render must compensate.

## 2026-09-28: Extraction runs entirely in one worker; OpenCV loads by fetch + eval
- **Decision:** OpenCV.js loads inside a module worker by fetching the self-hosted file and
  evaluating it (classic-worker `importScripts` as fallback). Its Emscripten module is
  never awaited directly (its `then` resolves to itself). Decoding (Mediabunny) also stays
  in the worker; one worker lives between jobs; Cancel terminates it.
- **Why:** spikes 1 and 2 passed in dev and in the build with no special headers. Measured
  here: OpenCV ready in ~0.5 s warm (0.9 s cold), longest main-thread gap 18 ms, blur +
  Farneback 18.8 ms per 320×180 frame, heap flat over 200 runs; frame-accurate decode of
  H.264 MP4/MOV with B-frames, 29.97 fps portrait with rotation metadata, and HEVC; all
  samples closed. A 10 s landscape clip extracts in ~9 s.
- **Alternatives:** main-thread decode with worker compute (SPEC 7.4 fallback; also works).

## 2026-09-28: Extraction details
- Frames are sampled at the middle of each 1/fps interval over the trim (no rounding onto
  the previous frame; variable-frame-rate clips become constant-rate). Native fps comes
  from packet statistics.
- Frames are drawn with Mediabunny's CanvasSink using one combined orientation (container
  rotation → user rotate → mirror), cropped to the focus area at native resolution, then
  downscaled (mipmapped) and converted to grayscale (BT.601).
- The trim is clamped to the clip's first and last frames and stored clamped.
- Extraction smoothing uses a truncated window at the clip's ends (a shrinking symmetric
  window left end frames raw and caused false onsets).
- Error model: format problems show SPEC 8.1's message; over-60-s clips have their own
  message; other failures show a plain message with technical detail for Diagnostics.

## 2026-09-28: Three corrections to SPEC 8.2's feature definitions
SPEC 8.2 states the intent of each feature; three formulas didn't deliver it, so the
implementation follows the intent. To revisit with Freeman only if a material feels wrong.
- **Divergence and curl** use a magnitude-weighted affine fit of the moving cells (trace
  for divergence, antisymmetric part for curl) instead of grid means. Why: by the
  divergence theorem, the grid mean of ∂u/∂x + ∂v/∂y only measures flow crossing the frame
  border, so a wink inside a focus box read as neither expanding nor contracting.
- **Onsets** need surge above both 2.5 σ(surge) and 3 × p95(energy) per second, and the
  frame's peak (not its mean energy) above the noise floor, with the 100 ms refractory
  period. Why: σ alone made steady movement fire onsets on tiny wobbles, and comparing a
  whole-frame mean to a per-cell floor could hide small movements entirely.
- **Analysis width applies to the longer side** of the (oriented, cropped) frame. Why:
  portrait clips analysed at 320 wide cost 3.3× landscape (~25 s for 10 s here, likely
  over the 60 s budget on a 2017 MacBook Pro); faces are usually filmed in portrait.
- The automatic noise floor still assumes some stillness; clips that move the whole time
  (water, curtains) get a hint on Prepare to raise Sensitivity manually.

## 2026-09-28: Library storage and file handling
- **Decision:** IndexedDB adds a `signatureMeta` store of lightweight list entries (name,
  dates, hash, duration, grid, thumbnail) written in the same transaction as the signature,
  so the Library lists without loading multi-megabyte fields. Persistent storage is
  requested on the first save, not at startup.
- **Import rules:** files keep their id unless it's taken; identical movement already in
  the library is recognised, never duplicated; imports never overwrite. Deleting a
  signature never deletes compositions: they wait and reconnect (by content hash) when the
  signature returns. Renaming a signature updates the name stored in its compositions.
- **Backup:** `.spbackup.zip` holds a manifest plus one file per item; restore checks
  everything (including hashes) before writing, in one transaction. Settings and the
  Studio's working state are not backed up.
- **Thumbnails** draw each cell's speed-weighted axis of motion (a plain time average
  cancels back-and-forth movement, so a wink drew almost nothing).
- **Hashing:** −0 hashes as +0, because JSON writes −0 as 0.
- **Alternatives:** list full signatures; overwrite on import; cascade deletes.

## 2026-09-28: Sampler semantics
- The tail holds the last frame actually played (frame 0 after a reversed pingpong pass);
  direction interpolates and smooths on the circle; times before 0 rest on frame 0;
  normalization is applied after strength, so strong settings saturate. Smoothing repeats
  edge frames and is cached per window size.
- **Why:** correct behaviour at ±π, and no jump in pan or position when the tail starts.
- The synthetic test signatures now run through the real pipeline and sampler.

## 2026-09-28: Fluid solver and Water: how the wake looks
- **Range projection:** at 0.5 the signature's field is fitted inside the canvas with its
  aspect kept (never cropped or stretched); Range scales it exponentially from 0.4× to
  2.5×, and movement speed scales with it.
- **Dye color follows the direction of movement** (palette textures), so a close and an
  open read as two colors: ultramarine falling, sea-glass rising (Deep water palette).
- **Dye is released from a seeded pattern of fixed spots**, each smeared along its motion,
  so the wake draws streaks that trace the flow instead of a flat cloud.
- **True viscosity** (implicit Jacobi diffusion) with iterations scaled by grid size so every
  quality tier looks equally viscous; Viscosity also adds drag and some lag so the slider
  visibly does what it says. The pressure step uses the textbook ½ factor.
- **No bloom:** a soft tone curve gives glow; "Surface light" adds shading and glints from
  the dye's thickness (fits a 2017 integrated GPU).
- **Water's primary properties** are viscosity, persistence, dispersion, brightness,
  intensity and density; range, palette and surface light sit under "More" (SPEC 9.2 lists
  Range as "More" and Density as "More"; Water promotes Density because dye amount is one of
  its most visible controls). Elasticity and rigidity are hidden for Water.
- **Baseline is a dark bowl** (about 7% mean brightness mid-wink): the wake glows out of
  black. Brightness raises it.
- **Measured here:** 59–60 fps on every tier at 1× and 2× resolution; a step costs
  0.1–0.5 ms of GPU time. The benchmark takes about 3 s. Visual determinism: identical
  frame hashes across runs, instances, sessions and builds on the same machine.
- **Canvas contexts** are opaque, not anti-aliased, `high-performance` (the discrete GPU on
  dual-GPU MacBook Pros), created in code and released by their owner.
- **Alternatives:** stretch or cover projection; time-cycling colors (the original);
  uniform dye release; bloom.

## 2026-09-28: Sound engine
- **Control programs on a 200 Hz grid.** Each sound material's control logic is a pure state
  machine run by a shared `ControlTimeline`; preview (50 ms scheduler, 200 ms lookahead) and
  offline render (one call up to 60 s, 5 s windows beyond, because Chrome renders one long
  automation list in quadratic time) produce identical automation. A seek resets and
  fast-forwards the state; loop wraps and live edits carry it on. Offline renders are
  bit-identical across runs and window sizes; preview differs only in oscillator phase.
- **Limiter:** a WaveShaper soft clip (linear below 0.8, tanh above) instead of
  `DynamicsCompressorNode`, which pumps and colours quiet material.
- **Clock:** the AudioContext asks for 48 kHz with the 'interactive' latency hint; the visual
  preview follows `compositionTimeAt(rAF timestamp)` (output-latency compensated).
- **Transport:** loop wraps carry the sound's state on; a seek dips the output 8 + 5 + 8 ms (every jump stays silent for one 5 ms control step);
  pause and play fade over 12 ms (no clicks).
- **Intensity:** −15 / 0 / +9 dB around each material's calibrated level, plus drive.
- **Water (A1):** pitch follows vertical travel (a running total of upward flow that leaks
  home only when vertical movement stops), so rising movement keeps rising and ends high
  ("-weet!"); onsets add short rising "droplets"; Rigidity (baseline 0 for water) snaps
  pitch to a pentatonic scale and sharpens attacks.
- **Render normalization** (SPEC 9.1): renders peak-normalize to −1 dBFS by default. The
  render dialog's "Even out loudness" toggle explains that turning it off keeps quiet
  compositions quiet, because normalization otherwise cancels Intensity's loudness in
  exports.
- **Alternatives:** `setTargetAtTime` smoothing alone (can't express asymmetric envelopes or
  springs); the whole synth in an AudioWorklet; Tone.js (not approved); velocity-based
  pitch (arches back down as a movement slows).

## 2026-09-28: Onset and hint thresholds (refinements)
- Onsets also require the frame's peak to exceed **2 ×** the noise floor (not 1 ×): the
  automatic floor sits right at camera noise's strongest cells, so 1 × fired on noise. 2 × is
  where the soft threshold starts passing cells untouched.
- The Prepare hint (automatic sensitivity may be hiding movement) appears only when the
  floor is automatic, above 0.02 field diagonals per second, and high relative to the clip's
  movement, so still or lightly noisy clips don't trigger it.
- Synthetic test signatures skip extraction smoothing (their analytic fields are already
  smooth; smoothing merged the wink's two onsets).
- A small movement covering under ~5% of the frame can't produce onsets under the peak rule;
  a focus area around it fixes that (and is the recommended way to capture a wink).
- Grid columns (default 32) apply to the longer side of the frame, like the analysis size,
  so portrait signatures are 18×32 rather than 32×48 (about 2.6× smaller files).

## 2026-09-28: Prepare screen
- The clip preview is muted (the instrument's sound comes from the sound materials; the
  clip's own audio isn't part of the signature).
- Trim snaps to frames (4-frame minimum); the preview loops inside the trim. Clips over 60 s
  open with their first minute selected; Extract stays disabled with a plain message while
  the selection is longer than a minute.
- Speed also sets the preview's playback rate and stays adjustable after extraction until
  the signature is saved (`preferredSpeed` isn't part of the content hash).
- The focus box turns and flips with the picture when Rotate or Mirror changes, so it stays
  on the same part of the clip. Arrow keys move it; Option/Alt+arrows resize it.
- Manual Sensitivity is logarithmic (0.1 → 0.001 field diagonals per second, 50% = 0.01),
  described as "% of the frame per second"; after an automatic extraction the manual slider
  starts from the floor Automatic found.
- Before saving, the button reads "Save and open in Studio", so nothing unsaved reaches the
  Studio; closing the tab with an unsaved signature asks first.
- Direction is drawn as a row of arrows averaged from the flow (a line of the angle jumps at
  ±180° and means nothing when still).
- Previews play one pass, looping, with no tail and no extra smoothing; they wait for Play
  when the computer asks for reduced motion.

## 2026-09-28: Honey and Smoke
- **Honey** is Water's solver made thick: the push is low-passed (lag), drag stops it soon
  after the push ends, and viscosity is an exact per-step Gaussian diffusion (plain Jacobi
  can't converge at honey viscosity). Its colour is released on time and drawn out into
  strokes, so the wink's timing stays legible while the flow lags. **Elasticity** is
  implemented (a displacement field carried with the flow plus a damped spring), stable
  across tiers and seeds; baseline 0.3 (at 0.5 it springs back before the open and blurs
  the wink). Rigidity is hidden (honey has no edges to make crisp).
- **Smoke** gives off smoke and heat where the movement is, from small seeded vents drawn
  into wisps; expansion widens the puff; Rise (primary, baseline 0.7) sets buoyancy, and
  below the middle smoke sinks. Its flow is solved on a fixed 64-cell grid at every tier
  (finer grids didn't converge and looked different per tier), so previews and High renders
  show the same motion. Fixed pale tints, cool for downward pushes and warm for upward.
- Measured here: 60 fps on every tier at 1× and 2× for Water, Honey and Smoke. Smoke's cost
  is flat across tiers (64 pressure passes); it's the one to watch on a 2017 Mac.

## 2026-09-28: Album mode
- Default pairing is "Every pairing once" (25 tracks = 5 × 5); the Signature diagnostic view
  isn't eligible by default. Kept tracks are pre-selected for batch rendering.
- Status and notes live on each track's composition; an album's "last changed" is its
  latest change or any track's. Deleting an album keeps its compositions unless the person
  ticks the box. Tracks whose composition was deleted keep their place, marked missing.
- Batch render runs tracks one after another; a failed track never stops the batch; pause
  holds between frames; the folder is chosen once per session. "Even out loudness" and the
  composition sidecar default to on for albums.
- Export album log saves `ALBUM_LOG.md` and `.spalbum.json` with one click (Chrome asks once
  whether the site may download multiple files). Album files can be imported from the
  Library.

## 2026-09-28: MP4 render
- **Fast start everywhere:** Mediabunny `fastStart: 'reserve'`, so even files streamed into a
  folder have their index at the front.
- **Sound interleaved with frames:** the rendered sound goes to the encoder in 1 s pieces
  about a second ahead of the frames (spike 3's finding about streaming), rather than after
  all frames as SPEC 10.2 words it. Sound length matches the video (N/fps).
- **Every file has both tracks:** a muted field renders black frames or silence; with no
  sound codec at all, the file is video only rather than refused.
- **Never overwrite:** " (2)" etc. (case-insensitive), with the MP4 and sidecar sharing the
  number; cancel or failure deletes the partial file.
- **Background tabs:** the frame loop yields with a message channel, not a timer, so Chrome's
  background-tab throttling can't stall an album render.
- **Measured here:** 720p30 4.3–5.8 ms per frame, 1080p30 6.3–7.9 ms; a 10 s 1080p track in
  ~3.5 s, so a 25-track album in ~1.5 minutes (a 2017 Mac is likely 5–10× slower). Repeat
  renders give identical frames (framemd5) and identical decoded sound. Sound and picture
  align within one frame at onsets (the picture trails by ≤ 1 frame, from fixed-step timing).
- **Watch on the Mac:** AudioToolbox's AAC priming (~44 ms); if measured, start the audio at
  minus the delay (Mediabunny trims it with an edit list).

## 2026-09-28: Honey and Breath sounds
- **Honey:** a hum at A2 through a resonant low-pass; the stutter is computed per control step
  (so preview and render stutter at the same moments), its rate following the honey's own
  slow, lagging motion (2–7 Hz); every onset starts a new syllable with a brief closure
  (the "B" of "Broo"); the "oot" is a fall below the movement's peak; stacked voices sit on
  harmonics (unison voices at 110 Hz beat slowly). Stutter depth is primary; Rigidity hidden.
- **Breath:** seeded pink noise through a band of air; expansion swells the breath and opens
  the band, contraction closes it; the band follows height; bandwidth follows spread ×
  Dispersion; Elasticity narrows it and above 0.5 a whistle rises; Density adds a chest layer
  and a hiss; Formant None / Ah / Oo. Rigidity hidden.
- **Loudness calibration** by RMS against Water on the wink: Honey ~5 dB above Water (a low hum
  sounds quieter), Breath ~3 dB below (noise sounds louder).
- **Mixing rule (determinism):** never feed more than two sounding sources into one audio
  input; Chrome sums three or more in an order that depends on memory addresses, which makes
  renders non-bit-identical. Use `mixPairwise`.

## 2026-09-28: Descending bubbles and Filaments
- **Density sets the count; the quality tier only caps it** (bubbles 1,500 / 4,000 / 8,000;
  filaments 150 / 400 / 800), so a Draft preview at baseline matches a High render. In a
  Draft preview, Density has no further effect above ~0.6 (the cap binds); renders show more.
- **Bubbles:** Persistence wears out and pops the bubbles the movement pushes (they re-form on
  their path) and sets how long their glow lasts, rather than a lifetime for every bubble
  (which emptied the water at low Persistence). Elasticity springs each bubble back toward
  its falling path. Bubbles stretch with speed and glow in the direction colors (not
  physical, but it makes the close and open readable, matching Water). Rigidity hidden.
- **Filaments:** Rigidity (bending stiffness) is primary and Dispersion moves under More.
  Strands rest along a flow that points every way rather than hanging down (hanging strands
  made the close and open look unequal). Each segment paints the area it sweeps into a
  fading half-float buffer (8-bit fallback) that advances only in `step()`. Still strands
  skip the solve until the movement reaches them.
- **Randomness:** one PRNG draw per step, with per-particle values hashed from it, so draws
  never depend on the particle count.
- Measured here: 60 fps on every tier at 1× and 2×, even at Density 1.

## 2026-09-28: Studio
- **Clock:** the sound engine is the master once its material has loaded; a wall clock with the
  same loop and end behaviour stands in before that and when there's no playable sound, and
  the handover keeps the playhead. Picture and sound share one sampler configured by
  `samplerConfigFor()` (the same helper the render uses).
- **Seek:** reset and fast-forward without drawing, with an adaptive step budget (8–600 steps
  per frame, halving on slow frames, 12 ms CPU cap) and "Catching up…" after 0.5 s; a small
  backward jitter of the audio clock is ignored; the playhead holds at a seek target until
  the sound arrives. Going forward from an untouched state simply continues.
- **Edits while playing:** property edits affect the preview from now on and apply from t = 0
  at the next loop or seek; Movement changes re-seek at once.
- **Quality:** the preview's pixel ratio is capped at 1 / 1.5 / 2 by tier (Retina smoothness);
  the first Studio visit measures the computer ("Getting to know this computer…").
- **Loop is on by default** (a session setting): the artist watches the same movement again
  and again.
- **Linked layout:** Visual, then the Linked toggle with a "Both" group, then Sound. A shared
  property is in Both if either material uses it (primary if either shows it as primary).
- **Switching materials keeps shared values** the new material doesn't use, so switching to
  the Signature view and back loses nothing.
- **Chance:** the pool excludes the Signature view; only shared properties lock (material-
  specific ones stay playable); the same seed repeats the same draw ("New seed" draws again).
- **Undo** covers the wake (materials, properties, Movement, seed, Linked, mute/solo, chance,
  unlocks, snapshot recall); name, notes and status are saved and autosaved but aren't undo
  steps. **Autosave** keeps one record per composition (or per signature for new work);
  restoring shows a notice with "Discard changes" (confirmed).
- **Thumbnail:** 320×180 JPEG at Standard, 0.25 s after the peak moment (at the peak itself the
  wake hasn't formed yet).
- **Presentation:** full screen with a window-covering fallback; the pointer hides after 2 s;
  a quiet "Present" button makes the mode findable without Help.
- **Keys:** Space plays/pauses even when a button has focus (switches and choices keep Space);
  letter shortcuts fire only without modifiers; Cmd/Ctrl+S also saves; Ctrl+Y redoes.
- **Save as new** saves "‹name› copy" and opens it. Saving records the installed material
  versions (after the "this material has changed" notice).

## 2026-09-28: Resonance and Pulse sounds
- **Resonance:** a bank of 12 modes in an AudioWorklet (each a pair of slightly detuned
  resonators, so pitch bends without clicks); onsets strike at the exact sample, seeded noise
  bows while the movement lasts, a damper settles when it stops. Bodies: Glass (G5), Wood (F4),
  Metal (A3). Rigidity sets inharmonicity (in tune at 0, the body's natural ratios at 0.5) and
  strike hardness; Elasticity the ring time and a pitch bounce that follows direction.
  Body and Rigidity are primary; Brightness and Dispersion move under More.
- **Pulse:** Karplus-Strong strings in an AudioWorklet; a pulse clock quickens with energy
  (Range sets its span); every onset plucks an accent that always sounds and restarts the
  clock (this keeps the wink's timing clear); other pulses sound by seeded chance from the
  density feature × Density; pitch follows height; Rigidity first snaps notes to the Scale
  (0.15–0.45), then pulls timing onto a steady grid (0.55–0.9). Scale defaults to Pentatonic.
- **Worklet events** are AudioParam triggers, never port messages; Pulse's randomness is
  `hash32(seed, step, stream)` with no generator state, so seeks, live edits and renders
  draw the same values. Both are bit-identical at every property extreme.

## 2026-09-28: Offline after the first visit
- **Decision:** vite-plugin-pwa precaches the whole instrument (app code, the extraction
  worker, the render chunk, OpenCV.js, fonts, worklets, the sample signature) on the first
  visit; the service worker updates itself on the next visit. Spike and harness pages stay
  out of the cache. End-to-end tests block service workers except the offline test.
- **Why:** SPEC C5. OpenCV.js (11 MB) is fetched in the background by the service worker
  after the page has loaded, so the first page load stays fast and extraction still works
  offline later (SPEC 14.3 asked for OpenCV to load lazily; this keeps the page load lazy
  while making it available offline).
- **Verified:** with the network cut after one visit, the Library, Help and a full
  extraction work (tests/e2e/offline.spec.ts).
- **Alternatives:** cache OpenCV only after the first extraction (offline extraction would
  fail until then); no offline support.

## 2026-09-28: Sound engine hardening
- **Mixing rule, measured:** at most two sounding sources per audio input, and an AudioParam's
  own non-zero value counts as one of the terms (a gain at 0.37 with two connections rendered
  two ways in twelve renders). Water's voices meet through `mixPairwise`; one-shot events
  (droplets, strikes) go through `OneShotMix` (16 slots mixed in pairs, slot chosen from the
  events' times alone). Water stays version 1: every setting that was already deterministic
  renders the same bits.
- **Stalls:** `ControlBus.cancelFrom` anchors the held value when cancelled after its last
  point; a starved scheduler resyncs with the same dip as a seek; every jump stays silent for
  one control step. During a stall the sound holds its last values, then dips cleanly (a
  freeze rather than a dropout).
- **Live edits** start at least 4 samples away from any control point: Chrome renders
  automation rewritten exactly on a point wrongly (all of Breath's buses dropped to ~0 for one
  sample, a loud click, about one edit in fifteen).
- **Head start:** 0.5 s is scheduled ahead at play and at a material switch.
- **Reverb rebuilds** (e.g. while dragging Persistence) run after the current task, at least
  150 ms and twice their own measured cost apart, in two steps (impulse response, then a new
  convolver on the silent side), waiting for small changes until the value is steady; recent
  responses are cached (16 MB). With the CPU throttled 2×, scheduler resyncs during drags went
  from 7 in 12 to 0.
- **Lookahead:** the preview scheduler keeps 0.35 s of sound written ahead (SPEC 9.1 suggests
  ~0.2 s) for slack on slower Macs; live edits aren't delayed, since they reschedule from now.
- **Known limit:** on a busy machine, dragging Persistence can still let the schedule run dry
  once in a while (a long reverb rebuild takes tens of ms on the main thread). The resync is
  click-free: a ~21 ms dip. The stall test allows one per drag and checks every step for
  clicks. If it's noticeable on Freeman's Mac, generate impulse responses in a worker.
- **Alternatives:** generating impulse responses in a worker; shorter responses during drags;
  a watchdog fade the moment the schedule runs out (a dropout instead of a freeze).

## 2026-09-28: Seeks: the click check, and strikes just after a landing
- **Resonance's intermittent seek "click" was the output limiter, not a click.** After a jump
  the preview keeps the reverb tail of what played before it (every material; a render never
  has it). At the test's loud settings (Metal, everything at 0.9) that tail (~0.2 rms) lifted
  the new sound's loudest peak, 127 ms after the jump, into the master soft clip, and the soft
  clip rounding it read as roughness to the second-difference check: 0.065–0.077 in about half
  the runs, against 0.063 allowed. Before the limiter the same seek measured 0.034–0.036
  (renders 0.035); with the limiter kept linear, 0 of 12 runs failed. A sweep of 23 seek
  targets found nothing at the reset, the dips or the fades.
- **Decision:** the sound harness also measures clicks before the limiter (an exact inverse of
  its curve, identical below its knee), and the click-free test checks seeks with it. The
  threshold and every other check are unchanged. It then passed 10 runs in a row.
- **Strikes just after a landing:** Resonance and Pulse silence their body or strings a few ms
  after a jump, under their own dip. A strike or pluck due in that gap was erased with them
  (15–23 dB quieter than the render until the next onset); it now starts together with the
  reset, still in silence. And a jump landing exactly on a control point used to move a few
  samples later, skipping an onset exactly at the target (onsets sit on frame times, often on
  the grid; the scrub bar's arrow keys step whole seconds). It now moves a few samples earlier
  (later only near 0, where no onset can be). A new E2E check seeks onto the wink's close and
  3 ms before it; it fails by 15–23 dB with any of the three fixes undone. Renders are
  bit-identical (hashes compared before and after), so no material version changes.
- **Left as is:** the old reverb tail rings on across a seek in every material, as in most
  audio software. Cutting it would need a new convolver at every seek; revisit if it bothers.
- **Alternatives:** relaxing the threshold (would hide real clicks too); checking every action
  before the limiter (broader than the one affected case); lowering the harness's master gain
  (changes the signal path under test).

## 2026-09-29: The user guide inside the app
- **Decision:** a Guide page (`#/guide`, and `#/guide/<section>` for each section) renders
  `docs/USER_GUIDE.md` itself, bundled with Vite's `?raw`, so the document and the page can't
  drift. A small in-house parser (`src/guide/markdown.ts`, unit-tested) turns it into a plain
  tree that `src/guide/MarkdownView.tsx` renders as React elements. Help points newcomers to it
  ("New here? Read the guide") and links each step of "How a session goes" to its section;
  Help stays the reference for words, materials, properties and shortcuts.
- **Why no Markdown library:** none is on the approved list (SPEC 7.2), and the guide uses a
  small subset: headings, emphasis, code, links, pictures, nested lists, tables. The parser
  follows CommonMark for what it covers; anything else, HTML included, shows as text. Every
  word becomes a React text node, so markup in the file can never run.
- **Links and addresses:** section addresses are stable slugs in `GUIDE_SECTIONS`
  (`src/guide/sections.ts`) for deep links from other screens; a unit test fails when a heading
  changes without the list. GitHub-style anchors (`#keeping-your-work-safe`) go to sections
  through the hash router, so the same file works on GitHub; links to other repository files
  or web addresses show as plain text (the site has neither and makes no network requests).
  The guide's two quoted cross-references to "Keeping your work safe" became links (same words).
- **Pictures:** the 12 screenshots the guide shows (1440 px PNG, 2.5 MB) are re-encoded by
  Chrome (canvas to WebP, no image dependency) at 1280 px wide and quality 0.85: 466 KiB in
  all. At 2× zoom 0.85 keeps small interface text as crisp as 0.9 (+23%); 0.7 starts to blur
  it; JPEG at the same setting was ~75% larger. `scripts/guide-images.mjs` makes them (and
  `capture-guide.mjs` runs it after new screenshots); their sizes are recorded, so the page
  reserves their space. They load lazily and open full size in a viewer.
- **Offline cost:** the service worker precaches them with the rest (`.webp` added to its
  patterns; only pictures the guide uses are bundled): 22 → 34 entries, 12,641 → 13,146 KiB
  (+505 KiB: pictures 466, JavaScript 32 including the guide's text, CSS 8). The offline test
  opens the guide and every picture with the network cut.
- **Alternatives:** a Markdown dependency (not approved, and far more than needed); rewriting
  the guide as components (two copies that drift); the original PNGs (5× the size); loading the
  page as its own chunk (32 KB didn't justify a loading state).

## 2026-09-29: Phones and tablets
- **Why:** on a phone every screen was wider than the screen (the header's links alone made a
  375 px page 460 px wide) and the Studio squeezed the wake into a strip beside its controls.
  The Mac in Chrome stays the design target: at 1024 px and wider nothing changes.
- **Breakpoints** (CSS can't share them, so they are repeated per module; `tokens.css` lists them):
  - **900 px and narrower, upright** (portrait, or taller than 500 px): Studio, Prepare and
    Signature become one column and the page scrolls. The stage takes the shape of what it
    shows (the composition's render size, the clip as turned, the signature's field), at most
    55–60% of the screen's height and at least 180 px tall.
  - **A phone on its side** (landscape, 500 px tall or less, narrower than 1024 px): the Studio
    keeps the wake at full height on the left, its header above the scrolling controls on the
    right and the transport along the bottom; the page doesn't scroll. Prepare keeps the clip
    beside its settings.
  - **720 px and narrower:** the header's links fold into a Menu (a disclosure: Esc returns focus
    to it; a tap elsewhere, Tab leaving it or arriving on a screen closes it), and the
    transport puts its snapshots and Draw by chance on a second row.
  - **600 px and narrower:** the Studio's name gets a line of its own (cut short with an
    ellipsis) above the save state, Save and a More menu with Save as new, Render MP4 and
    Present; 16 px page gutters; two library cards abreast where they fit.
  - **Under 360 px:** the transport shows only the playhead's time, and Draw by chance may wrap
    its label, so the transport keeps two rows.
- **The Studio's transport is docked to the bottom of the screen** on phones and upright
  tablets (sticky), not placed between the wake and the controls: Play and the scrub bar stay in
  reach while the controls scroll. Draw by chance opens as a sheet along the bottom there.
  Alternatives: the transport under the wake (scrolls away with it); the wake sticky too, so it
  stays in view while adjusting (better for playing, but a square composition would hold half
  a phone's screen, and with the keyboard up for notes almost nothing would be left; worth
  revisiting once Freeman has tried it on a phone).
- **Touch:** on touch screens (`pointer: coarse`) `--hit-min` is 44 px, and handle hit areas
  grow to match. Sliders, the signature's lines and the picture around a focus box use
  `touch-action: pan-y`: a sideways drag moves them, while an up or down swipe that starts on
  them still scrolls the page (otherwise a panel full of sliders barely scrolls under a finger).
  A tap jumps like a click; a double-tap resets a slider to its baseline (double-click on the
  Mac is unchanged); a tap on a slider's or line's name shows the description a tooltip shows
  with a mouse; values are always shown. The scrub bar, the trim bar, the focus box itself and
  its handles never scroll the page. Holding a full snapshot replaces it (Shift-click with a
  mouse). A touch the browser cancels keeps what it had reached. Pull-to-refresh can't reload
  the page mid-gesture (it would lose a clip). Presentation on a touch screen gets a Close
  button (there's no Esc key, and iPhones don't allow element full screen, so the wake just
  covers the window). Alternatives: `touch-action: none` everywhere (simplest, but the panel
  stops scrolling); long-press for descriptions; separate reset buttons.
- **Also fixed on the desktop:** the Studio page scrolled 424 px into empty space at 1440×900
  (a screen-reader-only label at the bottom of the scrolling controls escaped them); the panel
  is now positioned. Before/after captures at 1440×900 of Library, Prepare (empty, with a clip,
  extracted), Signature, Studio, New album, Album, Settings, Help and Diagnostics are
  pixel-identical apart from that (and a 1/255 shade in the scrub bar's hatching that comes with
  the shorter capture).
- **Not done:** Shift-drag fine control has no touch equivalent (drag slowly, or use a keyboard);
  titles on buttons (tooltips) don't show on touch screens, but their actions are labelled.
- **Tests:** `tests/e2e/responsive.spec.ts` checks every screen at 320×640, 375×812, 812×375 and
  768×1024 as a touch device, and drives sliders, the scrub bar, trim handles, the focus box and
  snapshots with real touch input (CDP).

## 2026-09-29: Where to go next
- **Why:** using the live site, Braden sometimes couldn't tell where to go next. The journey
  (clip → signature → composition → video or album) was there, but its next steps were hidden:
  a signature card's only visible action was Open (a detail view), Start a composition and New
  album sat in its "…" menu, and nothing after Prepare or a first save said what comes next.
- **How it works (Library):** three steps (make a signature from a clip, start a
  composition, render a video or make an album) at the top of the Library. The current step
  (the first not done) is lit in Honey with its action and a Guide link to its section; done
  steps get a tick and drop their description. Done means: a signature exists; a composition
  exists (album tracks count); an album exists or a render has finished. Single renders leave
  no record in the library, so the Studio sets a `videoRendered` setting when one finishes (a
  flag in this browser, nothing sent anywhere). With nothing in the library the steps replace
  the empty Library's invitation and offer **Try the sample wink** (the introduction's loader,
  now `importSampleWink()` in `src/library/sample.ts`), which adds it and moves focus to the
  next step's button rather than jumping into the Studio, so the person sees where the
  signature went. When every step is done the steps stay, compact, with a line saying so:
  predictable rather than vanishing on their own. **Hide** (and **Show how it works** in
  Settings, setting `showGuidance`) puts them away; a notice says where to bring them back.
- **Signature cards** show **Start a composition** (a button across the card) and **New
  album** beside the "…" menu, which keeps Rename, Duplicate, Export file and Delete. The
  picture is now a real button ("Open *name*") that opens the signature's page; composition
  and album cards keep their Open button. Each button's name includes the signature's
  ("Start a composition from Wink"), because cards repeat. At 375 px two cards still sit
  abreast (the label fits on one line; it may wrap to two at larger text sizes).
- **The Signature page** shows the two ways forward together under "Use this signature", one
  plain line each: **Start a composition** ("Shape one piece by hand in the Studio.") and **New
  album** ("Let chance draw a set of compositions from this signature."). On the Mac they head
  the right-hand column, where the facts had room to spare, so the wake keeps its size; on a
  phone they come first, above the wake; on an upright tablet they sit side by side.
- **Prepare:** **Save and open in Studio** is the main button (Save beside it), with "Not saved
  yet. Next comes the Studio, where it moves through a visual and a sound material." Enter in
  the name still just saves. The faint-signature note now says to turn on **Set sensitivity by
  hand** before raising Sensitivity.
- **The Studio:** after a new composition's first save, a note: "Saved in your Library. Next,
  make a video of it, or let chance draw an album of compositions from “*signature*”." with
  **Render MP4** and **New album** (a first save happens once per composition, so it never
  repeats; it goes when dismissed or when the render dialog opens). New album rather than a
  Library link: one step instead of two, and the breadcrumb already leads to the Library. The
  first visit also gets one tip, "Press Play (or Space) to see and hear the signature move
  through the materials…", because the wake is dark until Play; it goes once playback starts
  and is recorded as seen (`studioTipSeen`). Like the introduction it stays out of automated
  browsers unless forced with `?studiotip=1`. Both follow `showGuidance`. The Studio's notices
  now float over the top of the wake only on wide screens; on phones they sit between the
  header and the wake (with two buttons, the note would have hidden most of a phone's wake).
- **Album:** the review loop at the top as three short steps (Open in Studio and play; mark
  Kept or Set aside; Batch render and Export album log).
- **Guide links:** one small component, `GuideLink` (`src/ui/GuideLink.tsx`: a question mark
  and "Guide", named "Guide: *section*"), on the Library (The Library), Prepare and Signature
  (Making a signature: the bare wake and its lines are explained there), the Studio header
  (icon only on phones), Draw by chance, Render MP4 (not while rendering: leaving would cancel
  it), New album and Album (Albums), Settings, and Diagnostics (If something goes wrong). Same
  tab, like the header's Guide, so Back returns. Caveat: leaving Prepare with an unsaved
  signature or an open clip loses it, as the header's links always have; a leave-screen
  prompt would be a separate change.
- **A new screen starts at the top.** The window kept its scroll position across hash
  changes, so a screen could open halfway down. `useScrollToTopOnArrival()`
  (`src/app/arrival.ts`) scrolls to the top in a layout effect when the *screen* changes; the
  Studio after a first save or Save as new (a new address, the same screen) and moves between
  guide sections (the guide positions itself) keep their place.
- **The guide** was brought up to date (the steps, the cards, each item's menu as it is, undo
  and redo as keys, press and hold for snapshots, Also choose values, Diagnostics under Menu
  on a phone, no file path an in-app reader can't open) and its screenshots recaptured: 12
  pictures, 498 KiB (from 466).
- **Tests:** `tests/e2e/workflow-guidance.spec.ts` (the steps through the whole journey,
  Hide and Settings, cards, the Signature page, Prepare's main button, the Studio's note and
  tip, every guide link, arrival at the top); `responsive.spec.ts` checks the steps, cards and
  guide links at every size; unit tests for the steps (`journey.test.ts`) and for which
  addresses are the same screen (`arrival.test.ts`).
- **Alternatives:** a guided tour or coach marks (gamified, and they cover what they explain);
  auto-hiding the steps once all are done (surprising; the Settings switch would then seem not
  to work); counting only albums for the last step (the steps would nag someone who only makes
  videos); jumping into the Studio after the sample wink (as the introduction does; here the
  point is to show the Library filling up); keeping the ways forward in the menu with a hint
  (the problem was that they were hidden); Library in the Studio's note (one more step to New
  album); new tabs for guide links (a second copy of the app, with its own dedication splash).

## 2026-10-01: Going public: license, notices, a protected main
- **Why now:** Braden made the repository public so a university capstone team can work on
  the instrument.
- **License: MIT** (`LICENSE`, "Braden Freeman and contributors"). A public repository with
  no license lets nobody reuse it. MIT is the simplest for students and matches the
  dependencies, which are all permissive. Contributions come in under the same terms
  (`CONTRIBUTING.md`). Alternatives: AGPL-3.0 (keeps every derivative open, hosted copies
  included; compatible with everything used here, but it leans on enforcement, and how much
  copyright AI-assisted code carries is unsettled); no license plus written permission for the
  team (keeps options open, but blocks everyone else).
- **Freeman's brief stays public and stays his.** `docs/FREEMAN_WRITEUP.md` is marked
  © Freeman, all rights reserved, and the README and CONTRIBUTING say the MIT License doesn't
  cover it.
- **Notices in the app.** The minified build dropped the MIT and ISC notices of React,
  Zustand, idb, fflate, Workbox and the adapted fluid solver, and said nowhere how to get
  Mediabunny's source (MPL-2.0). The app now ships `third-party-notices.txt` (27 KB, generated
  from `node_modules` by `scripts/third-party-notices.mjs`), linked from Help › About and
  cached with OpenCV's `LICENSE` and the typeface's `OFL.txt`, so it reads offline. A unit test
  fails when it is stale or misses a runtime dependency. Alternative: a bundler plugin that
  collects licenses (a new dependency for something a 150-line script does).
- **`main` is protected** on GitHub: a pull request and a passing Vercel build are required,
  for administrators too; no force pushes or deletion. A merge to `main` goes live, so nothing
  should reach it unseen. No approving review is required (a sole maintainer can't approve
  their own pull request).
- **Not changed:** `CLAUDE.md` and `SPEC.md` still describe v0 as a surprise built solo; they
  need rewriting for the new arrangement once it is settled.

## 2026-10-01: Hue, a color control on every visual material
- **Why:** Braden wanted to be able to adjust the materials' colors. Every color was fixed in
  the code; only Water and Honey offered a choice (three palettes each, under More), and Smoke,
  Descending bubbles and Filaments offered none.
- **Decision:** one more property, **Hue**, on Water, Honey, Smoke, Descending bubbles and
  Filaments (not the Signature view, which is diagnostic). It turns all of a material's colors
  around the color wheel together. 0.5, the baseline, is the material's own colors; the whole
  slider is one full turn, so 0 and 1 are both half a turn away, and a third of a turn (0.83)
  takes red to green, green to blue and blue to red. Braden chose this over more palettes and
  over picking colors by hand (below), and chose to have it always in view.
- **How:** a rotation of RGB about the grey axis (`src/materials/visual/shared/hue.ts`), which
  comes to three weights: `out = k·rgb + n·gbr + p·brg`. It is applied only where a material
  draws (the fluids' display pass, the bubbles' rim tint, the filaments' ribbon display and
  strands), never in `step()`. The rotation is linear, so turning dye or ribbons already laid
  down gives the picture a turned palette would have given. So:
  - it shows at once, also while paused, and a render matches the preview (a change of
    Palette, by contrast, only colors new dye);
  - black stays black, and grey and white stay as they are; glints and highlights, left
    unturned on purpose, stay white;
  - two colors stay exactly as far apart as they were, so a wink's close and open still read
    as two colors at every Hue (SPEC 9.3);
  - the fluids' surface relief is still read from the dye as released, so Hue never moves the
    light on the surface.
- **The baseline is unchanged; no material version changes.** With no turn the shader returns
  the color untouched. 37 frame hashes from the materials harness (five materials × wink,
  sweep and swirl; Draft and Standard; Water's two capability fallbacks; Brightness and
  Surface light away from the baseline; still frames; Filaments at High; the Signature view)
  are identical before and after on the builder's machine (GTX 1660 Super, Direct3D 11). Saved
  compositions look as they did and show no "material has changed" notice. An older build that
  opens a composition with Hue moved ignores it.
- **A rule bent: Hue is shown beside the six primaries.** SPEC 9.1 and 13.1 allow six primary
  properties per material, and every material already had six. Rather than hide Hue under More
  or demote something, `countsTowardPrimaryCap()` in `src/materials/properties.ts` says Hue
  does not count; `capPrimary` and the registry test both use it, so the exception lives in one
  place. Linked, the Visual group shows Hue above More; unlinked, six primaries and Hue.
  `MAX_PRIMARY_PROPERTIES` stays 6 for everything else, Both and the sound materials included.
- **Material-specific on purpose, not shared.** Hue has no meaning in sound, and a tenth shared
  property would change what Draw by chance draws for every existing seed and album. So Hue is
  never linked, never locked or drawn by chance (album tracks start at 0.5) and, like Palette,
  returns to the baseline when another visual material is chosen. It counts as one of a
  material's three own properties, which fills that limit for Water, Honey, Descending bubbles
  and Filaments (Smoke keeps one). If one of them needs another property of its own, exempting
  Hue from that limit too is the obvious move.
- **Known limits:**
  - Smoke's tints are pale and its sideways tint is exactly grey, so Hue is faint there (it
    mostly moves the warm and the cool). Water's Ink palette is nearly as quiet. Prism holds
    every color, so Hue changes which direction gets which rather than the overall look.
  - The rotation keeps the sum of the channels, not their luminance: greens read brighter
    than blues, as on any screen, so the wake's brightness moves a little with Hue.
  - Between thirds of a turn a saturated color can leave what a screen shows and is clipped,
    so yellows, cyans and magentas come out a little dimmer than reds, greens and blues.
  - On a graphics card that can't blend into float targets, Filaments keeps 8-bit ribbons,
    which clamp before the turn; dense overlaps may differ slightly from other machines.
- **Also fixed:** the offscreen render (thumbnails, the materials harness) never applied
  display properties before drawing, so a frame drawn with no steps showed bubbles and strands
  at the baseline Brightness and Size. It now does what the Studio and a render do.
- **Alternatives:** palettes for every material (curated and always legible, but a fourth own
  property for Bubbles and Filaments, nine palettes to design, and a change only colors new
  wake); the artist's own colors per direction (the most freedom, but a new kind of property
  and control, the Mac's color picker to test, and it can make the close and the open the same
  color; a possible next step); a pass over the finished picture (an extra full-screen buffer
  and pass, after the tone curve and in 8 bits); turning the palette before the dye is released
  (exact colors, but nothing shows while paused, and old and new colors mix while playing); a
  luminance-preserving rotation (blues turned to yellow come out olive); a 3×3 matrix uniform
  (a transposed matrix silently reverses the turn; three weights can't be transposed).
- **Revisit with Freeman:** whether Hue should carry over from one material to the next;
  whether chance should be able to draw it; whether hue has a counterpart in sound; whether
  Smoke wants a stronger color control of its own.
- **Watch on the Mac** (`docs/MAC_TEST_CHECKLIST.md` 8.9 and 9.5): each material starts,
  dragging Hue stays smooth on integrated graphics, the extra row in the panel, rendered
  colors against the preview in QuickTime.
- **Tests:** `tests/unit/hue.test.ts` (the turn and the property); each material's mapping
  test (Hue changes nothing but its own display value); `tests/e2e/visual.spec.ts` (the middle
  changes nothing, the slider's ends meet, a third of a turn cycles the channels and not the
  reverse, Hue on the final draw alone equals Hue all along, a still signature stays black,
  bubbles and strands at rest take Hue before any step); `tests/e2e/studio.spec.ts` (in view,
  a paused wake recolors at once, undo, snapshots, save and reload, another material starts
  in its own colors); `tests/e2e/render.spec.ts` (a rendered MP4, decoded with ffmpeg, has
  the turned colors and the same sound sample for sample).

## Pending
- **Freeman's MacBook Pro:** model, year, chip, macOS and Chrome versions. Diagnostics' Copy
  report records the macOS version, CPU type (Intel or Apple Silicon), GPU and Chrome
  version whenever it runs there.
- **Everything on macOS** (`docs/MAC_TEST_CHECKLIST.md`): AAC encode and its priming delay
  (renders may need a small audio offset), float render targets, preview frame rate on a
  Retina screen, extraction time, QuickTime playback, the offline cache.
- **A real wink clip** with a focus area (M1 acceptance).
- **Phones and tablets on real devices:** the layouts and touch handling were checked in Chrome's
  mobile emulation only. Worth a try on an iPhone (Safari: no element full screen, its own
  toolbar and keyboard behaviour) and an Android phone in Chrome.
- **Hosting:** done 2026-09-29: a free Vercel Hobby project deploying from the private
  GitHub repository `allxdamnxday/synesthesia` on every push to `main` (`docs/DEPLOY.md`).
- **To confirm with Freeman after handover** (SPEC 18): the chance interpretation (open
  properties drawn from the shared properties the two materials use; the rest locked at
  baseline), which materials reveal or obscure the signature, the dedication splash (on by
  default), names for materials and properties, album format.
