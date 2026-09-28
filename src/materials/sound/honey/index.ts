import type { SoundMaterialEntry } from '../../types';
import { createHoneySound } from './honey';
import { HONEY_SOUND_META } from './meta';

/** A2 Honey: low, slow, stuttering, drawn-out ("Broo-roo-roo-roo-rooo-oot"). */
export const HONEY_SOUND: SoundMaterialEntry = {
  kind: 'sound',
  meta: HONEY_SOUND_META,
  create: createHoneySound,
};
