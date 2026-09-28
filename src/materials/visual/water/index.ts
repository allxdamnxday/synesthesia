import type { VisualMaterialEntry } from '../../types';
import { WATER_META, WaterMaterial } from './WaterMaterial';

export { WATER_META, WaterMaterial, type WaterOptions } from './WaterMaterial';
export { waterParams, type WaterParams } from './mapping';

export const waterEntry: VisualMaterialEntry = {
  kind: 'visual',
  meta: WATER_META,
  create: () => new WaterMaterial(),
};
