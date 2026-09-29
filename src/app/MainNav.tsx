import { useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import { MenuIcon } from '../ui/icons';
import styles from './MainNav.module.css';
import { href } from './router';

export interface NavItem {
  path: string;
  label: string;
}

/**
 * At this width and narrower the links fold into a Menu button. Keep it in step with
 * MainNav.module.css (CSS can't read it from here).
 */
export const COMPACT_NAV_QUERY = '(max-width: 720px)';

/**
 * The app's main navigation. Wide windows show the links in a row; narrow ones (phones) show
 * a Menu button that opens them as a list under the header: a disclosure, so Tab moves from
 * the button into the links. Esc closes it (focus goes back to the button), and so do a tap
 * elsewhere, Tab leaving it, and arriving on any screen.
 */
export function MainNav({ items, current }: { items: readonly NavItem[]; current: string }) {
  const listId = useId();
  const navRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Where the menu was opened: arriving anywhere else closes it, with nothing to reset.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === current;

  useEffect(() => {
    if (!open) return;
    const close = () => setOpenAt(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (navRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!navRef.current?.contains(event.target as Node)) close();
    };
    const compact = window.matchMedia(COMPACT_NAV_QUERY);
    const onResize = () => {
      if (!compact.matches) close();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    compact.addEventListener('change', onResize);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      compact.removeEventListener('change', onResize);
    };
  }, [open]);

  const onBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (open && next instanceof Node && !event.currentTarget.contains(next)) setOpenAt(null);
  };

  return (
    <nav ref={navRef} className={styles.nav} aria-label="Main" onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.menuButton}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpenAt(open ? null : current)}
      >
        <MenuIcon />
        Menu
      </button>
      <ul id={listId} className={styles.list} data-open={open ? '' : undefined}>
        {items.map((item) => (
          <li key={item.path} className={styles.item}>
            <a
              href={href(item.path)}
              aria-current={current === item.path ? 'page' : undefined}
              onClick={() => setOpenAt(null)}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
