import type { SoundMaterialEntry } from '../types';
import { BREATH_SOUND } from './breath';
import { HONEY_SOUND } from './honey';
import { WATER_SOUND } from './water';

/** Every sound material, in picker order. */
export const SOUND_MATERIALS: SoundMaterialEntry[] = [WATER_SOUND, HONEY_SOUND, BREATH_SOUND];
