import { useEffect, useRef, type ReactNode } from 'react';
import { ActionMenu, type ActionMenuItem } from '../../ui/ActionMenu';
import { Button } from '../../ui/Button';
import { InlineRename } from '../../ui/InlineRename';
import styles from './LibraryCard.module.css';

export interface LibraryCardProps {
  name: string;
  /** Data URL of the wake (signature sketch or composition still); none shows a placeholder. */
  thumbnail?: string;
  /** Short plain lines under the name. */
  details: ReactNode[];
  /** A gentle warning shown under the details (e.g. a missing signature). */
  warning?: string;
  renaming: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onRenameEnd: () => void;
  menu: readonly ActionMenuItem[];
}

/** A quiet placeholder wake: a single faint curve. */
function PlaceholderWake() {
  return (
    <svg className={styles.placeholder} viewBox="0 0 240 135" aria-hidden="true" focusable="false">
      <path
        d="M20 84 C 70 40, 110 110, 150 64 S 210 56, 222 70"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** One signature or composition in a Library list: the wake first, the chrome quiet. */
export function LibraryCard({
  name,
  thumbnail,
  details,
  warning,
  renaming,
  onOpen,
  onRename,
  onRenameEnd,
  menu,
}: LibraryCardProps) {
  const actionsRef = useRef<HTMLDivElement>(null);
  const wasRenaming = useRef(renaming);

  // When renaming ends, the name field disappears. If that left focus nowhere, put it back
  // on this card (its Open button) rather than at the top of the page.
  useEffect(() => {
    if (wasRenaming.current && !renaming) {
      const active = document.activeElement;
      if (!active || active === document.body) {
        actionsRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      }
    }
    wasRenaming.current = renaming;
  }, [renaming]);

  return (
    <li className={styles.card}>
      {/* A larger mouse target for Open; keyboard and screen readers use the Open button. */}
      <div className={styles.thumb} onClick={onOpen} aria-hidden="true">
        {thumbnail ? (
          <img src={thumbnail} alt="" draggable={false} className={styles.image} />
        ) : (
          <PlaceholderWake />
        )}
      </div>
      <div className={styles.body}>
        {renaming ? (
          <InlineRename
            value={name}
            label={`New name for ${name}`}
            onCommit={(next) => {
              onRename(next);
              onRenameEnd();
            }}
            onCancel={onRenameEnd}
          />
        ) : (
          <h3 className={styles.name} title={name}>
            {name}
          </h3>
        )}
        {details.map((line, i) => (
          <p key={i} className={styles.detail}>
            {line}
          </p>
        ))}
        {warning ? <p className={styles.warning}>{warning}</p> : null}
      </div>
      <div className={styles.actions} ref={actionsRef}>
        <Button variant="quiet" onClick={onOpen} aria-label={`Open ${name}`}>
          Open
        </Button>
        <ActionMenu label={`More actions for ${name}`} items={menu} />
      </div>
    </li>
  );
}
