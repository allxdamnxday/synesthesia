import styles from './StatusBadge.module.css';

export type BadgeStatus = 'pending' | 'pass' | 'warn' | 'fail';

const TEXT: Record<BadgeStatus, string> = {
  pending: 'Checking',
  pass: 'Pass',
  warn: 'Warning',
  fail: 'Fail',
};

/** Icon shapes differ per status, so the badge never relies on colour alone. */
function Icon({ status }: { status: BadgeStatus }) {
  switch (status) {
    case 'pass':
      return <path d="M4 8.5l2.5 2.5L12 5.5" />;
    case 'warn':
      return (
        <>
          <path d="M8 3.5v5.5" />
          <path d="M8 12.2v.3" />
        </>
      );
    case 'fail':
      return <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />;
    case 'pending':
      return <circle cx="8" cy="8" r="2.5" />;
  }
}

/**
 * A check result: Pass (Water), Warning (Honey), Fail (Alert), or a quiet Checking dot.
 * `label` overrides the text (for example "Required check failed").
 */
export function StatusBadge({ status, label }: { status: BadgeStatus; label?: string }) {
  return (
    <span className={styles.badge} data-status={status}>
      <svg className={styles.icon} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <Icon status={status} />
      </svg>
      <span>{label ?? TEXT[status]}</span>
    </span>
  );
}
