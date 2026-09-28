/**
 * A2 Honey (SPEC 9.5): low, slow, stuttering, drawn-out, "Broo-roo-roo-roo-rooo-oot".
 * Property definitions and picker text. Mapping details live in params.ts and program.ts.
 *
 * Rigidity is hidden: honey has no rigid state, and snapping the pitch to a scale or making
 * the envelopes percussive would fight the slow glide that defines it. Stutter depth takes
 * the articulation role instead. Dispersion moves under "More" to make room for Stutter
 * depth, Honey's defining behaviour.
 */
import { sharedProperty } from '../../properties';
import type { MaterialMeta, PropertyDef } from '../../types';

export const HONEY_PROPERTIES: PropertyDef[] = [
  sharedProperty('viscosity', 'sound', {
    description:
      'How thick the honey is: the sound lags further behind the movement, glides more slowly and turns darker.',
  }),
  sharedProperty('elasticity', 'sound', {
    description: 'How much the tone rings: a more resonant, vowel-like hum with a little bounce.',
  }),
  sharedProperty('persistence', 'sound', {
    description: 'How long each sound is drawn out: a longer release and a longer reverb tail.',
  }),
  sharedProperty('brightness', 'sound', {
    description: 'How bright the tone is: from a soft, dark hum to a buzzier, more open sound.',
  }),
  sharedProperty('intensity', 'sound', {
    description: 'How loud and driven the sound is.',
  }),
  {
    id: 'stutterDepth',
    label: 'Stutter depth',
    description:
      'How strongly the sound breaks into repeated "roo" syllables: a smooth hum at zero, separate syllables at the top.',
    kind: 'continuous',
    shared: false,
    default: 0.5,
    primary: true,
  },
  sharedProperty('dispersion', 'sound', {
    primary: false,
    description:
      'How far the sound spreads: stacked voices drift apart in pitch and across the stereo field.',
  }),
  sharedProperty('density', 'sound', {
    description: 'How many voices are stacked, from one to four (the fourth an octave below).',
  }),
  sharedProperty('range', 'sound', {
    description:
      'How far the pitch travels with the movement, and how deep the fall at the end of each movement.',
  }),
];

export const HONEY_SOUND_META: MaterialMeta = {
  id: 'honey',
  version: 1,
  name: 'Honey',
  description:
    'A low, slow hum that lags and stutters, like a finger drawn through honey. Faster movement stutters faster; each movement ends with a slow fall.',
  properties: HONEY_PROPERTIES,
};
