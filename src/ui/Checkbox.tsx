import { useId } from 'react';
import styles from './Checkbox.module.css';

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
}

/** A labelled checkbox with a 32 px target (e.g. which materials chance may pick). */
export function Checkbox({
  label,
  checked,
  onChange,
  description,
  disabled = false,
}: CheckboxProps) {
  const id = useId();
  return (
    <label className={styles.checkbox} htmlFor={id} title={description}>
      <input
        id={id}
        type="checkbox"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.box} aria-hidden="true">
        <svg viewBox="0 0 16 16" width="12" height="12" focusable="false">
          <path
            d="M3.5 8.5l3 3L12.5 5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className={styles.label}>{label}</span>
    </label>
  );
}
