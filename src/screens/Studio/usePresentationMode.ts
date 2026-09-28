import { useEffect, type RefObject } from 'react';
import { useStudioStore } from '../../state/studioStore';

/**
 * Presentation mode (SPEC 6.3; F to enter, Esc to leave): the wake alone, full screen.
 * The stage asks the browser for full screen; leaving full screen (Esc, or the browser's
 * own controls) leaves presentation mode. Where full screen is refused, the stage still
 * covers the window.
 */
export function usePresentationMode(stageRef: RefObject<HTMLElement | null>): void {
  const presentation = useStudioStore((s) => s.presentation);

  useEffect(() => {
    const stage = stageRef.current;
    if (presentation) {
      if (stage && document.fullscreenElement !== stage && stage.requestFullscreen) {
        stage.requestFullscreen().catch(() => undefined);
      }
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    }
  }, [presentation, stageRef]);

  useEffect(() => {
    const onChange = () => {
      const s = useStudioStore.getState();
      if (!document.fullscreenElement && s.presentation) s.setPresentation(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, []);
}
