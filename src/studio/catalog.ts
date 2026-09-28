/**
 * The installed materials, as the Studio sees them: lookups for the pure edit functions,
 * picker options, and the pools Draw by chance chooses from.
 */
import type { MaterialChoiceInfo } from '../chance/draw';
import {
  SIGNATURE_VIEW_ID,
  getSoundMaterial,
  getVisualMaterial,
  listSoundMaterials,
  listVisualMaterials,
} from '../materials/registry';
import type { MaterialMeta } from '../materials/types';
import type { MaterialCatalog } from './edits';

export const registryCatalog: MaterialCatalog = {
  visual: (id) => getVisualMaterial(id)?.meta,
  sound: (id) => getSoundMaterial(id)?.meta,
};

export function visualMetas(): MaterialMeta[] {
  return listVisualMaterials().map((e) => e.meta);
}

export function soundMetas(): MaterialMeta[] {
  return listSoundMaterials().map((e) => e.meta);
}

/**
 * Visual materials chance may pick. The Signature view is a diagnostic "bare wake", not one
 * of the materials (SPEC 9.4), so it is never drawn by chance (as in albums).
 */
export function chanceVisualMetas(): MaterialMeta[] {
  return visualMetas().filter((m) => m.id !== SIGNATURE_VIEW_ID);
}

export function chanceSoundMetas(): MaterialMeta[] {
  return soundMetas();
}

export function choiceInfo(meta: MaterialMeta): MaterialChoiceInfo {
  return { id: meta.id, sharedIds: meta.properties.filter((p) => p.shared).map((p) => p.id) };
}
