# Milestone acceptance reports (v0)

Every acceptance criterion from SPEC 16, with its evidence. Measured on the builder's
machine: Windows 11, Chrome 153, NVIDIA GTX 1660 SUPER, 2026-09-28. **Mac results are still
to come** (see `docs/MAC_TEST_CHECKLIST.md`); nothing here has run on macOS yet.

Checks at the end: `npm run lint` clean; `npm run test` (Vitest) green; `npm run test:e2e`
(Playwright driving Chrome) green. Counts are in the final summary of the build.

Legend: **Pass**: met and verified automatically on Windows. **Pass (measured)**: met by
measurement where a person's eye or ear is the real judge; still worth a manual look.
**Manual**: needs a person, a real clip, or a Mac.

## M0 Foundation and spikes

| Criterion | Result | Evidence |
|---|---|---|
| All spikes pass on Windows Chrome | Pass | `spikes/01-opencv/RESULTS.md` (OpenCV in a worker: ready in ~0.5 s, Farneback 18.8 ms/frame at 320×180, shift recovered to 0.02 px); `spikes/02-decode/RESULTS.md` (frame-accurate H.264 MP4/MOV with B-frames, portrait with rotation, HEVC); `spikes/03-encode/RESULTS.md` (H.264 + AAC 192 kbps, 90 frames, A/V offset 0.0 ms); `spikes/04-float-targets/RESULTS.md` (all float formats render and filter linearly); `spikes/05-fluid/RESULTS.md` (fluid in React, 0 leaked contexts, identical hashes, 60 fps every tier); the spike 5 check also runs in `tests/e2e/visual.spec.ts` |
| A written Mac test checklist exists | Pass | `docs/MAC_TEST_CHECKLIST.md` |
| Diagnostics runs and copies a report | Pass | `tests/e2e/diagnostics.spec.ts` (every check finishes; required checks pass; the copied report has GPU, WebGL2, AAC, Chrome version; clipboard fallback) |

## M1 Signature

| Criterion | Result | Evidence |
|---|---|---|
| Fixture feature signs match SPEC 8.5 | Pass | `tests/e2e/extraction.spec.ts`: dot right direction 0.000, dot up 1.569, expanding ring divergence > 0, contracting < 0, clockwise bar curl > 0, still energy ≈ 0 and density 0, noisy still density ≈ 0 after the automatic floor, stopping dot onset at 0.23 s and continuity 0.26 at the stop; plus movement fully inside the frame (divergence and curl use a local fit, see DECISIONS) |
| A real wink clip with a focus area produces a visibly localized, coherent field | Manual | No real wink clip was available to the build. Record one (iPhone, Most Compatible), box the eye in Prepare: the strokes should appear only around the eyelid, down on the close and up on the open |
| Exporting and re-importing a signature yields the identical contentHash | Pass | `tests/unit/hash.test.ts` (JSON round trip, −0), `tests/e2e/library-storage.spec.ts` (real download → import keeps the hash; a tampered file is refused) |
| The source clip cannot appear anywhere outside Prepare | Pass | The clip is never stored (only its movement); `tests/e2e/prepare.spec.ts` (no `<video>` anywhere after leaving Prepare), `tests/e2e/studio.spec.ts` (no `<video>` in the Studio); renders use materials only. Since 2026-10-08 the Studio's clip layer shows the clip on request (SPEC C7 as amended; `tests/e2e/clip-layer.spec.ts`) |

## M2 Engine, Studio, V1 Water

| Criterion | Result | Evidence |
|---|---|---|
| A wink visibly and repeatably drives Water | Pass | `tests/e2e/visual.spec.ts` (the wink is visible, the still signature differs, identical hashes across runs), `docs/images/same-signature-different-wake.png`; with a real wink: manual |
| Replay with the same seed and properties looks the same | Pass | Identical frame hashes across runs, instances, sessions and builds (`visual.spec.ts`, spike 5) |
| Every visible slider changes the wake in the direction its label promises | Pass (measured) | Every primary property changes the output (`visual.spec.ts`, for every material); directions checked for Water's brightness, density, persistence and range; each material's author reviewed filmstrips at property extremes. Worth a look by eye |
| ≥ 30 fps at Standard on the builder's machine | Pass | 59–60 fps on every tier at 1× and 2× (spike 5, Studio) |

## M3 Sound engine and A1 Water

| Criterion | Result | Evidence |
|---|---|---|
| Offline renders of A1 are bitwise identical across runs | Pass | `tests/e2e/sound.spec.ts` (SHA-256 of samples; also across window sizes and at property extremes) |
| Preview and offline sound the same by ear | Pass (measured) | Loudness-contour correlation 0.95–0.998 and level within 0.01 dB (preview recorded through a worklet tap); by ear: manual |
| Rising motion audibly rises in pitch | Pass (measured) | Pitch tracker: the sweep's rise goes ~475 → ~908 Hz (+11 semitones); unit test: pitch never falls while the movement rises |
| No clicks at loop boundaries | Pass | `sound.spec.ts` loop-boundary check for every sound material |

## M4 Render MP4

| Criterion | Result | Evidence |
|---|---|---|
| A 1080p30 MP4 with sound plays in QuickTime and Windows players | Pass (file) / Manual (players) | ffprobe: H.264 High + AAC-LC 48 kHz stereo, fast start (`tests/e2e/render.spec.ts`). Play it in Windows Media Player and VLC, and in QuickTime on a Mac |
| Audio and video align within one frame at an onset | Pass | Dev-only flash and click materials: the click lands within 0.02 ms of the onset; the picture trails by ≤ 1 frame (`render.spec.ts`) |
| Duration within one frame of expected | Pass | `render.spec.ts`, `tests/e2e/workflow.spec.ts` |
| Two renders of the same composition are perceptually identical | Pass | Identical frames (framemd5) and identical decoded sound |

## M5 Library, compositions, comparison

| Criterion | Result | Evidence |
|---|---|---|
| Closing and reopening Chrome restores everything | Pass (storage) / Manual (restart) | Everything is in IndexedDB (`library-storage.spec.ts`); the Studio autosaves and restores unsaved work (`studio.spec.ts`). Quit and reopen Chrome to confirm |
| A backup restores into a fresh browser profile | Pass (same profile) / Manual (fresh) | `library-storage.spec.ts`: back up → clear everything → restore restores exactly; a damaged backup changes nothing |
| Switching snapshots never restarts playback | Pass | `studio.spec.ts` (recall while playing; the playhead keeps going) |

## M6 Materials library

| Criterion | Result | Evidence |
|---|---|---|
| "Same signature, different wake": the wink's timing reads in every material at baseline | Pass (measured) | `docs/images/same-signature-different-wake.png` (the close at 1.0 s and the open at 1.4 s in all five visual materials); every sound material makes two distinct events on the wink (RMS gaps of 13–25 dB, measured). Side-by-side listening and looking: manual |
| Every primary slider in every material does something visible or audible | Pass | `visual.spec.ts` and `sound.spec.ts` test every registered material's primary properties |
| Each visual material holds ≥ 30 fps at Draft on the builder's machine | Pass | 60 fps for all five at every tier, 1× and 2× |

## M7 Chance and Album

| Criterion | Result | Evidence |
|---|---|---|
| The same master seed produces identical drafts on Windows and macOS | Pass (Windows) / Manual (Mac) | Pure integer PRNG (`sfc32`, `hash32`) with frozen reference values; golden test pinning the first tracks for a seed (`tests/unit/album-library.test.ts`). Confirm on a Mac with the same seed |
| A 25-track grid album of ~10 s tracks batch-renders unattended (report total time) | Pass | 25 tracks of 9.6 s (three passes of the wink + tail) at the default 1080p30, rendered unattended into a folder with composition files: **1 min 10 s** (2.8 s per track). A 2017 MacBook Pro may take 5–10× longer |
| Set-aside tracks appear in the log | Pass | `tests/unit/album-library.test.ts`, `tests/e2e/album.spec.ts` |

## M8 Handover polish

| Criterion | Result | Evidence |
|---|---|---|
| Braden completes the full workflow on a Mac using only the guide | Manual | `docs/USER_GUIDE.md` (with screenshots); the same workflow passes end to end in `tests/e2e/workflow.spec.ts` on Windows |
| The app loads and works with Wi-Fi off after the first visit | Pass | `tests/e2e/offline.spec.ts`: after one visit, with the network cut, the Library, Help and a full extraction work |
| Diagnostics passes on Freeman's MacBook Pro | Manual | Run Diagnostics there and Copy report |

Delivered for M8: the first-run introduction (three screens, sample wink), Help, the
dedication (Settings toggle), `docs/USER_GUIDE.md`, `docs/ARCHITECTURE.md`,
`docs/ADDING_A_MATERIAL.md`, `docs/MATERIALS.md`, offline support, deploy configuration
(`docs/DEPLOY.md`; not deployed, since it needs your accounts), and
`docs/WALKTHROUGH_SCRIPT.md`.
