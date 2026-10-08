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

1. Open `spikes/01-opencv/`. Every row should say PASS. **Copy results**.
2. Note *time to ready* (here: about 0.5 s warm, 0.9 s cold), the *longest main-thread
   gap* (should stay under 50 ms), *ms per frame* for Farneback at 320×180 (here: about
   19 ms), the projected time for a 10 s clip, and that the *heap* line is flat.
3. A 2017 MacBook Pro may be 2–4× slower per frame; the budget is a 10 s clip extracted
   within 60 s.

## 5. Spike 2: frame-accurate decode

1. Open `spikes/02-decode/`. **Copy results**.
2. Each clip should read 90/90 frames, in order, with exact seeks. The portrait clip should
   come out portrait (320 wide after the analysis resize). The HEVC clip should either
   decode or say it can't, cleanly (both are acceptable).

## 6. Spike 5: fluid simulation

1. Open `spikes/05-fluid/`, press **Run checks**, then **Copy results**.
2. (a) mount/unmount cycles: 0 live contexts, 0 lost, and no "Too many active WebGL
   contexts" warning in the console (View › Developer › JavaScript Console).
3. (b) determinism: the three hashes match.
4. (c) frame rate for each quality at 1× and 2×: Standard should hold 30 fps or more. If
   even Draft misses 30 fps at 2×, tell Claude (the preview can render at a lower pixel
   ratio).
5. Open `dev/materials/`, choose Water and the wink, and press **Benchmark** with the window
   at the size Freeman would use. Note the chosen quality and the fps per level.
6. On a 15-inch MacBook Pro with two graphics chips, unplug the charger while the water is
   moving: note whether the picture survives the switch between chips.

## 7. Extraction with real clips (Milestone 1)

1. Open `dev/extraction/`, pick a few files from `tests/fixtures/` (for example
   `dot-right.mp4`, `rotating-bar.mp4`) and compare the summaries with Windows (dot right:
   direction ≈ 0; rotating bar: rotation > 0; still: movement 0). Note "took X s".
2. Record a 10 s wink on an iPhone (portrait, Settings › Camera › Formats › Most Compatible),
   AirDrop it to the Mac, and time its extraction, with and without a focus box around the
   eye. Do the same with an HEVC ("High Efficiency") clip: it should either extract or show
   the format message.

## 8. The Studio

1. Open a signature and **Start a composition**. The first time, "Getting to know this
   computer…" shows for about 3 s; afterwards Settings names the preview quality it chose.
2. Play the wink with each visual material (Water, Honey, Smoke, Descending bubbles,
   Filaments) and each sound (Water, Honey, Breath, Resonance, Pulse). It should look smooth
   on the Retina screen, and the sound should stay with the picture: Water's rising whistle
   with the wake, droplets and strikes on the onset ticks in the scrub bar.
3. Switch materials while playing: playback doesn't restart and there are no clicks.
4. Drag sliders while playing (Persistence, Viscosity, Speed); listen for clicks or dropouts
   and watch Activity Monitor with Pulse (Density, Range and Persistence at 1) and Resonance
   (Density 1).
5. Keys: Space, L, 1–4, Shift+1–4, C, S, R, F, Esc, Cmd+Z, Shift+Cmd+Z. Cmd+S saves without
   the browser's "Save page" dialog.
6. **Present** (or F): macOS full screen with only the wake; Esc returns. On a two-GPU
   MacBook Pro, unplug the charger while presenting: "The graphics card was reset" may show,
   then the wake comes back.
7. Close the tab mid-edit and reopen the composition: "Restored changes you hadn't saved",
   and Discard asks first.
8. Try Bluetooth headphones: does the playhead match what you hear?
9. **Hue:** choose each visual material once (a material that failed to start would say
   so), and drag Hue while it plays and while it is paused. The colors turn at once, and
   playing stays as smooth as with Hue in the middle. On a two-GPU MacBook Pro, pause with
   Hue moved and unplug the charger: the wake comes back in the same colors. At the window
   size Freeman uses, note whether the sliders under Both still fit without scrolling
   (Hue adds a row above them).
10. **Clip:** make a signature from an iPhone clip (a `.mov`, filmed upright, with a box
    around the part that moves), then **Save and open in Studio**. Raise **Clip** at the top
    of the controls: the clip appears the right way up, and what moves in it sits where the
    wake responds. Play at Speed 1, then 0.25 and 2: the clip stays with the wake, with no
    drift and no stutter as each loop comes round. With Loops 2 and Repeat on Back and
    forth, the clip steps backwards on the way back (choppier is expected; note it if it
    freezes). With Clip at 50%, playing stays as smooth as without it (watch Activity
    Monitor on an Intel MacBook). Reload the page: the Clip slider is gone.

## 9. Rendering

1. In the Studio, **Render MP4** at 1080p: note the time per frame shown, and how long a 10 s
   composition takes.
2. Open the MP4 in **QuickTime Player**: it plays, has sound, scrubs, and the colors match
   the preview. Onsets (strikes, droplets) land with the picture. If sound seems to trail
   by about 1/20 s, run `dev/render/` › **Check alignment** and send the numbers (the Mac's
   AAC encoder may add a delay the render needs to compensate for).
3. Render into a folder you made inside Movies; render again and check the " (2)" file.
4. Start a render and hide Chrome for a minute: it keeps going.
5. Render one Water and one Filaments composition with Hue well away from the middle. In
   QuickTime the colors match the preview. Thin red or magenta strands are where the
   video's compression softens color most: note it if they look duller than in the Studio.

## 10. Albums

1. Make an album from a signature with the same master seed and settings as on Windows (the
   same materials installed): the track list (materials, open properties, seeds) must match
   exactly.
2. Mark some tracks Kept and some Set aside, add notes, then **Batch render** the kept ones
   into a folder, unattended. Note the total time for 25 tracks of about 10 s.
3. **Export album log**: allow Chrome's "multiple downloads" prompt; both files arrive and
   ALBUM_LOG.md reads well (set-aside tracks included).

## 11. Offline

1. Visit the app once online, then turn Wi-Fi off and reload: the Library, Help, the Studio
   and extraction still work (the offline cache includes everything, OpenCV included).

## 12. Where to go next

1. In a fresh Chrome profile (or after clearing the site's data), the Library's **How it
   works** steps show; **Try the sample wink** adds it and lights **Start a composition**.
   Walk the three steps and check each gets its tick, then **Hide** it and bring it back from
   Settings.
2. On a signature card, **Start a composition** fits on one line (Mac fonts are a little
   wider than Windows'); if it wraps to two lines, note the window width.
3. The first Studio visit shows the tip about **Play** after "Getting to know this
   computer…", and it goes when playback starts; a new composition's first save shows the note
   with **Render MP4** and **New album**.
4. Each screen's **Guide** link opens the guide at its section, and Back returns to the
   screen.

## Windows (Braden's machine)

- Play `spikes/03-encode/` MP4s in **Windows Media Player** (the "Media Player" app) and
  **VLC**: picture, tone, and the click in sync with the flash.
