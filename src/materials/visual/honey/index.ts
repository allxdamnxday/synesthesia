import type { VisualMaterialEntry } from '../../types';
import { HONEY_META, HoneyMaterial } from './HoneyMaterial';

export { HONEY_META, HoneyMaterial, type HoneyOptions } from './HoneyMaterial';
export { honeyParams, type HoneyParams } from './mapping';

export const honeyEntry: VisualMaterialEntry = {
  kind: 'visual',
  meta: HONEY_META,
  create: () => new HoneyMaterial(),
};
