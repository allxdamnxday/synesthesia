import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import styles from './ActionMenu.module.css';
import { IconButton } from './IconButton';
import { MoreIcon } from './icons';

export interface ActionMenuItem {
  label: string;
  onSelect: () => void;
  /** 'danger' for destructive actions such as Delete. */
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

export interface ActionMenuProps {
  /** Accessible name of the button, e.g. "More actions for Wink 01". */
  label: string;
  items: readonly ActionMenuItem[];
  className?: string;
}

const supportsAnchors =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('anchor-name', '--a');

/**
 * A "more actions" button with a small menu. Built on the Popover API, so the browser
 * handles closing on Esc or a click elsewhere and returns focus to the button. CSS anchor
 * positioning keeps the menu beside its button and flips it above when there's no room
 * below. Arrow keys, Home and End move between items; Tab closes the menu.
 */
export function ActionMenu({ label, items, className }: ActionMenuProps) {
  const menuId = useId();
  const anchorName = `--action-menu-${menuId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const menu = menuRef.current;
    const button = buttonRef.current;
    if (!menu || !button) return;
    if (supportsAnchors) {
      button.style.setProperty('anchor-name', anchorName);
      menu.style.setProperty('position-anchor', anchorName);
    }
    const close = () => menu.hidePopover();
    // Without anchor positioning, place the menu by hand (below, or above if no room).
    const place = () => {
      const r = button.getBoundingClientRect();
      menu.style.top = `${Math.round(r.bottom + 4)}px`;
      menu.style.left = '';
      menu.style.right = `${Math.round(document.documentElement.clientWidth - r.right)}px`;
    };
    const onBeforeToggle = (event: Event) => {
      if (!supportsAnchors && (event as ToggleEvent).newState === 'open') place();
    };
    const onToggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      if (isOpen) {
        if (!supportsAnchors) {
          const rect = menu.getBoundingClientRect();
          if (rect.bottom > window.innerHeight - 8) {
            const top = button.getBoundingClientRect().top - 4 - rect.height;
            menu.style.top = `${Math.max(8, Math.round(top))}px`;
          }
          // Near the left edge (a phone): line up with the button's left side instead.
          if (rect.left < 8) {
            menu.style.right = 'auto';
            menu.style.left = `${Math.max(8, Math.round(button.getBoundingClientRect().left))}px`;
          }
          window.addEventListener('scroll', close, { capture: true, once: true, passive: true });
        }
        menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
      } else {
        window.removeEventListener('scroll', close, { capture: true });
      }
    };
    menu.addEventListener('beforetoggle', onBeforeToggle);
    menu.addEventListener('toggle', onToggle);
    return () => {
      menu.removeEventListener('beforetoggle', onBeforeToggle);
      menu.removeEventListener('toggle', onToggle);
      window.removeEventListener('scroll', close, { capture: true });
    };
  }, [anchorName]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;
    const enabled = Array.from(
      menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    );
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown') next = enabled[(index + 1) % enabled.length];
    else if (event.key === 'ArrowUp') next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    else if (event.key === 'Tab') menu.hidePopover();
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  const select = (item: ActionMenuItem) => {
    menuRef.current?.hidePopover();
    item.onSelect();
  };

  return (
    <>
      <IconButton
        ref={buttonRef}
        label={label}
        className={className}
        popoverTarget={menuId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
      >
        <MoreIcon />
      </IconButton>
      <div
        ref={menuRef}
        id={menuId}
        popover="auto"
        role="menu"
        aria-label={label}
        className={styles.menu}
        onKeyDown={onKeyDown}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={item.disabled}
            className={item.tone === 'danger' ? `${styles.item} ${styles.danger}` : styles.item}
            onClick={() => select(item)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
