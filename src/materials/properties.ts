/**
 * The shared property vocabulary (SPEC 9.2). Each shared property means the same thing
 * in the visual and the sound field, so one slider can drive both (Linked mode).
 * Every property is 0–1 with baseline 0.5 unless a material's baseline says otherwise.
 */
import type { MaterialKind, PropertyDef, PropertyValues } from './types';

export const SHARED_PROPERTY_IDS = [
  'viscosity',
  'elasticity',
  'persistence',
  'dispersion',
  'brightness',
  'intensity',
  'rigidity',
  'density',
  'range',
] as const;

export type SharedPropertyId = (typeof SHARED_PROPERTY_IDS)[number];

export interface SharedPropertyInfo {
  id: SharedPropertyId;
  label: string;
  /** Plain-language meaning in the visual field. */
  visual: string;
  /** Plain-language meaning in the sound field. */
  sound: string;
  /** Shown by default (primary) unless a material overrides it. */
  primary: boolean;
}

export const SHARED_PROPERTIES: Readonly<Record<SharedPropertyId, SharedPropertyInfo>> = {
  viscosity: {
    id: 'viscosity',
    label: 'Viscosity',
    visual:
      'How thick the material is: it resists flow, spreads slowly, and lags behind the movement.',
    sound: 'How slowly the sound follows: longer glides, a darker tone, and softer attacks.',
    primary: true,
  },
  elasticity: {
    id: 'elasticity',
    label: 'Elasticity',
    visual: 'How much the material springs back and overshoots toward rest.',
    sound: 'How much the sound rings, bounces in pitch, and overshoots.',
    primary: true,
  },
  persistence: {
    id: 'persistence',
    label: 'Persistence',
    visual: 'How long the wake stays visible before it fades.',
    sound: 'How long each sound lingers: longer release and a longer reverb tail.',
    primary: true,
  },
  dispersion: {
    id: 'dispersion',
    label: 'Dispersion',
    visual: 'How much the wake spreads, scatters, and turns turbulent.',
    sound: 'How widely the sound spreads: stereo width, scatter, and detuning.',
    primary: true,
  },
  brightness: {
    id: 'brightness',
    label: 'Brightness',
    visual: 'How luminous and saturated the wake is.',
    sound: 'How bright the tone is: more high harmonics, a more open filter.',
    primary: true,
  },
  intensity: {
    id: 'intensity',
    label: 'Intensity',
    visual: 'How strongly the signature pushes the material.',
    sound: 'How loud and driven the sound is.',
    primary: true,
  },
  rigidity: {
    id: 'rigidity',
    label: 'Rigidity',
    visual: 'How hard-edged and crisp shapes are, and how much they resist bending.',
    sound: 'How sharp the attacks are; pitch snaps to a scale; envelopes become percussive.',
    primary: false,
  },
  density: {
    id: 'density',
    label: 'Density',
    visual: 'How much material there is: dye, particles, or filaments.',
    sound: 'How many voices, grains, or pulses sound at once.',
    primary: false,
  },
  range: {
    id: 'range',
    label: 'Range',
    visual: 'From compressed to expanded: the scale at which the movement is projected.',
    sound: 'Pitch range, from narrow (compressed) to wide (expanded).',
    primary: false,
  },
};

export function isSharedPropertyId(id: string): id is SharedPropertyId {
  return (SHARED_PROPERTY_IDS as readonly string[]).includes(id);
}

/**
 * Build a PropertyDef for a shared property as used by one material.
 * `overrides` can change the baseline, primary flag, or the description.
 */
export function sharedProperty(
  id: SharedPropertyId,
  kind: MaterialKind,
  overrides: Partial<Pick<PropertyDef, 'default' | 'primary' | 'description'>> = {},
): PropertyDef {
  const info = SHARED_PROPERTIES[id];
  return {
    id,
    label: info.label,
    description: overrides.description ?? (kind === 'visual' ? info.visual : info.sound),
    kind: 'continuous',
    shared: true,
    default: overrides.default ?? 0.5,
    primary: overrides.primary ?? info.primary,
  };
}

/** Baseline values for a list of property definitions. */
export function baselineValues(properties: readonly PropertyDef[]): PropertyValues {
  const values: PropertyValues = {};
  for (const p of properties) values[p.id] = p.default;
  return values;
}

/**
 * Read a property with a fallback to its baseline, clamped to its valid range.
 * Materials should read properties through this so missing or out-of-range values
 * never break a render.
 */
export function readProperty(
  props: PropertyValues,
  def: Pick<PropertyDef, 'id' | 'default' | 'kind' | 'choices'>,
): number {
  const raw = props[def.id];
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : def.default;
  if (def.kind === 'choice') {
    const max = Math.max(0, (def.choices?.length ?? 1) - 1);
    return Math.min(max, Math.max(0, Math.round(value)));
  }
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Most material-specific properties a material may add (SPEC 9.2). */
export const MAX_SPECIFIC_PROPERTIES = 3;
/** Most primary (always visible) properties per material (SPEC 9.1). */
export const MAX_PRIMARY_PROPERTIES = 6;
