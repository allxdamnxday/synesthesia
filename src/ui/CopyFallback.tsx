import { useEffect, useId, useRef } from 'react';
import styles from './CopyFallback.module.css';

function copyShortcut(): string {
  if (typeof navigator === 'undefined') return 'Ctrl+C or Cmd+C';
  return /Mac|iPhone|iPad/.test(navigator.userAgent) ? 'Cmd+C' : 'Ctrl+C';
}

/**
 * Shown when the clipboard refuses: the text in a read-only box, already selected, with
 * the keyboard shortcut to copy it.
 */
export function CopyFallback({ text, label }: { text: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.focus();
    box.select();
  }, [text]);

  return (
    <div className={styles.fallback}>
      <p id={hintId} className={styles.hint}>
        The browser didn&apos;t allow copying. The text below is selected: press {copyShortcut()} to
        copy it.
      </p>
      <textarea
        ref={ref}
        className={styles.box}
        readOnly
        value={text}
        rows={12}
        spellCheck={false}
        aria-label={label}
        aria-describedby={hintId}
        onFocus={(event) => event.currentTarget.select()}
      />
    </div>
  );
}
