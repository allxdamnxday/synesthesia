import { useEffect, useId, useMemo, useRef, useState } from 'react';
import styles from './Sparkline.module.css';
import {
  areaPath,
  directionBuckets,
  linePath,
  seriesPoints,
  signedRange,
  unsignedRange,
  yFor,
  type ValueRange,
} from './sparklineMath';

/** The SVG's own units; it stretches to its box (lines keep their width). */
const W = 1000;
const H = 100;

export type SparklineVariant = 'area' | 'line' | 'signed';

export interface SparklineProps {
  /** One value per signature frame. */
  values: ArrayLike<number>;
  /**
   * 'area' fills under the line from 0; 'line' draws only the line; 'signed' draws around a
   * middle line, filling above and below it in different colours.
   */
  variant?: SparklineVariant;
  /** Value range; by default 0..largest (or ±largest for 'signed'). */
  range?: ValueRange;
  /** What the line shows, for screen readers. */
  label: string;
}

/**
 * A compact line of one movement feature over the whole signature (frame i at i / n of the
 * width, the last frame held to the edge; see sparklineMath.ts). It fills its container.
 */
export function Sparkline({ values, variant = 'area', range, label }: SparklineProps) {
  const clipId = `spark${useId().replace(/[^\w-]/g, '')}`;
  const shape = useMemo(() => {
    const r = range ?? (variant === 'signed' ? signedRange(values) : unsignedRange(values));
    const points = seriesPoints(values, W, H, r);
    const zeroY = yFor(0, r, H);
    return {
      line: linePath(points),
      area: variant === 'line' ? '' : areaPath(points, zeroY),
      zeroY,
    };
  }, [values, variant, range]);

  return (
    <svg
      className={styles.sparkline}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      {variant === 'signed' ? (
        <>
          <defs>
            <clipPath id={`${clipId}-up`}>
              <rect x="0" y="0" width={W} height={shape.zeroY} />
            </clipPath>
            <clipPath id={`${clipId}-down`}>
              <rect x="0" y={shape.zeroY} width={W} height={H - shape.zeroY} />
            </clipPath>
          </defs>
          <path d={shape.area} className={styles.areaUp} clipPath={`url(#${clipId}-up)`} />
          <path d={shape.area} className={styles.areaDown} clipPath={`url(#${clipId}-down)`} />
          <line
            x1="0"
            x2={W}
            y1={shape.zeroY}
            y2={shape.zeroY}
            className={styles.zero}
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : shape.area ? (
        <path d={shape.area} className={styles.area} />
      ) : null}
      <path d={shape.line} className={styles.line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface DirectionSparklineProps {
  /** Mean flow per frame (x right, y down). */
  flowX: ArrayLike<number>;
  flowY: ArrayLike<number>;
  label: string;
  /** Room for each arrow, in pixels. */
  spacing?: number;
}

/** Below this share of the strongest movement a stretch shows a dot, not an arrow. */
const WEAK = 0.12;

/**
 * Direction over time as a row of small arrows: each points the way that stretch of the
 * movement goes, fainter when there is little movement to speak of.
 */
export function DirectionSparkline({ flowX, flowY, label, spacing = 18 }: DirectionSparklineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(24);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (width: number) => {
      if (width > 0) setCount(Math.max(4, Math.min(160, Math.floor(width / spacing))));
    };
    update(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) update(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [spacing]);

  const buckets = useMemo(() => directionBuckets(flowX, flowY, count), [flowX, flowY, count]);

  return (
    <div
      ref={ref}
      className={styles.arrows}
      role="img"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${Math.max(1, buckets.length)}, 1fr)` }}
    >
      {buckets.map((b, i) => (
        <span key={i} className={styles.slot}>
          {b.strength < WEAK ? (
            <span className={styles.dot} />
          ) : (
            <svg
              viewBox="-8 -8 16 16"
              className={styles.arrow}
              style={{
                transform: `rotate(${((b.angle * 180) / Math.PI).toFixed(1)}deg)`,
                opacity: 0.35 + 0.65 * b.strength,
              }}
              aria-hidden="true"
            >
              <path d="M-5.5 0 H5 M1.5 -3.5 L5 0 L1.5 3.5" />
            </svg>
          )}
        </span>
      ))}
    </div>
  );
}
