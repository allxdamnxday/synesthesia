/**
 * How the Studio groups property sliders (SPEC 9.2 Linked mode, 13.1 "few controls").
 *
 * Linked (the default): a "Both" group shows each shared property used by either material
 * once; one slider drives both fields. Each material's own group then shows only its
 * material-specific properties. Unlinked: each material shows all of its own properties.
 * No group shows more than six primary sliders (a visual material's Hue is shown as well);
 * the rest go under "More".
 */
import { sharedIdsInUse } from '../engine/propertyModel';
import {
  MAX_PRIMARY_PROPERTIES,
  countsTowardPrimaryCap,
  readProperty,
} from '../materials/properties';
import type { PropertyDef, PropertyValues } from '../materials/types';
import type { Field, FieldDefs } from './edits';

export interface PropertySections {
  /** Shared properties driving both fields; null when unlinked. */
  both: PropertyDef[] | null;
  visual: PropertyDef[];
  sound: PropertyDef[];
}

/**
 * Keep the first `max` primary properties primary; later ones move under "More". Hue stays
 * in view whatever the count.
 */
export function capPrimary(
  defs: readonly PropertyDef[],
  max: number = MAX_PRIMARY_PROPERTIES,
): PropertyDef[] {
  let shown = 0;
  return defs.map((def) => {
    if (!def.primary || !countsTowardPrimaryCap(def)) return def;
    shown++;
    return shown <= max ? def : { ...def, primary: false };
  });
}

/**
 * One definition for a shared property in the Both group: the visual material's (or the
 * sound material's, when only it uses the property), primary if either material shows it
 * by default, described for both fields.
 */
export function linkedDef(id: string, defs: FieldDefs): PropertyDef | null {
  const visual = defs.visual.find((d) => d.id === id && d.shared);
  const sound = defs.sound.find((d) => d.id === id && d.shared);
  const base = visual ?? sound;
  if (!base) return null;
  const description =
    visual && sound
      ? `Visual: ${visual.description} Sound: ${sound.description}`
      : visual
        ? `Visual: ${visual.description}`
        : `Sound: ${base.description}`;
  return {
    ...base,
    description,
    primary: (visual?.primary ?? false) || (sound?.primary ?? false),
  };
}

export function propertySections(defs: FieldDefs, linked: boolean): PropertySections {
  if (!linked) {
    return { both: null, visual: capPrimary(defs.visual), sound: capPrimary(defs.sound) };
  }
  const both = sharedIdsInUse(defs.visual, defs.sound)
    .map((id) => linkedDef(id, defs))
    .filter((d): d is PropertyDef => d !== null);
  return {
    both: capPrimary(both),
    visual: capPrimary(defs.visual.filter((d) => !d.shared)),
    sound: capPrimary(defs.sound.filter((d) => !d.shared)),
  };
}

/**
 * Values the Both group shows: each shared property's visual value where the visual
 * material uses it, otherwise the sound's (in Linked mode they are the same).
 */
export function linkedValues(
  both: readonly PropertyDef[],
  defs: FieldDefs,
  values: { visual: PropertyValues; sound: PropertyValues },
): PropertyValues {
  const out: PropertyValues = {};
  for (const def of both) {
    const field: Field = defs.visual.some((d) => d.id === def.id) ? 'visual' : 'sound';
    out[def.id] = readProperty(values[field], def);
  }
  return out;
}

/** The field a Both slider writes through (either works in Linked mode). */
export function linkedField(id: string, defs: FieldDefs): Field {
  return defs.visual.some((d) => d.id === id) ? 'visual' : 'sound';
}
