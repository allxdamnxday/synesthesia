import type { VisualMaterialEntry } from '../../types';
import { SIGNATURE_VIEW_META, SignatureView } from './SignatureView';

export { SHOW_READOUT_PROPERTY, SIGNATURE_VIEW_META, SignatureView } from './SignatureView';

export const signatureViewEntry: VisualMaterialEntry = {
  kind: 'visual',
  meta: SIGNATURE_VIEW_META,
  create: () => new SignatureView(),
};
