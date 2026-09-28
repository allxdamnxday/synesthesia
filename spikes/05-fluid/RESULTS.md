# Spike 5 results: fluid simulation in React, driven by a scripted force

**Outcome: PASS on the builder's machine (2026-09-28).** Still to do: run it on a Mac
(checklist at the end).

The page mounts the real V1 Water material (the shared fluid solver in
`src/materials/visual/shared/fluid/`) in a `<FluidCanvas>` React component, under
`<StrictMode>`, and drives it with the synthetic wink at a fixed step of 1/60 s using an
accumulator against `requestAnimationFrame`. There are no mouse or keyboard handlers
anywhere: only the signature moves the water.

## How to run it

- In a browser: `npm run dev`, open `/spikes/05-fluid/`, press **Run checks**, then
  **Copy results**. (`?run=1` starts the checks on load.)
- Headless, printing the report: `node spikes/05-fluid/run-headless.mjs` starts a Vite
  dev server on port 5204 (dev mode, so React StrictMode double-mounts every effect) and
  runs the page in headless Chrome. `--url <address>` runs it against another server.
  It exits 1 if a check fails or Chrome logs "Too many active WebGL contexts".
- In the e2e suite: `tests/e2e/visual.spec.ts` runs the same page against the
  production build and fails on any console error or context warning.

## Machine

| | |
|---|---|
| OS / browser | Windows 11, Chrome 153 (headless, real GPU) |
| GPU | ANGLE (NVIDIA GeForce GTX 1660 SUPER, Direct3D11) |
| Render targets | half-float, RG, linear filtering (no fallback needed) |
| Timer queries | `EXT_disjoint_timer_query_webgl2` available |

## Checks

| Check | Dev server (StrictMode active) | Production build (e2e) |
|---|---|---|
| (a) 20 mount/unmount cycles leak no WebGL contexts | PASS: 40 contexts created (StrictMode mounts twice), 40 released, 0 live, 0 lost, no "Too many active WebGL contexts" warning | PASS: 20 created, 20 released, 0 live, 0 lost, no warning |
| (b) Determinism: reset, 120 fixed steps, draw, read pixels, SHA-256; repeat after reset; repeat on a fresh instance | PASS: `38ff728ee5af…` three times | PASS: `38ff728ee5af…` three times |
| Standard sustains ≥ 30 fps at 1× | PASS: 59.4 fps | PASS: 58.5 fps |
| Every context released, none lost | PASS: 56 created, 56 released | PASS: 29 created, 29 released |

The hash is also identical across separate browser sessions and between the dev and
production builds, so a render made today matches one made tomorrow on the same machine.

How leaks are counted: every canvas's context is created and released through
`contexts.ts`, which counts both and listens for `webglcontextlost` on contexts we still
hold (Chrome kills the oldest context once 16 are live). Each `<FluidCanvas>` mount makes
a fresh canvas and releases its context with `WEBGL_lose_context` on unmount; a canvas
whose context was released can't get another one, which is why the component creates its
canvas instead of rendering it as JSX.

## Frame rate: (c) each tier at 1× and 2× backing-store resolution, ~2 s each

CSS size 960×540; 2× means a 1920×1080 backing store (a Retina display at that size).

| Quality | Scale | Backing | fps | Steps/s | Dropped | Burst ms/frame | GPU ms/step | GPU ms/draw |
|---|---|---|---|---|---|---|---|---|
| Draft | 1× | 960×540 | 59.9 | 59.3 | 0 | 0.47 | 0.239 | 0.121 |
| Draft | 2× | 1920×1080 | 60.0 | 60.0 | 0 | 0.82 | 0.155 | 0.110 |
| Standard | 1× | 960×540 | 59.4 | 58.8 | 0 | 0.45 | 0.135 | 0.040 |
| Standard | 2× | 1920×1080 | 60.0 | 59.3 | 0 | 0.33 | 0.160 | 0.124 |
| High | 1× | 960×540 | 60.0 | 60.6 | 0 | 0.57 | 0.451 | 0.026 |
| High | 2× | 1920×1080 | 60.0 | 59.3 | 0 | 0.81 | 0.438 | 0.121 |

- **fps** is paced by the display (`requestAnimationFrame`, ~60 Hz headless), so every tier
  hits the cap here. **Steps/s ≈ 60** shows the fixed-step clock keeps real time; nothing
  was dropped.
- **Burst** runs 120 step + draw frames back to back and waits for the GPU (median of
  three): the whole frame costs under 1 ms here, CPU submission included. At this size
  it is mostly CPU and driver overhead, so it doesn't rise neatly with the tier.
- **GPU ms** come from timer queries over 60 steps or 60 draws. The GPU barely wakes up
  at this load, so treat these as upper bounds for this card.

The quality benchmark (`src/perf/benchmark.ts`, about 3.2 s) picks **High** here at
960×540, 1920×1080 and 2880×1800 (every tier ~56–58 fps).

## Cost per frame (what the passes are)

Per simulation step at the baseline properties (Viscosity 0.5): force and dye injection
(2, skipped while nothing moves), viscosity Jacobi (8 at Standard; scaled by the grid
squared to 2 at Draft and 32 at High so every tier is equally viscous), curl and
vorticity (2), divergence, pressure warm start and pressure Jacobi (1 + 1 + 16/20/28),
gradient subtract (1), advection of velocity and dye (2). That is about 27 / 37 / 69
full-screen passes at Draft / Standard / High, on grids of 114×64 / 228×128 / 455×256
cells (16:9), plus dye at 256 / 512 / 1024 on the short side (capped at the canvas
size). Drawing is one pass at the canvas's full resolution (6 dye reads with surface
light). No bloom, no sunrays.

## What to expect on a 2017 Intel MacBook Pro (estimate, to be measured)

An Intel HD 630 / Iris Plus 640 has roughly a tenth of this GPU's throughput and memory
bandwidth. Scaling the GPU columns by 10–12×: Standard at 2× ≈ 1.5–2 ms per step +
~1.5 ms per draw, High at 2× ≈ 5 ms per step + ~1.5 ms per draw, and a full-screen
Retina canvas (2880×1800) about 2.5× the draw cost. CPU overhead (~40 draw calls per
step through ANGLE on Metal on a dual-core CPU) may add 1–2 ms. So Standard should hold
30 fps with room to spare and High is plausible; the benchmark decides on the day. If
even Draft falls under 30 fps at 2×, the drawing pass is the cost: the Studio can render
the preview canvas at a device pixel ratio of 1 and let CSS scale it up (the offline
render is unaffected).

## Checklist for the Mac (Braden)

1. Serve a build on the Mac (`npm run build && npm run preview`, or a static host) and
   open `/spikes/05-fluid/` in Chrome. Watch the demo for ten seconds: a dark bowl; a band
   of ultramarine streaks falls (the wink closing), then sea-glass streaks rise through
   it (the wink opening), curl and fade; black again before it repeats.
2. Press **Run checks**. All four must pass. Press **Copy results** and paste the report
   into `docs/DECISIONS.md` (it records the Mac's GPU and timings).
3. Open Chrome's console (View > Developer > JavaScript Console) and confirm there is no
   "Too many active WebGL contexts" warning and no red errors.
4. Open `/dev/materials/`, set the window to the size Freeman would use, press
   **Benchmark** and note the tier it picks and the fps per tier.
5. On a 15-inch model with two GPUs: check the demo keeps running when you unplug the
   power adapter or open another graphics-heavy app (Chrome may move the canvas between
   GPUs; a lost context would show as a frozen or black canvas).
6. In `/dev/materials/`, choose **Signature** and turn **Show readout** on: strokes and
   text should be crisp on the Retina screen, not blurry.
