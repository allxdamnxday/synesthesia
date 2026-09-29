import { describe, expect, it } from 'vitest';
import { guideImage } from '../../src/guide/images';
import { parseMarkdown } from '../../src/guide/markdown';
import {
  githubAnchor,
  guideLinkHref,
  guidePath,
  headingDomId,
  linkTarget,
  outlineGuide,
} from '../../src/guide/sections';

const DOC = [
  '# Synesthesia: a guide',
  '',
  'Intro text.',
  '',
  '## The Studio',
  '',
  'Studio text.',
  '',
  '### Draw by chance',
  '',
  '#### Small print',
  '',
  '## A new section (draft)',
  '',
  '## Notes',
  '',
  '## Notes',
].join('\n');

describe('guide sections', () => {
  it('makes GitHub’s heading anchors', () => {
    expect(githubAnchor('Making a signature (Prepare)')).toBe('making-a-signature-prepare');
    expect(githubAnchor('Keys (in the Studio)')).toBe('keys-in-the-studio');
    expect(githubAnchor('Synesthesia: a guide')).toBe('synesthesia-a-guide');
    expect(githubAnchor('Café & “quotes” — 2')).toBe('café--quotes--2');
  });

  it('splits the guide into an introduction and sections with sub-sections', () => {
    const outline = outlineGuide(parseMarkdown(DOC));
    expect(outline.intro.map((b) => b.type)).toEqual(['heading', 'paragraph']);
    expect(
      outline.sections.map((s) => [s.slug, s.title, s.blocks.length, s.subsections.length]),
    ).toEqual([
      ['studio', 'The Studio', 4, 1],
      ['a-new-section-draft', 'A new section (draft)', 1, 0],
      ['notes', 'Notes', 1, 0],
      ['notes-2', 'Notes', 1, 0],
    ]);
    expect(outline.sections[0].subsections).toEqual([
      { slug: 'chance', title: 'Draw by chance', depth: 3 },
    ]);
    expect(outline.headings.map((h) => h.slug)).toEqual([
      'studio',
      'chance',
      'a-new-section-draft',
      'notes',
      'notes-2',
    ]);
    // Each ##/### heading block knows its slug; the title and deeper headings don't have one.
    const slugged = [...outline.slugOf.values()];
    expect(slugged).toEqual(outline.headings.map((h) => h.slug));
  });

  it('maps GitHub anchors to sections, numbering repeats as GitHub does', () => {
    const { anchors } = outlineGuide(parseMarkdown(DOC));
    expect(Object.fromEntries(anchors)).toEqual({
      'synesthesia-a-guide': null,
      'the-studio': 'studio',
      'draw-by-chance': 'chance',
      'small-print': 'studio',
      'a-new-section-draft': 'a-new-section-draft',
      notes: 'notes',
      'notes-1': 'notes-2',
    });
  });

  it('sends links to the guide, to app screens, or nowhere', () => {
    const { anchors } = outlineGuide(parseMarkdown(DOC));
    expect(linkTarget('#the-studio', anchors)).toEqual({ kind: 'guide', slug: 'studio' });
    expect(linkTarget('#The-Studio', anchors)).toEqual({ kind: 'guide', slug: 'studio' });
    expect(linkTarget('USER_GUIDE.md#draw-by-chance', anchors)).toEqual({
      kind: 'guide',
      slug: 'chance',
    });
    expect(linkTarget('./docs/USER_GUIDE.md', anchors)).toEqual({ kind: 'guide', slug: null });
    expect(linkTarget('#synesthesia-a-guide', anchors)).toEqual({ kind: 'guide', slug: null });
    expect(linkTarget('#/settings', anchors)).toEqual({ kind: 'app', path: '/settings' });
    for (const other of [
      '#missing',
      '#%E0%A4%A',
      'docs/MAC_TEST_CHECKLIST.md',
      'MAC_TEST_CHECKLIST.md#a',
      'images/guide/studio.png',
      'https://example.com/#the-studio',
      '//example.com',
      'mailto:a@b.c',
      'javascript:alert(1)',
      '',
    ]) {
      expect(linkTarget(other, anchors), other).toEqual({ kind: 'text' });
    }
    expect(guideLinkHref('#the-studio', anchors)).toBe('#/guide/studio');
    expect(guideLinkHref('USER_GUIDE.md', anchors)).toBe('#/guide');
    expect(guideLinkHref('#/diagnostics', anchors)).toBe('#/diagnostics');
    expect(guideLinkHref('https://example.com', anchors)).toBeNull();
  });

  it('builds addresses and ids', () => {
    expect(guidePath()).toBe('/guide');
    expect(guidePath('albums')).toBe('/guide/albums');
    expect(headingDomId('albums')).toBe('guide-albums');
  });

  it('finds bundled pictures by the guide’s own paths only', () => {
    const picture = guideImage('images/guide/studio.png');
    expect(picture).toMatchObject({ width: 1280, height: 800 });
    expect(picture?.url).toMatch(/studio.*\.webp/);
    expect(guideImage('./images/guide/studio.png')).toEqual(picture);
    expect(guideImage('docs/images/guide/studio.png')).toEqual(picture);
    expect(guideImage('images/guide/nope.png')).toBeNull();
    expect(guideImage('https://example.com/images/guide/studio.png')).toBeNull();
    expect(guideImage('__proto__')).toBeNull();
  });
});
