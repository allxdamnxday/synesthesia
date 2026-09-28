/**
 * Recording Studio edits in the undo history (SPEC 6.3, 13.1). One slider drag is one
 * step: its changes share a key, and the step closes when the drag ends. Anything without
 * a gesture (a material switch, a seed, a chance draw) is a step of its own. An edit that
 * changes nothing (the same object back from src/studio/edits.ts) records nothing.
 */
import type { UndoHistory } from '../engine/history';

export type GesturePhase = 'start' | 'change' | 'end';

export interface Gesture {
  /** One key per control, e.g. `both:viscosity` or `timeline:speed`. */
  key: string;
  phase: GesturePhase;
}

/** Record `next` in the history; returns whether anything changed. */
export function recordEdit<T>(history: UndoHistory<T>, next: T, gesture?: Gesture): boolean {
  if (next === history.present) {
    if (gesture?.phase === 'end') history.endGesture();
    return false;
  }
  if (gesture) {
    history.push(next, gesture.key);
    if (gesture.phase === 'end') history.endGesture();
  } else {
    history.endGesture();
    history.push(next);
  }
  return true;
}
