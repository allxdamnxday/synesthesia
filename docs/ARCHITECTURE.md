# Architecture

How the instrument is put together. Read with `SPEC.md` (what it must do) and
`docs/CONVENTIONS.md` (how code is written). This document is kept current as the build
progresses.

## Pipeline

```
Clip ──► Prepare (trim, speed, rotate, mirror, focus area, sensitivity)
          │
          ▼
     Extract (worker: decode ─► transform ─► grayscale ─► Farneback ─► grid pool
          │                    ─► noise floor ─► smoothing ─► features ─► stats ─► hash)
          ▼
     Signature (.sig.json; immutable; hashed; no source pixels)
          │
          ▼
     SignatureSampler (composition time → interpolated field + features;
          │            speed, loops, pingpong, tail, smoothing, strength)
          ├──────────────────────────────┐
          ▼                              ▼
   Visual material (WebGL2)        Sound material (Web Audio)
   stepped by VisualRunner         scheduled in windows by AudioEngine (preview)
   at a fixed 1/60 s               or in one call by renderSoundOffline (render)
          │                              │
          ▼                              ▼
   Preview canvas  ◄── same code ──►  Offline render ─► Mediabunny ─► MP4
```

## Folders

| Folder | Responsibility | Deterministic? |
|---|---|---|
| `src/signature/` | Signature format, extraction (worker), features, hash, sampler, serialization | yes |
| `src/engine/` | Composition model, fixed-step runner, property model, history, snapshots, audio engine, seeds | yes |
| `src/materials/` | Material interfaces, shared vocabulary, registry, visual and sound materials | yes |
| `src/chance/` | Seeded PRNG, draw by chance, album planning and log | yes |
| `src/render/` | Capability checks, offline render to MP4 | yes |
| `src/library/` | IndexedDB storage, import/export, backup, thumbnails | no |
| `src/state/` | Zustand stores for the UI | no |
| `src/studio/`, `src/screens/`, `src/ui/`, `src/app/` | Screens, preview loops, UI components, shell | no |
| `src/perf/` | Benchmark (wall-clock timing) | no |

"Deterministic" folders are guarded by ESLint: no clock reads or browser randomness.

## Time

- All engine time is **composition time** in seconds. Timeline length =
  `signatureDuration / speed × loops + tail` (`timelineDuration()` in `src/engine/composition.ts`).
- The visual simulation advances in fixed steps of 1/60 s through `VisualRunner`
  (`src/engine/visualRunner.ts`). Step k is driven by the signature frame sampled at
  k/60 s. To show time t it steps until simulation time ≥ t: 2 steps per frame at 30 fps,
  1 at 60 fps. Preview and render use this same class.
- **Seeking** resets the material to its seeded initial state and fast-forwards steps
  without drawing (spread over animation frames, with a "catching up" hint when slow).
- In preview, the **audio clock is the master**: `AudioEngine.compositionTime()` (from
  `AudioContext.currentTime`) says where the playhead is, and the visual loop steps the
  simulation to that time each animation frame. The visual never skips steps; on a slow
  machine it falls behind rather than diverging from what a render would show.
- Changing anything that alters the past (seed, signature strength, smoothing, speed,
  loops) re-seeks the visual to the current playhead. Changing a property only affects
  steps from now on (in preview) and is applied from t = 0 in a render.

## Seeds

A composition's 6-digit seed is expanded by `src/engine/seeds.ts`: `visualSeed(seed)` goes
to `VisualMaterial.reset()` and the context `rng`; `soundSeed(seed)` goes to
`SoundMaterial.build()`. Preview and render must both use these helpers.

## Studio runtime (preview)

1. Load the composition and its signature; `createSampler(signature)` and configure it
   from the composition's timeline (speed, loops, loopMode, tail, smoothing, strength).
2. Create the visual material from the registry, `init()` it with a WebGL2 context on the
   preview canvas (backing size capped by the preview quality tier), then wrap it in a
   `VisualRunner`.
3. Create the `AudioEngine`, `load()` the sound material with the sampler, properties and
   `soundSeed(seed)`.
4. Each animation frame: read the playhead (audio clock while playing), advance the runner
   (with a per-frame step budget), draw. At the end of the timeline: loop back to 0 if the
   loop toggle is on, otherwise stop.
5. Property edits go through the property model (`src/engine/propertyModel.ts`, Linked
   mode) and undo history (`src/engine/history.ts`); the sound engine reschedules from
   "now" (`cancelFrom` + `schedule`).
6. Switching a material disposes the old instance, creates a fresh one, and seeks it to
   the playhead. Shared property values carry over; specific ones start at baseline.

## Render (offline)

`renderComposition()` (`src/render/`, loaded on first use as its own chunk) follows SPEC 10.2:

1. A dedicated render canvas at output size with its own WebGL2 context; fresh material
   instances from the registry at the requested quality (High by default); a sampler
   configured with `samplerConfigFor()` (the same helper the Studio preview uses).
2. The sound is rendered first with `renderSoundOffline()` (48 kHz stereo, one scheduling
   pass), peak-normalized to −1 dBFS unless "Even out loudness" is off.
3. A Mediabunny MP4 output (`fastStart: 'reserve'`, so files are fast-start even when
   streamed into a folder) with a `CanvasSource` (H.264 at the quality Diagnostics verified)
   and an `AudioBufferSource` (AAC at the bitrate Diagnostics verified, Opus as fallback).
   Sound is fed to the encoder in 1 s pieces about a second ahead of the frames.
4. For frame i: advance a `VisualRunner` to t = i / fps (2 fixed steps per frame at 30 fps),
   draw, add the frame; yield through a message channel (background tabs aren't throttled).
5. Finalize into a folder (File System Access, streamed, never overwriting: " (2)") or a
   download; optional `.spcomp.json` sidecar. Cancel deletes the partial file.

`renderBatch()` renders album tracks one after another into one folder; the Album screen's
batch panel (`src/screens/Album/batch/`) drives it with pause, cancel and a summary.

## Persistence

IndexedDB database `synesthesia` (`src/library/db.ts`): signatures (+ a lightweight
`signatureMeta` list store), compositions, albums, clips (unused by default), settings,
and the Studio's working state (autosave). Files: `.sig.json`, `.spcomp.json`,
`.spalbum.json`, `.spbackup.zip`, `ALBUM_LOG.md` (SPEC 11.3). The Library's Import file
action recognises signature, composition and album files by their contents. Persistent
storage is requested on the first save.

## Screens

| Route | Screen |
|---|---|
| `#/` | Library: signatures, albums, compositions; import, backup, restore |
| `#/prepare` | Prepare: clip → signature (the only screen that ever shows a clip) |
| `#/signature/:id` | A saved signature's bare wake and features |
| `#/studio/new/:signatureId`, `#/studio/:compositionId` | Studio |
| `#/album/new/:signatureId`, `#/album/:albumId` | Album mode |
| `#/settings`, `#/help`, `#/diagnostics` | Settings, Help, Diagnostics |

App-level pieces in `src/app/`: the startup capability gate, the first-run introduction
(Library only, until finished or skipped) and the optional dedication, a hash router, and a
file-drop guard (a clip dropped on any screen opens in Prepare; the browser never
navigates away to play it). First-run overlays stay out of automated browsers unless forced
with `?introduction=1` / `?dedication=1`.
