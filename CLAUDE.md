# Synesthesia Project: instructions for Claude Code

You are building **v0 of the Synesthesia Project (SP) instrument**: a browser-based
audiovisual instrument that extracts a *kinetic signature* from a short movement clip
and applies that one constant signature to interchangeable visual and sound materials.

## Source-of-truth documents (read before writing any code)

1. `SPEC.md` is the full build specification. It wins on implementation details.
2. `docs/FREEMAN_WRITEUP.md` is the artist's original brief. It wins on artistic intent.
   If SPEC.md and the write-up seem to disagree on intent, stop and ask Braden.

## Context you must keep in mind

- Braden is building this solo as a **surprise gift** for Freeman (his father-in-law),
  a dancer, artist and somatic educator. Never suggest contacting Freeman. Any decision
  the write-up says should be made "with the development collaborator" is made by
  Braden and logged in `docs/DECISIONS.md` so Freeman can revisit it after handover.
- Braden develops on **Windows 11 + Chrome**. The target machine is **Freeman's MacBook
  Pro in Chrome** (model unknown; assume a 2017-era Intel MBP with integrated graphics
  as the worst case). Flag anything macOS-sensitive so Braden can test it on a Mac.
- Budget is **$0**. No paid services, APIs, or licenses.

## How to work

- Work **one milestone at a time** (SPEC.md section 16). Do not start the next milestone
  until Braden says go.
- At the **start** of a milestone: post a short plan (files you'll touch, risks, order).
- At the **end** of a milestone: run lint + tests, report every acceptance criterion as
  pass/fail with evidence, and list the manual checks Braden must do (especially on Mac).
- Keep changes small and commit at logical steps with clear messages.
- Log every non-trivial decision in `docs/DECISIONS.md` (date, decision, why,
  alternatives considered).

## Hard rules (see SPEC.md section 3)

- Static web app only. No backend, accounts, analytics, telemetry, or runtime network
  requests. Self-host every asset (OpenCV.js, wasm, fonts, sample media).
- **Signature is not material.** The signature file never contains source pixels, and the
  source clip is never stored and never appears in a render, a thumbnail or an export. On
  screen it appears on the Prepare screen and, only while the artist raises it, as the
  Studio's clip layer (SPEC 6.3): hidden by default, and only in the visit its signature
  was made in. (Amended 2026-10-08 at Freeman's request; see `docs/DECISIONS.md`.)
- **Determinism.** Never use `Math.random()`, `Date.now()`, or `performance.now()` inside
  `src/signature`, `src/engine`, `src/materials`, `src/chance`, or `src/render`
  (except for progress/ETA display). Use the seeded PRNG in `src/chance/prng.ts`.
  Enforce with ESLint `no-restricted-properties` / `no-restricted-syntax`.
- Simulations advance on a **fixed timestep** driven by signature time, never wall-clock.
- Preview and offline render must share the same material code paths.

## Dependencies

- Use only the approved list in SPEC.md section 7.2. Ask Braden before adding anything
  else. Licenses must be permissive (MIT, BSD, ISC, Apache-2.0, OFL for fonts;
  MPL-2.0 is acceptable only for unmodified packages).
- Record every dependency and its license in `docs/THIRD_PARTY.md`.

## Code standards

- TypeScript `strict: true`. No `any` without a comment explaining why.
- Pure, tested functions for all math (features, PRNG, hashing, sampling, album
  generation). Vitest for unit tests; Playwright (Chromium) for smoke E2E.
- Small modules; one material per folder; materials only talk to the engine through
  the interfaces in SPEC.md section 9.1.
- Release WebCodecs `VideoFrame`s / samples promptly (`close()`); dispose GL resources.

## UI copy

Plain language, sentence case, artist vocabulary: clip, signature, wake, material,
properties, composition, album. Keep engineering terms (optical flow, fps, codec)
out of the main UI; they belong only in Advanced panels and Diagnostics.

## Commands (create these in Milestone 0)

- `npm run dev`: local dev server
- `npm run build` / `npm run preview`: production build and local preview
- `npm run lint` / `npm run test` / `npm run test:e2e`
