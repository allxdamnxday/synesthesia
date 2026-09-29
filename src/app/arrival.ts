import { useLayoutEffect, useRef } from 'react';

/**
 * Which screen a hash path shows, for deciding when the window starts again at the top.
 * Arriving on another screen does; the same screen at a new address doesn't: the Studio
 * after a new composition's first save or Save as new, and the guide, which brings its own
 * sections into view (`#/guide/studio`).
 */
export function screenKey(path: string): string {
  const [pathOnly = '/'] = path.split('?');
  const parts = pathOnly.split('/').filter(Boolean);
  const [first = '', second = '', third = ''] = parts;
  switch (first) {
    case '':
      return 'library';
    case 'studio':
    case 'guide':
      return first;
    case 'album':
      return second === 'new' ? `album/new/${third}` : `album/${second}`;
    default:
      return `/${parts.join('/')}`;
  }
}

/**
 * Start each newly arrived-at screen at the top of the window. The window keeps its scroll
 * position across hash changes otherwise, so a screen could open halfway down (Guide → Help).
 * A layout effect, so it happens before the new screen is painted and before the screens'
 * own effects (the guide scrolls to a section after this).
 */
export function useScrollToTopOnArrival(path: string): void {
  const key = screenKey(path);
  const previous = useRef(key);
  useLayoutEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [key]);
}
