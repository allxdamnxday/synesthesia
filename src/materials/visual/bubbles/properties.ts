/**
 * V4 Descending bubbles: property definitions (SPEC 9.2, 9.4). The six shared primaries
 * and Hue are shown by default; Density, Range, Fall speed and Size sit under "More".
 *
 * Rigidity is hidden: a bubble has nothing to bend, and how its shape gives and springs
 * back after a push is already Elasticity.
 */
import { hueProperty, sharedProperty } from '../../properties';
import type { PropertyDef } from '../../types';

export const FALL_SPEED_PROPERTY: PropertyDef = {
  id: 'fallSpeed',
  label: 'Fall speed',
  description: 'How fast the bubbles sink through the water.',
  kind: 'continuous',
  shared: false,
  default: 0.5,
  primary: false,
};

export const SIZE_PROPERTY: PropertyDef = {
  id: 'size',
  label: 'Size',
  description: 'How big the bubbles are.',
  kind: 'continuous',
  shared: false,
  default: 0.5,
  primary: false,
};

export const BUBBLES_PROPERTIES: PropertyDef[] = [
  sharedProperty('viscosity', 'visual', {
    description: 'How thick the water is: bubbles are held back, move less and stop sooner.',
  }),
  sharedProperty('elasticity', 'visual', {
    description: 'How much each bubble wobbles and springs back after the movement pushes it.',
  }),
  sharedProperty('persistence', 'visual', {
    description: 'How long bubbles last, and how long the glow of the movement stays on them.',
  }),
  sharedProperty('dispersion', 'visual', {
    description: 'How widely the bubbles are scattered and how much they wander as they fall.',
  }),
  sharedProperty('brightness', 'visual', {
    description: 'How luminous the rims and highlights of the bubbles are.',
  }),
  sharedProperty('intensity', 'visual', {
    description: 'How strongly the movement pushes the bubbles.',
  }),
  sharedProperty('density', 'visual', {
    description: 'How many bubbles fall at once.',
  }),
  sharedProperty('range', 'visual', {
    description:
      'How large the movement is among the bubbles: small and centered, or magnified past the edges.',
  }),
  FALL_SPEED_PROPERTY,
  SIZE_PROPERTY,
  hueProperty(
    'Turns the colors of the bubbles and their glow around the color wheel; the middle keeps them as they are.',
  ),
];

/** Look up one of the bubbles' property definitions by id. */
export function bubblesProperty(id: string): PropertyDef {
  const def = BUBBLES_PROPERTIES.find((p) => p.id === id);
  if (!def) throw new Error(`Descending bubbles has no property "${id}".`);
  return def;
}
