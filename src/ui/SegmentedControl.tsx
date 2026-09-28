import { useId } from 'react';
import type { KeyboardEvent } from 'react';
import styles from './SegmentedControl.module.css';

export interface SegmentedControlProps {
  label: string;
  options: readonly string[];
  /** Index of the selected option. */
  value: number;
  onChange: (index: number) => void;
  description?: string;
  disabled?: boolean;
  /** Visually hide the label (it stays available to screen readers). */
  hideLabel?: boolean;
}

/** A row of mutually exclusive choices (radio group), used for 'choice' properties. */
export function SegmentedControl({
  label,
  options,
  value,
  onChange,
  description,
  disabled = false,
  hideLabel = false,
}: SegmentedControlProps) {
  const id = useId();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const last = options.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = value >= last ? 0 : value + 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = value <= 0 ? last : value - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    const target = e.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next];
    target?.focus();
  };
  return (
    <div className={styles.group} title={description}>
      <span id={`${id}-label`} className={hideLabel ? 'visually-hidden' : styles.label}>
        {label}
      </span>
      <div
        className={styles.options}
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        onKeyDown={onKeyDown}
      >
        {options.map((option, index) => {
          const selected = index === value;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              className={selected ? `${styles.option} ${styles.selected}` : styles.option}
              onClick={() => onChange(index)}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
