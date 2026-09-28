import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** 0..1, or null when how far along isn't known yet. */
  value: number | null;
  /** What is in progress, for screen readers ("Extracting the signature"). */
  label: string;
  /** How far along, in words ("Finding the movement, 45%"). */
  valueText?: string;
}

/** A calm horizontal progress bar (extraction now; rendering later). */
export function ProgressBar({ value, label, valueText }: ProgressBarProps) {
  const fraction = value === null ? null : Math.min(1, Math.max(0, value));
  return (
    <div
      className={`${styles.bar} ${fraction === null ? styles.indeterminate : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
      aria-valuetext={valueText}
    >
      <div className={styles.fill} style={{ width: `${(fraction ?? 0.3) * 100}%` }} />
    </div>
  );
}
