import type { ReactNode } from 'react';
import { IconButton } from './IconButton';
import { CloseIcon } from './icons';
import styles from './Notice.module.css';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export interface NoticeProps {
  tone?: NoticeTone;
  children: ReactNode;
  /** Buttons offered with the message (e.g. "Import signature…"). */
  actions?: ReactNode;
  onDismiss?: () => void;
}

/**
 * A calm, inline message: what happened and, when there is one, what to do next.
 * Put notices inside a live region (role="status") so they are announced.
 */
export function Notice({ tone = 'info', children, actions, onDismiss }: NoticeProps) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`}>
      <div className={styles.text}>{children}</div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
      {onDismiss ? (
        <IconButton label="Dismiss" className={styles.dismiss} onClick={onDismiss}>
          <CloseIcon />
        </IconButton>
      ) : null}
    </div>
  );
}
