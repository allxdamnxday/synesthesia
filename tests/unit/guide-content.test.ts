import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GUIDE, GUIDE_SOURCE } from '../../src/guide/guide';
import { guideImage } from '../../src/guide/images';
import sizes from '../../src/guide/images.json';
import { type Block, type Inline } from '../../src/guide/markdown';
import { MarkdownBlocks } from '../../src/guide/MarkdownView';
import {
  GUIDE_SECTIONS,
  guideLinkHref,
  headingDomId,
  linkTarget,
  type GuideSectionSlug,
} from '../../src/guide/sections';

const root = join(import.meta.dirname, '..', '..');
const file = readFileSync(join(root, 'docs', 'USER_GUIDE.md'), 'utf8').replace(/\r\n/g, '\n');
const allBlocks = [...GUIDE.intro, ...GUIDE.sections.flatMap((s) => s.blocks)];

/** Every inline node in the guide, depth first. */
function inlines(blocks: readonly Block[]): Inline[] {
  const out: Inline[] = [];
  const walk = (nodes: readonly Inline[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.type === 'strong' || n.type === 'emphasis' || n.type === 'link') walk(n.children);
    }
  };
  for (const b of blocks) {
    if (b.type === 'heading' || b.type === 'paragraph') walk(b.children);
    else if (b.type === 'list') b.items.forEach((item) => out.push(...inlines(item)));
    else if (b.type === 'blockquote') out.push(...inlines(b.children));
    else if (b.type === 'table') [b.head, ...b.rows].flat().forEach(walk);
  }
  return out;
}

const nodes = inlines(allBlocks);

describe('the guide in the app is docs/USER_GUIDE.md', () => {
  it('bundles the file itself', () => {
    expect(GUIDE_SOURCE.replace(/\r\n/g, '\n')).toBe(file);
  });

  it('has every ## and ### heading of the file, in order', () => {
    const lines = file
      .split('\n')
      .map((line) => /^(##|###) (.+)$/.exec(line))
      .filter((m) => m !== null)
      .map((m) => [m[1].length, m[2].trim()]);
    expect(GUIDE.headings.map((h) => [h.depth, h.title])).toEqual(lines);
    expect(GUIDE.sections.map((s) => s.title)).toEqual(
      lines.filter(([depth]) => depth === 2).map(([, title]) => title),
    );
  });

  it('gives every section the stable slug GUIDE_SECTIONS lists (so deep links keep working)', () => {
    // If this fails after a heading was reworded, update its title in GUIDE_SECTIONS.
    expect(Object.fromEntries(GUIDE.headings.map((h) => [h.slug, h.title]))).toEqual(
      GUIDE_SECTIONS,
    );
    const slugs: GuideSectionSlug[] = ['library', 'prepare', 'studio', 'render', 'albums'];
    for (const slug of slugs) expect(GUIDE.headings.some((h) => h.slug === slug)).toBe(true);
  });

  it('parses without leaving Markdown behind', () => {
    const text = nodes.flatMap((n) => (n.type === 'text' ? [n.value] : []));
    const leftovers = text.filter((value) => /[*_`[\]|#<>\\]|!\[/.test(value));
    expect(leftovers).toEqual([]);
    // Everything the source marks up was found.
    const count = (type: Inline['type']) => nodes.filter((n) => n.type === type).length;
    expect(count('image')).toBe(file.match(/!\[/g)?.length);
    expect(count('link')).toBe((file.match(/\]\(/g)?.length ?? 0) - count('image'));
    expect(count('code')).toBe((file.match(/`/g)?.length ?? 0) / 2);
    // Each run of `|` lines in the file is one table: a header, a delimiter row, then rows.
    const runs = file.match(/(?:^\|.*\n)+/gm) ?? [];
    const expected = runs.map((run) => {
      const rows = run.trim().split('\n');
      return [rows[0].split('|').length - 2, rows.length - 2];
    });
    const tables = allBlocks.flatMap((b) =>
      b.type === 'table' ? [[b.head.length, b.rows.length]] : [],
    );
    expect(tables).toEqual(expected);
    expect(tables.length).toBeGreaterThan(0);
  });

  it('shows every picture from a bundled, web-sized copy', () => {
    const pictures = nodes.flatMap((n) => (n.type === 'image' ? [n.src] : []));
    expect(pictures.length).toBeGreaterThan(0);
    for (const src of pictures) {
      const image = guideImage(src);
      expect(image, src).not.toBeNull();
      expect(image?.width).toBeLessThanOrEqual(1280);
      expect(image?.height).toBeGreaterThan(0);
    }
    // images.json and src/guide/images/ hold exactly the pictures the guide shows.
    expect(Object.keys(sizes).sort()).toEqual([...new Set(pictures)].sort());
    const files = readdirSync(join(root, 'src', 'guide', 'images')).sort();
    expect(files).toEqual(
      Object.values(sizes)
        .map((s) => s.file)
        .sort(),
    );
    for (const src of pictures) expect(existsSync(join(root, 'docs', src)), src).toBe(true);
  });

  it('links only to places inside the guide, and never to the network', () => {
    expect(file).not.toMatch(/https?:\/\/|mailto:|www\./);
    for (const node of nodes) {
      if (node.type !== 'link') continue;
      expect(linkTarget(node.href, GUIDE.anchors), node.href).not.toEqual({ kind: 'text' });
    }
  });

  it('renders whole, with unique ids and nothing loaded from elsewhere', () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownBlocks, {
        blocks: allBlocks,
        options: {
          resolveLink: (href) => guideLinkHref(href, GUIDE.anchors),
          resolveImage: guideImage,
          headingId: (block) => {
            const slug = GUIDE.slugOf.get(block);
            return slug === undefined ? undefined : headingDomId(slug);
          },
        },
      }),
    );
    expect(html.match(/<h2 /g)).toHaveLength(GUIDE.sections.length);
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(GUIDE.headings.map((h) => headingDomId(h.slug)));
    const sources = [...html.matchAll(/<img [^>]*src="([^"]+)"/g)].map((m) => m[1]);
    expect(sources).toHaveLength(nodes.filter((n) => n.type === 'image').length);
    for (const src of sources) expect(src).not.toMatch(/^(https?:)?\/\//);
    const links = [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toMatch(/^#\/guide(\/[a-z-]+)?$/);
  });
});
