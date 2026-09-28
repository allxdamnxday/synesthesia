import type { VisualMaterialEntry } from '../../types';
import { FILAMENTS_META, FilamentsMaterial } from './FilamentsMaterial';

export { FILAMENTS_META, FilamentsMaterial, RIBBON_SHORT_SIDE } from './FilamentsMaterial';
export { FilamentSim, POINTS_PER_STRAND } from './FilamentSim';
export { FILAMENT_TIER_CAPS, filamentParams, type FilamentParams } from './mapping';

export const filamentsEntry: VisualMaterialEntry = {
  kind: 'visual',
  meta: FILAMENTS_META,
  create: () => new FilamentsMaterial(),
};
