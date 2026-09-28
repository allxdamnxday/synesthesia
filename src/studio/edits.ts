/**
 * Every edit the Studio makes to a composition's wake, as pure functions (SPEC 6.3, 9.2,
 * 12.2). They work on `WakeState`, the parts of a composition that shape the wake (the
 * same parts a snapshot holds), and each returns the very same object when nothing
 * changes, so callers can skip no-op undo steps with a reference check.
 *
 * Rules kept here:
 * - Linked mode: one value per shared property drives both fields (engine/propertyModel).
 * - Switching a material carries shared values over (they mean the same thing in every
 *   material); material-specific ones start at the new material's baseline. Shared values
 *   the new material doesn't use are kept, so switching away and back loses nothing.
 * - Draw by chance opens K shared properties; every other shared property is locked at its
 *   material's baseline. Unlocking one records it under `overrides`, so the record stays
 *   honest. Material-specific properties are never locked.
 */
import type { DrawResult } from '../chance/draw';
import { SEED_SPACE } from '../chance/prng';
import {
  GLOBAL_CONTROLS,
  type ChanceRecord,
  type Composition,
  type TimelineSettings,
} from '../engine/composition';
import {
  setLinked as linkValues,
  setProperty as setModelProperty,
  valuesAfterMaterialSwitch,
  type Field,
} from '../engine/propertyModel';
import { defaultCompositionName } from '../engine/compositionFactory';
import type { SnapshotState } from '../engine/snapshots';
import { isSharedPropertyId, readProperty, SHARED_PROPERTY_IDS } from '../materials/properties';
import type { MaterialMeta, PropertyDef, PropertyValues } from '../materials/types';

export type { Field } from '../engine/propertyModel';

/** The parts of a composition that shape the wake: what undo, snapshots and preview track. */
export type WakeState = SnapshotState;

/** Looks up installed materials by id (the registry in the app, a stub in tests). */
export interface MaterialCatalog {
  visual(id: string): MaterialMeta | undefined;
  sound(id: string): MaterialMeta | undefined;
}

export interface FieldDefs {
  visual: readonly PropertyDef[];
  sound: readonly PropertyDef[];
}

export function otherField(field: Field): Field {
  return field === 'visual' ? 'sound' : 'visual';
}

/** Property definitions of the state's materials (empty for a material that isn't installed). */
export function defsOf(
  state: Pick<WakeState, 'visual' | 'sound'>,
  catalog: MaterialCatalog,
): FieldDefs {
  return {
    visual: catalog.visual(state.visual.materialId)?.properties ?? [],
    sound: catalog.sound(state.sound.materialId)?.properties ?? [],
  };
}

function sameValues(a: PropertyValues, b: PropertyValues): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.is(a[k], b[k]));
}

function sharedOnly(values: PropertyValues): PropertyValues {
  const out: PropertyValues = {};
  for (const [id, v] of Object.entries(values)) if (isSharedPropertyId(id)) out[id] = v;
  return out;
}

function withProperties(
  state: WakeState,
  visual: PropertyValues,
  sound: PropertyValues,
): WakeState {
  if (sameValues(visual, state.visual.properties) && sameValues(sound, state.sound.properties)) {
    return state;
  }
  return {
    ...state,
    visual: { ...state.visual, properties: visual },
    sound: { ...state.sound, properties: sound },
  };
}

// ---------------------------------------------------------------------------------------
// Locks (Draw by chance)

/** True when chance has locked this property (shared, not open, not deliberately unlocked). */
export function isLocked(chance: ChanceRecord | null, id: string): boolean {
  if (!chance || !isSharedPropertyId(id)) return false;
  return !chance.openProperties.includes(id) && !chance.overrides.includes(id);
}

/** Every shared property chance has locked, in vocabulary order. */
export function lockedIds(chance: ChanceRecord | null): Set<string> {
  return new Set(SHARED_PROPERTY_IDS.filter((id) => isLocked(chance, id)));
}

function baselineLocked(
  values: PropertyValues,
  defs: readonly PropertyDef[],
  chance: ChanceRecord | null,
): PropertyValues {
  let out = values;
  for (const def of defs) {
    if (!def.shared || !isLocked(chance, def.id) || values[def.id] === def.default) continue;
    if (out === values) out = { ...values };
    out[def.id] = def.default;
  }
  return out;
}

/** Put every locked property at its material's baseline (nothing to do without chance). */
export function enforceLocks(state: WakeState, defs: FieldDefs): WakeState {
  if (!state.chance) return state;
  return withProperties(
    state,
    baselineLocked(state.visual.properties, defs.visual, state.chance),
    baselineLocked(state.sound.properties, defs.sound, state.chance),
  );
}

// ---------------------------------------------------------------------------------------
// Properties and materials

function clampFor(value: number, id: string, defs: FieldDefs, field: Field): number {
  const def =
    defs[field].find((d) => d.id === id) ?? defs[otherField(field)].find((d) => d.id === id);
  if (!def) return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return readProperty({ [id]: value }, def);
}

/**
 * Set one property of one field. A shared property in Linked mode moves both fields.
 * Locked properties don't move (unlock them first).
 */
export function editProperty(
  state: WakeState,
  field: Field,
  id: string,
  value: number,
  defs: FieldDefs,
): WakeState {
  if (isLocked(state.chance, id)) return state;
  const next = setModelProperty(
    { linked: state.linked, visual: state.visual.properties, sound: state.sound.properties },
    field,
    id,
    clampFor(value, id, defs, field),
  );
  return withProperties(state, next.visual, next.sound);
}

/** In Linked mode, give every shared property in use one value (the visual's, where it has one). */
function unify(state: WakeState, defs: FieldDefs): WakeState {
  const linked = linkValues(
    { linked: true, visual: state.visual.properties, sound: state.sound.properties },
    true,
    defs.visual,
    defs.sound,
  );
  return withProperties(state, linked.visual, linked.sound);
}

/**
 * Choose a different material for one field. Shared values carry over (in Linked mode from
 * either field); specific ones start at the new material's baseline; locks are enforced.
 */
export function switchMaterial(
  state: WakeState,
  field: Field,
  meta: MaterialMeta,
  catalog: MaterialCatalog,
): WakeState {
  const own = state[field];
  if (own.materialId === meta.id && own.materialVersion === meta.version) return state;
  let previous = own.properties;
  if (state.linked) previous = { ...sharedOnly(state[otherField(field)].properties), ...previous };
  const properties = {
    ...sharedOnly(previous),
    ...valuesAfterMaterialSwitch(previous, meta.properties),
  };
  let next: WakeState = {
    ...state,
    [field]: { materialId: meta.id, materialVersion: meta.version, properties },
  };
  const defs = defsOf(next, catalog);
  if (state.linked) next = unify(next, defs);
  return enforceLocks(next, defs);
}

/** Turn Linked on or off. Linking gives each shared property one value again. */
export function editLinked(state: WakeState, linked: boolean, defs: FieldDefs): WakeState {
  if (state.linked === linked) return state;
  const next: WakeState = { ...state, linked };
  return linked ? enforceLocks(unify(next, defs), defs) : next;
}

// ---------------------------------------------------------------------------------------
// Movement, seed, mute

type TimelineNumber = 'speed' | 'loops' | 'tailSec' | 'smoothing' | 'signatureStrength';

function clampControl(key: TimelineNumber, value: number, fallback: number): number {
  const range = GLOBAL_CONTROLS[key];
  if (!Number.isFinite(value)) return fallback;
  const v = Math.min(range.max, Math.max(range.min, value));
  return key === 'loops' ? Math.round(v) : v;
}

/** Change global controls (SPEC 9.2): values are clamped to their ranges; loops are whole. */
export function editTimeline(state: WakeState, patch: Partial<TimelineSettings>): WakeState {
  const t = state.timeline;
  const next: TimelineSettings = {
    speed: patch.speed === undefined ? t.speed : clampControl('speed', patch.speed, t.speed),
    loops: patch.loops === undefined ? t.loops : clampControl('loops', patch.loops, t.loops),
    loopMode:
      patch.loopMode === 'loop' || patch.loopMode === 'pingpong' ? patch.loopMode : t.loopMode,
    tailSec:
      patch.tailSec === undefined ? t.tailSec : clampControl('tailSec', patch.tailSec, t.tailSec),
    smoothing:
      patch.smoothing === undefined
        ? t.smoothing
        : clampControl('smoothing', patch.smoothing, t.smoothing),
    signatureStrength:
      patch.signatureStrength === undefined
        ? t.signatureStrength
        : clampControl('signatureStrength', patch.signatureStrength, t.signatureStrength),
  };
  const same = (Object.keys(next) as (keyof TimelineSettings)[]).every((k) =>
    Object.is(next[k], t[k]),
  );
  return same ? state : { ...state, timeline: next };
}

/** A seed is a whole number 0–999999. */
export function clampSeed(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  return Math.min(SEED_SPACE - 1, Math.max(0, Math.trunc(seed)));
}

export function editSeed(state: WakeState, seed: number): WakeState {
  const next = clampSeed(seed);
  return next === state.seed ? state : { ...state, seed: next };
}

export function isSoloed(mute: WakeState['mute'], field: Field): boolean {
  return !mute[field] && mute[otherField(field)];
}

/** Mute or unmute one field (a muted visual shows black; a muted sound is silent). */
export function toggleMute(state: WakeState, field: Field): WakeState {
  return { ...state, mute: { ...state.mute, [field]: !state.mute[field] } };
}

/** Solo one field (mute the other); soloing it again brings both back. */
export function toggleSolo(state: WakeState, field: Field): WakeState {
  const mute = isSoloed(state.mute, field)
    ? { visual: false, sound: false }
    : ({ [field]: false, [otherField(field)]: true } as WakeState['mute']);
  return { ...state, mute };
}

// ---------------------------------------------------------------------------------------
// Draw by chance

/**
 * Apply a chance draw (SPEC 12.2): its materials, its open properties (every other shared
 * property locked at baseline), and, when chance also chose values, those values in both
 * fields. Album bookkeeping on an existing record (album id, index, master seed) is kept.
 */
export function applyChanceDraw(
  state: WakeState,
  draw: DrawResult,
  catalog: MaterialCatalog,
): WakeState {
  const album: Partial<ChanceRecord> = {};
  if (state.chance?.albumId !== undefined) album.albumId = state.chance.albumId;
  if (state.chance?.index !== undefined) album.index = state.chance.index;
  if (state.chance?.masterSeed !== undefined) album.masterSeed = state.chance.masterSeed;
  let next: WakeState = {
    ...state,
    chance: { ...album, openProperties: [...draw.openProperties], overrides: [] },
  };
  const visual = catalog.visual(draw.visualId);
  const sound = catalog.sound(draw.soundId);
  if (visual) next = switchMaterial(next, 'visual', visual, catalog);
  if (sound) next = switchMaterial(next, 'sound', sound, catalog);
  const defs = defsOf(next, catalog);
  next = enforceLocks(next, defs);
  if (draw.values) {
    const v = { ...next.visual.properties };
    const s = { ...next.sound.properties };
    for (const [id, value] of Object.entries(draw.values)) {
      if (!draw.openProperties.includes(id)) continue;
      v[id] = clampFor(value, id, defs, 'visual');
      s[id] = clampFor(value, id, defs, 'sound');
    }
    next = withProperties(next, v, s);
  }
  return next;
}

/** Deliberately unlock a locked property; it is recorded under `overrides`. */
export function unlockProperty(state: WakeState, id: string): WakeState {
  if (!state.chance || !isLocked(state.chance, id)) return state;
  const overrides = new Set([...state.chance.overrides, id]);
  return {
    ...state,
    chance: {
      ...state.chance,
      overrides: SHARED_PROPERTY_IDS.filter((p) => overrides.has(p)),
    },
  };
}

// ---------------------------------------------------------------------------------------
// Whole compositions

/** The composition with its wake replaced by `state`. */
export function withWake(composition: Composition, state: WakeState): Composition {
  return {
    ...composition,
    seed: state.seed,
    timeline: state.timeline,
    linked: state.linked,
    visual: state.visual,
    sound: state.sound,
    mute: state.mute,
    chance: state.chance,
  };
}

/** The wake of a composition (shares its objects; don't mutate). */
export function wakeOf(composition: Composition): WakeState {
  return {
    seed: composition.seed,
    timeline: composition.timeline,
    linked: composition.linked,
    visual: composition.visual,
    sound: composition.sound,
    mute: composition.mute,
    chance: composition.chance,
  };
}

/**
 * The name a composition should have once its wake becomes `next`: one still called by its
 * default name ("Wink · Water and Water") follows its materials; a name the person chose
 * (or an album track's number) is kept.
 */
export function followDefaultName(
  composition: Composition,
  next: Pick<WakeState, 'visual' | 'sound'>,
  catalog: MaterialCatalog,
): string {
  const nameFor = (visualId: string, soundId: string): string | null => {
    const visual = catalog.visual(visualId);
    const sound = catalog.sound(soundId);
    return visual && sound
      ? defaultCompositionName(composition.signature.name, visual.name, sound.name)
      : null;
  };
  const before = nameFor(composition.visual.materialId, composition.sound.materialId);
  const after = nameFor(next.visual.materialId, next.sound.materialId);
  return before !== null && after !== null && composition.name === before
    ? after
    : composition.name;
}

/** Record the installed version of each material (on save, after the notice was shown). */
export function withInstalledVersions(
  composition: Composition,
  catalog: MaterialCatalog,
): Composition {
  const visual = catalog.visual(composition.visual.materialId);
  const sound = catalog.sound(composition.sound.materialId);
  return {
    ...composition,
    visual: visual
      ? { ...composition.visual, materialVersion: visual.version }
      : composition.visual,
    sound: sound ? { ...composition.sound, materialVersion: sound.version } : composition.sound,
  };
}

/** Stable text of the parts a person edits (ignores when it was saved and its thumbnail). */
export function compositionFingerprint(composition: Composition): string {
  const { updatedAt: _updatedAt, thumbnail: _thumbnail, ...rest } = composition;
  return JSON.stringify(rest, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : value,
  );
}

/** True when two versions of a composition differ in anything a person edited. */
export function compositionsDiffer(a: Composition, b: Composition): boolean {
  return compositionFingerprint(a) !== compositionFingerprint(b);
}
