import { useState, type ReactNode } from 'react';
import { navigate } from '../../app/router';
import { useStudioStore, type StudioNoticeAction } from '../../state/studioStore';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { Notice } from '../../ui/Notice';
import styles from './Studio.module.css';

/**
 * The Studio's notices: restored work (with Discard changes), a changed material, a failed
 * save, the first-visit tip, and after a new composition's first save, where to go next
 * (Render MP4, New album). On wide screens they float over the top of the wake; on phones
 * they sit between the header and the wake, so they never hide it (Studio.module.css).
 */
export function StudioNotices() {
  const notices = useStudioStore((s) => s.notices);
  const isNew = useStudioStore((s) => s.isNew);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const store = useStudioStore.getState;

  /** A notice's buttons besides Dismiss (see StudioNoticeAction). */
  const actions = (action: StudioNoticeAction | undefined): ReactNode => {
    if (action === 'discard') {
      return (
        <button
          type="button"
          className={styles.noticeAction}
          onClick={() => setConfirmDiscard(true)}
        >
          Discard changes
        </button>
      );
    }
    if (action === 'next') {
      const signatureId = store().signature?.id;
      return (
        <>
          <button
            type="button"
            className={styles.noticeAction}
            onClick={() => store().setRenderOpen(true)}
          >
            Render MP4
          </button>
          {signatureId ? (
            <button
              type="button"
              className={styles.noticeAction}
              onClick={() => navigate(`/album/new/${encodeURIComponent(signatureId)}`)}
            >
              New album
            </button>
          ) : null}
        </>
      );
    }
    return undefined;
  };

  return (
    <>
      <div className={styles.notices} role="status" aria-live="polite">
        {notices.map((n) => (
          <Notice
            key={n.id}
            tone={n.tone}
            onDismiss={() => store().dismissNotice(n.id)}
            actions={actions(n.action)}
          >
            {n.text}
          </Notice>
        ))}
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard the unsaved changes?"
        confirmLabel="Discard changes"
        cancelLabel="Keep them"
        tone="danger"
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          void store().discardChanges();
        }}
      >
        <p>
          {isNew
            ? 'The composition starts again from its materials’ baselines.'
            : 'The composition goes back to how it was last saved.'}{' '}
          This can’t be undone.
        </p>
      </ConfirmDialog>
    </>
  );
}
