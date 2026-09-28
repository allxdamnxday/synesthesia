import { describe, expect, it } from 'vitest';
import { UndoHistory } from '../../src/engine/history';
import { recordEdit } from '../../src/studio/undo';

interface State {
  v: number;
}

function drag(history: UndoHistory<State>, key: string, values: number[]): void {
  values.forEach((v, i) => {
    const phase = i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'change';
    recordEdit(history, { v }, { key, phase });
  });
}

describe('recording Studio edits for undo', () => {
  it('one slider drag is one step', () => {
    const h = new UndoHistory<State>({ v: 0 });
    drag(h, 'both:viscosity', [0.2, 0.3, 0.4, 0.5]);
    expect(h.present.v).toBe(0.5);
    expect(h.undo().v).toBe(0);
    expect(h.canUndo).toBe(false);
    expect(h.redo().v).toBe(0.5);
  });

  it('two drags of the same slider are two steps', () => {
    const h = new UndoHistory<State>({ v: 0 });
    drag(h, 'both:viscosity', [0.2, 0.4]);
    drag(h, 'both:viscosity', [0.6, 0.8]);
    expect(h.undo().v).toBe(0.4);
    expect(h.undo().v).toBe(0);
  });

  it('keyboard nudges (end only) and plain edits are a step each', () => {
    const h = new UndoHistory<State>({ v: 0 });
    recordEdit(h, { v: 0.01 }, { key: 'both:viscosity', phase: 'end' });
    recordEdit(h, { v: 0.02 }, { key: 'both:viscosity', phase: 'end' });
    recordEdit(h, { v: 9 });
    expect(h.undo().v).toBe(0.02);
    expect(h.undo().v).toBe(0.01);
    expect(h.undo().v).toBe(0);
  });

  it('an edit that changes nothing records nothing, but still ends the gesture', () => {
    const h = new UndoHistory<State>({ v: 0 });
    const same = h.present;
    expect(recordEdit(h, same, { key: 'k', phase: 'start' })).toBe(false);
    expect(h.canUndo).toBe(false);
    recordEdit(h, { v: 1 }, { key: 'k', phase: 'change' });
    recordEdit(h, h.present, { key: 'k', phase: 'end' });
    recordEdit(h, { v: 2 }, { key: 'k', phase: 'start' });
    expect(h.undo().v).toBe(1);
    expect(h.undo().v).toBe(0);
  });

  it('a plain edit in the middle of a drag closes the drag', () => {
    const h = new UndoHistory<State>({ v: 0 });
    recordEdit(h, { v: 0.3 }, { key: 'k', phase: 'start' });
    recordEdit(h, { v: 5 });
    recordEdit(h, { v: 0.4 }, { key: 'k', phase: 'change' });
    expect(h.undo().v).toBe(5);
    expect(h.undo().v).toBe(0.3);
  });
});
