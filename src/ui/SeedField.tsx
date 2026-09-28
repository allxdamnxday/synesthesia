import { useId } from 'react';
import { Button } from './Button';
import styles from './SeedField.module.css';

export interface SeedFieldProps {
  label: string;
  /** The digits as typed (the owner parses them, e.g. with parseSeed in src/state/seed.ts). */
  value: string;
  onChange: (text: string) => void;
  /** Leaving the field or pressing Enter: a chance to tidy the text (pad to six digits). */
  onCommit?: () => void;
  /** Pick a fresh seed (newSeed in src/state/seed.ts). */
  onNewSeed: () => void;
  /** One plain sentence under the field. */
  description?: string;
  /** Shown instead of the description while the text isn't a usable seed. */
  error?: string | null;
  disabled?: boolean;
}

/**
 * A 6-digit seed (SPEC 12.1): editable, with a "New seed" button. Only digits can be
 * typed. The same seed always gives the same result.
 */
export function SeedField({
  label,
  value,
  onChange,
  onCommit,
  onNewSeed,
  description,
  error,
  disabled = false,
}: SeedFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? description;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.row}>
        <input
          id={id}
          className={styles.input}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={6}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
          onBlur={onCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onCommit?.();
          }}
        />
        <Button onClick={onNewSeed} disabled={disabled}>
          New seed
        </Button>
      </div>
      {note ? (
        <p id={noteId} className={error ? styles.error : styles.description}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
