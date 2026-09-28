import { useEffect, useRef, useState } from 'react';
import styles from './InlineRename.module.css';

export interface InlineRenameProps {
  /** The current name (the starting text). */
  value: string;
  /** Accessible label, e.g. "New name for Wink 01". */
  label: string;
  /** Called with the trimmed new name when it changed and isn't empty. */
  onCommit: (name: string) => void;
  /** Called when renaming ends without a change (Esc, empty, or unchanged). */
  onCancel: () => void;
  maxLength?: number;
  className?: string;
}

/**
 * A text field that replaces a name while renaming. Enter or leaving the field keeps the
 * new name; Esc keeps the old one. The text starts selected.
 */
export function InlineRename({
  value,
  label,
  onCommit,
  onCancel,
  maxLength = 120,
  className,
}: InlineRenameProps) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const next = draft.replace(/\s+/g, ' ').trim();
    if (commit && next !== '' && next !== value) onCommit(next);
    else onCancel();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      aria-label={label}
      className={[styles.input, className].filter(Boolean).join(' ')}
      value={draft}
      maxLength={maxLength}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}
