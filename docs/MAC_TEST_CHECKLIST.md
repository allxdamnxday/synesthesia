# Mac test checklist

For Braden, on a Mac in Google Chrome (ideally Freeman's MacBook Pro, or a borrowed one).
Everything here needs the app served over **HTTPS** (or `localhost`): WebCodecs, AudioWorklet,
the clipboard and folder saving don't work on plain `http://` addresses. See
`docs/DECISIONS.md` ("Hosting") for how the test build is deployed.

Write results into `docs/DECISIONS.md` (the "Pending" section) or paste the copied reports
into a chat with Claude. Each page below has a **Copy report** or **Copy results** button.

## 0. Record the machine

- Apple menu › About This Mac: model, year, chip (Intel or Apple Silicon), memory, macOS
  version.
- Chrome menu › About Google Chrome: version. On macOS 12 Monterey, Chrome is frozen at 150.

## 1. Diagnostics (Milestone 0)

1. Open the app. It must **not** show the "can't run here" screen.
2. Open **Diagnostics** (top right) and wait until every row has a status.
3. These must pass: *WebGL2*, *Half-float render targets*, *Web Audio and AudioWorklet*,
   *H.264 export (720p)*, *H.264 clip import*. Note any other warning or failure.
4. The environment block should show the real macOS version (for example
   "macOS 12.7.6 (Monterey)", not 10.15.7), "Intel" or "Apple Silicon", the full Chrome
   version, and the GPU.
5. **Copy report** and keep it. Look at the AAC row (192 kbps is expected; an Opus warning
   means QuickTime may play renders without sound) and the HEVC row.
6. Check that **Run again** works and that "Technical detail" opens with the keyboard (Tab,
   Enter).
7. If this Mac runs macOS 12, do steps 1–5 in Chrome 150 too.
8. Optional: open the app in Safari. A "made for Google Chrome" notice should appear;
   Dismiss hides it, and it stays hidden after reloading.

## 2. Spike 3: MP4 encode

1. Open `spikes/03-encode/` and click **Encode both**.
2. Note ms per frame, codec strings, the AAC bitrate, and each size's read-back offset
   (it must be within ±33 ms). **Copy results**.
3. Download both MP4s and play them in **QuickTime Player**: about 3 s long, the click
   lands exactly with the white flash, and the tone fades in and out smoothly.
   - If the click comes noticeably after the flash (about 1/20 s), note it: the Mac's AAC
     encoder adds a delay that renders will need to compensate for.

## 3. Spike 4: float render targets

1. Open `spikes/04-float-targets/`. The verdict should be **PASS**. **Copy results**.
2. On a 15-inch MacBook Pro with two GPUs, also run *High-performance* and *Low-power* and
   copy both.
3. An RGBA16F failure is a blocker (tell Claude); R16F or RG16F failures only mean a slower
   fallback.

## 4. Spike 1: OpenCV in a worker

_(filled in when the extraction work lands)_

## 5. Spike 2: frame-accurate decode

_(filled in when the extraction work lands)_

## 6. Spike 5: fluid simulation

_(filled in when the fluid work lands)_

## Windows (Braden's machine)

- Play `spikes/03-encode/` MP4s in **Windows Media Player** (the "Media Player" app) and
  **VLC**: picture, tone, and the click in sync with the flash.
