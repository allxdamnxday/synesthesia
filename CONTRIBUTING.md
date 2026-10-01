# Contributing

Synesthesia is an audiovisual instrument for exploring movement as perceptual material. It
keeps the movement from a short clip as a **signature** and lets it move through
interchangeable visual and sound **materials**. It is a static web app for Google Chrome.

The artistic intent comes from Freeman's brief (`docs/FREEMAN_WRITEUP.md`); `SPEC.md` is the
build specification. Braden Freeman maintains the repository and merges changes.

## Getting set up

You need Node 24 LTS (22.12 or later works) and Google Chrome.

```
npm ci
npm run dev        # http://localhost:5173
```

Read these before changing anything substantial:

| File | Why |
|---|---|
| `docs/ARCHITECTURE.md` | How the pieces fit together |
| `docs/CONVENTIONS.md` | How code is written and checked |
| `docs/ADDING_A_MATERIAL.md` | The easiest place to start: a new visual or sound material |
| `docs/DECISIONS.md` | Why things are the way they are |
| `CLAUDE.md` | The project's hard rules, written for an AI assistant but true for everyone |

## How changes get in

`main` is protected, and every merge to it goes live on the public site. So:

1. Work on a branch (or a fork) and open a pull request against `main`.
2. Vercel builds a preview of the pull request and must succeed. Previews of forks wait for
   the maintainer to allow them.
3. The maintainer reviews and merges.

Before opening a pull request, run:

```
npm run lint       # type-check and ESLint, including the determinism rules
npm run test       # unit tests
npm run test:e2e   # end-to-end tests in installed Chrome (about 15 minutes; run the specs you touched at least)
npm run format     # Prettier
```

The sound tests measure real-time audio, so run them on a computer that isn't busy.

## Rules that matter here

- **Static web app only.** No backend, accounts, analytics, telemetry, or network requests at
  run time. Every asset is self-hosted.
- **The signature is not the material.** A signature never contains pixels from the clip, and
  the clip never appears outside the Prepare screen or in a render.
- **Determinism.** The same signature, materials, properties and seed must always give the same
  wake. No `Math.random()`, `Date.now()` or `performance.now()` in `src/signature`,
  `src/engine`, `src/materials`, `src/chance` or `src/render`; use the seeded generator in
  `src/chance/prng.ts`. ESLint enforces this.
- **Dependencies.** Ask before adding one. Licenses must be permissive (MIT, BSD, ISC,
  Apache-2.0; OFL for fonts). Record it in `docs/THIRD_PARTY.md`, and if it ships in the app,
  add it to `scripts/third-party-notices.mjs` and run `npm run notices`.
- **Words on screen.** Plain language, sentence case, the artist's vocabulary: clip, signature,
  wake, material, properties, composition, album. Engineering terms stay in Advanced panels
  and Diagnostics.
- **No real people's clips in the repository.** Test clips are synthetic
  (`scripts/make-fixtures.mjs`).

## License

The project is under the MIT License (`LICENSE`). By opening a pull request you agree that your
contribution is licensed under the same terms, and that it is yours to contribute: your own
work, or work you have the right to submit under MIT. If an AI assistant wrote part of it,
review that part as you would your own.

Freeman's brief (`docs/FREEMAN_WRITEUP.md`) is his own writing, © Freeman, all rights reserved;
the MIT License does not cover it. Software and assets from others keep their own licenses
(`docs/THIRD_PARTY.md`).
