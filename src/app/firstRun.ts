/**
 * First-run overlays (the dedication and the introduction) stay out of automated browsers,
 * so end-to-end tests aren't blocked by them. A test can still force one with a URL flag,
 * e.g. `?dedication=1` or `?introduction=1`.
 */
export function overlayAllowed(flag: 'dedication' | 'introduction'): boolean {
  const forced = new URLSearchParams(window.location.search).get(flag) === '1';
  return forced || !navigator.webdriver;
}
