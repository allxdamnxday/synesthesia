/**
 * A3 Breath (SPEC 9.5): air, inhale and exhale. Property definitions and picker text.
 * Mapping details live in params.ts and program.ts.
 *
 * Rigidity is hidden: breath has no rigid form, a band of noise has no pitch to snap to a
 * scale, and sharp onsets are already there with Viscosity at zero.
 */
import { sharedProperty } from '../../properties';
import type { MaterialMeta, PropertyDef } from '../../types';

export const FORMANT_CHOICES = ['None', 'Ah', 'Oo'] as const;

export const BREATH_PROPERTIES: PropertyDef[] = [
  sharedProperty('viscosity', 'sound', {
    description:
      'How slowly the breath follows the movement: slower swells, softer onsets and a darker sound.',
  }),
  sharedProperty('elasticity', 'sound', {
    description:
      'How much the air rings: a narrower band that bounces as it moves, whistling at the top.',
  }),
  sharedProperty('persistence', 'sound', {
    description: 'How long each breath lingers: a longer release and a longer reverb tail.',
  }),
  sharedProperty('dispersion', 'sound', {
    description:
      'How widely the breath spreads: a broader band of air (broader still when the movement is spread out) and a wider stereo image.',
  }),
  sharedProperty('brightness', 'sound', {
    description: 'How high and airy the breath sounds, from a low hush to a bright hiss.',
  }),
  sharedProperty('intensity', 'sound', {
    description: 'How loud and driven the breath is.',
  }),
  sharedProperty('range', 'sound', {
    description:
      'How far the band of air travels with the movement: with its height in the frame, and as it opens and closes.',
  }),
  sharedProperty('density', 'sound', {
    description:
      'How many layers of air sound together: one band, then a lower chest layer, then a high hiss.',
  }),
  {
    id: 'formant',
    label: 'Formant',
    description:
      'The shape of the mouth the air passes through: none (plain air), "ah" (open) or "oo" (rounded).',
    kind: 'choice',
    shared: false,
    default: 0,
    choices: [...FORMANT_CHOICES],
    primary: false,
  },
];

export const BREATH_SOUND_META: MaterialMeta = {
  id: 'breath',
  version: 1,
  name: 'Breath',
  description:
    'Air drawn in and let out. Spreading movement swells and opens the breath like an inhale; gathering movement closes it down.',
  properties: BREATH_PROPERTIES,
};
