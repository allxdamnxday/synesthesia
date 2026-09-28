import type { MouseEvent } from 'react';
import styles from './SnapshotBar.module.css';

export const SLOTS = ['A', 'B', 'C', 'D'] as const;
export type Slot = (typeof SLOTS)[number];

export interface SnapshotBarProps {
  /** Which slots hold a snapshot. */
  stored: Partial<Record<Slot, boolean>>;
  /** The slot the current state came from, if any. */
  active: Slot | null;
  onRecall: (slot: Slot) => void;
  onStore: (slot: Slot) => void;
}

/**
 * Snapshots A–D (SPEC 6.3). Click an empty slot to store the current state there; click a
 * full slot to recall it (playback never restarts); Shift-click to store over it.
 * Keyboard: 1–4 recall, Shift+1–4 store (handled by the Studio).
 */
export function SnapshotBar({ stored, active, onRecall, onStore }: SnapshotBarProps) {
  const onClick = (slot: Slot, e: MouseEvent<HTMLButtonElement>) => {
    if (e.shiftKey || !stored[slot]) onStore(slot);
    else onRecall(slot);
  };
  return (
    <div className={styles.bar} role="group" aria-label="Snapshots">
      {SLOTS.map((slot, i) => {
        const full = stored[slot] === true;
        const isActive = active === slot;
        const classes = [styles.slot, full ? styles.full : '', isActive ? styles.active : '']
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={slot}
            type="button"
            className={classes}
            onClick={(e) => onClick(slot, e)}
            aria-pressed={isActive}
            aria-label={
              full ? `Snapshot ${slot}: recall (Shift-click to replace)` : `Store snapshot ${slot}`
            }
            title={
              full
                ? `Recall ${slot} (${i + 1}). Shift-click or Shift+${i + 1} to replace.`
                : `Store the current state in ${slot} (Shift+${i + 1})`
            }
          >
            {slot}
          </button>
        );
      })}
    </div>
  );
}
