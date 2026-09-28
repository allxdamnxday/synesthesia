import type { Composition } from '../../../engine/composition';
import type { KineticSignature } from '../../../signature/types';
import { Button } from '../../../ui/Button';

export interface RenderDialogProps {
  composition: Composition;
  signature: KineticSignature;
  /** Called when the dialog closes, with the file name if a render finished. */
  onClose: (renderedFileName: string | null) => void;
}

/**
 * Render MP4 dialog (SPEC 10.1). Placeholder until the render milestone lands; the
 * Studio opens it with the current composition and its signature.
 */
export function RenderDialog({ composition, onClose }: RenderDialogProps) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Render MP4">
      <p>Rendering &ldquo;{composition.name}&rdquo; to MP4 arrives with the next milestone.</p>
      <Button onClick={() => onClose(null)}>Close</Button>
    </div>
  );
}
