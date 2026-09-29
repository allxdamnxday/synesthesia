# Synesthesia

An audiovisual instrument for exploring movement as perceptual material. It keeps the
movement from a short clip as a **kinetic signature** (movement, not picture) and lets that
one constant signature move through interchangeable **visual materials** (Water, Honey,
Smoke, Descending bubbles, Filaments) and **sound materials** (Water, Honey, Breath,
Resonance, Pulse), each with adjustable properties. The source disappears; its wake remains.

Made for Freeman. v0 of the Synesthesia Project instrument, a static web app for Google Chrome.

## Using it

- `docs/USER_GUIDE.md`: how to use the instrument (for Freeman). The app shows the same file
  as its Guide page (`#/guide`); after changing the guide's pictures, run
  `node scripts/guide-images.mjs`.
- In the app: **Help** (top right) and **Diagnostics** (with a report to copy and send).

## Developing

Requires Node 22.12+ (24 LTS recommended) and Google Chrome.

```
npm ci
npm run dev             # http://localhost:5173
npm run lint            # type-check (all projects) + ESLint, including the determinism rules
npm run test            # unit tests (Vitest)
npm run test:e2e        # end-to-end tests (Playwright driving installed Chrome)
npm run build           # production build + spike and developer harness pages
npm run build:release   # production build only (what Freeman gets)
npm run preview         # serve the build on http://localhost:4173
```

Developer pages (in `npm run dev` and `npm run build`): `/spikes/` (Milestone 0
experiments) and `/dev/` (harness pages for materials, sound, extraction, rendering, albums).

## Documents

| File | What |
|---|---|
| `SPEC.md` | The build specification |
| `docs/FREEMAN_WRITEUP.md` | Freeman's original brief (wins on artistic intent) |
| `docs/DECISIONS.md` | Every non-trivial decision, for Freeman to revisit |
| `docs/ARCHITECTURE.md` | How the pieces fit together |
| `docs/CONVENTIONS.md` | How code is written and checked |
| `docs/MATERIALS.md` | Every material and how the signature drives it |
| `docs/ADDING_A_MATERIAL.md` | Adding a visual or sound material |
| `docs/THIRD_PARTY.md` | Dependencies and licences |
| `docs/MAC_TEST_CHECKLIST.md` | What to check on a Mac |
| `docs/DEPLOY.md` | Deploying the static build |
| `docs/WALKTHROUGH_SCRIPT.md` | Script for a ~15-minute walkthrough video for Freeman |
| `docs/milestones/` | Milestone acceptance reports |
