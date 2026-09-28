import { useEffect, type ReactNode } from 'react';
import { href } from '../../app/router';
import { flushStudioAutosave, useStudioStore } from '../../state/studioStore';
import { targetKey, type StudioTarget } from '../../studio/working';
import { Button } from '../../ui/Button';
import styles from './Studio.module.css';
import { StudioWorkspace } from './StudioWorkspace';

function targetOf(params: Record<string, string> | undefined): StudioTarget | null {
  if (params?.compositionId) return { kind: 'composition', compositionId: params.compositionId };
  if (params?.signatureId) return { kind: 'new', signatureId: params.signatureId };
  return null;
}

/**
 * Studio (SPEC 6.3): where a signature is applied to a visual and a sound material and
 * played. `#/studio/new/:signatureId` starts a composition from a signature (unsaved until
 * Save); `#/studio/:compositionId` opens a saved one. The source clip never appears here.
 */
export function StudioScreen({ params }: { params?: Record<string, string> }) {
  const target = targetOf(params);
  const key = target ? targetKey(target) : '';
  const status = useStudioStore((s) => s.status);
  const failure = useStudioStore((s) => s.failure);
  const missingSignature = useStudioStore((s) => s.missingSignature);

  useEffect(() => {
    const next = targetOf(params);
    if (next) void useStudioStore.getState().load(next);
    // Reload only when the address names something else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Keep unsaved work when the page hides or closes, and when leaving the Studio.
  useEffect(() => {
    const flush = () => void flushStudioAutosave();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      const store = useStudioStore.getState();
      store.setPresentation(false);
      void store.leave();
    };
  }, []);

  if (!target) {
    return (
      <Message title="Nothing to open">
        <p>
          Open a composition or start one from a signature in the <a href={href('/')}>library</a>.
        </p>
      </Message>
    );
  }

  switch (status) {
    case 'ready':
      return <StudioWorkspace />;
    case 'missing-composition':
      return (
        <Message title="This composition isn’t here">
          <p>
            It isn’t in your library any more. It may have been deleted in another window.{' '}
            <a href={href('/')}>Go to the library</a>.
          </p>
        </Message>
      );
    case 'missing-signature':
      return missingSignature ? (
        <Message title="This composition needs its signature">
          <p>
            It plays the signature “{missingSignature.name}”, which isn’t in your library. Import
            that signature file in the library, then open the composition again.
          </p>
          <p>
            <a href={href('/')}>Go to the library</a>
          </p>
        </Message>
      ) : (
        <Message title="That signature isn’t here">
          <p>
            It isn’t in your library any more. Choose another signature in the{' '}
            <a href={href('/')}>library</a> to start a composition.
          </p>
        </Message>
      );
    case 'failed':
      return (
        <Message title="The Studio couldn’t open">
          <p>{failure}</p>
          <Button onClick={() => void useStudioStore.getState().load(target)}>Try again</Button>
        </Message>
      );
    default:
      return (
        <section className={styles.opening} aria-live="polite">
          <p>Opening the composition…</p>
        </section>
      );
  }
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.message}>
      <h1>{title}</h1>
      {children}
    </section>
  );
}
