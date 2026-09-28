/**
 * The optional feature readout for V0: a few normalized movement features as small
 * labelled bars, drawn into a 2D canvas that is uploaded as a texture. Labels use the
 * write-up's own words for the movement qualities.
 */
import type { FeatureName } from '../../../signature/types';
import type { ReadoutLayout } from './layout';

export interface ReadoutRow {
  feature: FeatureName;
  label: string;
  /** Signed features draw from the middle: left for negative, right for positive. */
  signed: boolean;
}

export const READOUT_ROWS: readonly ReadoutRow[] = [
  { feature: 'energy', label: 'Velocity', signed: false },
  { feature: 'acceleration', label: 'Acceleration', signed: false },
  { feature: 'divergence', label: 'Expansion', signed: true },
  { feature: 'curl', label: 'Rotation', signed: true },
  { feature: 'continuity', label: 'Continuity', signed: false },
  { feature: 'density', label: 'Density', signed: false },
];

export interface ReadoutValues {
  /** Normalized features (0..1, or −1..1 for signed ones). */
  normalized: Readonly<Record<FeatureName, number>>;
  /** Raw `direction` (radians, up positive). */
  direction: number;
  /** Normalized `energy`, used to fade the direction arrow when nothing moves. */
  movement: number;
  /** Raw `coherence` 0..1: how much of the movement goes one way. */
  coherence: number;
}

export const READOUT_FONT_FAMILY = "'Atkinson Hyperlegible Next', system-ui, sans-serif";

const PEARL = 'rgba(232, 228, 218, 0.95)';
const MIST = 'rgba(154, 171, 181, 0.95)';
const TRACK = 'rgba(94, 111, 122, 0.55)';
const PANEL = 'rgba(0, 0, 0, 0.6)';

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const clampSigned = (x: number) => (Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0);
const clampUnit = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/** Draw the whole panel (it fills the 2D canvas, which is layout.width × layout.height). */
export function drawReadout(ctx: Context2D, layout: ReadoutLayout, values: ReadoutValues): void {
  const u = layout.unit;
  const w = layout.width;
  const h = layout.height;
  const px = (x: number) => Math.round(x * u);
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = PANEL;
  roundRect(ctx, 0, 0, w, h, px(8));
  ctx.fill();

  const pad = px(14);
  const rowHeight = px(26);
  const barX = px(112);
  const barW = w - barX - pad;
  const barH = Math.max(2, px(6));
  ctx.font = `${Math.max(9, px(13))}px ${READOUT_FONT_FAMILY}`;
  ctx.textBaseline = 'middle';

  READOUT_ROWS.forEach((row, i) => {
    const cy = pad + rowHeight * i + rowHeight / 2;
    ctx.fillStyle = PEARL;
    ctx.fillText(row.label, pad, cy);
    const top = Math.round(cy - barH / 2);
    ctx.fillStyle = TRACK;
    ctx.fillRect(barX, top, barW, barH);
    ctx.fillStyle = PEARL;
    const value = values.normalized[row.feature];
    if (row.signed) {
      const mid = barX + Math.round(barW / 2);
      const v = clampSigned(value);
      const len = Math.round((Math.abs(v) * barW) / 2);
      ctx.fillRect(v < 0 ? mid - len : mid, top, len, barH);
      ctx.fillStyle = MIST;
      ctx.fillRect(mid, top - px(2), Math.max(1, Math.round(u)), barH + px(4));
    } else {
      ctx.fillRect(barX, top, Math.round(clampUnit(value) * barW), barH);
    }
  });

  // Direction: an arrow from the middle of its row, fading when nothing moves.
  const cy = pad + rowHeight * READOUT_ROWS.length + rowHeight / 2;
  ctx.fillStyle = PEARL;
  ctx.fillText('Direction', pad, cy);
  const cx = barX + barW / 2;
  const reach = Math.min(barW / 2, rowHeight * 0.45) * (0.35 + 0.65 * clampUnit(values.coherence));
  const alpha = clampUnit(values.movement * 3);
  ctx.strokeStyle = TRACK;
  ctx.lineWidth = Math.max(1, u);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(barW / 2, rowHeight * 0.45), 0, Math.PI * 2);
  ctx.stroke();
  if (alpha > 0.01 && Number.isFinite(values.direction)) {
    const dx = Math.cos(values.direction) * reach;
    const dy = -Math.sin(values.direction) * reach; // canvas y is down; direction has up positive
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = PEARL;
    ctx.lineWidth = Math.max(1.5, 2 * u);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();
    const head = Math.max(3, 5 * u);
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(cx + dx, cy + dy);
    ctx.lineTo(cx + dx - head * Math.cos(angle - 0.5), cy + dy - head * Math.sin(angle - 0.5));
    ctx.moveTo(cx + dx, cy + dy);
    ctx.lineTo(cx + dx - head * Math.cos(angle + 0.5), cy + dy - head * Math.sin(angle + 0.5));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function roundRect(ctx: Context2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
