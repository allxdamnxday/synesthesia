/**
 * A4 Resonance (SPEC 9.5): struck and bowed bodies of glass, wood and metal. Property
 * definitions and picker text. Mapping details live in params.ts and program.ts.
 *
 * Every shared property has a meaning here, so none is hidden. The six primary controls are
 * the ones that change a struck body most: Body, Rigidity (SPEC 9.5's headline mapping for
 * Resonance), Elasticity, Viscosity, Persistence and Intensity. Brightness, Dispersion,
 * Density and Range sit under "More".
 */
import { sharedProperty } from '../../properties';
import type { MaterialMeta, PropertyDef } from '../../types';

export const BODY_CHOICES = ['Glass', 'Wood', 'Metal'] as const;

export const RESONANCE_PROPERTIES: PropertyDef[] = [
  {
    id: 'body',
    label: 'Body',
    description:
      'What is struck: glass rings high and pure, wood knocks short and dry, metal hums long and shimmering.',
    kind: 'choice',
    shared: false,
    default: 0,
    choices: [...BODY_CHOICES],
    primary: true,
  },
  sharedProperty('rigidity', 'sound', {
    primary: true,
    description:
      'How stiff the body is: soft bodies ring in tune, stiff ones clang with out-of-tune overtones and harder strikes.',
  }),
  sharedProperty('elasticity', 'sound', {
    description:
      'How freely the body rings and springs: from a dead knock to a long ring that bounces in pitch when struck.',
  }),
  sharedProperty('viscosity', 'sound', {
    description:
      'How thick the medium around the body is: strikes are muffled, the ring is damped, and the singing follows the movement slowly.',
  }),
  sharedProperty('persistence', 'sound', {
    description:
      'How long the sound lingers after the movement stops: a longer release and a longer reverb tail.',
  }),
  sharedProperty('intensity', 'sound', {
    description: 'How loud and driven the sound is.',
  }),
  sharedProperty('brightness', 'sound', {
    primary: false,
    description: 'How bright the tone is: stronger high overtones and a more open filter.',
  }),
  sharedProperty('dispersion', 'sound', {
    primary: false,
    description:
      'How widely the sound spreads: overtones drift apart across the stereo field and shimmer against each other.',
  }),
  sharedProperty('density', 'sound', {
    description:
      'How many resonances sound together, from a few pure tones to a rich, complex body.',
  }),
  sharedProperty('range', 'sound', {
    description:
      "How far apart the body's resonances sit, from a tight cluster (compressed) to wide spacing (expanded).",
  }),
];

export const RESONANCE_SOUND_META: MaterialMeta = {
  id: 'resonance',
  version: 1,
  name: 'Resonance',
  description:
    'A body of glass, wood or metal, struck at each sudden movement and singing softly while the movement lasts.',
  properties: RESONANCE_PROPERTIES,
};
