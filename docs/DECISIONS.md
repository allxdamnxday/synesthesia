# Decisions log

Record every non-trivial decision: date, decision, why, alternatives considered.
Freeman reviews this after handover.

## 2026-09-28: Input method for v0 is a recorded clip
- **Decision:** v0 accepts recorded clips only; live camera is deferred.
- **Why:** the first investigation holds one captured signature constant; recorded input
  is reproducible, debuggable, and matches the album workflow.
- **Alternatives:** live camera feed (deferred to a later signature source).
- **Revisit with Freeman:** yes.

## 2026-09-28: Platform is a browser app, not TouchDesigner
- **Decision:** static web app (Vite + React + WebGL2 + Web Audio + WebCodecs) in Chrome.
- **Why:** $0 budget; identical on Windows (builder) and macOS (artist); no license
  change if the album is ever sold; MP4 export works on Mac without an Nvidia GPU.
- **Alternatives:** TouchDesigner (free tier resolution-capped and non-commercial;
  realtime H.264 export needs Nvidia); Max/MuBu (paid, second app to learn).

## 2026-09-28: Toolchain versions (TypeScript 6, Vitest 4, Node 25 for now)
- **Decision:** pin TypeScript 6.0.3 (not 7.x) and Vitest 4.1.11 (not 5.x). Develop on the
  builder's installed Node 25; `.nvmrc` recommends Node 24 LTS.
- **Why:** `typescript@latest` is 7.0 (the Go port), but typescript-eslint 8.71 supports only
  TypeScript `<6.1`. Vitest 5 does not support Node 25 (its engines allow `^22.12 || ^24 ||
  >=26`), while Vitest 4.1 does. Node 25 reached end-of-life in June 2026, so the builder
  should move to Node 24 LTS; once on 24 or 26, Vitest can move to 5.
- **Alternatives:** TypeScript 7 with no type-aware linting (loses floating-promise checks,
  which matter in heavily async WebCodecs/Web Audio code); forcing Vitest 5 on an
  unsupported Node.

## 2026-09-28: End-to-end tests drive installed Google Chrome, not bundled Chromium
- **Decision:** Playwright uses `channel: 'chrome'`.
- **Why:** Playwright's bundled Chromium lacks proprietary codecs (H.264, AAC), which clip
  import and MP4 export depend on. Google Chrome is also what Freeman uses. On the
  builder's machine, headless Chrome 153 runs on the real GPU (NVIDIA GTX 1660 SUPER via
  ANGLE/D3D11) and supports H.264 encode at 1080p and 720p, AAC and Opus encode, and H.264
  and HEVC decode, so headless runs are faithful.
- **Alternatives:** bundled Chromium (can't test codecs); Chrome for Testing downloads.

## 2026-09-28: OpenCV.js 4.13.0, the official single-file build
- **Decision:** vendor `https://docs.opencv.org/4.13.0/opencv.js` (10,964,323 bytes, SHA-256
  in `docs/THIRD_PARTY.md`) at `public/vendor/opencv/`.
- **Why:** SPEC asks for a pinned official 4.x build. 4.13.0 is the only pinned 4.x build
  OpenCV still hosts (the 4.10–4.12 URLs now return 404). Its JS export list includes
  `calcOpticalFlowFarneback`. It embeds the WebAssembly and uses no threads, so it needs
  no special server headers (GitHub Pages and Vercel both work).
- **Alternatives:** OpenCV 5.x (outside the SPEC's 4.x pin, 16 MB); npm repackagings such as
  `@techstark/opencv-js` (not the official build).

## 2026-09-28: Hash-based routing with no router library
- **Decision:** screens are addressed as `#/studio/<id>` etc. by a ~60-line router in
  `src/app/router.ts`.
- **Why:** no router is on the approved dependency list; hash URLs work on any static host
  without rewrite rules; the app has only a handful of screens.
- **Alternatives:** React Router (unapproved dependency); history-API routing (needs a
  404 fallback on GitHub Pages).

## 2026-09-28: Chrome 150 is the feature floor
- **Decision:** don't rely on web platform features newer than Chrome 150.
- **Why:** Chrome 150 was the last release for macOS 12 Monterey; Chrome 151+ needs macOS 13.
  If Freeman's MacBook Pro runs macOS 12, its Chrome is frozen at 150. (A 2017 MacBook Pro
  can run macOS 13, which keeps Chrome current.) Diagnostics reports both versions.
- **Alternatives:** target only current Chrome (risks a blank feature on Freeman's Mac).

## 2026-09-28: Accessible secondary text colour ("Mist")
- **Decision:** add `--color-mist #9AABB5` for secondary text and `--color-alert #E8806A` for
  failed checks and errors. Silt stays for dividers and decoration.
- **Why:** SPEC 13.2's Silt (#5E6F7A) is only 3.4:1 on Deep, below the SPEC's own WCAG AA
  floor for text. Mist is 7.4:1 on Deep and 6.5:1 on Basin; Alert is 6.5:1 on Deep.
- **Alternatives:** use Silt for text anyway (fails AA).

## 2026-09-28: Spike and harness pages ship in development builds only
- **Decision:** `spikes/<name>/index.html` and `dev/<name>/index.html` are built as extra
  pages unless `SP_RELEASE=1`, so they can be opened on a test Mac from a static host.
- **Why:** WebCodecs, AudioWorklet, the clipboard and folder saving need a secure context
  (HTTPS or localhost), so a Mac can't simply open the dev server over the LAN.
- **Alternatives:** separate build config for spikes (more to maintain).

## Pending
- Freeman's MacBook Pro model, year, chip, macOS version (Diagnostics' Copy report now
  records macOS version, CPU architecture and GPU whenever it runs on his Mac).
- M0 spike outcomes on macOS (AAC encode, float render targets, performance).
- Chance interpretation (SPEC 12.2), to confirm with Freeman after handover.
- Hosting: the plan is a free Vercel Hobby deployment from a private GitHub repo. It
  needs the builder's own Vercel login, so nothing has been deployed yet.
