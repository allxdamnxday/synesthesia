import { useEffect, useRef } from 'react';

/** Handlers by key: `event.key` for named keys ('ArrowLeft'), lower case for characters (' ', 'l', ','). */
export type ShortcutMap = Partial<Record<string, (event: KeyboardEvent) => void>>;

const OWN_KEYS_ROLES = new Set([
  'button',
  'radio',
  'switch',
  'checkbox',
  'menuitem',
  'tab',
  'textbox',
]);

/**
 * True when the focused element uses plain key presses itself (text fields, buttons,
 * choices), so a screen-wide shortcut must leave the key alone.
 */
export function ownsKeys(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY', 'A'].includes(tag)) return true;
  return OWN_KEYS_ROLES.has(target.getAttribute('role') ?? '');
}

/**
 * Screen-wide single-key shortcuts (SPEC 13.4 style: Space, L…). Ignored while typing, when
 * the focused control uses the key, with Ctrl/Cmd/Alt held, or while a dialog is open.
 */
export function useKeyShortcuts(map: ShortcutMap, enabled = true): void {
  const latest = useRef(map);
  useEffect(() => {
    latest.current = map;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (ownsKeys(event.target)) return;
      if (document.querySelector('dialog[open]')) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const handler = latest.current[key];
      if (!handler) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
