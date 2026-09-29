/**
 * First-run overlays and hints (the dedication, the introduction, the Studio's first-visit
 * tip) stay out of automated browsers, so end-to-end tests aren't disturbed by them. A test
 * can still force one with a URL flag, e.g. `?dedication=1`, `?introduction=1` or
 * `?studiotip=1`.
 */
export function overlayAllowed(flag: 'dedication' | 'introduction' | 'studiotip'): boolean {
  const forced = new URLSearchParams(window.location.search).get(flag) === '1';
  return forced || !navigator.webdriver;
}
