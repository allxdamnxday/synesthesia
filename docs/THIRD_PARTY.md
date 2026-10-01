# Third-party software and assets

Every dependency, vendored file, and bundled asset, with its license. Licenses must be
permissive (SPEC C2): MIT, BSD, ISC, Apache-2.0; OFL for fonts; MPL-2.0 only for
unmodified packages. Versions are pinned exactly in `package.json`.

## Runtime (ships in the app)

| Package | Version | License | Use |
|---|---|---|---|
| react, react-dom | 19.3.0 | MIT | UI |
| mediabunny | 1.60.0 | MPL-2.0 (unmodified) | Video decode (clip import) and MP4 encode (render) via WebCodecs |
| zustand | 5.0.15 | MIT | App state stores |
| idb | 8.0.3 | ISC | IndexedDB wrapper for the library |
| fflate | 0.8.3 | MIT | Zip backup and restore |

Mediabunny is used as published on npm, without modification, so MPL-2.0's file-level
copyleft places no obligations on this project's own code.

**Notices in the app.** The build is minified, which drops the license notices these packages
ask to travel with their code. The app ships them as `third-party-notices.txt` (linked from
Help › About and cached for offline use), together with OpenCV's `LICENSE` and the typeface's
`OFL.txt`. It also covers what the build adds at run time (`scheduler`, Workbox,
vite-plugin-pwa) and the adapted fluid solver. `npm run notices` rewrites it from
`node_modules`; a unit test fails when it is out of date or misses a runtime dependency. When
you add something that ships, add it to `scripts/third-party-notices.mjs` too.

## Vendored files

| File | Source | Version | License | SHA-256 |
|---|---|---|---|---|
| `public/vendor/opencv/opencv.js` | https://docs.opencv.org/4.13.0/opencv.js (official build) | OpenCV 4.13.0 | Apache-2.0 (`public/vendor/opencv/LICENSE`) | `63366510248adf3a7eddf3e793dd825404efb7df3749f4d6f8557c7fa4ca8aa0` |
| `public/fonts/AtkinsonHyperlegibleNext-{Light,Regular,SemiBold}.woff2` | https://github.com/googlefonts/atkinson-hyperlegible-next at commit `7925f50f649b3813257faf2f4c0b381011f434f1` | 2.x (2025) | SIL OFL 1.1 (`public/fonts/OFL.txt`) | Light `129a2785…d909`, Regular `378aea0f…9c54`, SemiBold `4ab00275…829a` |

OpenCV.js is a single file with the WebAssembly embedded; it is loaded lazily, only when
extraction starts. The official 4.13.0 build is single-threaded, so it needs no
cross-origin-isolation headers.

## Adapted source code

| Code | Source | License | Where |
|---|---|---|---|
| Stable-fluids WebGL solver | Pavel Dobryakov, WebGL-Fluid-Simulation (https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) | MIT, Copyright (c) 2017 Pavel Dobryakov | `src/materials/visual/shared/fluid/` (attribution kept in file headers) |

## Development only (not shipped)

| Package | Version | License | Use |
|---|---|---|---|
| vite | 8.3.1 | MIT | Dev server and build |
| @vitejs/plugin-react | 6.1.1 | MIT | React fast refresh for Vite |
| typescript | 6.0.3 | Apache-2.0 | Type checking (pinned below 7; see DECISIONS) |
| @types/react, @types/react-dom | 19.3.0 | MIT | Types |
| @types/node | 24.19.0 | MIT | Types for config files and scripts |
| eslint | 10.11.0 | MIT | Linting, including the determinism rules |
| @eslint/js | 10.0.1 | MIT | ESLint recommended rules |
| typescript-eslint | 8.71.0 | MIT | TypeScript lint rules and parser |
| eslint-plugin-react-hooks | 7.1.1 | MIT | Hook rules |
| eslint-config-prettier | 10.1.8 | MIT | Turns off rules that conflict with Prettier |
| globals | 17.12.0 | MIT | Global variable sets for ESLint |
| prettier | 3.9.9 | MIT | Formatting |
| vitest | 4.1.11 | MIT | Unit tests |
| @playwright/test | 1.63.0 | Apache-2.0 | End-to-end tests (drives installed Google Chrome) |
| vite-plugin-pwa | 1.3.0 | MIT | Service worker and web app manifest for offline use (M8) |
| workbox-build, workbox-window | 7.4.1 | MIT | Peer dependencies of vite-plugin-pwa (build-time precache generation; the generated service worker ships) |

## Development tools on the builder's machine (not in the repo)

| Tool | License | Use |
|---|---|---|
| FFmpeg / ffprobe 8.1 | LGPL/GPL (tool only; never shipped or linked) | Generating synthetic test clips and checking exported MP4s. Generated clips are committed, so nobody else needs FFmpeg. |
