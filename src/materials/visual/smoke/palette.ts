/**
 * Smoke's tints. Smoke is pale on dark, but, as in every fluid material, the direction of
 * movement colors it a little, so a wink's close (down) and open (up) give off two
 * different smokes: cool grey-blue falling, warm ivory rising, neutral to the sides.
 */
import type { Rgb } from '../shared/fluid';

export interface SmokeTints {
  /** Smoke pushed upward. */
  rising: Rgb;
  /** Smoke pushed sideways. */
  level: Rgb;
  /** Smoke pushed downward. */
  falling: Rgb;
}

export const SMOKE_TINTS: Readonly<SmokeTints> = {
  rising: [1, 0.94, 0.86],
  level: [0.86, 0.86, 0.86],
  falling: [0.6, 0.72, 0.96],
};

/**
 * Tint for a push in direction (x, y) (y up), as the emission shader computes it:
 * level blends toward rising or falling with the sine of the angle.
 */
export function smokeTint(x: number, y: number, tints: Readonly<SmokeTints> = SMOKE_TINTS): Rgb {
  const m = Math.hypot(x, y);
  const s = m > 0 ? y / m : 0;
  const to = s >= 0 ? tints.rising : tints.falling;
  const k = Math.abs(s);
  return [
    tints.level[0] + (to[0] - tints.level[0]) * k,
    tints.level[1] + (to[1] - tints.level[1]) * k,
    tints.level[2] + (to[2] - tints.level[2]) * k,
  ];
}
