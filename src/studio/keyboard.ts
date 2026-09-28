/**
 * Studio keyboard shortcuts (SPEC 13.4), as a pure mapping from a key press to a command.
 *
 * - Letters and digits only work without Cmd/Ctrl/Alt, so the browser's own shortcuts
 *   (copy, find, reload, the address bar) keep working. Cmd/Ctrl+S also saves.
 * - Digits use the physical key (`code`), so Shift+1 stores snapshot A on any layout.
 * - Nothing fires while typing in a text field; there the field keeps every key, including
 *   Cmd/Ctrl+Z for its own text.
 * - Space plays and pauses, except on controls where Space already means something
 *   (switches, checkboxes, choices, menus): there it keeps its usual meaning.
 */
import { SNAPSHOT_SLOTS, type SnapshotSlot } from '../engine/snapshots';

export type StudioCommand =
  | { type: 'play-pause' }
  | { type: 'loop' }
  | { type: 'recall'; slot: SnapshotSlot }
  | { type: 'store'; slot: SnapshotSlot }
  | { type: 'chance' }
  | { type: 'save' }
  | { type: 'render' }
  | { type: 'presentation' }
  | { type: 'exit-presentation' }
  | { type: 'undo' }
  | { type: 'redo' };

export interface KeyPress {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
}

export interface KeyContext {
  /** Focus is in a text field (input, textarea, contenteditable). */
  typing: boolean;
  /** Focus is on a control that uses Space itself (switch, checkbox, radio, option, menu). */
  spaceControl: boolean;
  presentation: boolean;
}

const DIGIT_SLOTS: Readonly<Record<string, SnapshotSlot>> = {
  Digit1: SNAPSHOT_SLOTS[0],
  Digit2: SNAPSHOT_SLOTS[1],
  Digit3: SNAPSHOT_SLOTS[2],
  Digit4: SNAPSHOT_SLOTS[3],
};

export function commandForKey(e: KeyPress, ctx: KeyContext): StudioCommand | null {
  if (ctx.typing) return null;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (mod && !e.altKey) {
    if (key === 'z') return e.shiftKey ? { type: 'redo' } : { type: 'undo' };
    if (key === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey) return { type: 'redo' };
    if (key === 's' && !e.shiftKey && !e.repeat) return { type: 'save' };
    return null;
  }
  if (mod || e.altKey) return null;

  if (key === 'Escape') return ctx.presentation ? { type: 'exit-presentation' } : null;
  if (e.repeat) return null;

  const slot = DIGIT_SLOTS[e.code];
  if (slot) return e.shiftKey ? { type: 'store', slot } : { type: 'recall', slot };

  if (e.shiftKey) return null;
  switch (key) {
    case ' ':
      return ctx.spaceControl ? null : { type: 'play-pause' };
    case 'l':
      return { type: 'loop' };
    case 'c':
      return { type: 'chance' };
    case 's':
      return { type: 'save' };
    case 'r':
      return { type: 'render' };
    case 'f':
      return { type: 'presentation' };
    default:
      return null;
  }
}

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
]);

const SPACE_ROLES = new Set([
  'switch',
  'checkbox',
  'radio',
  'option',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'listbox',
  'combobox',
]);

/** Is this element a place where a person types text? */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/** Does this element use Space itself (so Space shouldn't play or pause)? */
export function usesSpace(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLInputElement) return el.type === 'checkbox' || el.type === 'radio';
  if (el instanceof HTMLSelectElement || el.tagName === 'SUMMARY') return true;
  const role = el.getAttribute('role');
  return role !== null && SPACE_ROLES.has(role);
}
