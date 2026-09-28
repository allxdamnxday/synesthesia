import { useId, useState } from 'react';
import { useStudioStore } from '../../state/studioStore';
import { formatSeed, parseSeed } from '../../state/seed';
import { Button } from '../../ui/Button';
import styles from './Studio.module.css';

/**
 * The composition's seed as six digits (SPEC 12.1): type another, or draw a new one. Enter
 * or leaving the field keeps a valid seed; Esc (or anything that isn't one to six digits)
 * keeps the old one.
 */
export function SeedField() {
  const seed = useStudioStore((s) => s.composition?.seed ?? 0);
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const store = useStudioStore.getState;

  const commit = () => {
    if (draft === null) return;
    const parsed = parseSeed(draft);
    if (parsed !== null && parsed !== seed) store().setSeed(parsed);
    setDraft(null);
  };

  return (
    <div className={styles.seedRow}>
      <label htmlFor={id} className="visually-hidden">
        Seed
      </label>
      <input
        id={id}
        className={styles.seedInput}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={6}
        value={draft ?? formatSeed(seed)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
          }
        }}
      />
      <Button onClick={() => store().rollSeed()} title="Draw a new seed">
        New seed
      </Button>
    </div>
  );
}
