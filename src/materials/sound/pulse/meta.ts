/**
 * A5 Pulse (SPEC 9.5): rhythmic plucks and ticks. Property definitions and picker text.
 * Mapping details live in params.ts and program.ts.
 *
 * Every shared property has a meaning here, so none is hidden. The six primary controls are
 * the ones SPEC 9.5 builds Pulse around (Rigidity, Range, Density, Persistence) plus Viscosity
 * and Intensity. Scale, Elasticity, Brightness and Dispersion sit under "More".
 */
import { sharedProperty } from '../../properties';
import type { MaterialMeta, PropertyDef } from '../../types';

export const SCALE_CHOICES = ['Free', 'Pentatonic', 'Whole-tone'] as const;

export const PULSE_PROPERTIES: PropertyDef[] = [
  sharedProperty('rigidity', 'sound', {
    primary: true,
    description:
      'At zero, pitch and timing float freely; raise it and the notes lock to the scale, then the pulses lock to a steady beat, with sharper attacks.',
  }),
  sharedProperty('range', 'sound', {
    primary: true,
    description:
      'How much the pulse speeds up and the pitch travels with the movement, from steady and narrow to wide.',
  }),
  sharedProperty('density', 'sound', {
    primary: true,
    description: 'How many pulses sound: from sparse, scattered plucks to every pulse firing.',
  }),
  sharedProperty('persistence', 'sound', {
    description: 'How long each pluck rings, and how long the reverb tail lasts.',
  }),
  sharedProperty('viscosity', 'sound', {
    description:
      'How thick the plucking feels: softer, darker plucks that follow the movement slowly.',
  }),
  sharedProperty('intensity', 'sound', {
    description: 'How loud and driven the sound is.',
  }),
  {
    id: 'scale',
    label: 'Scale',
    description:
      'The notes the plucks may use: free pitch, a five-note scale, or a whole-tone scale.',
    kind: 'choice',
    shared: false,
    default: 1,
    choices: [...SCALE_CHOICES],
    primary: false,
  },
  sharedProperty('elasticity', 'sound', {
    primary: false,
    description: 'How much each pluck twangs: its pitch bounces and settles like a plucked band.',
  }),
  sharedProperty('brightness', 'sound', {
    primary: false,
    description: 'How bright the plucks are: more high overtones and a more open filter.',
  }),
  sharedProperty('dispersion', 'sound', {
    primary: false,
    description:
      'How widely the plucks spread: across the stereo field, and a little apart in tuning and in time.',
  }),
];

export const PULSE_SOUND_META: MaterialMeta = {
  id: 'pulse',
  version: 1,
  name: 'Pulse',
  description:
    'Rhythmic plucks that quicken with the movement. Higher movement plays higher notes; sudden movements pluck at once.',
  properties: PULSE_PROPERTIES,
};
