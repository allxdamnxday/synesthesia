# Engineering conventions

How code in this repo is written and checked. Read `CLAUDE.md` and the relevant sections
of `SPEC.md` first; this file adds the practical details. `docs/FREEMAN_WRITEUP.md` is the
artist's brief and wins on artistic intent.

## Checks (all must pass before a commit)

```
npm run lint        # tsc -b (all projects) + ESLint with --max-warnings 0
npm run test        # Vitest unit tests (Node)
npm run test:e2e    # Playwright against installed Google Chrome (builds first)
npx prettier --write <changed files>
```

- Set `E2E_PORT` when running Playwright so parallel runs never collide, e.g.
  `E2E_PORT=4203 npx playwright test tests/e2e/diagnostics.spec.ts`.
- A dev server for manual poking: `npx vite --port <port> --strictPort`. Stop it afterwards.
- Headless Chrome on the builder's machine runs on the real GPU and supports H.264/AAC
  encode and H.264/HEVC decode, so browser behaviour can be verified headlessly.

## Project layout

See SPEC 7.3. Key contracts, written first and shared by everyone:

| File | What |
|---|---|
| `src/signature/types.ts` | `.sig.json` format, `SignatureSampler`, `SignatureFrame`, extraction options |
| `src/signature/hash.ts` | Content hash (canonical bytes documented in the file) |
| `src/signature/fieldCodec.ts` | Field base64 codec (little-endian float32) |
| `src/signature/synthetic.ts` | Analytic wink/sweep/swirl/still samplers for developing materials |
| `src/materials/types.ts` | Material interfaces (SPEC 9.1), `FIXED_DT`, registry entry types |
| `src/materials/properties.ts` | Shared property vocabulary (SPEC 9.2), `sharedProperty()`, `readProperty()` |
| `src/materials/registry.ts` | Lookups; materials register in `visual/index.ts` / `sound/index.ts` |
| `src/engine/composition.ts` | Composition model (SPEC 11.2), global controls, `timelineDuration()` |
| `src/chance/prng.ts` | `createRng(seed)`, `hash32(...)`, shuffles. The only randomness allowed in output code |
| `src/lib/math.ts` | clamp, lerp, smoothstep, percentile, … |
| `src/app/router.ts` | Hash router: `navigate()`, `href()`, `matchPath()`; routes in `src/app/App.tsx` |

Change a shared contract only when necessary, additively, and say so in your report.

## Determinism (SPEC C6, C8)

- In `src/{signature,engine,materials,chance,render}`: no `Math.random`, `Date.now`,
  `performance.now`, `new Date()`, or crypto entropy. ESLint enforces this. Progress/ETA
  display is the only exception, with
  `// eslint-disable-next-line no-restricted-properties -- progress/ETA display only`.
- Randomness comes from `createRng(seed)`; derive sub-seeds with `hash32(seed, n)`.
- Simulations step by `FIXED_DT` (1/60 s) of composition time, never wall-clock.
- Wall-clock code (preview loops, benchmarks, UI timers) lives outside those folders,
  e.g. `src/screens`, `src/state`, `src/perf`.
- Preview and offline render use the same material code.

## Workers and assets

- Worker entry files are named `*.worker.ts` and are type-checked with the WebWorker lib
  (`tsconfig.worker.json`). Modules they import must not use DOM-only types.
- Create workers with `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`.
- The app is built with a relative base (`./`). Resolve files in `public/` on the main
  thread with `new URL('vendor/opencv/opencv.js', document.baseURI).href` and pass the
  absolute URL into workers (a worker's own location is inside `assets/`).
- Close every `VideoFrame`/`VideoSample` promptly, `delete()` every OpenCV `Mat`, and
  dispose GL resources (programs, textures, framebuffers, buffers) in `dispose()`.

## TypeScript and style

- `strict`; no `any` without a comment explaining why. Prefer small modules and pure,
  tested functions for all math.
- `noUncheckedIndexedAccess` is off; still guard array reads in hot loops with `?? 0`
  where a missing value is possible.
- Prettier formats everything (single quotes, trailing commas, width 100).
- Pure logic gets Vitest tests in `tests/unit/` (or `src/**/x.test.ts`). Browser-only
  behaviour gets a harness page in `dev/<name>/index.html` plus a Playwright spec in
  `tests/e2e/`. Harness pages may expose functions on `window` for tests to call.

## UI

- Plain language, sentence case, artist vocabulary: clip, signature, wake, material,
  property, composition, album. Engineering terms (optical flow, fps, codec, WebGL) only
  in Advanced panels and Diagnostics.
- Errors say what happened and what to do next; they don't apologise.
- Plain CSS Modules with the tokens in `src/app/tokens.css`. No UI kit. Reuse `src/ui/`
  components (add new shared ones there). Minimum 14 px text, 32 px hit targets, visible
  keyboard focus, `prefers-reduced-motion` respected, WCAG AA contrast (secondary text
  uses `--color-mist`, not Silt).
- The canvas surround is true black. The source clip never appears outside Prepare.

## Dependencies

Only the packages already in `package.json`. Adding anything needs the builder's
approval: stop and report instead. Record licences in `docs/THIRD_PARTY.md`.

## Commits

Small, logical commits with clear messages ending with:

```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Decisions (date, decision, why, alternatives) go in `docs/DECISIONS.md`.
