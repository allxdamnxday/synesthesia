/**
 * Material registry (SPEC 9.1). Materials register in visual/index.ts and
 * sound/index.ts; everything else looks them up here.
 */
import { SOUND_MATERIALS } from './sound';
import type { SoundMaterialEntry, VisualMaterialEntry } from './types';
import { VISUAL_MATERIALS } from './visual';

/** The diagnostic "bare wake" view; selectable, but not one of the five materials. */
export const SIGNATURE_VIEW_ID = 'signature';
export const DEFAULT_VISUAL_ID = 'water';
export const DEFAULT_SOUND_ID = 'water';

export function listVisualMaterials(): readonly VisualMaterialEntry[] {
  return VISUAL_MATERIALS;
}

export function listSoundMaterials(): readonly SoundMaterialEntry[] {
  return SOUND_MATERIALS;
}

export function getVisualMaterial(id: string): VisualMaterialEntry | undefined {
  return VISUAL_MATERIALS.find((m) => m.meta.id === id);
}

export function getSoundMaterial(id: string): SoundMaterialEntry | undefined {
  return SOUND_MATERIALS.find((m) => m.meta.id === id);
}
