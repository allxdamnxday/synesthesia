import { registerSW } from 'virtual:pwa-register';

/**
 * Register the service worker that keeps the instrument working offline after the first
 * visit (SPEC C5). Production builds only; a new version activates on the next visit.
 */
export function registerOffline(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  registerSW({ immediate: true });
}
