import type { SoundMaterialEntry } from '../types';
import { WATER_SOUND } from './water';
import { RESONANCE_SOUND } from './resonance';
import { PULSE_SOUND } from './pulse';

/** Every sound material, in picker order. */
export const SOUND_MATERIALS: SoundMaterialEntry[] = [WATER_SOUND, RESONANCE_SOUND, PULSE_SOUND];
