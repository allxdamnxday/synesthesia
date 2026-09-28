import { useSyncExternalStore } from 'react';

/**
 * A tiny hash router. Hash URLs (`#/studio/abc`) work on any static host without
 * server rewrites, and there is no router dependency. See docs/DECISIONS.md.
 */

function readPath(): string {
  const raw = window.location.hash.replace(/^#/, '');
  if (raw === '') return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The current hash path, e.g. `/studio/abc`. Re-renders on change. */
export function useHashPath(): string {
  return useSyncExternalStore(subscribe, readPath, () => '/');
}

/** Go to a path. `replace` swaps the current history entry instead of adding one. */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const hash = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (options.replace) {
    window.history.replaceState(window.history.state, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = hash;
  }
}

/** Build an href for an anchor element. */
export function href(path: string): string {
  return `#${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Match a path against a pattern such as `/studio/:compositionId`.
 * Returns the decoded params, or null when it doesn't match.
 */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const [pathOnly = '/'] = path.split('?');
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathOnly.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i];
    const actual = pathParts[i];
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}
