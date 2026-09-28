import { useEffect, useState } from 'react';
import {
  CHECK_DEFINITIONS,
  GROUP_LABELS,
  environmentRows,
  pendingChecks,
  runAllChecks,
  summarizeChecks,
  type CapabilityCheck,
  type CheckGroup,
  type CheckImportance,
  type EnvironmentInfo,
} from '../../render/capabilities';
import { Button } from '../../ui/Button';
import { CopyFallback } from '../../ui/CopyFallback';
import { StatusBadge, type BadgeStatus } from '../../ui/StatusBadge';
import { useCopyText } from '../../ui/useCopyText';
import { APP_VERSION, buildReport } from './buildReport';
import styles from './DiagnosticsScreen.module.css';

const GROUP_ORDER: CheckGroup[] = [];
for (const definition of CHECK_DEFINITIONS) {
  if (!GROUP_ORDER.includes(definition.group)) GROUP_ORDER.push(definition.group);
}

const IMPORTANCE_TEXT: Record<CheckImportance, string> = {
  required: 'Required',
  preferred: 'Preferred',
  optional: 'Optional',
};

/** Optional checks (folder saving, persistence, space) never change the overall badge. */
function overallStatus(checks: readonly CapabilityCheck[]): BadgeStatus {
  if (checks.some((c) => c.status === 'pending')) return 'pending';
  if (checks.some((c) => c.importance === 'required' && c.status === 'fail')) return 'fail';
  const notOk = (c: CapabilityCheck) => c.status === 'warn' || c.status === 'fail';
  if (checks.some((c) => c.importance !== 'optional' && notOk(c))) return 'warn';
  return 'pass';
}

const OVERALL_LABELS: Record<BadgeStatus, string> = {
  pending: 'Checking',
  pass: 'Ready',
  warn: 'Warning',
  fail: 'Not ready',
};

function CheckRow({ check }: { check: CapabilityCheck }) {
  return (
    <li
      className={styles.row}
      data-check-id={check.id}
      data-status={check.status}
      data-importance={check.importance}
    >
      <div className={styles.rowStatus}>
        <StatusBadge status={check.status} />
      </div>
      <div className={styles.rowBody}>
        <p className={styles.rowTitle}>
          <span className={styles.rowLabel}>{check.label}</span>
          <span className={styles.importance}>{IMPORTANCE_TEXT[check.importance]}</span>
        </p>
        <p className={styles.rowSummary}>{check.summary}</p>
        {check.detail ? (
          <details className={styles.detail}>
            <summary>Technical detail</summary>
            <pre>{check.detail}</pre>
          </details>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Capability checks (SPEC 6.5, 14.1): every check with its status and detail, the
 * environment, and a Copy report button so Freeman can send results to Braden.
 * Engineering terms are fine here.
 */
export function DiagnosticsScreen() {
  const [checks, setChecks] = useState<CapabilityCheck[]>(() => pendingChecks());
  const [environment, setEnvironment] = useState<EnvironmentInfo | null>(null);
  const [running, setRunning] = useState(true);
  const [run, setRun] = useState(0);
  const copy = useCopyText();

  useEffect(() => {
    const controller = new AbortController();
    void runAllChecks((rows) => setChecks(rows), {
      signal: controller.signal,
      onEnvironment: setEnvironment,
    }).then((result) => {
      if (controller.signal.aborted) return;
      setChecks(result.checks);
      if (result.environment) setEnvironment(result.environment);
      setRunning(false);
    });
    return () => controller.abort();
  }, [run]);

  const runAgain = () => {
    copy.reset();
    setChecks(pendingChecks());
    setRunning(true);
    setRun((n) => n + 1);
  };

  const summary = summarizeChecks(checks);
  const status = overallStatus(checks);

  return (
    <section className={styles.page} aria-labelledby="diagnostics-title">
      <h1 id="diagnostics-title">Diagnostics</h1>
      <p className={styles.intro}>
        These checks show whether this computer and browser can run the instrument. If something
        isn&apos;t working, copy the report and send it to Braden.
      </p>

      <div className={styles.actions}>
        <Button variant="primary" onClick={() => void copy.copy(buildReport(checks, environment))}>
          Copy report
        </Button>
        <Button onClick={runAgain} disabled={running}>
          Run again
        </Button>
        <p className={styles.copyStatus} role="status">
          {copy.status === 'copied'
            ? running
              ? 'Report copied (some checks were still running).'
              : 'Report copied.'
            : ''}
        </p>
      </div>
      {copy.status === 'fallback' ? (
        <CopyFallback text={copy.text} label="Diagnostics report" />
      ) : null}

      <div className={styles.summary} aria-live="polite">
        <StatusBadge status={status} label={OVERALL_LABELS[status]} />
        <p>
          <strong>{summary.headline}</strong>{' '}
          <span className={styles.muted}>{summary.countsLine}</span>
        </p>
      </div>

      {GROUP_ORDER.map((group) => (
        <section key={group} className={styles.group} aria-labelledby={`diagnostics-${group}`}>
          <h2 id={`diagnostics-${group}`}>{GROUP_LABELS[group]}</h2>
          <ul className={styles.list}>
            {checks
              .filter((check) => check.group === group)
              .map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
          </ul>
        </section>
      ))}

      <section className={styles.group} aria-labelledby="diagnostics-environment">
        <h2 id="diagnostics-environment">Environment</h2>
        {environment ? (
          <dl className={styles.environment}>
            {environmentRows(environment).map((row) => (
              <div key={row.label} className={styles.environmentRow}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
            <div className={styles.environmentRow}>
              <dt>App version</dt>
              <dd>{APP_VERSION}</dd>
            </div>
          </dl>
        ) : (
          <p className={styles.muted}>Reading the environment…</p>
        )}
      </section>

      <section className={styles.group} aria-labelledby="diagnostics-performance">
        <h2 id="diagnostics-performance">Performance</h2>
        <p className={styles.muted}>
          Benchmark: not yet available. It arrives with the Water material.
        </p>
      </section>
    </section>
  );
}
