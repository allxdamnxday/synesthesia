import type { SoundMaterialEntry } from '../../types';
import { createBreathSound } from './breath';
import { BREATH_SOUND_META } from './meta';

/** A3 Breath: air, inhale and exhale. */
export const BREATH_SOUND: SoundMaterialEntry = {
  kind: 'sound',
  meta: BREATH_SOUND_META,
  create: createBreathSound,
};
