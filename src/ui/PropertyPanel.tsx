import { useState } from 'react';
import type { PropertyDef, PropertyValues } from '../materials/types';
import styles from './PropertyPanel.module.css';
import { SegmentedControl } from './SegmentedControl';
import { Slider, type SliderPhase } from './Slider';

export interface PropertyPanelProps {
  /** Properties to show, in order. Primary ones are always visible; others under "More". */
  defs: readonly PropertyDef[];
  values: PropertyValues;
  onChange: (id: string, value: number, phase: SliderPhase) => void;
  /** Properties locked by chance (dimmed, with a lock). */
  lockedIds?: ReadonlySet<string>;
  onUnlock?: (id: string) => void;
  /** Shared properties currently driving both fields (shown in the Water accent). */
  linkedIds?: ReadonlySet<string>;
  /** Accessible name for the group, e.g. "Water properties". */
  label: string;
  /** Start with "More" open. */
  defaultExpanded?: boolean;
}

/** Sliders and choices for one material's properties (SPEC 9.1: at most 6 primary, and Hue). */
export function PropertyPanel({
  defs,
  values,
  onChange,
  lockedIds,
  onUnlock,
  linkedIds,
  label,
  defaultExpanded = false,
}: PropertyPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const primary = defs.filter((d) => d.primary);
  const more = defs.filter((d) => !d.primary);

  const renderDef = (def: PropertyDef) => {
    const value = values[def.id] ?? def.default;
    const locked = lockedIds?.has(def.id) ?? false;
    if (def.kind === 'choice') {
      return (
        <SegmentedControl
          key={def.id}
          label={def.label}
          description={def.description}
          options={def.choices ?? []}
          value={Math.round(value)}
          disabled={locked}
          onChange={(index) => onChange(def.id, index, 'end')}
        />
      );
    }
    return (
      <Slider
        key={def.id}
        label={def.label}
        description={def.description}
        value={value}
        baseline={def.default}
        locked={locked}
        onUnlock={onUnlock ? () => onUnlock(def.id) : undefined}
        accent={linkedIds?.has(def.id) ? 'water' : 'honey'}
        onChange={(v, phase) => onChange(def.id, v, phase)}
      />
    );
  };

  return (
    <div className={styles.panel} role="group" aria-label={label}>
      {primary.map(renderDef)}
      {more.length > 0 ? (
        <>
          <button
            type="button"
            className={styles.more}
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            <span className={styles.chevron} aria-hidden="true">
              {expanded ? '▾' : '▸'}
            </span>
            {expanded ? 'Fewer' : `More (${more.length})`}
          </button>
          {expanded ? <div className={styles.moreList}>{more.map(renderDef)}</div> : null}
        </>
      ) : null}
    </div>
  );
}
