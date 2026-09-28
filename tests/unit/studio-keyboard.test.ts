import { describe, expect, it } from 'vitest';
import { commandForKey, type KeyContext, type KeyPress } from '../../src/studio/keyboard';

function press(key: string, extra: Partial<KeyPress> = {}): KeyPress {
  const code = /^[0-9]$/.test(key)
    ? `Digit${key}`
    : key.length === 1
      ? `Key${key.toUpperCase()}`
      : key;
  return {
    key,
    code,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    ...extra,
  };
}

const idle: KeyContext = { typing: false, spaceControl: false, presentation: false };

describe('studio keyboard shortcuts', () => {
  it('maps the SPEC 13.4 keys', () => {
    expect(commandForKey(press(' ', { code: 'Space' }), idle)).toEqual({ type: 'play-pause' });
    expect(commandForKey(press('l'), idle)).toEqual({ type: 'loop' });
    expect(commandForKey(press('c'), idle)).toEqual({ type: 'chance' });
    expect(commandForKey(press('s'), idle)).toEqual({ type: 'save' });
    expect(commandForKey(press('r'), idle)).toEqual({ type: 'render' });
    expect(commandForKey(press('f'), idle)).toEqual({ type: 'presentation' });
    expect(commandForKey(press('F', { code: 'KeyF' }), idle)).toEqual({ type: 'presentation' });
  });

  it('recalls with 1–4 and stores with Shift+1–4, whatever the layout prints', () => {
    expect(commandForKey(press('1'), idle)).toEqual({ type: 'recall', slot: 'A' });
    expect(commandForKey(press('4'), idle)).toEqual({ type: 'recall', slot: 'D' });
    expect(commandForKey(press('!', { code: 'Digit1', shiftKey: true }), idle)).toEqual({
      type: 'store',
      slot: 'A',
    });
    expect(commandForKey(press('&', { code: 'Digit1' }), idle)).toEqual({
      type: 'recall',
      slot: 'A',
    });
    expect(commandForKey(press('5'), idle)).toBeNull();
  });

  it('undo and redo with Cmd or Ctrl', () => {
    expect(commandForKey(press('z', { metaKey: true }), idle)).toEqual({ type: 'undo' });
    expect(commandForKey(press('z', { ctrlKey: true }), idle)).toEqual({ type: 'undo' });
    expect(commandForKey(press('Z', { metaKey: true, shiftKey: true }), idle)).toEqual({
      type: 'redo',
    });
    expect(commandForKey(press('y', { ctrlKey: true }), idle)).toEqual({ type: 'redo' });
    expect(commandForKey(press('s', { ctrlKey: true }), idle)).toEqual({ type: 'save' });
  });

  it('leaves the browser’s own shortcuts alone', () => {
    for (const key of ['c', 'f', 'r', 'l', '1']) {
      expect(commandForKey(press(key, { ctrlKey: true }), idle)).toBeNull();
      expect(commandForKey(press(key, { metaKey: true }), idle)).toBeNull();
      expect(commandForKey(press(key, { altKey: true }), idle)).toBeNull();
    }
  });

  it('does nothing while typing', () => {
    const typing = { ...idle, typing: true };
    for (const k of [press(' '), press('s'), press('1'), press('z', { metaKey: true })]) {
      expect(commandForKey(k, typing)).toBeNull();
    }
  });

  it('Space keeps its meaning on switches and choices', () => {
    expect(commandForKey(press(' '), { ...idle, spaceControl: true })).toBeNull();
    expect(commandForKey(press('l'), { ...idle, spaceControl: true })).toEqual({ type: 'loop' });
  });

  it('Esc leaves presentation mode only', () => {
    expect(commandForKey(press('Escape'), idle)).toBeNull();
    expect(commandForKey(press('Escape'), { ...idle, presentation: true })).toEqual({
      type: 'exit-presentation',
    });
  });

  it('ignores held keys (auto-repeat) for toggles', () => {
    expect(commandForKey(press(' ', { repeat: true }), idle)).toBeNull();
    expect(commandForKey(press('f', { repeat: true }), idle)).toBeNull();
    expect(commandForKey(press('z', { metaKey: true, repeat: true }), idle)).toEqual({
      type: 'undo',
    });
  });
});
