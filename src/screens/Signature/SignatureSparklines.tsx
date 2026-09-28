import { useEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import type { SignatureBody } from '../../signature/extractClient';
import { DirectionSparkline, Sparkline } from '../../ui/Sparkline';
import type { ValueRange } from '../../ui/sparklineMath';
import type { SignaturePlayback } from './SignaturePreview';
import styles from './SignatureSparklines.module.css';

const UNIT: ValueRange = { min: 0, max: 1 };

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
 * wake. Click or drag across the lines to move the playhead.
 */
export function SignatureSparklines({ signature, playback }: SignatureSparklinesProps) {
  const { features, frameCount } = signature;
  const { clock } = playback;
  const plotsRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; resume: boolean } | null>(null);

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

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, resume: clock.isPlaying() };
    clock.pause();
    seekTo(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === e.pointerId) seekTo(e.clientX);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.resume) clock.play();
  };

  const onsets = features.onsets
    .filter((i) => i >= 0 && i < frameCount)
    .map((i) => (frameCount > 0 ? i / frameCount : 0));

  return (
    <div className={styles.sparklines} data-testid="sparklines">
      <div className={styles.labels}>
        {ROWS.map((row) => (
          <span key={row.id} className={styles.label} title={row.hint}>
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
      {onsets.length > 0 ? (
        <p className={styles.legend}>
          <span className={styles.swatch} aria-hidden="true" />
          Moments of sudden movement
        </p>
      ) : null}
    </div>
  );
}
