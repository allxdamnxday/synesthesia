import { useEffect, useRef, type ReactNode } from 'react';
import { ActionMenu, type ActionMenuItem } from '../../ui/ActionMenu';
import { Button } from '../../ui/Button';
import { InlineRename } from '../../ui/InlineRename';
import styles from './LibraryCard.module.css';

/** An action shown on the card itself rather than in its menu. */
export interface CardAction {
  label: string;
  /** Names the item too, for screen readers ("Start a composition from Wink"): cards repeat. */
  accessibleLabel?: string;
  onSelect: () => void;
}

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
  /**
   * The ways forward, shown on the card (a signature's Start a composition and New album): the
   * first as a button across the card, the others beside the menu. The picture then opens the
   * item, in place of an Open button.
   */
  actions?: readonly CardAction[];
  /** Everything waits while something else is under way. */
  busy?: boolean;
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

/** One signature, album or composition in a Library list: the wake first, the chrome quiet. */
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
  actions,
  busy = false,
}: LibraryCardProps) {
  const openRef = useRef<HTMLButtonElement>(null);
  const wasRenaming = useRef(renaming);
  const [first, ...rest] = actions ?? [];

  // When renaming ends, the name field disappears. If that left focus nowhere, put it back
  // on this card (its Open control) rather than at the top of the page.
  useEffect(() => {
    if (wasRenaming.current && !renaming) {
      const active = document.activeElement;
      if (!active || active === document.body) openRef.current?.focus();
    }
    wasRenaming.current = renaming;
  }, [renaming]);

  const picture = thumbnail ? (
    <img src={thumbnail} alt="" draggable={false} className={styles.image} />
  ) : (
    <PlaceholderWake />
  );

  return (
    <li className={styles.card}>
      {first ? (
        // The picture is this card's Open control (its actions take the place of Open).
        <button
          ref={openRef}
          type="button"
          className={`${styles.thumb} ${styles.thumbButton}`}
          onClick={onOpen}
          aria-label={`Open ${name}`}
          title={`Open ${name}`}
        >
          {picture}
        </button>
      ) : (
        // A larger mouse target for Open; keyboard and screen readers use the Open button.
        <div className={styles.thumb} onClick={onOpen} aria-hidden="true">
          {picture}
        </div>
      )}
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
      {first ? (
        <div className={styles.ways}>
          <Button
            className={styles.wayMain}
            onClick={first.onSelect}
            disabled={busy}
            aria-label={first.accessibleLabel}
          >
            {first.label}
          </Button>
          <div className={styles.actions}>
            {rest.map((action) => (
              <Button
                key={action.label}
                variant="quiet"
                onClick={action.onSelect}
                disabled={busy}
                aria-label={action.accessibleLabel}
              >
                {action.label}
              </Button>
            ))}
            <ActionMenu label={`More actions for ${name}`} items={menu} className={styles.menu} />
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button ref={openRef} variant="quiet" onClick={onOpen} aria-label={`Open ${name}`}>
            Open
          </Button>
          <ActionMenu label={`More actions for ${name}`} items={menu} />
        </div>
      )}
    </li>
  );
}
