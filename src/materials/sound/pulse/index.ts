import type { SoundMaterialEntry } from '../../types';
import { PULSE_SOUND_META } from './meta';
import { createPulseSound } from './pulse';

/** A5 Pulse: rhythmic plucks and ticks. */
export const PULSE_SOUND: SoundMaterialEntry = {
  kind: 'sound',
  meta: PULSE_SOUND_META,
  create: createPulseSound,
};
