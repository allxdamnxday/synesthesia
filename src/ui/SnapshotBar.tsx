import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';
import styles from './SnapshotBar.module.css';

export const SLOTS = ['A', 'B', 'C', 'D'] as const;
export type Slot = (typeof SLOTS)[number];

/** Touch screens: holding a full slot this long (ms) stores over it, like Shift-click. */
const HOLD_MS = 550;
/** A finger that moves further than this (px) is not holding still. */
const HOLD_SLOP_PX = 10;

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
 * full slot to recall it (playback never restarts); Shift-click to store over it. On a
 * touch screen, press and hold a full slot to store over it.
 * Keyboard: 1–4 recall, Shift+1–4 store (handled by the Studio).
 */
export function SnapshotBar({ stored, active, onRecall, onStore }: SnapshotBarProps) {
  const hold = useRef<{ slot: Slot; x: number; y: number; timer: number } | null>(null);
  /** A hold just stored over this slot: the click that follows isn't a recall. */
  const held = useRef<Slot | null>(null);

  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  useEffect(() => cancelHold, []);

  const onPointerDown = (slot: Slot, e: PointerEvent<HTMLButtonElement>) => {
    held.current = null;
    cancelHold();
    if (e.pointerType === 'mouse' || !stored[slot]) return;
    const timer = window.setTimeout(() => {
      hold.current = null;
      held.current = slot;
      onStore(slot);
    }, HOLD_MS);
    hold.current = { slot, x: e.clientX, y: e.clientY, timer };
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const h = hold.current;
    if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP_PX) cancelHold();
  };

  const onClick = (slot: Slot, e: MouseEvent<HTMLButtonElement>) => {
    cancelHold();
    if (held.current === slot) {
      held.current = null;
      return;
    }
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
            onPointerDown={(e) => onPointerDown(slot, e)}
            onPointerMove={onPointerMove}
            onPointerUp={cancelHold}
            onPointerCancel={cancelHold}
            onContextMenu={(e) => {
              // A long press on a touch screen replaces the slot, not a context menu.
              if (hold.current || held.current) e.preventDefault();
            }}
            aria-pressed={isActive}
            aria-label={
              full
                ? `Snapshot ${slot}: recall (Shift-click, or press and hold, to replace)`
                : `Store snapshot ${slot}`
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
