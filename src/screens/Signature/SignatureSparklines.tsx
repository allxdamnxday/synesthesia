import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import type { SignatureBody } from '../../signature/extractClient';
import { DirectionSparkline, Sparkline } from '../../ui/Sparkline';
import type { ValueRange } from '../../ui/sparklineMath';
import { touchIntent } from '../../ui/touchMath';
import type { SignaturePlayback } from './SignaturePreview';
import styles from './SignatureSparklines.module.css';

const UNIT: ValueRange = { min: 0, max: 1 };
/** Sideways travel (px) that turns a touch on the lines into a scrub. */
const TOUCH_SLOP_PX = 6;

const ROWS = [
  { id: 'energy', label: 'Energy', hint: 'How much is moving.' },
  { id: 'direction', label: 'Direction', hint: 'Which way the movement goes.' },
  {
    id: 'divergence',
    label: 'Expansion and contraction',
    hint: 'Above the line: opening outward. Below: drawing in.',
  },
  {
    id: 'continuity',
    label: 'Continuity',
    hint: 'High when the movement flows smoothly, low when it changes suddenly.',
  },
  { id: 'density', label: 'Density', hint: 'How much of the frame is moving.' },
] as const;

export interface SignatureSparklinesProps {
  signature: Pick<SignatureBody, 'features' | 'frameCount'>;
  playback: SignaturePlayback;
}

/**
 * Energy, direction, expansion/contraction, continuity and density across the whole
 * signature, with its moments of sudden movement marked and a playhead that follows the
 * wake. Click or drag across the lines to move the playhead. A finger taps or drags sideways
 * to do the same (an up or down swipe scrolls the page), and taps a row's name for its hint.
 */
export function SignatureSparklines({ signature, playback }: SignatureSparklinesProps) {
  const { features, frameCount } = signature;
  const { clock } = playback;
  const plotsRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; resume: boolean } | null>(null);
  const press = useRef<{ pointerId: number; x: number; y: number; scrolling: boolean } | null>(
    null,
  );
  const lastPointer = useRef('mouse');
  const touchDragged = useRef(false);
  /** Touch screens have no tooltips: a tap on a row's name shows its hint. */
  const [hint, setHint] = useState<string | null>(null);

  // The playhead moves every frame, so it is positioned directly rather than re-rendered.
  useEffect(() => {
    const update = () => {
      const duration = clock.getDuration();
      const fraction = duration > 0 ? Math.min(1, clock.getTime() / duration) : 0;
      if (headRef.current) headRef.current.style.left = `${fraction * 100}%`;
    };
    update();
    return clock.subscribe(update);
  }, [clock]);

  const seekTo = (clientX: number) => {
    const rect = plotsRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    clock.seek(fraction * clock.getDuration());
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, resume: clock.isPlaying() };
    clock.pause();
    seekTo(e.clientX);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    lastPointer.current = e.pointerType;
    touchDragged.current = false;
    if (e.button !== 0) return;
    if (e.pointerType === 'mouse') {
      e.preventDefault();
      startDrag(e);
      return;
    }
    // A finger: sideways moves the playhead; up or down scrolls the page (pan-y).
    press.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, scrolling: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (p && p.pointerId === e.pointerId) {
      if (p.scrolling) return;
      const intent = touchIntent(e.clientX - p.x, e.clientY - p.y, TOUCH_SLOP_PX);
      if (intent === 'scroll') p.scrolling = true;
      if (intent !== 'drag') return;
      press.current = null;
      touchDragged.current = true;
      startDrag(e);
      return;
    }
    if (drag.current?.pointerId === e.pointerId) seekTo(e.clientX);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId === e.pointerId) press.current = null;
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.resume) clock.play();
  };
  /** A tap by finger moves the playhead there (a mouse already did on press). */
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (lastPointer.current === 'mouse') return;
    if (touchDragged.current) {
      touchDragged.current = false;
      return;
    }
    seekTo(e.clientX);
  };

  const onsets = features.onsets
    .filter((i) => i >= 0 && i < frameCount)
    .map((i) => (frameCount > 0 ? i / frameCount : 0));

  return (
    <div
      className={styles.sparklines}
      data-testid="sparklines"
      onPointerDownCapture={(e) => {
        lastPointer.current = e.pointerType;
      }}
    >
      <div className={styles.labels}>
        {ROWS.map((row) => (
          <span
            key={row.id}
            className={styles.label}
            title={row.hint}
            onClick={() => {
              if (lastPointer.current !== 'mouse')
                setHint((h) => (h === row.hint ? null : row.hint));
            }}
          >
            {row.label}
          </span>
        ))}
      </div>
      <div
        ref={plotsRef}
        className={styles.plots}
        role="group"
        aria-label="Movement over time. Click to move the playhead."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
      >
        <div className={styles.row}>
          <Sparkline values={features.energy} label="Energy: how much is moving, over time" />
        </div>
        <div className={styles.row}>
          <DirectionSparkline
            flowX={features.flowX}
            flowY={features.flowY}
            label="Direction: which way the movement goes, over time"
          />
        </div>
        <div className={styles.row}>
          <Sparkline
            values={features.divergence}
            variant="signed"
            label="Expansion (above the line) and contraction (below), over time"
          />
        </div>
        <div className={styles.row}>
          <Sparkline
            values={features.continuity}
            variant="line"
            range={UNIT}
            label="Continuity: smooth (high) or sudden (low), over time"
          />
        </div>
        <div className={styles.row}>
          <Sparkline
            values={features.density}
            range={UNIT}
            label="Density: how much of the frame is moving, over time"
          />
        </div>
        {onsets.map((fraction, i) => (
          <div
            key={i}
            className={styles.onset}
            style={{ left: `${fraction * 100}%` }}
            data-testid="onset-marker"
          />
        ))}
        <div ref={headRef} className={styles.playhead} />
      </div>
      {hint ? (
        <p className={styles.hint} aria-hidden="true">
          {hint}
        </p>
      ) : null}
      {onsets.length > 0 ? (
        <p className={styles.legend}>
          <span className={styles.swatch} aria-hidden="true" />
          Moments of sudden movement
        </p>
      ) : null}
    </div>
  );
}
