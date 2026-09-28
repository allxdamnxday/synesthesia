import { useEffect, useState } from 'react';
import { getSetting } from '../library';
import styles from './DedicationSplash.module.css';
import { overlayAllowed } from './firstRun';

/** Shown once per browser session, so reloading while working doesn't repeat it. */
const SESSION_KEY = 'sp-dedication-shown';
const HOLD_MS = 2600;

function alreadyShownThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function markShown(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // Private windows may refuse storage; the splash then shows again next time, harmlessly.
  }
}

/**
 * The dedication (SPEC 6.5, M8): a quiet moment when the instrument opens. It can be turned
 * off in Settings. Any key or click dismisses it; with reduced motion it doesn't fade.
 * The words live here so they're easy to change.
 */
export function DedicationSplash() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!overlayAllowed('dedication') || alreadyShownThisSession()) return;
    let cancelled = false;
    void getSetting('dedicationSplash').then((enabled) => {
      if (cancelled || !enabled) return;
      markShown();
      setVisible(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!leaving) return;
    // Don't rely on transitionend: with reduced motion there is no transition.
    const timer = window.setTimeout(() => setVisible(false), 750);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  useEffect(() => {
    if (!visible) return;
    const dismiss = () => setLeaving(true);
    const timer = window.setTimeout(dismiss, HOLD_MS);
    window.addEventListener('keydown', dismiss);
    window.addEventListener('pointerdown', dismiss);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', dismiss);
      window.removeEventListener('pointerdown', dismiss);
    };
  }, [visible]);

  if (!visible) return null;
  return (
    <div
      className={`${styles.splash} ${leaving ? styles.leaving : ''}`}
      role="presentation"
      data-testid="dedication"
    >
      <div className={styles.rings} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className={styles.title}>Synesthesia</p>
      <p className={styles.dedication}>Made for Freeman</p>
    </div>
  );
}
