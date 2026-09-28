import type { SoundMaterialEntry } from '../../types';
import { WATER_SOUND_META } from './meta';
import { createWaterSound } from './water';

/** A1 Water: quick, bright, rising ("Breee-weet!"). */
export const WATER_SOUND: SoundMaterialEntry = {
  kind: 'sound',
  meta: WATER_SOUND_META,
  create: createWaterSound,
};
