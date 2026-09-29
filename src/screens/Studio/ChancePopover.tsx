import { useEffect, useId, useRef } from 'react';
import { useStudioStore, type ChancePopoverHandle } from '../../state/studioStore';
import { chanceSoundMetas, chanceVisualMetas } from '../../studio/catalog';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Toggle } from '../../ui/Toggle';
import styles from './ChancePopover.module.css';
import { CompositionSeed } from './CompositionSeed';

const supportsAnchors =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('anchor-name', '--a');

/** Where the popover is a sheet along the bottom instead (ChancePopover.module.css). */
const SHEET_QUERY =
  '(max-width: 900px), (orientation: landscape) and (max-height: 500px) and (max-width: 1023.98px)';

/**
 * Draw by chance (SPEC 12.2): chance picks one visual and one sound material from the
 * eligible pool and opens K shared properties to play; every other shared property stays
 * at its baseline, locked. The composition's seed decides the draw, so the same seed
 * always draws the same way. Built on the Popover API: Esc or a click elsewhere closes it.
 */
export function ChanceButton() {
  const popoverId = useId();
  const anchorName = `--chance-${popoverId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const open = useStudioStore((s) => s.chanceOpen);
  const options = useStudioStore((s) => s.chance);
  const chance = useStudioStore((s) => s.composition?.chance ?? null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const store = useStudioStore.getState;

  const visual = chanceVisualMetas();
  const sound = chanceSoundMetas();
  const visualPool = visual.filter((m) => options.visualPool.includes(m.id));
  const soundPool = sound.filter((m) => options.soundPool.includes(m.id));
  const canDraw = visualPool.length > 0 && (sound.length === 0 || soundPool.length > 0);

  // Anchor the popover above its button.
  useEffect(() => {
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover || !supportsAnchors) return;
    anchor.style.setProperty('anchor-name', anchorName);
    popover.style.setProperty('position-anchor', anchorName);
  }, [anchorName]);

  // The popover itself is the truth: its button (a popover invoker), Esc and clicks
  // elsewhere open and close it natively, and the C key toggles it through this handle.
  // The store only mirrors whether it is open.
  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    const handle: ChancePopoverHandle = {
      toggle: () => popover.togglePopover(),
      close: () => {
        if (popover.matches(':popover-open')) popover.hidePopover();
      },
    };
    const onBeforeToggle = (event: Event) => {
      if ((event as ToggleEvent).newState !== 'open' || supportsAnchors) return;
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r || window.matchMedia(SHEET_QUERY).matches) {
        popover.style.right = '';
        popover.style.bottom = '';
        return;
      }
      popover.style.right = `${Math.round(document.documentElement.clientWidth - r.right)}px`;
      popover.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`;
    };
    const onToggle = (event: Event) => {
      const nowOpen = (event as ToggleEvent).newState === 'open';
      store().setChanceOpen(nowOpen);
      if (nowOpen) {
        popover.querySelector<HTMLElement>('input, button')?.focus();
      } else if (popover.contains(document.activeElement)) {
        anchorRef.current?.querySelector('button')?.focus();
      }
    };
    store().attachChancePopover(handle);
    popover.addEventListener('beforetoggle', onBeforeToggle);
    popover.addEventListener('toggle', onToggle);
    return () => {
      store().detachChancePopover(handle);
      popover.removeEventListener('beforetoggle', onBeforeToggle);
      popover.removeEventListener('toggle', onToggle);
    };
  }, [store]);

  const togglePool = (kind: 'visualPool' | 'soundPool', id: string, on: boolean) => {
    const current = options[kind];
    store().setChanceOptions({
      [kind]: on ? [...current.filter((x) => x !== id), id] : current.filter((x) => x !== id),
    });
  };

  const draw = () => {
    if (store().drawChance()) popoverRef.current?.hidePopover();
  };

  return (
    <>
      <span ref={anchorRef} className={styles.anchor}>
        <Button
          popoverTarget={popoverId}
          aria-expanded={open}
          aria-controls={popoverId}
          title="Draw by chance (C)"
          className={chance ? styles.drawn : undefined}
        >
          Draw by chance
        </Button>
      </span>
      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        role="dialog"
        aria-label="Draw by chance"
        className={styles.popover}
      >
        <h2 className={styles.title}>Draw by chance</h2>
        <p className={styles.hint}>
          Chance picks a visual and a sound material and opens a few shared properties to play. The
          others stay at their baseline, locked; you can still unlock one, and that is noted. The
          same seed always draws the same way.
        </p>
        <CompositionSeed />
        <fieldset className={styles.pool}>
          <legend className={styles.label}>Visual materials</legend>
          {visual.map((m) => (
            <Checkbox
              key={m.id}
              label={m.name}
              checked={options.visualPool.includes(m.id)}
              onChange={(on) => togglePool('visualPool', m.id, on)}
            />
          ))}
        </fieldset>
        {sound.length > 0 ? (
          <fieldset className={styles.pool}>
            <legend className={styles.label}>Sound materials</legend>
            {sound.map((m) => (
              <Checkbox
                key={m.id}
                label={m.name}
                checked={options.soundPool.includes(m.id)}
                onChange={(on) => togglePool('soundPool', m.id, on)}
              />
            ))}
          </fieldset>
        ) : null}
        <SegmentedControl
          label="Open properties"
          description="How many shared properties chance opens to play."
          options={['1', '2', '3']}
          value={Math.min(2, Math.max(0, options.openCount - 1))}
          onChange={(i) => store().setChanceOptions({ openCount: i + 1 })}
        />
        <Toggle
          label="Also choose values"
          checked={options.chooseValues}
          onChange={(chooseValues) => store().setChanceOptions({ chooseValues })}
          description="Chance also sets the open properties to values of its own."
        />
        {canDraw ? null : (
          <p className={styles.problem} role="alert">
            Choose at least one visual and one sound material.
          </p>
        )}
        <div className={styles.actions}>
          <Button popoverTarget={popoverId} popoverTargetAction="hide">
            Close
          </Button>
          <Button variant="primary" onClick={draw} disabled={!canDraw}>
            Draw
          </Button>
        </div>
      </div>
    </>
  );
}
