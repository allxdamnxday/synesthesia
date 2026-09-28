import { useId, type ReactNode } from 'react';
import styles from './Checkbox.module.css';

export interface CheckboxProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** A quieter line under the label. */
  description?: ReactNode;
  disabled?: boolean;
  /** Accessible name, when the visible label and description would be too long for one. */
  ariaLabel?: string;
}

/** A checkbox with a large hit area: the whole label toggles it. */
export function Checkbox({
  label,
  checked,
  onChange,
  description,
  disabled = false,
  ariaLabel,
}: CheckboxProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <label className={styles.checkbox} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={description && ariaLabel ? descriptionId : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.box} aria-hidden="true">
        <svg viewBox="0 0 16 16" width="12" height="12" focusable="false">
          <path
            d="M3.5 8.5l3 3 6-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {description ? (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
