/**
 * A1 Water (SPEC 9.5): quick, bright, rising, "Breee-weet!". Property definitions and
 * picker text. Mapping details live in params.ts and program.ts.
 */
import { sharedProperty } from '../../properties';
import type { MaterialMeta, PropertyDef } from '../../types';

export const REGISTER_CHOICES = ['Low', 'Middle', 'High'] as const;

export const WATER_PROPERTIES: PropertyDef[] = [
  sharedProperty('viscosity', 'sound', {
    description:
      'How slowly the pitch follows the movement: quick glides at the low end, softer attacks and a darker tone at the high end.',
  }),
  sharedProperty('elasticity', 'sound', {
    description: 'How much the pitch overshoots and wobbles when the movement jolts.',
  }),
  sharedProperty('persistence', 'sound', {
    description: 'How long each sound lingers: a longer release and a longer reverb tail.',
  }),
  sharedProperty('dispersion', 'sound', {
    description:
      'How far the sound spreads: voices drift apart in pitch and across the stereo field.',
  }),
  sharedProperty('brightness', 'sound', {
    description: 'How bright and buzzy the tone is.',
  }),
  sharedProperty('intensity', 'sound', {
    description: 'How loud and driven the sound is.',
  }),
  sharedProperty('range', 'sound', {
    description: 'How far the pitch travels with the movement, from narrow to wide.',
  }),
  sharedProperty('density', 'sound', {
    description:
      'How many voices sing together (one to three), and how clearly droplets mark sudden movements.',
  }),
  sharedProperty('rigidity', 'sound', {
    default: 0,
    description:
      'At zero the pitch glides freely; raise it and the pitch snaps to a five-note scale with sharper attacks.',
  }),
  {
    id: 'register',
    label: 'Register',
    description: 'Where the voice sits: low, middle, or high.',
    kind: 'choice',
    shared: false,
    default: 1,
    choices: [...REGISTER_CHOICES],
    primary: false,
  },
];

export const WATER_SOUND_META: MaterialMeta = {
  id: 'water',
  version: 1,
  name: 'Water',
  description:
    'A quick, bright whistle, like a finger drawn through water. Rising movement rises in pitch; sudden movements add droplets.',
  properties: WATER_PROPERTIES,
};
