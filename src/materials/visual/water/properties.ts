/** V1 Water: property definitions (SPEC 9.2, 9.4). Hides Elasticity and Rigidity. */
import { hueProperty, sharedProperty } from '../../properties';
import type { PropertyDef } from '../../types';

export const WATER_PALETTES = ['Deep water', 'Ink', 'Prism'] as const;

export const PALETTE_PROPERTY: PropertyDef = {
  id: 'palette',
  label: 'Palette',
  description: 'The colors of the dye. Each direction of movement has its own color.',
  kind: 'choice',
  shared: false,
  default: 0,
  choices: [...WATER_PALETTES],
  primary: false,
};

export const SURFACE_LIGHT_PROPERTY: PropertyDef = {
  id: 'surfaceLight',
  label: 'Surface light',
  description: 'Light glinting through the moving surface, as if looking up through the water.',
  kind: 'continuous',
  shared: false,
  default: 0.5,
  primary: false,
};

export const WATER_PROPERTIES: PropertyDef[] = [
  sharedProperty('viscosity', 'visual', {
    description:
      'How thick the water is: thicker water moves more slowly and smooths away small swirls.',
  }),
  sharedProperty('persistence', 'visual', {
    description: 'How long the colored trails stay before they fade.',
  }),
  sharedProperty('dispersion', 'visual', {
    description: 'How much the wake curls, scatters and turns turbulent.',
  }),
  sharedProperty('brightness', 'visual', {
    description: 'How luminous and saturated the colors are.',
  }),
  sharedProperty('intensity', 'visual', {
    description: 'How strongly the movement stirs the water.',
  }),
  sharedProperty('density', 'visual', {
    primary: true,
    description: 'How much dye the movement releases into the water.',
  }),
  sharedProperty('range', 'visual', {
    description:
      'How large the movement is in the water: small and centered, or magnified past the edges.',
  }),
  PALETTE_PROPERTY,
  SURFACE_LIGHT_PROPERTY,
  hueProperty(
    'Turns every color of the dye around the color wheel; the middle keeps the palette as it is.',
  ),
];

/** Look up one of Water's property definitions by id. */
export function waterProperty(id: string): PropertyDef {
  const def = WATER_PROPERTIES.find((p) => p.id === id);
  if (!def) throw new Error(`Water has no property "${id}".`);
  return def;
}
