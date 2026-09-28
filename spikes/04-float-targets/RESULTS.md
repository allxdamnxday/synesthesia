# Spike 4: WebGL2 half-float/float render targets with linear filtering

**Result on Windows Chrome: PASS.** Every format in the R/RG/RGBA × 16F/32F matrix is
renderable, keeps values outside 0..1, and filters linearly; the signature upload path
(Float32 data into RG16F, bilinear sampling) is exact.

- Date: 2026-09-28
- Machine: Braden's PC, Windows 11 (client-hints platform version 19.0.0), Google Chrome
  153.0.8010.53 (headless via Playwright)
- GPU: `ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER (0x000021C4) Direct3D11 vs_5_0 ps_5_0, D3D11)`,
  vendor `Google Inc. (NVIDIA)` (from `WEBGL_debug_renderer_info`; the plain `RENDERER` is
  masked as "WebKit WebGL")
- `WebGL 2.0 (OpenGL ES 3.0 Chromium)`, `MAX_TEXTURE_SIZE` 16384

## What is tested (same code as Diagnostics: `src/render/capabilities/webgl.ts`)

For each of R16F, RG16F, RGBA16F, R32F, RG32F, RGBA32F:

1. **Renderable:** allocate a 3×1 texture (`texImage2D`, HALF_FLOAT or FLOAT), attach it to
   a framebuffer, `checkFramebufferStatus` is `FRAMEBUFFER_COMPLETE`.
2. **Readback:** a shader writes `(v, -v, v/2, 2v)` for v = -1.5, 2.25 and 1000 (all exact in
   half floats); `readPixels(RGBA, FLOAT)` must return them within 1e-3 (relative). This
   catches targets that clamp to 0..1.
3. **Linear filter:** a 2×1 texture of the format uploaded from Float32 texels 0 and 1,
   `LINEAR` filtering, sampled at the midpoint into a 1×1 float target: expect 0.5 ± 1e-3.
   (An unfilterable format samples as incomplete and returns 0.)

Plus the **signature path** (SPEC 9.4): a 4×3 RG field with values from -4 to 2.5 uploaded
with `texImage2D(RG16F, ..., RG, FLOAT, Float32Array)` and sampled bilinearly at texel
centres, midpoints, a four-texel centre and clamped corners, compared with a CPU bilinear
reference (tolerance 2e-3). If RG16F failed, RGBA16F would be tried as the fallback.

Required for the instrument: RGBA16F renderable + correct readback + linear filtering.
R16F and RG16F are nice to have (the solver falls back to RGBA). 32F is not needed.

## Results (this machine)

Identical for `powerPreference` default, high-performance and low-power (one GPU).

| Format | Needed for | Renderable | Readback of -1.5, 2.25, 1000 | Linear filter | Result |
|---|---|---|---|---|---|
| R16F | nice to have | yes | ok | ok (0.5000) | PASS |
| RG16F | nice to have | yes | ok | ok (0.5000) | PASS |
| RGBA16F | **required** | yes | ok | ok (0.5000) | **PASS** |
| R32F | not needed | yes | ok | ok (0.5000) | PASS |
| RG32F | not needed | yes | ok | ok (0.5000) | PASS |
| RGBA32F | not needed | yes | ok | ok (0.5000) | PASS |

- Extensions: `EXT_color_buffer_float` yes, `EXT_color_buffer_half_float` yes,
  `OES_texture_float_linear` yes, `EXT_float_blend` yes
- Sampled through an RGBA32F target
- Signature upload (Float32 → RG16F, bilinear): ok, max error 0
- Timing: the startup subset (RGBA16F only) plus the AudioWorklet check took about 190 ms
  in total; the full Diagnostics run, including the real encodes, about 1.5 s.

## Notes for the fluid solver (M2)

- Call `gl.getExtension('EXT_color_buffer_float')` (and `EXT_color_buffer_half_float`)
  before creating float render targets: in WebGL2 that call is what makes them renderable.
- Uploading the signature field as Float32 straight into RG16F works, so there is no need
  to convert to half floats on the CPU.
- Keep the Dobryakov-style format fallback (R16F → RG16F → RGBA16F); the Diagnostics
  "Compact float formats" row warns if a Mac needs it.

## Manual checks for Braden (Mac)

- [ ] Open `spikes/04-float-targets/` in Chrome on the Mac, check the verdict line, and
      click **Copy results**.
- [ ] On a 15-inch MacBook Pro (two GPUs), also run **High-performance** and **Low-power**
      and copy both; note which GPU string each one reports.
- [ ] Record any FAIL row. RGBA16F must pass; R16F/RG16F failures only mean the slower
      fallback.
