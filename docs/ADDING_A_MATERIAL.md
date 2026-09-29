# Adding a material

A material is something the signature acts on: **visual materials** draw, **sound
materials** sound. Every material talks to the engine only through the interfaces in
`src/materials/types.ts` (SPEC 9.1), and the same code runs in the live preview and in
the offline render. Read `docs/CONVENTIONS.md` first.

## Rules every material follows

- **Properties** come from the shared vocabulary where one fits
  (`src/materials/properties.ts`: viscosity, elasticity, persistence, dispersion,
  brightness, intensity, rigidity, density, range). Use `sharedProperty(id, kind,
  overrides)` so the label and meaning stay consistent across sight and sound; hide
  shared properties that make no sense for the material. Add **at most 3**
  material-specific properties. **At most 6** properties are primary (always visible);
  the rest sit under "More". Every property is 0–1 (or a choice index). Labels are
  sentence case; each has one plain-language sentence of description (it appears in
  Help and tooltips).
- **Baselines reveal timing** (SPEC 9.3): with the synthetic wink at baseline, the close
  and the open must each be clearly visible or audible. Every primary property must
  change the wake in the direction its label promises.
- **Deterministic**: no `Math.random`, clock reads, or browser randomness (ESLint
  enforces this in `src/materials/`). Randomness comes from `createRng(seed)`
  (`src/chance/prng.ts`), recreated from the seed on `reset` / `build`, drawing the same
  number of values every step whatever the state.
- **Fixed time**: visual materials advance only in `step(frame, props, dt)` with
  dt = 1/60 s of composition time; sound materials schedule automation from composition
  time. Never use wall-clock time.
- **Clean up**: dispose every GL object / audio node; close nothing you don't own.
- **Version**: bump `version` whenever the output for the same inputs changes. Saved
  compositions then show "This material has changed since this composition was saved".

## A visual material

Look at `src/materials/visual/water/` (a fluid material) and
`src/materials/visual/signature-view/` (a simple instanced drawing).

```
src/materials/visual/<id>/
  index.ts         the registry entry: { kind: 'visual', meta, create: () => new X() }
  <Name>Material.ts  implements VisualMaterial (init, reset, step, draw, setProperties?, resize, dispose)
  mapping.ts       pure function: property values → simulation parameters (unit-tested),
                   with the feature → parameter table in its header comment
  properties.ts    PropertyDef list (sharedProperty(...) + specific ones)
```

- `init({ gl, width, height, quality, seed, rng })` gets a WebGL2 context the host owns.
  Use the helpers in `src/materials/visual/shared/gl/` (programs with readable errors,
  render targets with half-float fallbacks, `GlResources` for one-call disposal).
- `step(frame, props, dt)`: `frame.field` is the signature's `cols × rows` grid of
  (u, v) vectors in field diagonals per second, image coordinates (y down). Project it
  with `src/materials/visual/shared/fluid/projection.ts` so Range places the movement the
  same way in every material. `frame.normalized` holds 0..1 (or −1..1) features.
- Fluid materials reuse `FluidSolver` (`shared/fluid/`): pass per-step parameters, and use
  the `beforeProjection` / `afterAdvection` hooks for extra fields (Smoke's temperature,
  Honey's spring-back).
- Quality tiers (`draft`, `standard`, `high`) set resolution or particle counts
  (SPEC 14.2); a tier change creates a fresh instance.
- `setProperties?(props)` applies display-only changes while paused, so the Studio can
  redraw without stepping.
- Register the entry in `src/materials/visual/index.ts`.

## A sound material

Look at `src/materials/sound/water/`.

```
src/materials/sound/<id>/
  index.ts     the registry entry: { kind: 'sound', meta, create }
  meta.ts      MaterialMeta: id, version, name, description, properties
  params.ts    pure: property values → synthesis parameters (unit-tested), mapping table
               in its header comment
  program.ts   pure ControlProgram<State>: createState, reset, copy, step
  <name>.ts    the audio graph: build(ctx, destination, seed), schedule(win),
               cancelFrom(ctxTime), dispose()
```

- The control logic runs on a 200 Hz grid of composition time through
  `ControlTimeline` (`src/materials/sound/shared/controlTimeline.ts`). It makes the preview
  scheduler (50 ms, 200 ms ahead) and the single offline call produce identical automation,
  and handles live edits, seeks and loop wraps. Write per-point curves through
  `ControlBus`; property-only values through `StaticParam` in `begin`.
- Discrete events (onsets): `events: (a, b) => win.sampler.onsetsBetween(a, b)`; create
  their nodes at the exact context time and release future ones in `cancelFrom`.
- Shared blocks: `reverb.ts` (procedural impulse response; decay from Persistence),
  `noise.ts` (seeded noise buffers), `mapping.ts` (pan from the horizontal centroid,
  `upwardFlow`, Intensity and Brightness curves), `masterChain.ts`.
- AudioWorklet DSP: write a plain `*.worklet.js` file, import it with `?url&no-inline`,
  and `await loadWorklet(ctx, url)` in `build()`. Keep processors deterministic and drive
  them through AudioParams (never port messages).
- **Mixing rule (determinism):** never connect more than two sounding sources to one input,
  and count an AudioParam's own non-zero value as one of them. Chrome sums more in an order
  that depends on memory addresses, so renders stop being bit-identical. Use `mixPairwise`
  (`shared/graph.ts`) for voices and `OneShotMix` for one-shot events (`add()` returns false
  when full: don't start that source; call its `cancelFrom` from the material's
  `cancelFrom`, and `prune(ctx.currentTime)` on each schedule).
- **Reverb:** build `Reverb` without a decay and call `setDecayNow` / `setDecay` after writing
  the window's automation; rebuilds are throttled for you.
- `tests/e2e/sound.spec.ts` renders every material twice at baseline, at Density 1 and with
  each primary property at 0 and at 1, and `tests/e2e/sound-stall.spec.ts` stalls the page
  and drags Persistence: both run automatically for a new material.
- Register the entry in `src/materials/sound/index.ts`.

## Test it

- `npm run dev`, then open `/dev/materials/` (visual) or `/dev/sound/` (sound) to audition
  it against the synthetic wink, sweep, swirl and still signatures.
- `tests/e2e/visual.spec.ts` and `tests/e2e/sound.spec.ts` test **every registered
  material** automatically: determinism, response to the signature, every primary property
  changes the output, click-free loops (sound). Add unit tests for your mapping and
  control code, and a material-specific spec if it has behaviour worth pinning down.
- Write `docs/materials/<visual|sound>-<id>.md` (description, properties, feature →
  parameter table) and add it to `docs/MATERIALS.md`.
