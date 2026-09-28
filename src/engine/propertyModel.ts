/**
 * Property values for a composition's two fields, with Linked mode (SPEC 9.2): one slider
 * per shared property drives both the visual and the sound material. Material-specific
 * properties are never linked. All functions are pure and return new objects.
 */
import {
  baselineValues,
  isSharedPropertyId,
  readProperty,
  SHARED_PROPERTY_IDS,
  type SharedPropertyId,
} from '../materials/properties';
import type { PropertyDef, PropertyValues } from '../materials/types';

export type Field = 'visual' | 'sound';

export interface PropertyState {
  linked: boolean;
  visual: PropertyValues;
  sound: PropertyValues;
}

/** Shared properties used by either material, in vocabulary order. */
export function sharedIdsInUse(
  visualDefs: readonly PropertyDef[],
  soundDefs: readonly PropertyDef[],
): SharedPropertyId[] {
  const used = new Set<string>();
  for (const d of visualDefs) if (d.shared) used.add(d.id);
  for (const d of soundDefs) if (d.shared) used.add(d.id);
  return SHARED_PROPERTY_IDS.filter((id) => used.has(id));
}

/** Complete a value map for a material: every property present, clamped, baselines filled. */
export function completeValues(
  values: PropertyValues,
  defs: readonly PropertyDef[],
): PropertyValues {
  const out: PropertyValues = {};
  for (const d of defs) out[d.id] = readProperty(values, d);
  return out;
}

/**
 * Set one property. When linked and the property is shared, both fields change;
 * otherwise only the given field.
 */
export function setProperty(
  state: PropertyState,
  field: Field,
  id: string,
  value: number,
): PropertyState {
  if (state.linked && isSharedPropertyId(id)) {
    return {
      ...state,
      visual: { ...state.visual, [id]: value },
      sound: { ...state.sound, [id]: value },
    };
  }
  return { ...state, [field]: { ...state[field], [id]: value } };
}

/**
 * Turn Linked on or off. Unlinking keeps both sets as they are. Linking again makes each
 * shared property take the visual material's value (or the sound material's when the
 * visual material doesn't use it).
 */
export function setLinked(
  state: PropertyState,
  linked: boolean,
  visualDefs: readonly PropertyDef[],
  soundDefs: readonly PropertyDef[],
): PropertyState {
  if (!linked) return { ...state, linked };
  const visual = { ...state.visual };
  const sound = { ...state.sound };
  const visualIds = new Set(visualDefs.filter((d) => d.shared).map((d) => d.id));
  for (const id of sharedIdsInUse(visualDefs, soundDefs)) {
    const value = visualIds.has(id) ? visual[id] : sound[id];
    if (value === undefined) continue;
    visual[id] = value;
    sound[id] = value;
  }
  return { linked, visual, sound };
}

/**
 * Values for a newly chosen material. Shared properties carry over from the previous
 * values (they mean the same thing in every material, which is what makes comparison
 * possible); material-specific properties start at the new material's baseline.
 */
export function valuesAfterMaterialSwitch(
  previous: PropertyValues,
  newDefs: readonly PropertyDef[],
): PropertyValues {
  const out = baselineValues(newDefs);
  for (const d of newDefs) {
    const carried = previous[d.id];
    if (d.shared && typeof carried === 'number') out[d.id] = readProperty(previous, d);
  }
  return out;
}

/** Reset one property (or all) of a field to the material's baseline. */
export function resetToBaseline(
  values: PropertyValues,
  defs: readonly PropertyDef[],
  id?: string,
): PropertyValues {
  const base = baselineValues(defs);
  if (id === undefined) return base;
  const def = defs.find((d) => d.id === id);
  return def ? { ...values, [id]: def.default } : values;
}
