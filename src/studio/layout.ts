/**
 * Where the preview canvas sits and how many pixels it has. The canvas keeps the
 * composition's render aspect (16:9 or square), letterboxed in true black, and its
 * backing store is capped by the preview quality tier so Retina Macs stay smooth.
 */
import type { Quality } from '../materials/types';

/** Backing-store pixels per CSS pixel, at most, by preview quality tier. */
export const PIXEL_RATIO_CAP: Readonly<Record<Quality, number>> = {
  draft: 1,
  standard: 1.5,
  high: 2,
};

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The largest box of the given aspect (width / height) centred in a host, in whole pixels. */
export function fitAspect(hostWidth: number, hostHeight: number, aspect: number): Box {
  const w = Number.isFinite(hostWidth) ? Math.max(0, hostWidth) : 0;
  const h = Number.isFinite(hostHeight) ? Math.max(0, hostHeight) : 0;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  let width = w;
  let height = w / a;
  if (height > h) {
    height = h;
    width = h * a;
  }
  width = Math.max(1, Math.floor(width));
  height = Math.max(1, Math.floor(height));
  return {
    left: Math.max(0, Math.floor((w - width) / 2)),
    top: Math.max(0, Math.floor((h - height) / 2)),
    width,
    height,
  };
}

/** Pixels per CSS pixel for a display and tier. */
export function pixelRatioFor(devicePixelRatio: number, quality: Quality): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr, PIXEL_RATIO_CAP[quality]);
}

/** Backing-store size for a canvas of this CSS size. */
export function backingSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  quality: Quality,
): { width: number; height: number } {
  const ratio = pixelRatioFor(devicePixelRatio, quality);
  return {
    width: Math.max(1, Math.round(cssWidth * ratio)),
    height: Math.max(1, Math.round(cssHeight * ratio)),
  };
}
