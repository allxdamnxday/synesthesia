# Spike 2 results: frame-accurate decode

**Verdict: pass on Windows 11 + Chrome 153 (headless), in a module worker and on the main
thread, in both the dev server and the production build.** Decoding stays in the
extraction worker; SPEC 7.4's main-thread fallback is not needed (it also works).

How it was run (2026-09-28):

```
node scripts/make-spike-clips.mjs                       # regenerate the clips (needs ffmpeg)
npx vite --port 5201 --strictPort
node spikes/01-opencv/run-headless.mjs http://localhost:5201/ spikes/02-decode/
npx vite build && npx vite preview --port 4201 --strictPort
node spikes/01-opencv/run-headless.mjs http://localhost:4201/ spikes/02-decode/
```

The runner starts Chrome with `--js-flags=--expose-gc` so the page can force garbage
collection before checking for unclosed-frame warnings.

## Clips (`spikes/fixtures/`, made by `scripts/make-spike-clips.mjs`)

Every frame shows its index as a 12-bit barcode (and its inverse, to reject bad reads) in
the top half of the *displayed* picture; the bottom half is a scrolling texture.

| File | Size | Stream (ffprobe) |
|---|---|---|
| `h264-30fps.mp4` | 54 KB | H.264 High, B-frames (has_b_frames=2), 640×360, 30/1, 90 frames, GOP 60 |
| `h264-30fps.mov` | 54 KB | the same stream remuxed into MOV |
| `portrait-2997-rot90.mov` | 40 KB | H.264 High, coded 640×360, 30000/1001, 90 frames, display matrix rotation −90 (ffprobe's convention; = 90° clockwise, like an upright iPhone) |
| `hevc-30fps.mov` | 37 KB | HEVC Main (libx265, `hvc1` tag), 640×360, 30/1, 90 frames |

ffmpeg 8 note: `-display_rotation` is an *input* option and is only written to the output
on a stream copy, so the portrait clip is encoded first and then remuxed with
`-display_rotation:v:0 -90 -i … -c copy`.

## Results (identical in dev and production builds)

| Check | H.264 MP4 | H.264 MOV | Portrait 29.97 MOV | HEVC MOV |
|---|---|---|---|---|
| Metadata (Mediabunny) | avc, rotation 0°, 640×360, first ts 0, 3.000 s, 30.000 fps | same | avc, **rotation 90°**, displayed **360×640**, first ts 0, 3.003 s, **29.970 fps** | hevc, `canDecode()` **true**, 640×360 |
| Every frame exactly once, in order (`samples()`) | 90/90 | 90/90 | 90/90 | 90/90 |
| Timestamps = index / fps | max error 0.0000 ms | 0.0000 ms | 0.0000 ms | 0.0000 ms |
| 10 seeded random seeks (`getSample`) at frame start and frame middle | 10/10 exact | 10/10 | 10/10 | 10/10 |
| Fixed-rate `samplesAtTimestamps((i + 0.5) / fps)` (the extraction path) | 90/90 | 90/90 | 90/90 | 90/90 |
| `CanvasSink` with the track's rotation, 320 wide | 320×180, 90/90 | 320×180, 90/90 | **320×569 (portrait)**, 90/90 | 320×180, 90/90 |
| Every `VideoSample` closed | 290 obtained / 290 closed | same | same | same |
| Decode only, worker (frames/s) | 283–1095* | 2507–2804 | 2795–2894 | 2687–2703 |
| Decode + rotate + resize to 320 + read pixels, worker (frames/s) | 474–523 | 637–669 | 499–508 | 313–330 |
| Main-thread fallback: all checks | pass | pass | pass | pass |

\* The first clip includes decoder start-up.

- **No "garbage collected without being closed" warnings** from Mediabunny (counted in the
  worker and on the main thread after two forced garbage collections) and none from Chrome
  in the console.
- **Rotation:** Mediabunny reports the clockwise rotation (90°) for ffprobe's −90 display
  matrix and gives the displayed size (360×640). `CanvasSink` applies it by default, and
  accepts an explicit `rotation`/`flip`/`crop`, which is how extraction composes the
  container rotation with the user's rotate/mirror and the focus area.
- **HEVC:** decodes on this machine (hardware decoder on the GTX 1660 SUPER). Where the
  browser can't decode HEVC, `track.canDecode()` resolves to `false` without throwing, and
  the app shows SPEC 8.1's message instead of extracting.
- **Seeking:** asking for a frame's exact start time and its middle both land on the right
  frame here. Extraction samples at frame middles (`(i + 0.5) / fps`) so float rounding in
  timestamps can never pick the previous frame.
- **Console noise:** Chrome logs one "Canvas2D: Multiple readback operations using
  getImageData are faster with the willReadFrequently attribute" warning per `CanvasSink`
  canvas (they are GPU canvases that Mediabunny creates). Harmless; reading 320×180 back
  from a GPU canvas is still fast, and a CPU canvas would force a full-resolution readback
  of every decoded frame instead.

## Mac checks for Braden

Open `spikes/02-decode/` from a build on the Mac in Chrome and press **Copy results**.
Watch for: the portrait clip reading 90/90 at 320×569; HEVC either decoding 90/90 or
reporting `canDecode false` cleanly (Chrome on macOS normally decodes HEVC through
VideoToolbox); frames/s figures. Also try a real iPhone clip in both "Most Compatible"
(H.264) and "High Efficiency" (HEVC) formats once the Prepare screen lands.
