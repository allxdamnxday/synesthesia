# Spike 3: encode a canvas animation and a tone to MP4

**Result on Windows Chrome: PASS.** Both sizes encode to valid, fast-start MP4s with H.264
High video and AAC-LC audio, exactly 90 frames, and zero measured audio/video offset.
QuickTime (Mac), Windows Media Player and VLC playback are still manual checks (below).

- Date: 2026-09-28
- Machine: Braden's PC, Windows 11 (client-hints platform version 19.0.0), Google Chrome
  153.0.8010.53 (headless via Playwright), NVIDIA GeForce GTX 1660 SUPER (ANGLE, D3D11),
  12 logical cores
- Mediabunny 1.60.0

## What the spike does

- **Video:** 90 frames at 30 fps drawn from the frame index only (a disc sweeping across, a
  timeline, a frame counter). Frame 30 (t = 1.000 s) is a white full-frame flash.
- **Audio:** rendered first in an `OfflineAudioContext` at 48 kHz stereo: a 440 Hz sine at
  0.12 with 0.25 s linear fades, plus a click (a decaying 1 kHz burst starting at 0.9)
  scheduled with `start(1.0)`. The click lands on sample 48000 of the rendered buffer.
- **Encode (the SPEC 10.2 order):** `Output` with `Mp4OutputFormat({ fastStart: 'in-memory' })`
  and a `BufferTarget`; `CanvasSource` with codec `avc` and `new Quality('high')`, each frame
  added with timestamp `i / 30` and duration `1 / 30`; then the whole soundtrack through an
  `AudioBufferSource` using the codec and bitrate from `getRenderDefaults()`; then `finalize()`.
- **Self-check in the page:** each MP4 is read back with Mediabunny (`CanvasSink`,
  `AudioBufferSink`) to find the flash frame and the click onset, so a Mac run reports
  alignment without ffmpeg.
- **`verify.mjs`:** ffprobe/ffmpeg checks (container, codecs, frame count, duration, fast
  start, edit lists) and the offset measured from ffmpeg's decode, which applies edit lists
  as players do. `run.mjs` automates build, encode, download and verify.

## Results (this machine)

| | 720p (1280×720) | 1080p (1920×1080) |
|---|---|---|
| File size | 197,045 bytes | 232,841 bytes |
| MIME from Mediabunny | `video/mp4; codecs="avc1.64001f, mp4a.40.2"` | `video/mp4; codecs="avc1.640028, mp4a.40.2"` |
| Video (ffprobe) | H.264 High, level 3.1, yuv420p, 30/1 fps, 327 kbps | H.264 High, level 4.0, yuv420p, 30/1 fps, 422 kbps |
| Video rate control | quantizer (per-frame QP), hardware acceleration no-preference | same |
| Audio (ffprobe) | AAC-LC (`mp4a.40.2`), 48000 Hz, 2 ch, 192 kbps, 141 packets | same |
| Frames (ffprobe `-count_frames`) | 90 | 90 |
| Duration | 3.008 s (video stream 3.000 s, audio stream 3.008 s) | same |
| Top-level boxes | `ftyp moov mdat` (moov before mdat) | same |
| Edit lists | none (video or audio) | none |
| Encode speed (5 runs) | 5.1–7.4 ms per frame, 455–670 ms in total | 8.0–11.3 ms per frame, 722–1019 ms in total |
| First AAC packet | timestamp 0.00000 s, 0.02133 s long (1024 samples) | same |
| Flash (ffmpeg showinfo) | frame 30 at 1.0000 s | same |
| Click onset (ffmpeg decode) | 1.00000 s | same |
| **A/V offset** | **0.00 ms** (ffmpeg), **+0.0 ms** (in-page Mediabunny read-back) | same |

`verify.mjs` output: all 8 checks pass for both files (MP4 container, H.264, 90 frames,
duration within one frame, AAC, 48 kHz stereo, moov before mdat, offset within one frame).

**AAC bitrate:** 192 kbps worked on the first try. Windows' Media Foundation AAC encoder only
accepts 96, 128, 160 and 192 kbps (`AudioEncoder.isConfigSupported` rejects 64, 256 and
320 kbps here), so the capability check tries 192, 160, 128, 96 in that order and records
the one that produced packets. Opus was not needed.

## Findings for the render milestone (M4)

1. The planned pipeline works as written: audio rendered offline first, frames added by
   index with `t = i / fps`, audio added after the frames, `fastStart: 'in-memory'`.
2. **No A/V offset on Windows.** Chrome's AAC encoder emits the first packet at 0 s and the
   decoded click sits exactly at 1.000 s, so no priming compensation is needed here.
   Chrome on macOS uses a different AAC encoder (AudioToolbox, which normally primes with
   2112 samples, about 44 ms). **The Mac run of this page is the check that matters**: if its
   read-back shows an offset near +44 ms, M4 must compensate (shift the audio timestamps or
   trim with an edit list).
3. AAC pads the last frame: 141 × 1024 = 144,384 samples, so the file reports 3.008 s
   instead of 3.000 s. That is within one frame; M4 can trim it with an edit list later if
   an exact duration matters.
4. With `fastStart: 'in-memory'` the whole file sits in memory until `finalize()`
   (about 0.2 MB for 3 s of this simple content; real wakes will be much larger). If M4 streams
   to disk through the File System Access API with `fastStart: false`, add the audio
   *before* (or interleaved with) the frames, or the muxer has to hold all video until the
   audio arrives.
5. Mediabunny's `Quality('high')` picks quantizer (constant-QP) rate control when the
   encoder supports it, as Windows' does, falling back to variable bitrate otherwise. Files
   are small for simple content; check size and quality on real wakes in M4.
6. The capability check (`src/render/capabilities`) uses the same `Quality('high')`, so
   Diagnostics tests the exact encoder configuration renders will use.

## How to re-run

- Automated (Windows, needs ffmpeg and ffprobe on PATH): `node spikes/03-encode/run.mjs`
  builds the app, encodes both sizes in headless Chrome, saves the MP4s to
  `spikes/03-encode/output/` (git-ignored) and runs `verify.mjs`.
- One file: `node spikes/03-encode/verify.mjs spikes/03-encode/output/sp-spike03-1080p.mp4`
- In a browser: open `spikes/03-encode/` from the dev server or a build, click
  **Encode both**, then **Copy results**.

## Manual checks for Braden

- [ ] Windows Media Player: both files play; the click lands with the white flash; the
      tone fades in and out without clicks.
- [ ] VLC: same.
- [ ] Mac, Chrome: open the spike page (from a static host over https, see
      `docs/DECISIONS.md`), click **Encode both**, and copy the results. Record the codec
      strings, the AAC bitrate (or an Opus fallback), ms per frame, and especially the
      read-back **offset** for each size.
- [ ] Mac, QuickTime Player: both downloaded files open, show about 3 seconds, and the click
      sounds with the flash (watch at normal speed; also scrub to 1 s to see the flash).
