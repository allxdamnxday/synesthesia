import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  blockingFailures,
  collectEnvironment,
  isChromiumBrowser,
  runStartupChecks,
  type CapabilityCheck,
  type CheckId,
  type EnvironmentInfo,
} from '../render/capabilities';
import { buildReport } from '../screens/Diagnostics/buildReport';
import { Button } from '../ui/Button';
import { CopyFallback } from '../ui/CopyFallback';
import { useCopyText } from '../ui/useCopyText';
import { href, useHashPath } from './router';
import styles from './StartupGate.module.css';

let startupRun: Promise<CapabilityCheck[]> | null = null;

/**
 * The startup checks run once per page load (React's StrictMode mounts twice in
 * development). If the run itself throws, nothing blocks: a bug in a check must never
 * lock Freeman out of Chrome.
 */
function startupChecksOnce(): Promise<CapabilityCheck[]> {
  startupRun ??= runStartupChecks().catch((): CapabilityCheck[] => []);
  return startupRun;
}

const PLAIN_NAMES: Partial<Record<CheckId, string>> = {
  webgl2: 'Graphics acceleration (WebGL2), which draws the wakes.',
  'float-targets': 'High-precision graphics (half-float textures), which the fluid materials need.',
  'audio-worklet':
    'Sound processing (Web Audio with AudioWorklet), which plays the sound materials.',
};

const NOTICE_KEY = 'sp.browserNotice.dismissed';

function noticeDismissed(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberNoticeDismissed(): void {
  try {
    localStorage.setItem(NOTICE_KEY, '1');
  } catch {
    // Private mode or storage disabled: the notice just comes back next time.
  }
}

function BrowserNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className={styles.notice} role="note">
      <p>Synesthesia is made for Google Chrome. Some parts may not work in this browser.</p>
      <Button variant="quiet" onClick={onDismiss} aria-label="Dismiss the browser notice">
        Dismiss
      </Button>
    </div>
  );
}

function BlockedScreen({
  checks,
  failures,
}: {
  checks: CapabilityCheck[];
  failures: CapabilityCheck[];
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null);
  const copy = useCopyText();
  const secure = typeof isSecureContext === 'boolean' ? isSecureContext : true;
  const chromium = isChromiumBrowser();
  // Without WebGL2 the half-float check fails too; list only the root cause.
  const noWebGL2 = failures.some((check) => check.id === 'webgl2');
  const causes = failures.filter((check) => !(noWebGL2 && check.id === 'float-targets'));

  useEffect(() => {
    heading.current?.focus();
    let active = true;
    void collectEnvironment()
      .then((env) => {
        if (active) setEnvironment(env);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className={styles.blocked}>
      <div className={styles.panel}>
        <p className={styles.wordmark}>Synesthesia</p>
        <h1 ref={heading} tabIndex={-1}>
          Synesthesia can&apos;t start here yet
        </h1>
        <p>It needs a few things from the browser that aren&apos;t working right now:</p>
        <ul className={styles.missing}>
          {causes.map((check) => (
            <li key={check.id}>{PLAIN_NAMES[check.id] ?? check.summary}</li>
          ))}
        </ul>

        <h2>What you can do</h2>
        <ol className={styles.steps}>
          {!chromium ? (
            <li>Open Synesthesia in Google Chrome. It&apos;s made for Chrome.</li>
          ) : null}
          {!secure ? (
            <li>Open Synesthesia from its usual web address, the one that starts with https://.</li>
          ) : null}
          <li>
            Update Google Chrome: open the Chrome menu, choose Help, then About Google Chrome, and
            restart Chrome when it asks.
          </li>
          <li>
            Turn on graphics acceleration: in Chrome, open Settings, then System, turn on &ldquo;Use
            graphics acceleration when available&rdquo;, and restart Chrome.
          </li>
          <li>Try another computer.</li>
        </ol>
        <p>If it still doesn&apos;t start, copy the report and send it to Braden.</p>

        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={() => void copy.copy(buildReport(checks, environment))}
          >
            Copy report
          </Button>
          <a className={styles.linkButton} href={href('/diagnostics')}>
            See diagnostics
          </a>
          <p className={styles.copyStatus} role="status">
            {copy.status === 'copied' ? 'Report copied.' : ''}
          </p>
        </div>
        {copy.status === 'fallback' ? (
          <CopyFallback text={copy.text} label="Diagnostics report" />
        ) : null}
      </div>
    </main>
  );
}

/**
 * Runs the required capability checks at startup (SPEC 14.1) after the app's first paint.
 * If a required capability is definitely missing, it replaces the app with a calm
 * explanation (Diagnostics stays reachable). A check that throws is never a reason to
 * block. Outside Chromium browsers it shows a dismissible notice.
 */
export function StartupGate({ children }: { children: ReactNode }) {
  const [checks, setChecks] = useState<CapabilityCheck[] | null>(null);
  const [showNotice, setShowNotice] = useState(() => !isChromiumBrowser() && !noticeDismissed());
  const path = useHashPath();

  useEffect(() => {
    let active = true;
    // Let the app paint first; the checks take a few hundred milliseconds at most.
    const timer = window.setTimeout(() => {
      void startupChecksOnce().then((result) => {
        if (!active) return;
        // Lets tests (and curious humans) see that the startup checks finished.
        document.documentElement.dataset.spStartup =
          blockingFailures(result).length > 0 ? 'blocked' : 'ok';
        setChecks(result);
      });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const failures = checks ? blockingFailures(checks) : [];
  if (checks && failures.length > 0 && path !== '/diagnostics') {
    return <BlockedScreen checks={checks} failures={failures} />;
  }
  return (
    <>
      {showNotice ? (
        <BrowserNotice
          onDismiss={() => {
            rememberNoticeDismissed();
            setShowNotice(false);
          }}
        />
      ) : null}
      {children}
    </>
  );
}
