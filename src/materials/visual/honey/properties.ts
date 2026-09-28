/**
 * V2 Honey: property definitions (SPEC 9.2, 9.4). Hides Rigidity: honey has no hard
 * edges, and its thickness is already Viscosity.
 */
import { sharedProperty } from '../../properties';
import type { PropertyDef } from '../../types';

export const HONEY_PALETTES = ['Amber', 'Dark honey', 'Pale gold'] as const;

export const HONEY_PALETTE_PROPERTY: PropertyDef = {
  id: 'palette',
  label: 'Palette',
  description: 'The colors of the honey. Each direction of movement has its own shade.',
  kind: 'choice',
  shared: false,
  default: 0,
  choices: [...HONEY_PALETTES],
  primary: false,
};

export const HONEY_SURFACE_LIGHT_PROPERTY: PropertyDef = {
  id: 'surfaceLight',
  label: 'Surface light',
  description: 'The glossy sheen of light on the honey, as if looking up through the bowl.',
  kind: 'continuous',
  shared: false,
  default: 0.6,
  primary: false,
};

export const HONEY_PROPERTIES: PropertyDef[] = [
  sharedProperty('viscosity', 'visual', {
    description:
      'How thick the honey is: thicker honey drags more of itself along, lags further behind and stops sooner.',
  }),
  sharedProperty('elasticity', 'visual', {
    default: 0.3,
    description: 'How much the honey springs back toward where it was, and overshoots.',
  }),
  sharedProperty('persistence', 'visual', {
    description: 'How long the colors folded into the honey stay before they fade.',
  }),
  sharedProperty('dispersion', 'visual', {
    description: 'How unevenly the honey is pushed, so the wake spreads and folds.',
  }),
  sharedProperty('brightness', 'visual', {
    description: 'How luminous and saturated the colors are.',
  }),
  sharedProperty('intensity', 'visual', {
    description: 'How strongly the movement drags the honey.',
  }),
  sharedProperty('density', 'visual', {
    description: 'How much color the movement folds into the honey.',
  }),
  sharedProperty('range', 'visual', {
    description:
      'How large the movement is in the honey: small and centered, or magnified past the edges.',
  }),
  HONEY_PALETTE_PROPERTY,
  HONEY_SURFACE_LIGHT_PROPERTY,
];

/** Look up one of Honey's property definitions by id. */
export function honeyProperty(id: string): PropertyDef {
  const def = HONEY_PROPERTIES.find((p) => p.id === id);
  if (!def) throw new Error(`Honey has no property "${id}".`);
  return def;
}
