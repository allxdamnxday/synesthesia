# Spike 1 results: OpenCV.js in a worker

**Verdict: pass on Windows 11 + Chrome 153 (headless), in both the dev server and the
production build.** The production loader (`src/signature/opencv.ts`) is what the spike
runs, so these numbers describe the real extraction path.

How it was run (2026-09-28):

```
npx vite --port 5201 --strictPort                       # dev
npx vite build && npx vite preview --port 4201 --strictPort   # production build
node spikes/01-opencv/run-headless.mjs http://localhost:5201/ spikes/01-opencv/
node spikes/01-opencv/run-headless.mjs http://localhost:4201/ spikes/01-opencv/
```

Machine: Braden's Windows 11 desktop, 12 logical CPUs, NVIDIA GTX 1660 SUPER, Chrome 153
headless (`channel: 'chrome'`).

## How loading works

- The page resolves the absolute URL of `public/vendor/opencv/opencv.js` and passes it to a
  **module worker** (`new Worker(new URL(...), { type: 'module' })`).
- Module workers can't call `importScripts()`, so the worker `fetch`es the file and runs it
  with an **indirect eval**. The UMD wrapper sees `importScripts` (it exists, it just throws
  in module workers), takes its web-worker branch and sets `self.cv`.
- `self.cv` here is a legacy Emscripten module: a *thenable* whose `then(cb)` calls
  `cb(Module)`. `await cv` would loop forever (the promise machinery keeps finding `then`).
  The loader never awaits the module: it waits through `then(cb)` (or `onRuntimeInitialized`
  on builds without `then`, or a real Promise on newer builds), deletes the `then` hook, and
  hands the module out wrapped as `{ cv }`.
- Fallback: in a classic worker, `importScripts(url)` works too (checked with a blob
  worker). The production loader tries fetch + eval first and `importScripts()` second.

| | Dev server (`vite`) | Production build (`vite build` + `vite preview`) |
|---|---|---|
| Module worker, fetch + indirect eval | **works** | **works** |
| Classic worker, `importScripts()` | works | works |

## Numbers

| Check | Dev server | Production build | Target |
|---|---|---|---|
| File size | 10,964,323 bytes (10.46 MiB), wasm embedded | same | — |
| Time to ready, cold cache | 501 ms (fetch 56, eval 250, runtime init 181) | 874 ms (fetch 381, eval 261, init 222) | — |
| Time to ready, warm cache (new worker) | 497 ms (fetch 53, eval 245, init 181) | 505 ms (fetch 52, eval 249, init 188) | — |
| Longest main-thread frame gap while loading | 18.2 ms | 18.7 ms | < 50 ms |
| `typeof cv.calcOpticalFlowFarneback` | `function` | `function` | function |
| Known shift (+3, −2) px, median flow | (2.975, −1.983); error (−0.025, +0.017) | same | ±0.25 px |
| Zero shift, median flow | (0.0000, −0.0000); largest component 0.0000 px | same | ≈ 0 |
| Blur + Farneback per frame, 320×180, 50 runs | 18.7 ms avg (min 15.3, max 32.3) | 18.9 ms avg (min 15.5, max 26.3) | — |
| Projected flow time, 10 s at 30 fps (300 frames) | ≈ 5.6 s | ≈ 5.7 s | ≤ 60 s on a 2017 MBP |
| wasm heap before / after 200 frames / after 20 engines | 134,217,728 bytes, unchanged | unchanged | stable |
| Classic worker `importScripts()` | 302 ms + 195 ms init | 296 ms + 215 ms init | works |

Notes:

- Farneback params are SPEC 8.1's defaults (`pyrScale 0.5, levels 3, winsize 15,
  iterations 3, polyN 5, polySigma 1.2`), preceded by a 5×5 Gaussian blur.
- **Headroom:** ≈ 5.7 s of flow for a 10 s clip here leaves about 10× headroom against the
  60 s budget. A 2017 dual-core Intel MacBook Pro is typically 2–3× slower per core than
  this desktop, which would still be ≈ 12–17 s of flow plus decode. Extraction timings from
  the real pipeline (decode + draw + flow) are in the Milestone 1 report.
- Cold-cache fetch time here is from localhost. Over the internet the first visit
  downloads ~10.5 MB once (the static host compresses it); after that the browser cache
  serves it. OpenCV loads only when extraction starts (SPEC 14.3).
- The build is single-threaded and needs no cross-origin-isolation headers.
- The first second after page load is excluded from the frame-gap measurement: headless
  Chrome's first frames after navigation took 99–194 ms with or without the worker.
- The wasm heap is 128 MiB from the start; it did not grow over 200 frames or 20
  create/dispose cycles, so every `Mat` is being deleted.

## Full extraction pipeline (Milestone 1)

Measured through `dev/extraction/` (headless Chrome 153, dev server, OpenCV already loaded)
on 10 s, 30 fps clips (300 analysis frames), after one warm-up run. Each frame is decoded,
drawn (rotated, cropped, resized) onto a canvas, read back as grayscale, blurred, run
through Farneback against the previous frame, and pooled.

| Source clip | Analysis frame | Per analysis frame | 10 s clip |
|---|---|---|---|
| 320×180 H.264 | 320×180 | 23.5–25.6 ms | 7.3–8.9 s |
| 1920×1080 H.264 | 320×180 | 27.9–33.8 ms | 8.5–10.3 s |
| 1080×1920 H.264 (portrait), first version | 320×569 | 77.6–85.3 ms | 23.6–26.0 s |
| 1080×1920 H.264 (portrait), now | 180×320 | 30.2–34.9 ms | 9.5–10.8 s |

The first version made the analysis frame 320 *wide* (SPEC 8.1's wording), so a portrait
clip's was 569 px tall and cost about 3× as much. The `analysisWidth` option now sets the
*longer* side (see DECISIONS), so portrait costs the same as landscape. Portrait grids stay
32×48 (rows follow the aspect ratio, clamped to 48), so their signatures are about 2.6×
larger than landscape ones (4.9 MB vs 1.9 MB of JSON for 10 s at 30 fps). First
extraction in a session adds about 0.5–1 s to load OpenCV.

## Mac checks for Braden

Open `spikes/01-opencv/` from a build on the Mac (served over `localhost` or HTTPS) in
Chrome and press **Copy results**. Record: time to ready (cold and warm), longest frame gap,
ms per frame, and the heap line. On a Mac the speed check passes when the projected 10 s
time is ≤ 60 s (elsewhere it asks for ≤ 20 s, leaving room for a slower Mac).
