/**
 * V3 Smoke: property definitions (SPEC 9.2, 9.4). Hides Elasticity (smoke has no shape to
 * spring back to) and Rigidity (smoke has no edges to make crisp).
 */
import { sharedProperty } from '../../properties';
import type { PropertyDef } from '../../types';

export const RISE_PROPERTY: PropertyDef = {
  id: 'rise',
  label: 'Rise',
  description: 'How strongly the warm smoke rises; below the middle it is heavy and sinks instead.',
  kind: 'continuous',
  shared: false,
  default: 0.7,
  primary: true,
};

export const SMOKE_PROPERTIES: PropertyDef[] = [
  sharedProperty('viscosity', 'visual', {
    description: 'How thick the air is: thicker air moves slowly and smooths away the curls.',
  }),
  sharedProperty('persistence', 'visual', {
    description: 'How long the smoke hangs in the air before it thins away.',
  }),
  sharedProperty('dispersion', 'visual', {
    description: 'How much the smoke curls, eddies and breaks into turbulence.',
  }),
  sharedProperty('brightness', 'visual', {
    description: 'How luminous the smoke is.',
  }),
  sharedProperty('intensity', 'visual', {
    description: 'How strongly the movement pushes the smoke.',
  }),
  RISE_PROPERTY,
  sharedProperty('density', 'visual', {
    description: 'How much smoke the movement gives off.',
  }),
  sharedProperty('range', 'visual', {
    description:
      'How large the movement is in the air: small and centered, or magnified past the edges.',
  }),
];

/** Look up one of Smoke's property definitions by id. */
export function smokeProperty(id: string): PropertyDef {
  const def = SMOKE_PROPERTIES.find((p) => p.id === id);
  if (!def) throw new Error(`Smoke has no property "${id}".`);
  return def;
}
