import type { VisualMaterialEntry } from '../../types';
import { SMOKE_META, SmokeMaterial } from './SmokeMaterial';

export { SMOKE_META, SmokeMaterial, type SmokeOptions } from './SmokeMaterial';
export { smokeParams, type SmokeParams } from './mapping';

export const smokeEntry: VisualMaterialEntry = {
  kind: 'visual',
  meta: SMOKE_META,
  create: () => new SmokeMaterial(),
};
