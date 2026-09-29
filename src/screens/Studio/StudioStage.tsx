import { useEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
import { overlayAllowed } from '../../app/firstRun';
import { href } from '../../app/router';
import { useStudioStore, type TransportController } from '../../state/studioStore';
import { measureThisComputer } from '../../studio/measure';
import { FALLBACK_QUALITY } from '../../studio/quality';
import { StudioRuntime, type PictureProblem } from '../../studio/runtime';
import { CloseIcon } from '../../ui/icons';
import styles from './Studio.module.css';

/** Hide the pointer after this long without movement in presentation mode. */
const CURSOR_IDLE_MS = 2000;

function pictureMessage(problem: PictureProblem, materialId: string) {
  switch (problem) {
    case 'no-webgl':
      return (
        <>
          This browser can’t draw the wake here: graphics acceleration may be turned off. The{' '}
          <a href={href('/diagnostics')}>Diagnostics</a> page can tell you more.
        </>
      );
    case 'material-missing':
      return (
        <>
          The visual material “{materialId}” isn’t part of this version of the instrument. Choose
          another visual material.
        </>
      );
    case 'material-failed':
      return (
        <>
          This visual material couldn’t start on this computer. Try another one, or reload the page.
        </>
      );
    case 'context-lost':
      return <>The graphics card was reset. The wake will come back in a moment.</>;
  }
}

/**
 * The wake. The canvas (made by the preview runtime) keeps the composition's render aspect,
 * letterboxed in true black. On the very first Studio visit the stage first measures this
 * computer for "Automatic" preview quality.
 */
export function StudioStage({ ref }: { ref?: Ref<HTMLDivElement> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<StudioRuntime | null>(null);
  const session = useStudioStore((s) => s.session);
  const quality = useStudioStore((s) => s.quality);
  const composition = useStudioStore((s) => s.composition);
  const picture = useStudioStore((s) => s.picture);
  const presentation = useStudioStore((s) => s.presentation);
  const [cursorHidden, setCursorHidden] = useState(false);
  const measuring = quality === null;

  // First visit: measure this computer, then remember the tier (SPEC 14.2).
  useEffect(() => {
    if (!measuring) return;
    const host = hostRef.current;
    const c = useStudioStore.getState().composition;
    if (!host || !c) return;
    const abort = new AbortController();
    measureThisComputer(host, c.render.width / c.render.height, abort.signal)
      .then((tier) => {
        if (!abort.signal.aborted) useStudioStore.getState().setQuality(tier);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        console.warn('Measuring this computer failed; using Standard for now.', error);
        useStudioStore.getState().setQuality(FALLBACK_QUALITY);
      });
    return () => abort.abort();
  }, [measuring, session]);

  // One preview runtime per open composition (StrictMode-safe: disposed on unmount).
  useEffect(() => {
    if (measuring) return;
    const host = hostRef.current;
    const state = useStudioStore.getState();
    if (!host || !state.signature || !state.composition || !state.quality) return;
    const runtime = new StudioRuntime({
      host,
      signature: state.signature,
      composition: state.composition,
      quality: state.quality,
      loop: state.loop,
      events: state.runtimeEvents,
    });
    runtimeRef.current = runtime;
    const controller: TransportController = {
      play: () => runtime.play(),
      pause: () => runtime.pause(),
      togglePlay: () => runtime.togglePlay(),
      seek: (t) => runtime.seek(t),
      scrub: (t, phase) => runtime.scrub(t, phase),
      setLoop: (loop) => runtime.setLoop(loop),
      renderStill: (options) => runtime.renderStill(options),
    };
    state.attachController(controller);
    return () => {
      useStudioStore.getState().detachController(controller);
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [measuring, session]);

  useEffect(() => {
    if (quality) runtimeRef.current?.setQuality(quality);
  }, [quality]);

  // The very first visit, once this computer has been measured: a tip to press Play (the
  // stage is dark until then). Like the introduction, it stays out of automated browsers
  // unless asked for with `?studiotip=1`.
  useEffect(() => {
    if (measuring || !overlayAllowed('studiotip')) return;
    void useStudioStore.getState().showFirstVisitTip();
  }, [measuring, session]);

  useEffect(() => {
    if (composition) runtimeRef.current?.setComposition(composition);
  }, [composition]);

  // Presentation mode: the pointer (and, on touch screens, the Close button) fades away
  // when it rests; a touch brings the button back.
  useEffect(() => {
    if (!presentation) {
      setCursorHidden(false);
      return;
    }
    let timer = window.setTimeout(() => setCursorHidden(true), CURSOR_IDLE_MS);
    const onMove = () => {
      setCursorHidden(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setCursorHidden(true), CURSOR_IDLE_MS);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onMove);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
    };
  }, [presentation]);

  const store = useStudioStore.getState;
  const classes = [styles.stage, cursorHidden ? styles.cursorHidden : ''].filter(Boolean).join(' ');
  // On phones the stage takes the composition's shape (Studio.module.css).
  const aspect = composition
    ? ({
        '--stage-aspect': `${composition.render.width} / ${composition.render.height}`,
      } as CSSProperties)
    : undefined;
  return (
    <div ref={ref} className={classes} style={aspect}>
      <div ref={hostRef} className={styles.canvasHost} />
      {presentation ? (
        <button
          type="button"
          className={styles.leave}
          onClick={() => store().setPresentation(false)}
        >
          <CloseIcon />
          Close
        </button>
      ) : (
        <>
          {measuring ? (
            <p className={styles.measuring} role="status">
              Getting to know this computer…
            </p>
          ) : null}
          {picture && composition ? (
            <p className={styles.pictureProblem} role="status">
              {pictureMessage(picture, composition.visual.materialId)}
            </p>
          ) : null}
          {composition?.mute.visual ? <p className={styles.mutedLabel}>Visual muted</p> : null}
        </>
      )}
    </div>
  );
}
