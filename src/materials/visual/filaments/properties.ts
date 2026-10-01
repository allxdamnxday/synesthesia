/**
 * V5 Filaments: property definitions (SPEC 9.2, 9.4). Rigidity is promoted to primary
 * (how stiff the strands are is their most telling quality) and Dispersion moves under
 * "More" to keep six primaries, with Hue shown beside them. Every shared property applies.
 */
import { hueProperty, sharedProperty } from '../../properties';
import type { PropertyDef } from '../../types';

export const LENGTH_PROPERTY: PropertyDef = {
  id: 'length',
  label: 'Length',
  description: 'How long each strand is.',
  kind: 'continuous',
  shared: false,
  default: 0.5,
  primary: false,
};

export const THICKNESS_PROPERTY: PropertyDef = {
  id: 'thickness',
  label: 'Thickness',
  description: 'How thick each strand and its ribbon of light are.',
  kind: 'continuous',
  shared: false,
  default: 0.5,
  primary: false,
};

export const FILAMENTS_PROPERTIES: PropertyDef[] = [
  sharedProperty('viscosity', 'visual', {
    description:
      'How thick the water is: strands move less, lag behind the movement and stop sooner.',
  }),
  sharedProperty('elasticity', 'visual', {
    description:
      'How strongly the strands spring back to where they rest, overshooting as they settle.',
  }),
  sharedProperty('persistence', 'visual', {
    description: 'How long the ribbons of light that moving strands paint take to fade.',
  }),
  sharedProperty('rigidity', 'visual', {
    primary: true,
    description:
      'How stiff the strands are: soft ones curl with the flow, stiff ones swing like rods.',
  }),
  sharedProperty('brightness', 'visual', {
    description: 'How luminous the strands and their ribbons of light are.',
  }),
  sharedProperty('intensity', 'visual', {
    description: 'How strongly the movement pushes the strands.',
  }),
  sharedProperty('dispersion', 'visual', {
    primary: false,
    description: 'How tangled the strands lie, and how much the movement scatters them.',
  }),
  sharedProperty('density', 'visual', {
    description: 'How many strands there are.',
  }),
  sharedProperty('range', 'visual', {
    description:
      'How large the movement is among the strands: small and centered, or magnified past the edges.',
  }),
  LENGTH_PROPERTY,
  THICKNESS_PROPERTY,
  hueProperty(
    'Turns the colors of the strands and their ribbons of light around the color wheel; the middle keeps them as they are.',
  ),
];

/** Look up one of the filaments' property definitions by id. */
export function filamentsProperty(id: string): PropertyDef {
  const def = FILAMENTS_PROPERTIES.find((p) => p.id === id);
  if (!def) throw new Error(`Filaments has no property "${id}".`);
  return def;
}
