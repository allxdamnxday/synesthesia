import { useId, useMemo, type ReactNode } from 'react';
import type { CompositionStatus } from '../../engine/composition';
import type { MaterialMeta } from '../../materials/types';
import { useStudioStore } from '../../state/studioStore';
import { registryCatalog, soundMetas, visualMetas } from '../../studio/catalog';
import { defsOf, isSoloed, lockedIds, type Field } from '../../studio/edits';
import { linkedField, linkedValues, propertySections } from '../../studio/sections';
import type { SoundProblem } from '../../studio/runtime';
import { MaterialPicker } from '../../ui/MaterialPicker';
import { PropertyPanel } from '../../ui/PropertyPanel';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Toggle } from '../../ui/Toggle';
import { MovementControls } from './MovementControls';
import { CompositionSeed } from './CompositionSeed';
import styles from './Studio.module.css';

const STATUS_OPTIONS: Array<{ value: CompositionStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'kept', label: 'Kept' },
  { value: 'set-aside', label: 'Set aside' },
];

function soundMessage(problem: SoundProblem, materialId: string): string {
  switch (problem) {
    case 'no-audio':
      return 'Sound isn’t available in this browser, so the composition plays silently.';
    case 'material-missing':
      return `The sound material “${materialId}” isn’t part of this version, so the composition plays silently. Choose another sound material.`;
    case 'material-failed':
      return 'This sound material couldn’t start on this computer. Try another one, or reload the page.';
    case 'play-failed':
      return 'The sound couldn’t start. Check that this computer’s sound is on, then press Play again.';
  }
}

/** The controls beside the wake (SPEC 13.3): materials, shared properties, movement, seed, notes. */
export function StudioPanel() {
  const composition = useStudioStore((s) => s.composition);
  const sound = useStudioStore((s) => s.sound);
  const defs = useMemo(
    () => (composition ? defsOf(composition, registryCatalog) : { visual: [], sound: [] }),
    [composition],
  );
  const sections = useMemo(
    () => propertySections(defs, composition?.linked ?? true),
    [defs, composition?.linked],
  );
  const locked = useMemo(() => lockedIds(composition?.chance ?? null), [composition?.chance]);
  if (!composition) return null;
  const store = useStudioStore.getState;

  const onChange =
    (field: Field) => (id: string, value: number, phase: 'start' | 'change' | 'end') =>
      store().setProperty(field, id, value, { key: `${field}:${id}`, phase });

  return (
    <aside className={styles.panel} aria-label="Composition controls">
      <MaterialSection
        field="visual"
        kind="Visual"
        options={visualMetas()}
        materialId={composition.visual.materialId}
        muted={composition.mute.visual}
        soloed={isSoloed(composition.mute, 'visual')}
      >
        {sections.visual.length > 0 ? (
          <PropertyPanel
            label="Visual material properties"
            defs={sections.visual}
            values={composition.visual.properties}
            lockedIds={locked}
            onUnlock={(id) => store().unlock(id)}
            onChange={onChange('visual')}
          />
        ) : null}
      </MaterialSection>

      <section className={styles.section} aria-label="Linked properties">
        <div className={styles.linkRow}>
          {composition.linked ? <h2 className={styles.sectionTitle}>Both</h2> : null}
          <Toggle
            label="Linked"
            accent="water"
            checked={composition.linked}
            onChange={(linked) => store().setLinked(linked)}
            description="One slider moves each shared property in both the visual and the sound."
          />
        </div>
        {sections.both && sections.both.length > 0 ? (
          <PropertyPanel
            label="Shared properties, moving the visual and the sound together"
            defs={sections.both}
            values={linkedValues(sections.both, defs, {
              visual: composition.visual.properties,
              sound: composition.sound.properties,
            })}
            linkedIds={new Set(sections.both.map((d) => d.id))}
            lockedIds={locked}
            onUnlock={(id) => store().unlock(id)}
            onChange={(id, value, phase) =>
              store().setProperty(linkedField(id, defs), id, value, { key: `both:${id}`, phase })
            }
          />
        ) : null}
      </section>

      <MaterialSection
        field="sound"
        kind="Sound"
        options={soundMetas()}
        materialId={composition.sound.materialId}
        muted={composition.mute.sound}
        soloed={isSoloed(composition.mute, 'sound')}
      >
        {sound ? (
          <p className={styles.fieldNote} role="status">
            {soundMessage(sound, composition.sound.materialId)}
          </p>
        ) : null}
        {sections.sound.length > 0 ? (
          <PropertyPanel
            label="Sound material properties"
            defs={sections.sound}
            values={composition.sound.properties}
            lockedIds={locked}
            onUnlock={(id) => store().unlock(id)}
            onChange={onChange('sound')}
          />
        ) : null}
      </MaterialSection>

      <section className={styles.section} aria-labelledby="studio-movement">
        <h2 id="studio-movement" className={styles.sectionTitle}>
          Movement
        </h2>
        <MovementControls />
      </section>

      <section className={styles.section} aria-label="Seed">
        <CompositionSeed description="The seed fixes every chance choice, so the composition always plays the same way." />
      </section>

      <NotesSection />
    </aside>
  );
}

interface MaterialSectionProps {
  field: Field;
  kind: 'Visual' | 'Sound';
  options: readonly MaterialMeta[];
  materialId: string;
  muted: boolean;
  soloed: boolean;
  children?: ReactNode;
}

function MaterialSection({
  field,
  kind,
  options,
  materialId,
  muted,
  soloed,
  children,
}: MaterialSectionProps) {
  const store = useStudioStore.getState;
  const lower = kind.toLowerCase();
  return (
    <section className={styles.section} aria-label={`${kind} material`}>
      <div className={styles.materialHead}>
        <div className={styles.picker}>
          <MaterialPicker
            kind={kind}
            options={options}
            value={materialId}
            onChange={(id) => store().setMaterial(field, id)}
          />
        </div>
        <button
          type="button"
          className={styles.toggleButton}
          aria-pressed={muted}
          aria-label={`Mute ${lower}`}
          title={field === 'visual' ? 'Mute the picture (black)' : 'Mute the sound'}
          onClick={() => store().toggleMute(field)}
        >
          Mute
        </button>
        <button
          type="button"
          className={styles.toggleButton}
          aria-pressed={soloed}
          aria-label={`Solo ${lower}`}
          title={field === 'visual' ? 'The picture alone' : 'The sound alone'}
          onClick={() => store().toggleSolo(field)}
        >
          Solo
        </button>
      </div>
      {children}
    </section>
  );
}

function NotesSection() {
  const notes = useStudioStore((s) => s.composition?.notes ?? '');
  const status = useStudioStore((s) => s.composition?.status ?? 'draft');
  const notesId = useId();
  const store = useStudioStore.getState;
  return (
    <section className={styles.section} aria-labelledby={`${notesId}-title`}>
      <h2 id={`${notesId}-title`} className={styles.sectionTitle}>
        Notes
      </h2>
      <label className="visually-hidden" htmlFor={notesId}>
        Notes
      </label>
      <textarea
        id={notesId}
        className={styles.notes}
        value={notes}
        rows={5}
        placeholder="What do you notice? Discoveries, rough places, revisions."
        onChange={(e) => store().setNotes(e.target.value)}
      />
      <SegmentedControl
        label="Status"
        options={STATUS_OPTIONS.map((o) => o.label)}
        value={Math.max(
          0,
          STATUS_OPTIONS.findIndex((o) => o.value === status),
        )}
        onChange={(i) => store().setStatus(STATUS_OPTIONS[i]?.value ?? 'draft')}
      />
    </section>
  );
}
