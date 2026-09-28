import type { VisualMaterialEntry } from '../../types';
import { BUBBLES_META, BubblesMaterial } from './BubblesMaterial';

export { BUBBLES_META, BubblesMaterial } from './BubblesMaterial';
export { BubbleSim } from './BubbleSim';
export { BUBBLE_TIER_CAPS, bubbleParams, type BubbleParams } from './mapping';

export const bubblesEntry: VisualMaterialEntry = {
  kind: 'visual',
  meta: BUBBLES_META,
  create: () => new BubblesMaterial(),
};
