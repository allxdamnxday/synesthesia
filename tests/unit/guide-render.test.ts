import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GuideImage } from '../../src/guide/images';
import { parseMarkdown, type Block } from '../../src/guide/markdown';
import { MarkdownBlocks, type MarkdownOptions } from '../../src/guide/MarkdownView';
import { guideLinkHref, outlineGuide } from '../../src/guide/sections';

const PICTURE: GuideImage = { url: '/assets/x.webp', width: 1280, height: 800 };

function render(markdown: string, options: Partial<MarkdownOptions> = {}): string {
  const blocks = parseMarkdown(markdown);
  const anchors = outlineGuide(blocks).anchors;
  return renderToStaticMarkup(
    createElement(MarkdownBlocks, {
      blocks,
      options: {
        resolveLink: (href) => guideLinkHref(href, anchors),
        resolveImage: (src) => (src === 'images/guide/x.png' ? PICTURE : null),
        ...options,
      },
    }),
  );
}

describe('guide renderer', () => {
  it('renders every block as elements', () => {
    const html = render(
      [
        '# Title',
        '',
        'Some **bold**, *italic* and `code`.  ',
        'Next line.',
        '',
        '> quoted',
        '',
        '---',
        '',
        '```',
        'a < b',
        '```',
      ].join('\n'),
    );
    expect(html).toContain('<h1');
    expect(html).toContain('<p>Some <strong>bold</strong>, <em>italic</em> and <code class="');
    expect(html).toContain('>code</code>.<br/>Next line.</p>');
    expect(html).toMatch(/<blockquote[^>]*><p>quoted<\/p><\/blockquote>/);
    expect(html).toMatch(/<hr[^>]*\/>/);
    expect(html).toMatch(/<pre[^>]*><code>a &lt; b<\/code><\/pre>/);
  });

  it('escapes everything: HTML in the guide shows as text', () => {
    const html = render(
      '<script>alert(1)</script>\n\n**<img src=x onerror=alert(1)>** `<b>` [<i>x</i>](#/settings)',
    );
    expect(html).not.toMatch(/<script|<img|<b>|<i>/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
    expect(html).toContain('<a href="#/settings">&lt;i&gt;x&lt;/i&gt;</a>');
  });

  it('links only to places in the app; other links keep just their words', () => {
    const html = render(
      [
        '## Keeping your work safe',
        '',
        'See [backups](#keeping-your-work-safe), [Settings](#/settings), [the guide](USER_GUIDE.md),',
        '[the checklist](docs/MAC_TEST_CHECKLIST.md), [a site](https://example.com),',
        '[mail](mailto:a@b.c), [bad](javascript:alert(1)) and [nowhere](#no-such-heading).',
      ].join('\n'),
    );
    expect(html).toContain('<a href="#/guide/backup">backups</a>');
    expect(html).toContain('<a href="#/settings">Settings</a>');
    expect(html).toContain('<a href="#/guide">the guide</a>');
    expect(html).toContain(' the checklist, a site, mail, bad and nowhere.');
    expect(html.match(/<a /g)).toHaveLength(3);
    expect(html).not.toMatch(/https?:|mailto:|javascript:/);
  });

  it('shows pictures lazily, at their size, with their description', () => {
    const html = render('![The Library](images/guide/x.png)');
    expect(html).toContain('<figure');
    expect(html).toMatch(
      /<img class="[^"]*" src="\/assets\/x.webp" alt="The Library" width="1280" height="800" loading="lazy" decoding="async"\/>/,
    );
    expect(html).not.toContain('<button');
  });

  it('makes a picture a button that opens it larger, when the page can', () => {
    const html = render('![The Library](images/guide/x.png)', { onZoom: () => {} });
    expect(html).toMatch(/<button type="button" class="[^"]*" aria-haspopup="dialog"><img /);
    expect(html).toContain('<span class="visually-hidden"> (show larger)</span></button>');
  });

  it('shows the description of a picture it doesn’t have, and loads nothing', () => {
    const html = render(
      '![A web picture](https://example.com/x.png)\n\n![](images/guide/missing.png)\n\nInline ![icon](https://e.com/i.png) here',
    );
    expect(html).not.toContain('<img');
    expect(html).toMatch(/<p class="[^"]*">A web picture<\/p>/);
    expect(html).toContain('<p>Inline icon here</p>');
  });

  it('renders tables with column and row headers, alignment, and labels for phones', () => {
    const html = render(
      '| Property | What you see | What you hear |\n|---|:-:|---|\n| Viscosity | Thick | Slow |',
    );
    expect(html).toContain('<th scope="col">Property</th>');
    expect(html).toContain('<th scope="col" style="text-align:center">What you see</th>');
    expect(html).toContain('<th scope="row">Viscosity</th>');
    expect(html).toContain('<td style="text-align:center" data-label="What you see">Thick</td>');
    expect(html).toContain('<td data-label="What you hear">Slow</td>');
    // Two columns stay a plain table (no phone labels).
    expect(render('| Key | Action |\n|---|---|\n| Space | Play |')).toContain('<td>Play</td>');
  });

  it('renders tight list items without paragraphs, loose ones with them', () => {
    expect(render('- one\n- two')).toMatch(/<ul[^>]*><li>one<\/li><li>two<\/li><\/ul>/);
    expect(render('- one\n\n- two')).toMatch(/<li><p>one<\/p><\/li><li><p>two<\/p><\/li>/);
    expect(render('3. three\n4. four')).toMatch(/<ol[^>]*start="3"/);
    expect(render('1. one')).not.toContain('start=');
  });

  it('gives section headings their ids, focusable for the reader’s jumps', () => {
    const blocks = parseMarkdown('## The Studio\n\ntext');
    const outline = outlineGuide(blocks);
    const html = renderToStaticMarkup(
      createElement(MarkdownBlocks, {
        blocks,
        options: {
          resolveLink: () => null,
          resolveImage: () => null,
          headingId: (block: Block) => {
            const slug = outline.slugOf.get(block);
            return slug ? `guide-${slug}` : undefined;
          },
        },
      }),
    );
    expect(html).toMatch(/<h2 id="guide-studio" tabindex="-1" class="[^"]*">The Studio<\/h2>/);
  });
});
