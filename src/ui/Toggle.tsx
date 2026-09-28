import { useId } from 'react';
import styles from './Toggle.module.css';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
  accent?: 'honey' | 'water';
}

/** An on/off switch (e.g. Linked, Loop, Mute). */
export function Toggle({
  label,
  checked,
  onChange,
  description,
  disabled = false,
  accent = 'honey',
}: ToggleProps) {
  const id = useId();
  return (
    <label
      className={`${styles.toggle} ${accent === 'water' ? styles.water : ''}`}
      htmlFor={id}
      title={description}
    >
      <span className={styles.switch}>
        <input
          id={id}
          type="checkbox"
          role="switch"
          className={styles.input}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className={styles.track} aria-hidden="true">
          <span className={styles.knob} />
        </span>
      </span>
      <span className={styles.label}>{label}</span>
    </label>
  );
}
