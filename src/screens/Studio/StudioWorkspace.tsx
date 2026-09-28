import { useRef } from 'react';
import { useStudioStore } from '../../state/studioStore';
import { RenderDialog } from './render/RenderDialog';
import styles from './Studio.module.css';
import { StudioHeader } from './StudioHeader';
import { StudioPanel } from './StudioPanel';
import { StudioStage } from './StudioStage';
import { StudioTransport } from './StudioTransport';
import { usePresentationMode } from './usePresentationMode';
import { useStudioKeyboard } from './useStudioKeyboard';

/**
 * The Studio's layout (SPEC 13.3): a header with the breadcrumb and Save / Render; the
 * wake, which dominates; the controls on the right; the transport along the bottom. In
 * presentation mode only the wake remains.
 */
export function StudioWorkspace() {
  const presentation = useStudioStore((s) => s.presentation);
  const renderOpen = useStudioStore((s) => s.renderOpen);
  const composition = useStudioStore((s) => s.composition);
  const signature = useStudioStore((s) => s.signature);
  const stageRef = useRef<HTMLDivElement>(null);
  useStudioKeyboard();
  usePresentationMode(stageRef);

  return (
    <div className={`${styles.studio} ${presentation ? styles.presenting : ''}`}>
      <div className={styles.grid}>
        {presentation ? null : <StudioHeader />}
        <StudioStage ref={stageRef} />
        {presentation ? null : <StudioPanel />}
        {presentation ? null : <StudioTransport />}
      </div>
      {renderOpen && composition && signature ? (
        <RenderDialog
          composition={composition}
          signature={signature}
          onClose={(fileName) => useStudioStore.getState().renderClosed(fileName)}
        />
      ) : null}
    </div>
  );
}
