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
- **Transport:** loop wraps carry the sound's state on; a seek dips the output 8 + 8 ms;
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

## Pending
- Freeman's MacBook Pro model, year, chip, macOS version (Diagnostics' Copy report now
  records macOS version, CPU architecture and GPU whenever it runs on his Mac).
- M0 spike outcomes on macOS (AAC encode, float render targets, performance).
- Chance interpretation (SPEC 12.2), to confirm with Freeman after handover.
- Dedication splash default: on ("Made for Freeman"), toggle in Settings.
- Hosting: the plan is a free Vercel Hobby deployment from a private GitHub repo. It
  needs the builder's own Vercel login, so nothing has been deployed yet.
