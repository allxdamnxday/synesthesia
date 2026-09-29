import { href } from '../app/router';
import { plainText, type Block } from './markdown';

/**
 * Stable addresses for the guide's sections: `#/guide/<slug>`, e.g. `href(guidePath('studio'))`.
 * Keyed by slug, with the heading (as written in docs/USER_GUIDE.md) each one points at.
 * `##` headings are sections; the `###` ones listed here are sub-sections inside them.
 *
 * Rewording a heading in the guide only needs its title updated here, so links elsewhere in
 * the app keep working; a unit test fails until every `##` and `###` heading is listed.
 */
export const GUIDE_SECTIONS = {
  idea: 'The idea',
  'before-you-start': 'Before you start',
  library: 'The Library',
  prepare: 'Making a signature (Prepare)',
  studio: 'The Studio',
  chance: 'Draw by chance',
  render: 'Rendering a video',
  albums: 'Albums',
  settings: 'Settings',
  backup: 'Keeping your work safe',
  trouble: 'If something goes wrong',
  reference: 'Quick reference',
  'shared-properties': 'Shared properties',
  keys: 'Keys (in the Studio)',
} as const satisfies Record<string, string>;

export type GuideSectionSlug = keyof typeof GUIDE_SECTIONS;

/** The router path for the guide, or for one of its sections. */
export function guidePath(section?: GuideSectionSlug): string {
  return section ? `/guide/${section}` : '/guide';
}

/** The DOM id of a section's heading (ids are prefixed so they never clash with others). */
export function headingDomId(slug: string): string {
  return `guide-${slug}`;
}

/**
 * The anchor GitHub gives a heading (`Keeping your work safe` → `keeping-your-work-safe`), so
 * `[…](#keeping-your-work-safe)` links written for GitHub work in the app too. Also the slug
 * of a heading that isn't in GUIDE_SECTIONS.
 */
export function githubAnchor(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

export interface GuideHeading {
  slug: string;
  title: string;
  depth: 2 | 3;
}

export interface GuideSection extends GuideHeading {
  depth: 2;
  /** The section's blocks, starting with its heading. */
  blocks: Block[];
  subsections: GuideHeading[];
}

export interface GuideOutline {
  /** Everything before the first `##` heading: the title, the dedication line, a picture. */
  intro: Block[];
  sections: GuideSection[];
  /** Every `##` and `###` heading in order (for the contents and for following the reader). */
  headings: GuideHeading[];
  /** Section slug for each `##` and `###` heading block. */
  slugOf: ReadonlyMap<Block, string>;
  /** GitHub-style anchors of all headings → slug (null: the top of the guide). */
  anchors: ReadonlyMap<string, string | null>;
}

const SLUG_BY_TITLE: ReadonlyMap<string, string> = new Map(
  Object.entries(GUIDE_SECTIONS).map(([slug, title]) => [title, slug]),
);

/** Split a parsed guide into its sections and give every `##`/`###` heading its slug. */
export function outlineGuide(blocks: readonly Block[]): GuideOutline {
  const intro: Block[] = [];
  const sections: GuideSection[] = [];
  const headings: GuideHeading[] = [];
  const slugOf = new Map<Block, string>();
  const anchors = new Map<string, string | null>();
  const used = new Set<string>();
  const anchorCounts = new Map<string, number>();

  for (const block of blocks) {
    if (block.type === 'heading') {
      const title = plainText(block.children).trim();
      // GitHub numbers repeated anchors: `notes`, `notes-1`, `notes-2`.
      const base = githubAnchor(title);
      const seen = anchorCounts.get(base) ?? 0;
      anchorCounts.set(base, seen + 1);
      const anchor = seen === 0 ? base : `${base}-${seen}`;

      if (block.depth === 2 || block.depth === 3) {
        const wanted = SLUG_BY_TITLE.get(title) ?? (base || 'section');
        let slug = wanted;
        for (let n = 2; used.has(slug); n++) slug = `${wanted}-${n}`;
        used.add(slug);
        slugOf.set(block, slug);
        anchors.set(anchor, slug);
        const heading: GuideHeading = { slug, title, depth: block.depth };
        headings.push(heading);
        if (block.depth === 2) {
          sections.push({ slug, title, depth: 2, blocks: [block], subsections: [] });
          continue;
        }
        sections[sections.length - 1]?.subsections.push(heading);
      } else if (!anchors.has(anchor)) {
        // Other headings: the h1 title leads to the top; deeper ones to their section.
        anchors.set(
          anchor,
          block.depth === 1 ? null : (sections[sections.length - 1]?.slug ?? null),
        );
      }
    }
    const current = sections[sections.length - 1];
    if (current) current.blocks.push(block);
    else intro.push(block);
  }
  return { intro, sections, headings, slugOf, anchors };
}

export type LinkTarget =
  { kind: 'guide'; slug: string | null } | { kind: 'app'; path: string } | { kind: 'text' };

/**
 * Where a link in the guide goes in the app:
 * - `#keeping-your-work-safe` (or `USER_GUIDE.md#…`): that section of the guide;
 * - `USER_GUIDE.md`: the top of the guide;
 * - `#/settings` and other app paths: that screen;
 * - anything else (other repository files, web addresses): nothing. The site has no copy of
 *   other documents and makes no network requests, so the link's words show as plain text.
 */
export function linkTarget(href: string, anchors: ReadonlyMap<string, string | null>): LinkTarget {
  const target = href.trim();
  if (target.startsWith('#/')) return { kind: 'app', path: target.slice(1) };
  const guide = /^(?:(?:\.\/)?(?:docs\/)?USER_GUIDE\.md)?(?:#(.*))?$/i.exec(target);
  if (!guide || target === '') return { kind: 'text' };
  const fragment = guide[1];
  if (fragment === undefined || fragment === '') return { kind: 'guide', slug: null };
  let anchor = fragment;
  try {
    anchor = decodeURIComponent(fragment);
  } catch {
    // A malformed escape: look the fragment up as written.
  }
  const slug = anchors.get(anchor.toLowerCase());
  return slug === undefined ? { kind: 'text' } : { kind: 'guide', slug };
}

/** The address a link in the guide opens in the app (`#/guide/backup`), or null for plain text. */
export function guideLinkHref(
  target: string,
  anchors: ReadonlyMap<string, string | null>,
): string | null {
  const link = linkTarget(target, anchors);
  if (link.kind === 'guide') return href(link.slug === null ? '/guide' : `/guide/${link.slug}`);
  if (link.kind === 'app') return href(link.path);
  return null;
}
