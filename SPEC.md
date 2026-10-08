# Synesthesia Project: MVP Instrument v0 build specification

| | |
|---|---|
| Status | Draft 1, September 2026 |
| Builder | Braden (solo, with Claude Code) |
| Artist / vision holder | Freeman |
| Artistic brief | `docs/FREEMAN_WRITEUP.md` |
| Working agreements | `CLAUDE.md` |

---

## 0. Priorities

When requirements pull against each other, resolve in this order:

1. The kinetic signature stays **constant and separate** from every material.
2. It runs **reliably on Freeman's MacBook Pro** in Chrome.
3. Freeman can use it **alone**, without Braden in the room.
4. The wakes are **beautiful and legible**: the signature reads through each material.
5. Feature count.

---

## 1. Project context

### 1.1 The idea

Picture lying at the bottom of a bowl of colored water, looking up. A finger traces a
path through the water above. You never see the finger, only its wake. Apply that same
movement to a bowl of honey: same movement, different response. Give each a sound. The
water answers with a quick, bright, rising *"Breee-weet!"*; the honey answers with a low,
slow, stuttering *"Broo-roo-roo-roo-roo-rooo-oot."*

SP captures the movement as a **kinetic signature**: movement-derived data, not the source
image. It applies that one signature to interchangeable **visual materials** and **sound
materials**, each with adjustable **properties**. The source disappears; its wake remains.

### 1.2 Core inquiry

> What becomes perceptible when the same movement is expressed through different
> audiovisual materials, while the visible source of that movement is absent?

### 1.3 What SP is not

- It does not diagnose, classify, or assign meaning to anyone's state. No emotion
  labels, no "this movement is anxious." The artist is the only authority on meaning.
- It does not claim to reproduce neurological synaesthesia.
- It is not a VJ tool, a music visualizer, or an AI generator.

### 1.4 First artistic investigation (the reason v0 exists)

One captured signature (a wink or a smile) becomes an **album of 20–30 compositions**.
Each composition starts from the same signature and a defined baseline. Chance
procedures may pick the materials and which properties are open to play. The album is
both artwork and research record: it keeps discoveries, failed mappings, rough places,
and revisions. v0 must make this album possible end to end.

### 1.5 Surprise build

Braden is building v0 as a surprise. Freeman's brief says the input method is to be
chosen "with the development collaborator"; for v0 Braden makes that call (recorded
clip). Present the result to Freeman as **a playable v0 that he now co-directs**, not
a finished product. Every judgment call goes in `docs/DECISIONS.md` so Freeman can
revisit it.

---

## 2. Users and environment

| | |
|---|---|
| Primary user | Freeman: dancer, artist, somatic educator. Not an engineer. Uses it alone at home, repeatedly. |
| Builder | Braden: solo developer on Windows 11, Chrome, React/TypeScript, Claude Code. |
| Target machine | Freeman's MacBook Pro. Model, year, and chip are TBD (record them in DECISIONS.md once known). Design for a worst case of a 2017-era Intel MBP with integrated graphics, 8 GB RAM, macOS 12+. |
| Browsers | Latest Google Chrome on macOS and Windows (supported). Microsoft Edge should work. Safari and Firefox are not supported in v0; show a friendly notice. |

---

## 3. Hard constraints

| ID | Constraint |
|---|---|
| C1 | **$0 cost.** No paid services, APIs, or licenses. Free static hosting only (GitHub Pages or a free Vercel tier). |
| C2 | **Permissive licenses only.** MIT, BSD, ISC, Apache-2.0; OFL for fonts; MPL-2.0 only for unmodified packages. Track in `docs/THIRD_PARTY.md`. |
| C3 | **Static web app.** No backend, accounts, analytics, telemetry, or runtime network requests. Self-host all assets. |
| C4 | **Local-first.** User data lives in browser storage and in files the user explicitly exports. Nothing is uploaded anywhere. |
| C5 | **Works offline** after first load (Milestone 8). |
| C6 | **Deterministic.** Signature + composition + seed fully define a render. Same machine and same inputs give the same output. |
| C7 | **Source disappears.** The signature file contains no source pixels, and the clip is never stored and never appears in a render, a thumbnail or an export. On screen the clip is visible on the Prepare screen and, only while the artist raises it, as the Studio's clip layer (6.3): hidden by default, and only in the visit its signature was made in. *(Amended 2026-10-08 at Freeman's request; see `docs/DECISIONS.md`.)* |
| C8 | **Seeded randomness only.** No `Math.random()` or clock-based randomness in engine, material, signature, chance, or render code. |

---

## 4. Glossary (use these words in the UI and code)

| Term | Meaning |
|---|---|
| Clip | The source video the user imports. |
| Signature | The kinetic signature: a time series of motion vectors on a grid, plus derived movement features. Saved as `.sig.json`. |
| Material | A responsive medium the signature acts on. **Visual materials** draw; **sound materials** sound. |
| Property | A 0–1 control that shapes how a material responds (e.g., viscosity). |
| Shared property | A property from the common vocabulary (section 9.2) that means the same thing in the visual and sound fields. |
| Baseline | A material's default property values. Every composition starts from it. |
| Wake | The combined audiovisual response to a signature. |
| Composition | Signature reference + one visual material + one sound material + property values + seed + render settings + notes. |
| Snapshot | A temporary A/B/C/D slot holding a composition state for quick comparison. |
| Album | An ordered set of compositions derived from one signature, plus its log. |
| Render | The offline, frame-by-frame export of a composition to MP4. |

---

## 5. Scope

### 5.1 Write-up requirements mapped to v0

| Write-up MVP requirement | v0 implementation | Milestone |
|---|---|---|
| One movement-input path | Recorded clip import (MP4/MOV/WebM). Live camera deferred; architecture leaves room for it. | M1 |
| Runs on Freeman's MacBook Pro | Chrome web app; quality tiers; offline render so final quality doesn't depend on GPU speed. | M0, M2, M4 |
| 3–5 visual, 1–5 auditory materials | 5 visual + 5 sound, plus a diagnostic "Signature" view. | M2, M3, M6 |
| Simple interface with meaningful properties | Shared property vocabulary; at most 6 visible sliders per material, more behind a disclosure. | M2 |
| Signature preserved independently | `.sig.json` with no source pixels; hashed. | M1 |
| Replay and re-render through different materials | Studio transport, snapshots A–D, album batch render. | M2, M5, M7 |
| Save/load movement, settings, experiments; MP4 export | IndexedDB library, composition files, backup zip, MP4 with audio. | M4, M5 |
| Training and documentation | First-run onboarding, Help screen, `USER_GUIDE.md`, walkthrough video script. | M8 |
| Extensible architecture | Material plugin interfaces; signature source interface. | throughout |

### 5.2 Out of scope for v0

Live camera input; body/face/hand skeleton tracking; multi-camera or depth; installation
or gallery mode; multi-user; accounts, cloud sync, or any backend; AI/ML generation or
classification; a user-editable mapping matrix; MIDI/OSC output; mobile/tablet support;
Safari/Firefox support; clinical or interpretive features of any kind.

---

## 6. Artist workflow and screens

Freeman's eight steps map onto four main screens:

| Step | Screen |
|---|---|
| 1 Introduce, 2 Prepare, 3 Extract | **Prepare** |
| 4 Select, 5 Apply, 6 Play, 7 Compare | **Studio** |
| 8 Preserve | **Studio** (save, render) and **Library** |
| Album investigation | **Album** |

### 6.1 Library (home)

- Two lists: **Signatures** and **Compositions** (plus **Albums** once M7 lands).
- Each item shows a name, a thumbnail (a still of its wake for compositions, a
  vector-field sketch for signatures), and its last-modified date.
- Actions: New from clip, Open, Rename, Duplicate, Delete (with confirmation),
  Export file, Import file, Back up everything, Restore from backup.
- Empty state invites the first action: "Bring in a clip to make your first signature."

### 6.2 Prepare

- Import a clip by drag-and-drop or file picker.
- Player with scrub, play/pause, frame step.
- **Trim** handles (start/end).
- **Speed** (0.25×–2×): stored as the signature's preferred playback rate. It does not
  resample extraction; see 8.1.
- **Rotate** (0/90/180/270) and **Mirror**, applied before extraction.
- **Focus area** (optional region-of-interest box). For a wink, the user boxes the eye
  so only its motion is analyzed. The box is stretched to fill the material field.
- **Sensitivity** (noise floor): Auto by default, with a manual slider under Advanced.
- **Extract signature** button: runs in a worker with progress and cancel.
- After extraction: the **Signature view** (diagnostic vector rendering, see V0 in
  9.4) plays alongside sparklines for energy, direction, expansion/contraction,
  continuity, and density. A **Hide source** toggle (on by default after extraction)
  lets the artist see the signature with the source gone.
- Name and save the signature, then **Open in Studio**. Once saved, the clip stays in
  memory until the page is closed or reloaded (it is never stored), so the Studio can show
  it (6.3).
- Advanced panel (collapsed): analysis width, grid columns, extraction smoothing.

### 6.3 Studio

- The **canvas** (the wake) dominates the screen.
- **Transport:** play/pause, loop toggle, loop count, scrub bar, current/total time.
- **Visual material** picker and its property sliders.
- **Sound material** picker and its property sliders.
- **Linked** toggle (on by default): shared properties are driven by one slider that
  affects both fields. Unlinked gives each field its own values.
- **Global controls:** Signature strength (gain), Smoothing, Speed, Loops, Tail (seconds
  of settling after the movement ends).
- **Mute/solo** for the visual and sound fields (for studying each alone).
- **Snapshots A–D:** store the current state; switch instantly without restarting playback.
- **Draw by chance** (see section 12).
- **Notes** field for the research record.
- **Save**, **Save as new**, **Render MP4**.
- **Presentation mode** (F key): hides all UI and shows only the wake.
- **Undo/redo** for property changes (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z).
- **Clip layer** (added 2026-10-08): a **Clip** slider, 0–100% and at 0% every time a
  composition opens, lays the source clip over the wake. The clip is cropped, turned and
  placed where the signature acts (the focus area lies on the rectangle the material's
  Range projects the movement onto) and it follows the transport (speed, loops, back and
  forth, tail). It is a way of looking, not part of the composition: it is not saved,
  undone, stored in snapshots or drawn by chance, and it never appears in a thumbnail or a
  render. The slider is offered only while the clip is in memory: the visit its signature
  was made in (6.2).
- Otherwise the source clip never appears here: at 0% there is no clip in the Studio at all.

### 6.4 Album (Milestone 7)

Create an album from one signature, generate chance-driven draft compositions, work
through them, mark each as kept or set aside, batch render, and export the album log.
Details in section 12.

### 6.5 Settings, Diagnostics, Help

- **Settings:** preview quality tier, default render resolution and fps, storage usage
  and a request for persistent storage, dedication splash toggle (M8).
- **Diagnostics:** capability checks (section 14.1) with pass/fail and a
  **Copy report** button so Freeman can paste results to Braden.
- **Help:** plain-language guide, keyboard shortcuts, and "what each property does" per
  material.

---

## 7. Architecture

### 7.1 Pipeline

```
Clip ──► Prepare (trim, rotate, focus area)
          │
          ▼
     Extract (worker: decode ─► grayscale ─► optical flow ─► grid pool ─► features)
          │
          ▼
     Signature (.sig.json; immutable; hashed)
          │
          ▼
     SignatureSampler (signature time, speed, loops, tail, smoothing)
          │                         │
          ▼                         ▼
   Visual material            Sound material
   (WebGL2, fixed step)       (Web Audio, scheduled automation)
          ▲                         ▲
          └──── Properties (shared vocabulary + material-specific; linked or not)
          │                         │
          ▼                         ▼
   Preview (realtime)  ◄──same code──►  Render (offline, frame-stepped) ─► MP4
```

### 7.2 Approved stack

| Concern | Choice | License |
|---|---|---|
| Build / dev server | Vite | MIT |
| UI | React (current stable) + TypeScript (strict) | MIT / Apache-2.0 |
| State | Zustand | MIT |
| Styling | Plain CSS with custom-property tokens + CSS Modules; no UI kit | n/a |
| Optical flow | OpenCV.js 4.x official build, pinned, self-hosted in `public/vendor/opencv/` | Apache-2.0 |
| Video decode + MP4 encode | Mediabunny (WebCodecs-based) | MPL-2.0 (unmodified) |
| Fluid solver base | Pavel Dobryakov's WebGL-Fluid-Simulation, adapted; keep attribution | MIT |
| Graphics | Raw WebGL2 (optional helper: twgl.js) | MIT |
| Audio | Web Audio API + AudioWorklet (no Tone.js unless offline parity is proven) | n/a |
| Storage | idb (IndexedDB wrapper) | ISC |
| Zip backup | fflate | MIT |
| PWA / offline | vite-plugin-pwa (M8) | MIT |
| Tests | Vitest; Playwright (Chromium) | MIT / Apache-2.0 |
| Font | Atkinson Hyperlegible Next, self-hosted | OFL |

### 7.3 Repository layout

```
synesthesia/
  CLAUDE.md
  SPEC.md
  docs/
    FREEMAN_WRITEUP.md   DECISIONS.md   MATERIALS.md   ARCHITECTURE.md
    ADDING_A_MATERIAL.md USER_GUIDE.md  THIRD_PARTY.md
  public/
    vendor/opencv/       fonts/         samples/
  src/
    app/                 # shell, routing, providers
    screens/             # Library, Prepare, Studio, Album, Settings, Diagnostics, Help
    ui/                  # Slider, MaterialPicker, Transport, SnapshotBar, Sparkline, ...
    state/               # zustand stores
    signature/           # types, extract.worker, features, sampler, serialize, hash, migrations
    engine/              # transport, fixed-step clock, properties, composition model
    materials/
      properties.ts      # shared vocabulary definitions
      registry.ts
      visual/            # signature-view/, water/, honey/, smoke/, bubbles/, filaments/, shared/fluid/
      sound/             # water/, honey/, breath/, resonance/, pulse/, shared/ (reverb, noise, worklets)
    render/              # renderComposition, mp4, capabilities
    library/             # db, backup, import/export, migrations
    chance/              # prng, hash32, draw, album
    lib/                 # math helpers
  tests/
    unit/  e2e/  fixtures/
  spikes/                # throwaway M0 experiments
```

### 7.4 Threads

- **Main thread:** React UI, WebGL2 rendering, Web Audio (preview), render loop.
- **Extraction worker:** decoding, grayscale conversion, OpenCV optical flow, pooling,
  features. Posts progress; supports cancel.
- **AudioWorklet thread:** custom DSP (grains, modal resonators, plucks) where needed.
- If decoding inside the worker proves unreliable in M0, decode on the main thread
  and transfer grayscale `Uint8Array` frames to the worker.

### 7.5 Timing model

- All engine time is **signature time** in seconds, never wall-clock.
- Composition timeline length = `signatureDuration / speed × loops + tail`. During the
  tail, the sampler returns a zero field (the movement has ended; the wake settles).
- Visual simulations step at a **fixed dt of 1/60 s**. Preview uses an accumulator
  against real elapsed time; render advances exactly `fps`-matched steps per frame
  (2 steps per frame at 30 fps, 1 step at 60 fps).
- **Seeking** resets the material to its seeded initial state and fast-forwards steps
  (without drawing) to the target time. If that takes longer than ~0.5 s, show a
  subtle "catching up" indicator.
- Audio is scheduled against the same composition timeline (section 9.1).

### 7.6 Future input: signature sources

Materials consume only `SignatureFrame`s from a `SignatureSampler`. Define:

```ts
interface SignatureSource {
  kind: 'recorded' | 'live';
  sampler: SignatureSampler;
}
```

v0 implements only `recorded`. A later live-camera source must plug in without any
material changes.

---

## 8. Kinetic signature

### 8.1 Extraction algorithm

1. **Decode** the clip with Mediabunny. Check decodability first. If the browser can't
   decode it (common with HEVC from iPhones on some Windows machines), show:
   "This clip's format can't be read in this browser. On iPhone, set Settings > Camera >
   Formats > Most Compatible and record again, or convert the clip to MP4 (H.264)."
2. **Frame rate:** analyze at `min(nativeFps, 60)`. Speed from Prepare is *not* applied
   here; it is a playback parameter.
3. **Clip limits:** at most 60 s after trimming. Any input resolution; downscale for
   analysis.
4. **Preprocess each frame:** apply rotate/mirror → crop to the focus area (if any) →
   resize so the width is `analysisWidth` (default 320, keep aspect) → grayscale →
   light Gaussian blur (5×5).
5. **Optical flow:** OpenCV `calcOpticalFlowFarneback(prev, next)` with defaults
   `pyrScale 0.5, levels 3, winsize 15, iterations 3, polyN 5, polySigma 1.2`. Store the
   params in the signature.
6. **Normalize units:** divide pixel displacement by the analysis frame's diagonal, then
   multiply by fps. Unit = "field diagonals per second." A tiny wink in a boxed focus
   area therefore produces vectors comparable to a large gesture in a full frame.
7. **Pool to a grid:** average vectors into `cols × rows` cells. `cols` defaults to 32;
   `rows = round(cols × h / w)`, clamped to 8–48.
8. **Noise floor:** Auto = the 60th-percentile cell magnitude across the quietest 10% of
   frames, times 1.5. Apply a soft threshold per cell: `v × smoothstep(floor, 2·floor, |v|)`.
9. **Extraction smoothing:** centered moving average over time, window 3 frames by
   default (Advanced: 1–9).
10. **Features:** compute per frame (8.2).
11. **Stats:** per feature, compute min, max, mean, p05, p95 (used for normalization).
12. **Hash:** SHA-256 (SubtleCrypto) over field data + features → `contentHash`.
13. Close every decoded frame/sample immediately after use.

### 8.2 Features

Notation, per frame: grid cells `c`, vector `v_c = (u, v)` in image coordinates (x
right, **y down**), magnitude `m_c = |v_c|`, cell center `p_c` in 0..1 field
coordinates. Spatial derivatives use central differences with grid spacing in field
units. Temporal derivatives multiply frame-to-frame differences by fps. `ε = 1e-6`.

| Write-up term | Feature | Definition |
|---|---|---|
| Velocity | `energy` | `mean(m_c)` |
| Velocity (peak) | `peak` | 95th percentile of `m_c` |
| Direction | `flowX`, `flowY`, `direction` | `F = mean(v_c)`; `direction = atan2(-F.y, F.x)` (math convention, **up is positive**) |
| Direction (coherence) | `coherence` | `abs(Σv_c) / (Σm_c + ε)`, 0..1; 1 means everything moves together |
| Expansion / contraction | `divergence` | `mean(∂u/∂x + ∂v/∂y)`; positive = expanding, negative = contracting |
| (Rotation) | `curl` | `mean(∂v/∂x − ∂u/∂y)`; document the resulting sign convention in code |
| Acceleration | `acceleration` | `abs(F_t − F_{t−1}) × fps` |
| Acceleration (signed energy change) | `surge` | `(energy_t − energy_{t−1}) × fps`; positive = gathering, negative = releasing |
| Continuity | `jerk`, `continuity` | `jerk = abs(acceleration_t − acceleration_{t−1}) × fps`; `continuity = 1 / (1 + jerk / p95(jerk))`, 0..1, 1 = smooth |
| Density | `density` | fraction of cells with `m_c > floor` |
| Spatial relationship | `centroidX`, `centroidY` | magnitude-weighted mean of `p_c` |
| Scale | `spread` | `sqrt(Σ m_c·abs(p_c − centroid)² / Σ m_c)` |
| Timing | `onsets` | frames where `surge > 2.5 × σ(surge)` and `energy > floor`, with a 100 ms refractory period |

The sampler also exposes **normalized** versions: unsigned features map
`(x − p05) / (p95 − p05)` clamped to 0..1; signed features (`divergence`, `curl`,
`surge`, `flowX`, `flowY`) map to −1..1 by dividing by `p95(abs(x))` and clamping.

### 8.3 Signature file format (`.sig.json`)

```ts
interface KineticSignature {
  format: 'sp-signature';
  version: 1;
  id: string;                 // uuid
  name: string;
  createdAt: string;          // ISO 8601
  contentHash: string;        // sha-256 hex of field + features
  source: {
    fileName: string;
    nativeFps: number;
    width: number; height: number;
    trim: { startSec: number; endSec: number };
    rotate: 0 | 90 | 180 | 270;
    mirror: boolean;
    focusArea: { x: number; y: number; w: number; h: number } | null; // normalized 0..1
  };
  preferredSpeed: number;     // from Prepare, default 1
  extraction: {
    method: 'farneback';
    params: { pyrScale: number; levels: number; winsize: number;
              iterations: number; polyN: number; polySigma: number };
    analysisWidth: number;
    noiseFloor: number;
    noiseFloorMode: 'auto' | 'manual';
    temporalSmoothingFrames: number;
  };
  frameRate: number;          // analysis fps
  frameCount: number;
  grid: { cols: number; rows: number };
  // frameCount × rows × cols × 2 float32 values (u, v), row-major, base64-encoded
  field: { encoding: 'f32-base64'; data: string };
  features: {
    energy: number[]; peak: number[];
    flowX: number[]; flowY: number[]; direction: number[]; coherence: number[];
    divergence: number[]; curl: number[];
    acceleration: number[]; surge: number[]; jerk: number[]; continuity: number[];
    density: number[]; centroidX: number[]; centroidY: number[]; spread: number[];
    onsets: number[];         // frame indices
  };
  stats: Record<string, { min: number; max: number; mean: number; p05: number; p95: number }>;
}
```

Size check: 10 s × 30 fps × 32×18 cells × 2 floats ≈ 1.4 MB of base64. Acceptable.
Every format carries `version`; write a migration function per version bump.

### 8.4 Sampler

```ts
interface SignatureFrame {
  t: number;                       // composition time (s)
  cols: number; rows: number;
  field: Float32Array;             // interpolated (u, v) grid; zeros during tail
  // FeatureName = every key of KineticSignature['features'] except 'onsets'
  features: Record<FeatureName, number>;      // raw
  normalized: Record<FeatureName, number>;    // 0..1 or −1..1
  inTail: boolean;
}

interface SignatureSampler {
  readonly duration: number;       // full composition timeline, incl. loops and tail
  configure(opts: { speed: number; loops: number; tailSec: number;
                    loopMode: 'loop' | 'pingpong'; smoothing: number }): void;
  sample(t: number): SignatureFrame;              // random access, pure
  onsetsBetween(t0: number, t1: number): number[]; // composition times of onsets
}
```

- Linear interpolation between frames for field and features.
- **Smoothing** (global control, 0–1) is applied as a precomputed zero-phase moving
  average over features and field (window up to ~0.5 s), cached per value, so `sample()`
  stays pure and random-access.
- The sampler never allocates in the hot path; reuse buffers.

### 8.5 Validation

Generate synthetic fixture clips (a `/dev/fixtures` page that draws on a canvas and
encodes with Mediabunny, or a Node script) and commit them to `tests/fixtures/`:

| Fixture | Expected features |
|---|---|
| Dot moving right | `direction ≈ 0`, `coherence` high, `divergence ≈ 0`, energy > 0 |
| Dot moving up | `direction ≈ π/2` |
| Expanding ring | `divergence > 0` |
| Contracting ring | `divergence < 0` |
| Rotating bar | `abs(curl)` high; sign matches the documented convention |
| Still frame | `energy ≈ 0`, `density ≈ 0` |
| Still frame with sensor noise | `density ≈ 0` after the auto noise floor |
| Dot that stops abruptly | onset near the start; low `continuity` at the stop |

---

## 9. Materials

### 9.1 Interfaces

```ts
type PropertyKind = 'continuous' | 'choice';

interface PropertyDef {
  id: string;                 // e.g. 'viscosity' (shared) or 'fallSpeed' (specific)
  label: string;              // UI label, sentence case
  description: string;        // one plain-language sentence for Help and tooltips
  kind: PropertyKind;
  shared: boolean;            // true if from the shared vocabulary (9.2)
  default: number;            // baseline; for 'choice', an index
  choices?: string[];         // for 'choice'
  primary: boolean;           // shown by default (max 6 primary per material)
}

type PropertyValues = Record<string, number>;

interface MaterialMeta {
  id: string;                 // unique within its kind ('visual' | 'sound')
  version: number;            // bump whenever output for the same inputs changes
  name: string;
  description: string;        // plain language, shown in the picker
  properties: PropertyDef[];
}

interface VisualContext {
  gl: WebGL2RenderingContext;
  width: number; height: number;
  quality: 'draft' | 'standard' | 'high';
  seed: number;
  rng: () => number;          // seeded PRNG; never Math.random
}

interface VisualMaterial extends MaterialMeta {
  init(ctx: VisualContext): Promise<void>;
  reset(seed: number): void;                                   // initial state at t = 0
  step(frame: SignatureFrame, props: PropertyValues, dt: number): void; // fixed dt
  draw(): void;                                                // to the default framebuffer
  resize(width: number, height: number): void;
  dispose(): void;
}

interface ScheduleWindow {
  sampler: SignatureSampler;
  props: PropertyValues;
  t0: number; t1: number;     // composition time range to schedule
  ctxTimeAtT0: number;        // AudioContext time corresponding to t0
  controlRate: number;        // automation points per second (default 200)
}

interface SoundMaterial extends MaterialMeta {
  build(ctx: BaseAudioContext, destination: AudioNode, seed: number): Promise<void>;
  schedule(win: ScheduleWindow): void;   // write AudioParam automation + events for the window
  cancelFrom(ctxTime: number): void;     // clear automation after a time (for live edits)
  dispose(): void;
}
```

Materials register in `src/materials/registry.ts`. The **same** material code runs in
preview and in offline render.

**Sound scheduling:**
- *Preview:* a lookahead scheduler runs every ~50 ms and schedules the next ~200 ms.
  When a property changes, call `cancelFrom(now)` and reschedule the window.
- *Offline render:* one `schedule()` call covering the full timeline on an
  `OfflineAudioContext`.
- Discrete events (onsets) are scheduled at exact times.
- Noise is generated from the seeded PRNG into `AudioBuffer`s, never from browser randomness.
- AudioWorklet modules are self-hosted and loaded via `ctx.audioWorklet.addModule()`
  (works in both context types).

**Master sound chain:** material → master gain → soft limiter (fast
`DynamicsCompressorNode` or a gentle `WaveShaperNode` soft clip) → destination. Offline
renders peak-normalize to −1 dBFS by default (toggle in the render dialog).

**Reverb:** a `ConvolverNode` with a procedurally generated impulse response
(seeded noise × exponential decay; decay time from Persistence). No external IR files.

### 9.2 Shared property vocabulary

Every property is 0–1, baseline 0.5 unless a material's baseline says otherwise. Each
material must honor these meanings. It may hide shared properties that make no sense
for it, and it may add at most 3 material-specific properties.

| Property | Visual meaning | Sound meaning | Primary? |
|---|---|---|---|
| Viscosity | Resistance to flow: slower diffusion, heavier drag, lagging response | Longer glide/slew, darker low-pass, softer attacks | Yes |
| Elasticity | Spring-back and overshoot toward rest | Resonance, feedback, pitch bounce and overshoot | Yes |
| Persistence | How long the wake remains: lower dissipation, longer trails | Longer release and sustain, longer reverb tail | Yes |
| Dispersion | Spread and scatter; turbulence | Stereo width, grain scatter, detune spread | Yes |
| Brightness | Luminance, saturation, glow | Spectral brightness: filter cutoff, harmonic content | Yes |
| Intensity | How strongly the signature pushes the material | Loudness and drive | Yes |
| Rigidity | Hard edges, crisp shapes, resistance to bending | Sharp attacks, pitch quantized to a scale, percussive envelopes | More |
| Density | Amount of material (dye, particle count, filament count) | Number of voices, grains, or pulses | More |
| Range | Compression ↔ expansion: spatial scale at which the signature is projected onto the field | Pitch range: narrow (compressed) ↔ wide (expanded) | More |

**Global composition controls** (not material properties):

| Control | Range | Default |
|---|---|---|
| Signature strength | 0–3 | 1 |
| Smoothing | 0–1 | 0.2 |
| Speed | 0.25–2× | signature's `preferredSpeed` |
| Loops | 1–8 | 1 |
| Tail | 0–10 s | 3 s |

**Linked mode** (default on): one slider per shared property drives both the visual
and sound material. Unlinked: two independent sets. Material-specific properties are
never linked. This directly serves Freeman's question about which auditory behaviors
correspond to viscosity, rigidity, elasticity, expansion, and compression.

**Slider behavior:** double-click resets to baseline; Shift-drag for fine control; arrow
keys nudge; value readout on hover/focus.

### 9.3 Mapping principle

Every material must let the signature's **timing** read clearly. A viewer or listener
should be able to feel the wink's moment of closing and opening in every
material, even when the texture is completely different. When a property setting fully
obscures the timing, that is allowed (it's a finding), but baselines must reveal it.

Mappings from features to material parameters are coded per material and documented
in `docs/MATERIALS.md` as tables. v0 has no user-editable mapping matrix.

### 9.4 Visual materials

All fluid materials share one adapted GPU solver in `materials/visual/shared/fluid/`,
based on Dobryakov's stable-fluids WebGL sim. Required adaptations:

- Remove mouse/touch input and random splats.
- **Signature forcing:** each step, upload the current `cols × rows` field as an RG
  float texture; a force shader samples it bilinearly across the whole sim domain
  (after the Range projection) and adds `force × Intensity × strength × dt` to velocity.
  Dye (or emission) is injected in proportion to force magnitude × Density.
- Add **true viscous diffusion** (Jacobi iterations on velocity, iteration count and ν
  from Viscosity). The original sim only has velocity dissipation, which is not
  viscosity; honey needs real viscosity.
- Keep its capability fallbacks for half-float/float render targets.
- Solver resolution by tier: draft 64, standard 128, high 256. Dye resolution: 256 / 512 / 1024.

| ID | Name | Concept and engine | Signature mapping highlights | Specific properties |
|---|---|---|---|---|
| V0 | Signature | Diagnostic, "bare wake": short strokes per grid cell, brightness by magnitude, direction by angle; optional feature readout. Used in Prepare, selectable in Studio. Not counted toward the five. | Direct field display | Show readout (choice) |
| V1 | Water | Fluid solver; colored dye in low-viscosity water, viewed from below. | Field → force; energy → dye emission; Persistence → dye dissipation; Dispersion → vorticity confinement + seeded forcing jitter; Brightness → dye intensity/bloom. Hides Elasticity, Rigidity. | Palette (choice: deep water, ink, prism); Surface light (cheap normal-from-dye-gradient shading that suggests looking up through liquid) |
| V2 | Honey | **Same solver as Water** with high viscous diffusion, low dye dissipation, amber palette, forcing low-passed for a heavy, lagging response. This pair is Freeman's bowl analogy made literal. | Viscosity → ν (high range); Elasticity → optional damped spring pulling velocity back via a displacement accumulator texture (implement if stable; otherwise hide and log the decision). | Palette; Surface light |
| V3 | Smoke | Solver + buoyancy (temperature field rises) + strong vorticity confinement; pale smoke on dark. | Energy → emission; divergence → emission burst radius; Persistence → dissipation; Dispersion → vorticity + turbulence noise. | Rise (buoyancy; negative values sink) |
| V4 | Descending bubbles | CPU particle system (typed arrays). Bubbles spawn at the top (seeded), drift down, and are pushed by the field sampled at their position. Drawn as instanced quads with a rim-lit bubble shader (bright rim, clear center). | Field → force; Viscosity → drag; Elasticity → wobble/scale oscillation after impulses; Persistence → lifetime; Dispersion → spawn spread + seeded random walk; Density → count (tier caps: 1.5k / 4k / 8k). | Fall speed; Size |
| V5 | Filaments | Ribbon trails: seeded anchor points across the field, each filament a polyline advected by the field; drawn as thin additive lines that fade. Suggests kelp, hair, or a curtain. | Rigidity → bending stiffness; Elasticity → spring toward anchors; Viscosity → drag; Persistence → trail fade; Density → filament count. | Length; Thickness |

Render surround is true black (`#000`) so wake colors aren't tinted by the UI.

### 9.5 Sound materials

Common behavior for all sound materials unless noted: pan follows `centroidX` (width
scaled by Dispersion); Intensity → gain; Brightness → low-pass cutoff or harmonic
content; Persistence → envelope release + reverb send. `flowY` stays in image
coordinates (y down), so upward movement is **negative** `flowY`; materials that want
"up = positive" use `−flowY`.

| ID | Name | Target character | Engine | Mapping highlights | Specific properties |
|---|---|---|---|---|---|
| A1 | Water | Quick, bright, rising: *"Breee-weet!"* | 1–3 sine/FM voices | Pitch = base + Range × f(upward flow, energy); glide time from Viscosity (short range); amplitude follows energy with fast attack; Brightness → FM index; Elasticity → overshoot/vibrato on acceleration spikes; Dispersion → detuned voices spread in stereo. | Register (choice: low, middle, high) |
| A2 | Honey | Low, slow, stuttering, drawn-out: *"Broo-roo-roo-roo-rooo-oot."* | Low saw/triangle through a resonant low-pass, with a smooth-square amplitude "stutter" LFO | Heavy slew from Viscosity (long range); stutter rate follows energy (faster movement, faster "roo"); falling energy at gesture end → downward glide (the "oot"); Density → stacked voices. | Stutter depth |
| A3 | Breath | Air, inhale and exhale | Seeded noise through a band-pass (plus optional formant filters) | Band center follows vertical centroid + Brightness; bandwidth follows spread × Dispersion; amplitude follows energy; **divergence** swells and opens the filter (expansion = inhale), contraction closes it. | Formant (choice: none, "ah", "oo") |
| A4 | Resonance | Struck and bowed bodies: glass, wood, metal | Modal resonator bank (6–12 modes; biquads or an AudioWorklet) excited by impulses at onsets and by energy-scaled noise | Rigidity → inharmonicity and strike hardness; Elasticity → mode decay/Q; Range → mode pitch spread; onset strength → strike velocity. | Body (choice: glass, wood, metal) |
| A5 | Pulse | Rhythmic plucks and ticks | Karplus-Strong plucks in an AudioWorklet (or short noise bursts through a feedback delay) | Pulse rate follows energy (Range sets min/max); `density` feature → per-pulse firing probability (seeded); Rigidity → timing quantized to a steady grid vs. free; pitch from `centroidY`, quantized to a scale when Rigidity is high; Persistence → pluck decay. | Scale (choice: free, pentatonic, whole-tone) |

Loops must be click-free at loop boundaries (short crossfades or continuous state).

---

## 10. Rendering and export

### 10.1 Render dialog

- Resolution: **720p** (1280×720, default on slower machines), **1080p** (1920×1080),
  **Square** (1080×1080).
- Frame rate: **30** (default) or 60.
- Quality tier: High by default (independent of the preview tier).
- Audio: 48 kHz stereo; normalize to −1 dBFS toggle (on).
- Save a composition sidecar (`.spcomp.json`) next to the MP4 (on in Album mode).
- Estimated time is shown once the first frames complete.

### 10.2 Pipeline

1. Pause preview. Create a dedicated render canvas at output size (separate WebGL2
   context) so the preview context is untouched.
2. Instantiate fresh material instances; `init`, then `reset(seed)`.
3. **Audio first:** build the sound material on an `OfflineAudioContext` of the full
   timeline duration, `schedule()` once, `startRendering()`, and normalize if enabled.
4. Create a Mediabunny MP4 `Output` with a `CanvasSource` (AVC) and an audio source fed
   from the rendered `AudioBuffer` (AAC preferred).
5. For frame `i` in `0..N−1`: `t = i / fps`; step the simulation at a fixed 1/60 s until
   sim time ≥ `t`; `draw()`; add the canvas frame with timestamp `t` and duration
   `1/fps`; update progress; yield to the UI regularly; honor cancel.
6. Add audio, finalize, and write the file:
   - Chrome: prefer the File System Access API (the user picks a folder once per
     session; stream to disk to avoid holding the whole MP4 in memory).
   - Fallback: download a Blob.
7. Filename: `SP_{signature}_{composition}_{seed}.mp4`, sanitized.

### 10.3 Codec capability and fallbacks

At startup (and on Diagnostics), check with Mediabunny's codec capability helpers:

- AVC encode at 1920×1080 and 1280×720.
- AAC audio encode.

If 1080p AVC isn't available, offer 720p with an explanation. If AAC isn't available,
fall back to Opus-in-MP4 and warn that some players (e.g., QuickTime) may not play the
audio. Milestone 0 must determine actual behavior on Windows Chrome and macOS Chrome.

---

## 11. Persistence and file formats

### 11.1 Browser storage (IndexedDB via idb)

| Store | Contents |
|---|---|
| `signatures` | `KineticSignature` records |
| `compositions` | `Composition` records, including thumbnails |
| `albums` | `Album` records |
| `clips` | Optional source clips (off by default; large) |
| `settings` | App settings |
| `workingState` | Studio autosave (debounced ~1 s) so a crash loses nothing |

On the first save, call `navigator.storage.persist()`. Show storage usage in Settings.

### 11.2 Composition format (`.spcomp.json`)

```ts
interface Composition {
  format: 'sp-composition';
  version: 1;
  id: string;
  name: string;
  createdAt: string; updatedAt: string;
  signature: { id: string; contentHash: string; name: string };
  seed: number;
  timeline: { speed: number; loops: number; loopMode: 'loop' | 'pingpong';
              tailSec: number; smoothing: number; signatureStrength: number };
  linked: boolean;
  visual: { materialId: string; materialVersion: number; properties: PropertyValues };
  sound:  { materialId: string; materialVersion: number; properties: PropertyValues };
  mute: { visual: boolean; sound: boolean };
  chance: null | {
    albumId?: string; index?: number; masterSeed?: number;
    openProperties: string[];     // properties chance made available to play
    overrides: string[];          // locked properties the artist deliberately changed
  };
  render: { width: number; height: number; fps: 30 | 60 };
  status: 'draft' | 'kept' | 'set-aside';
  notes: string;                  // research record: discoveries, failures, revisions
  thumbnail?: string;             // small data URL
}
```

If a composition's `materialVersion` differs from the installed material, show a
gentle notice: "This material has changed since this composition was saved; it may
look or sound different."

### 11.3 Files

| File | Purpose |
|---|---|
| `.sig.json` | One signature |
| `.spcomp.json` | One composition (references its signature by id and hash) |
| `.spalbum.json` | One album and its composition ids |
| `.spbackup.zip` | Everything: signatures, compositions, albums (clips optional); built with fflate |
| `ALBUM_LOG.md` | Human-readable album record (section 12.3) |

Importing a composition whose signature is missing prompts the user to import the
signature (matched by `contentHash`).

---

## 12. Chance procedures and Album mode

### 12.1 Seeds and PRNG

- `src/chance/prng.ts`: a small, well-known 32-bit PRNG (sfc32 or mulberry32) with a
  `hash32(...ints)` mixer for deriving seeds.
- Seeds are shown to the user as 6-digit numbers and are editable. "New seed" draws one
  from `crypto.getRandomValues` (the only allowed entropy source, used solely to *pick*
  a seed; everything downstream is deterministic).
- Per-composition seed in an album: `hash32(masterSeed, index)`.

### 12.2 Draw by chance (Studio)

*Interpretation of the write-up; log it in DECISIONS.md and confirm with Freeman after
handover.* The write-up says chance may determine the visual material, the auditory
material, and "the properties available for modulation." v0 implements:

- Chance picks one visual material and one sound material from an **eligible pool**
  (checkboxes; all by default).
- Chance picks **K open properties** (K = 1–3, default 2) from the shared vocabulary.
  Open properties are playable; all others are **locked at baseline** (dimmed, with a
  lock icon).
- The artist may deliberately unlock a locked property; the composition records it
  under `overrides` so the record stays honest.
- Optional **"Also choose values"**: chance sets the open properties to seeded values.

### 12.3 Album mode

1. **New album:** title, source signature, track count N (1–40, default 25), master
   seed, eligible materials, K open properties, and a pairing strategy:
   - **Pure chance:** independent seeded draws per track.
   - **Grid:** every eligible visual × sound pair exactly once (5 × 5 = 25), in
     seeded-shuffled order. If N differs from the number of pairs, fill or truncate
     deterministically and say so.
2. **Generate:** creates N draft compositions (`01`, `02`, …) with derived seeds.
   The same master seed and settings produce identical drafts on any machine.
3. **Work the album:** a track list with status (draft / kept / set aside), notes
   preview, and open-in-Studio. Nothing is ever deleted by default: set-aside tracks
   stay in the record (the write-up asks to keep failed mappings).
4. **Batch render:** render selected tracks unattended to a chosen folder, with
   per-track progress, a pause/cancel control, and a summary on completion.
5. **Export album log:** `ALBUM_LOG.md` + `.spalbum.json`. The log lists, per track:
   number, name, status, visual and sound material, open properties, final values,
   overrides, seed, render filename, and notes. The header records the signature name
   and hash, master seed, pairing strategy, and date.

---

## 13. Interface and design direction

### 13.1 Principles

- **The wake is the hero.** The canvas dominates; UI chrome recedes. Presentation
  mode removes chrome entirely.
- **The source disappears.** Studio never shows the clip.
- **Plain language, artist vocabulary.** Follow the glossary. Engineering terms live
  only in Advanced and Diagnostics.
- **Few controls, all meaningful.** At most 6 primary sliders per material; each must
  visibly or audibly change the wake in the direction its label promises.
- **Sliders, not knobs.** Horizontal sliders with large hit areas are easier on a
  trackpad than rotary knobs.
- **Safe to explore.** Undo/redo, snapshots, autosave, and confirmation only on
  destructive actions.
- **Errors direct, they don't apologize.** Say what happened and what to do next.
- **Motion answers action.** No decorative animation in the chrome. One optional
  first-launch moment (the dedication splash, M8).

### 13.2 Tokens (proposal; grounded in "the view from beneath the bowl")

| Token | Hex | Role |
|---|---|---|
| Deep | `#0E1A24` | App background: submerged blue, not neutral black |
| Basin | `#172733` | Panels |
| Silt | `#5E6F7A` | Secondary text, dividers, inactive controls |
| Pearl | `#E8E4DA` | Primary text |
| Honey | `#D9A441` | The single accent: active, selected, recording/rendering |
| Water | `#7FB7C9` | Linked state and sound-related highlights |
| Surround | `#000000` | Canvas letterbox only |

- **Type:** Atkinson Hyperlegible Next (self-hosted), weights 300/400/600. One family.
  Sentence case everywhere; no all-caps labels. Minimum 14 px UI text.
- **Accessibility floor:** visible keyboard focus, WCAG AA contrast, 32 px minimum hit
  targets, `prefers-reduced-motion` respected for UI motion.

### 13.3 Studio layout (reference wireframe)

```
+----------------------------------------------------------------------+
| Library / Wink 01 / Track 07                       Save   Render MP4 |
+------------------------------------------------+---------------------+
|                                                | Visual: Honey    v  |
|                                                |  Viscosity   ----o- |
|                                                |  Persistence --o--- |
|              the wake (canvas)                 |  ...        More    |
|                                                |---------------------|
|                                                | Sound: Breath    v  |
|                                                |  [x] Linked         |
|                                                |  ...                |
|                                                |---------------------|
|                                                | Notes               |
+------------------------------------------------+---------------------+
| > play  loop  |----o-------------| 0:03 / 0:11   A B C D   Draw by chance |
+----------------------------------------------------------------------+
```

### 13.4 Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play / pause |
| L | Loop on/off |
| 1–4 | Recall snapshot A–D |
| Shift+1–4 | Store snapshot A–D |
| C | Draw by chance |
| S | Save |
| R | Render MP4 |
| F / Esc | Enter / exit presentation mode |
| Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z | Undo, redo |

---

## 14. Performance and compatibility

### 14.1 Capability checks (startup + Diagnostics screen)

| Check | Required? | If missing |
|---|---|---|
| WebGL2 | Yes | Block with explanation |
| Float or half-float color render targets + linear filtering | Yes (half-float acceptable) | Block with explanation |
| Web Audio + AudioWorklet | Yes | Block with explanation |
| WebCodecs video decode of the imported clip | Yes | Clip-specific message (8.1) |
| AVC encode at 1080p / 720p | Yes (720p minimum) | Offer 720p only |
| AAC encode | Preferred | Opus fallback with warning |
| File System Access API | No | Downloads instead of folder saving |
| `navigator.storage.persist()` granted | No | Warn that the browser may clear data; urge backups |

Diagnostics also reports the GPU renderer string (via `WEBGL_debug_renderer_info` if
available), OS, Chrome version, and the benchmark result. **Copy report** puts it all on
the clipboard as plain text.

### 14.2 Quality tiers

| Tier | Fluid sim | Dye | Bubbles | Filaments |
|---|---|---|---|---|
| Draft | 64 | 256 | 1,500 | 150 |
| Standard | 128 | 512 | 4,000 | 400 |
| High | 256 | 1024 | 8,000 | 800 |

On first launch, run a ~3 s benchmark (Water material, synthetic signature) and pick
the highest preview tier that sustains ≥ 30 fps. The user can override it in Settings.
Render defaults to High regardless of the preview tier.

### 14.3 Budgets

| Metric | Target |
|---|---|
| Preview frame rate | ≥ 30 fps at the auto-selected tier on the target machine |
| Extraction time | 10 s clip at 30 fps in ≤ 60 s on the target machine |
| Render | No realtime requirement; progress, ETA, cancel |
| App load (first visit) | OpenCV.js loads lazily, only when extraction starts |
| Memory | No decoded frames retained; typed-array reuse in hot paths |

---

## 15. Testing and QA

### 15.1 Automated

- **Unit (Vitest):** PRNG determinism; `hash32`; feature math on synthetic vector fields
  (uniform translation, radial expansion/contraction, rotation, zero field); stats and
  normalization; sampler interpolation, loop/pingpong, tail, and smoothing (zero-phase,
  random access); serialization round trips and migrations; album generation (same
  master seed → identical drafts; grid strategy covers every pair once).
- **Extraction integration:** run the pipeline on `tests/fixtures/` clips and assert the
  expected feature signs from 8.5.
- **Audio determinism:** render 2 s of each sound material offline twice with the same
  inputs → bitwise-identical buffers.
- **Visual determinism:** render the same composition twice on the same machine and
  compare frame hashes; report any mismatch (tiny GPU float differences are tolerable
  but must be investigated once).
- **E2E (Playwright, Chromium):** import fixture → extract → open Studio → switch
  materials → save composition → render a 2 s MP4 → file exists and duration is within
  one frame of expected.

### 15.2 Manual matrix

| Environment | Checks |
|---|---|
| Windows 11 + Chrome (Braden) | Full workflow; MP4 plays in Windows Media Player and VLC |
| macOS + Chrome (Freeman's MBP or a borrowed Mac) | Diagnostics pass; tier benchmark; full workflow; MP4 plays in QuickTime |
| Real iPhone clip (H.264 "Most Compatible") | Imports and extracts |
| Real iPhone clip (HEVC) | Clear message if undecodable |

### 15.3 Artist test

Before handover, Braden completes the whole workflow on a Mac **using only
`USER_GUIDE.md`**, and records every point of friction. Fix or document each.

---

## 16. Milestones

Each milestone ends with lint + tests green, an acceptance report, and a list of manual
checks for Braden. Do not begin the next milestone without his go-ahead.

### M0: Foundation and spikes

**Build:** Vite + React + TS strict scaffold; ESLint (including the determinism rules
from CLAUDE.md), Prettier, Vitest, Playwright; token CSS and self-hosted font;
Diagnostics screen (section 14.1).

**Spikes** (in `spikes/`, results logged in DECISIONS.md):
1. OpenCV.js self-hosted, loaded in a worker; Farneback on two frames; record load time and size.
2. Mediabunny decodes an H.264 MP4 and an H.264 MOV frame-accurately (in the worker if possible).
3. Mediabunny encodes a 3 s canvas animation + generated tone to MP4 (AVC + AAC); the
   file plays in QuickTime and Windows Media Player.
4. WebGL2 half-float/float render targets with linear filtering.
5. Dobryakov fluid sim running inside a React canvas, driven by a scripted force instead of the mouse.

**Accept:** all spikes pass on Windows Chrome; a written Mac test checklist exists for
Braden; Diagnostics runs and copies a report.

### M1: Signature

**Build:** Library skeleton; Prepare screen (import, player, trim, speed, rotate/mirror,
focus area, sensitivity); extraction worker with progress/cancel; features, stats, hash;
save/load in IndexedDB; `.sig.json` export/import; V0 Signature view with sparklines;
Hide source toggle; synthetic fixtures + tests.

**Accept:** fixture feature signs match 8.5; a real wink clip with a focus area produces
a visibly localized, coherent field; exporting and re-importing a signature yields the
identical `contentHash`; the source clip cannot appear anywhere outside Prepare.
*(Since 2026-10-08 the Studio's clip layer shows it on request; see C7 and 6.3.)*

### M2: Engine, Studio, V1 Water

**Build:** transport (play, pause, loop, loops, tail, scrub with seek-by-fast-forward);
fixed-step clock; property system with the shared vocabulary; sliders with reset/fine/
keyboard; global controls; quality tiers + benchmark; the adapted fluid solver with
signature forcing and true viscosity; V1 Water; V0 selectable in Studio; presentation mode.

**Accept:** a wink visibly and repeatably drives Water; replay with the same seed and
properties looks the same; every visible slider changes the wake in the direction its
label promises; ≥ 30 fps at Standard on Braden's machine.

### M3: Sound engine and A1 Water

**Build:** audio engine (lookahead preview scheduler; offline path); master chain;
procedural reverb; seeded noise buffers; A1 Water; Linked/unlinked properties;
mute/solo.

**Accept:** offline renders of A1 are bitwise identical across runs; preview and offline
sound the same by ear; rising motion audibly rises in pitch; no clicks at loop boundaries.

### M4: Render MP4

**Build:** render dialog; offline pipeline (10.2); progress, ETA, cancel; folder save
with download fallback; sidecar JSON; capability fallbacks (10.3).

**Accept:** a 1080p30 MP4 with sound plays in QuickTime and Windows players; audio and
video align within one frame at an onset; duration is within one frame of expected; two
renders of the same composition are perceptually identical.

### M5: Library, compositions, comparison

**Build:** composition save/load/duplicate/rename/delete; notes and status; thumbnails;
Studio autosave; undo/redo; snapshots A–D (instant switch, playhead preserved); backup
and restore zip; storage usage and persistence request.

**Accept:** closing and reopening Chrome restores everything; a backup restores into a
fresh browser profile; switching snapshots never restarts playback.

### M6: Materials library

**Build:** V2 Honey, V3 Smoke, V4 Descending bubbles, V5 Filaments; A2 Honey, A3 Breath,
A4 Resonance, A5 Pulse. Each with baseline, description, Help text, and a mapping
table in `docs/MATERIALS.md`.

**Accept:** "same signature, different wake" review: played side by side (via
snapshots), the wink's timing reads in every material at baseline; every primary slider
in every material does something visible or audible; each visual material holds
≥ 30 fps at Draft on Braden's machine.

### M7: Chance and Album

**Build:** seed UI; Draw by chance with eligible pool, open/locked properties, overrides;
Album creation (pure chance and grid); track list with status; batch render to folder;
`ALBUM_LOG.md` + `.spalbum.json` export.

**Accept:** the same master seed produces identical drafts on Windows and macOS; a
25-track grid album of ~10 s tracks batch-renders unattended (report total time on
Braden's machine); set-aside tracks appear in the log.

### M8: Handover polish

**Build:** first-run onboarding (three screens at most) with a bundled sample signature;
Help screen; `USER_GUIDE.md` (Freeman-facing, plain language, screenshots);
`ARCHITECTURE.md`; `ADDING_A_MATERIAL.md`; offline support via service worker;
deployment to GitHub Pages (or a free Vercel tier); a ~15-minute walkthrough video
script for Braden to record; optional dedication splash ("Made for Freeman") toggled
in Settings.

**Accept:** Braden completes the full workflow on a Mac using only the guide; the app
loads and works with Wi-Fi off after the first visit; Diagnostics passes on Freeman's
MacBook Pro.

---

## 17. Risks and mitigations

| Risk | Mitigation |
|---|---|
| OpenCV.js is large or awkward in a worker | Lazy-load; M0 spike; fallback to main-thread decode with worker compute; last resort: custom block-matching or GPU Lucas–Kanade |
| iPhone HEVC clips don't decode | Detect early; clear instructions (Most Compatible / convert) |
| AAC encoding unavailable on a platform | Capability check; Opus fallback with warning; decided in M0 |
| Freeman's Mac is old and slow | Quality tiers + benchmark; offline render decouples final quality from GPU speed |
| Braden has no Mac for testing | Borrow one for M0, M4, and M8 checkpoints; Diagnostics copy-report for remote checks |
| Preview and render drift apart | Shared material code; fixed timestep; determinism tests |
| Browser clears IndexedDB | Persistence request; prominent backup; storage warning |
| Wakes obscure the signature | Mapping principle (9.3); baselines tuned to reveal timing; V0 always available for comparison |
| Scope creep | Milestone gates; out-of-scope list (5.2); new ideas go to section 19 |
| Surprise means no input from Freeman | Treat v0 as a draft he co-directs; every judgment call logged in DECISIONS.md |

---

## 18. Questions for Freeman after handover

1. Recorded clips worked for v0; when should live camera input come next, if at all?
2. Is "chance opens K properties and locks the rest" the right reading of *"properties
   available for modulation"*?
3. Which materials reveal the signature for him, and which obscure it? Which should be
   added, cut, or reworked?
4. Album format: resolution/aspect, track length, whether visual-only or sound-only
   tracks are allowed.
5. Is the amount of control right, too little, or burdensome?
6. What names does he want for the materials and properties?

---

## 19. After v0 (parking lot)

- Live camera signature source
- Alternative extractors (face, hand, or body landmarks)
- User-editable feature → parameter mapping
- More materials: flocking, ribbons of light, color fields, harmony-based sound
- Multiple signatures per composition
- MIDI/OSC output to other instruments
- Installation / gallery mode
- Desktop wrapper (e.g., Tauri) if browser limits start to bite
