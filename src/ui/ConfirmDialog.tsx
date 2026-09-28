import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  /** A question, e.g. "Delete “Wink 01”?" */
  title: string;
  /** What will happen, in plain language. */
  children?: ReactNode;
  /** The action, e.g. "Delete". */
  confirmLabel: string;
  cancelLabel?: string;
  /** 'danger' marks the confirm button as destructive. */
  tone?: 'default' | 'danger';
  /** While true, both buttons are disabled and Esc does nothing. */
  busy?: boolean;
  onConfirm: () => void;
  /** Called for Cancel, Esc, or the browser closing the dialog. */
  onCancel: () => void;
}

/**
 * A modal confirmation on the native <dialog> element: focus is trapped inside while it
 * is open, starts on Cancel (the safe choice), and returns where it was afterwards.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);
  const onCancelRef = useRef(onCancel);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    openRef.current = open;
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={children ? bodyId : undefined}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={() => {
        // Closed by Esc or by the browser rather than by `open` turning false.
        if (openRef.current) onCancelRef.current();
      }}
    >
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      {children ? (
        <div id={bodyId} className={styles.body}>
          {children}
        </div>
      ) : null}
      <div className={styles.buttons}>
        <Button onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone === 'danger' ? 'secondary' : 'primary'}
          className={tone === 'danger' ? styles.danger : undefined}
          onClick={onConfirm}
          disabled={busy}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
