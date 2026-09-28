import type { SoundMaterialEntry } from '../../types';
import { RESONANCE_SOUND_META } from './meta';
import { createResonanceSound } from './resonance';

/** A4 Resonance: struck and bowed bodies of glass, wood and metal. */
export const RESONANCE_SOUND: SoundMaterialEntry = {
  kind: 'sound',
  meta: RESONANCE_SOUND_META,
  create: createResonanceSound,
};
