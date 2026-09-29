import sizes from './images.json';

/**
 * The guide's pictures: web-sized WebP copies of the screenshots in docs/images/guide/,
 * made by `node scripts/guide-images.mjs` and bundled by Vite (so the offline cache keeps
 * them). images.json records each one's size so the page reserves its space before it loads.
 */

export interface GuideImage {
  url: string;
  width: number;
  height: number;
}

interface ImageSize {
  file: string;
  width: number;
  height: number;
}

const SIZES: Readonly<Record<string, ImageSize>> = sizes;

const URLS = import.meta.glob<string>('./images/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** The markdown's path as images.json keys it: `images/guide/x.png`. */
function normalize(src: string): string {
  return src
    .trim()
    .replace(/^\.\//, '')
    .replace(/^docs\//, '');
}

/**
 * The bundled picture for an image path in the guide (`images/guide/studio.png`), or null
 * when there is none, such as a web address: the guide never loads anything from the network.
 */
export function guideImage(src: string): GuideImage | null {
  const size = Object.hasOwn(SIZES, normalize(src)) ? SIZES[normalize(src)] : undefined;
  const url = size ? URLS[`./images/${size.file}`] : undefined;
  return size && url ? { url, width: size.width, height: size.height } : null;
}
