import { useState } from 'react';
import { useStudioStore } from '../../state/studioStore';
import { formatSeed, parseSeed } from '../../state/seed';
import { SeedField } from '../../ui/SeedField';

/**
 * The composition's seed as six digits (SPEC 12.1), in the panel and in Draw by chance:
 * type another (kept on Enter or on leaving the field) or draw a new one. Anything that
 * isn't one to six digits keeps the old seed.
 */
export function CompositionSeed({ description }: { description?: string }) {
  const seed = useStudioStore((s) => s.composition?.seed ?? 0);
  const [draft, setDraft] = useState<string | null>(null);
  const store = useStudioStore.getState;

  const commit = () => {
    if (draft === null) return;
    const parsed = parseSeed(draft);
    if (parsed !== null && parsed !== seed) store().setSeed(parsed);
    setDraft(null);
  };

  return (
    <SeedField
      label="Seed"
      value={draft ?? formatSeed(seed)}
      onChange={setDraft}
      onCommit={commit}
      onNewSeed={() => {
        setDraft(null);
        store().rollSeed();
      }}
      description={description}
      error={draft !== null && parseSeed(draft) === null ? 'A seed is one to six digits.' : null}
    />
  );
}
