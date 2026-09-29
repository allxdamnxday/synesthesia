import { describe, expect, it } from 'vitest';
import {
  parseInline,
  parseMarkdown,
  plainText,
  type Block,
  type Inline,
} from '../../src/guide/markdown';

const t = (value: string): Inline => ({ type: 'text', value });
const strong = (...children: Inline[]): Inline => ({ type: 'strong', children });
const em = (...children: Inline[]): Inline => ({ type: 'emphasis', children });
const code = (value: string): Inline => ({ type: 'code', value });
const p = (...children: Inline[]): Block => ({ type: 'paragraph', children });

/** Every text value in a tree of blocks, for "nothing left over" checks. */
function texts(blocks: readonly Block[]): string[] {
  const out: string[] = [];
  const inline = (nodes: readonly Inline[]) => {
    for (const n of nodes) {
      if (n.type === 'text') out.push(n.value);
      else if (n.type === 'strong' || n.type === 'emphasis' || n.type === 'link') {
        inline(n.children);
      }
    }
  };
  for (const b of blocks) {
    if (b.type === 'heading' || b.type === 'paragraph') inline(b.children);
    else if (b.type === 'list') b.items.forEach((item) => out.push(...texts(item)));
    else if (b.type === 'blockquote') out.push(...texts(b.children));
    else if (b.type === 'table') [b.head, ...b.rows].flat().forEach(inline);
  }
  return out;
}

describe('guide markdown: blocks', () => {
  it('reads ATX headings of every level, without closing hashes or spaces', () => {
    const blocks = parseMarkdown('# One\n## Two ##\n###   Three   \n#### Four\n##### 5\n###### 6');
    expect(
      blocks.map((b) => (b.type === 'heading' ? [b.depth, plainText(b.children)] : b)),
    ).toEqual([
      [1, 'One'],
      [2, 'Two'],
      [3, 'Three'],
      [4, 'Four'],
      [5, '5'],
      [6, '6'],
    ]);
    // Not headings: no space after the hashes, or seven of them.
    expect(parseMarkdown('#hashtag\n\n####### seven')).toEqual([
      p(t('#hashtag')),
      p(t('####### seven')),
    ]);
  });

  it('reads setext headings', () => {
    expect(parseMarkdown('Title\n=====\n\nSub\n---')).toEqual([
      { type: 'heading', depth: 1, children: [t('Title')] },
      { type: 'heading', depth: 2, children: [t('Sub')] },
    ]);
  });

  it('joins a paragraph’s lines with spaces and splits paragraphs at blank lines', () => {
    expect(parseMarkdown('one\n  two\nthree\n\n\nfour')).toEqual([
      p(t('one two three')),
      p(t('four')),
    ]);
  });

  it('reads bullet lists with indented and lazy continuation lines', () => {
    const [list] = parseMarkdown('- **New** starts\n  a signature.\n- Two\nlazy line\n+ other');
    expect(list).toEqual({
      type: 'list',
      ordered: false,
      start: 1,
      tight: true,
      items: [[p(strong(t('New')), t(' starts a signature.'))], [p(t('Two lazy line'))]],
    });
    // A different bullet starts a new list.
    expect(parseMarkdown('- a\n+ b').map((b) => b.type)).toEqual(['list', 'list']);
  });

  it('reads numbered lists, their start number and either delimiter', () => {
    const [list] = parseMarkdown('3. three\n   more\n4. four');
    expect(list).toMatchObject({ type: 'list', ordered: true, start: 3, tight: true });
    expect(list.type === 'list' && list.items).toEqual([[p(t('three more'))], [p(t('four'))]]);
    expect(parseMarkdown('1) a\n2) b')[0]).toMatchObject({ ordered: true, start: 1 });
    // A number inside a paragraph doesn't start a list, unless it's 1.
    expect(parseMarkdown('The year\n2026. was')).toEqual([p(t('The year 2026. was'))]);
    expect(parseMarkdown('Steps\n1. one').map((b) => b.type)).toEqual(['paragraph', 'list']);
  });

  it('nests lists by indentation', () => {
    const [list] = parseMarkdown('- a\n  - b\n    more b\n  - c\n- d');
    expect(list).toEqual({
      type: 'list',
      ordered: false,
      start: 1,
      tight: true,
      items: [
        [
          p(t('a')),
          {
            type: 'list',
            ordered: false,
            start: 1,
            tight: true,
            items: [[p(t('b more b'))], [p(t('c'))]],
          },
        ],
        [p(t('d'))],
      ],
    });
  });

  it('tells loose lists from tight ones', () => {
    expect(parseMarkdown('- a\n\n- b')[0]).toMatchObject({ tight: false });
    expect(parseMarkdown('- a\n\n  more a\n- b')[0]).toMatchObject({ tight: false });
    expect(parseMarkdown('- a\n- b\n\nAfter')[0]).toMatchObject({ tight: true });
  });

  it('ends a list at an unindented picture or paragraph (the guide does this)', () => {
    const blocks = parseMarkdown('- one\n- two\n\n![A picture](images/guide/x.png)\n\n- three');
    expect(blocks.map((b) => b.type)).toEqual(['list', 'paragraph', 'list']);
    expect(blocks[1]).toEqual(p({ type: 'image', src: 'images/guide/x.png', alt: 'A picture' }));
  });

  it('reads pipe tables with alignment, escaped pipes and ragged rows', () => {
    const [table] = parseMarkdown(
      '| Key | Action | Note |\n|:---|---:|:-:|\n| `a\\|b` | **Undo** |\n| x | y | z | extra |\nAfter',
    );
    expect(table).toEqual({
      type: 'table',
      align: ['left', 'right', 'center'],
      head: [[t('Key')], [t('Action')], [t('Note')]],
      rows: [
        [[code('a|b')], [strong(t('Undo'))], []],
        [[t('x')], [t('y')], [t('z')]],
        [[t('After')], [], []],
      ],
    });
    // Without leading pipes too; a lone line with pipes is just text.
    expect(parseMarkdown('a | b\n--- | ---\n1 | 2')[0]).toMatchObject({ type: 'table' });
    expect(parseMarkdown('a | b')[0]).toEqual(p(t('a | b')));
    // The delimiter row must match the header's cells.
    expect(parseMarkdown('| a | b |\n|---|')[0]).toMatchObject({ type: 'paragraph' });
  });

  it('reads block quotes with blocks inside and lazy lines', () => {
    expect(parseMarkdown('> **Note:** one\ntwo\n>\n> - item')).toEqual([
      {
        type: 'blockquote',
        children: [
          p(strong(t('Note:')), t(' one two')),
          { type: 'list', ordered: false, start: 1, tight: true, items: [[p(t('item'))]] },
        ],
      },
    ]);
  });

  it('keeps fenced code as it is, closed or not', () => {
    expect(parseMarkdown('```sh\nnpm run dev\n  **not bold**\n```\nafter')).toEqual([
      { type: 'code', lang: 'sh', value: 'npm run dev\n  **not bold**' },
      p(t('after')),
    ]);
    expect(parseMarkdown('~~~\nopen <b>')).toEqual([{ type: 'code', lang: '', value: 'open <b>' }]);
  });

  it('reads thematic breaks, which are not list items', () => {
    expect(parseMarkdown('a\n\n---\n\n* * *\n\n___')).toEqual([
      p(t('a')),
      { type: 'rule' },
      { type: 'rule' },
      { type: 'rule' },
    ]);
  });

  it('copes with Windows line ends, tabs and a byte-order mark', () => {
    expect(parseMarkdown('﻿# Title\r\n\r\n-\tone\r\n')).toEqual([
      { type: 'heading', depth: 1, children: [t('Title')] },
      { type: 'list', ordered: false, start: 1, tight: true, items: [[p(t('one'))]] },
    ]);
  });
});

describe('guide markdown: inline', () => {
  it('reads bold, italic and both, with asterisks or underscores', () => {
    expect(parseInline('**bold** and *it* and ***both*** and __b__ _i_')).toEqual([
      strong(t('bold')),
      t(' and '),
      em(t('it')),
      t(' and '),
      em(strong(t('both'))),
      t(' and '),
      strong(t('b')),
      t(' '),
      em(t('i')),
    ]);
    expect(parseInline('**outer *inner* outer**')).toEqual([
      strong(t('outer '), em(t('inner')), t(' outer')),
    ]);
  });

  it('follows CommonMark’s flanking rules', () => {
    // Punctuation next to the delimiters, as in the guide.
    expect(parseInline('choose **Choose a clip…**. Short')).toEqual([
      t('choose '),
      strong(t('Choose a clip…')),
      t('. Short'),
    ]);
    expect(parseInline('(**energy**)')).toEqual([t('('), strong(t('energy')), t(')')]);
    // Underscores inside words stay; spaces inside the delimiters don't emphasise.
    expect(parseInline('ALBUM_LOG_FILE and snake_case')).toEqual([
      t('ALBUM_LOG_FILE and snake_case'),
    ]);
    expect(parseInline('a * b * c')).toEqual([t('a * b * c')]);
    expect(parseInline('2*3*4')).toEqual([t('2'), em(t('3')), t('4')]);
  });

  it('reads code spans, trimming one space and ignoring markup inside', () => {
    expect(parseInline('see `docs/DECISIONS.md` and `` a`b `` and ` **x** `')).toEqual([
      t('see '),
      code('docs/DECISIONS.md'),
      t(' and '),
      code('a`b'),
      t(' and '),
      code('**x**'),
    ]);
    expect(parseInline('an `unclosed span')).toEqual([t('an `unclosed span')]);
  });

  it('reads links and images, with titles, angle brackets and parentheses', () => {
    expect(parseInline('[the **guide**](#keeping-your-work-safe "Title") x')).toEqual([
      {
        type: 'link',
        href: '#keeping-your-work-safe',
        children: [t('the '), strong(t('guide'))],
      },
      t(' x'),
    ]);
    expect(parseInline('![A *wink*](<images/guide/a b.png>)')).toEqual([
      { type: 'image', src: 'images/guide/a b.png', alt: 'A wink' },
    ]);
    expect(parseInline('[w](https://en.wikipedia.org/wiki/Wake_(physics))')).toEqual([
      {
        type: 'link',
        href: 'https://en.wikipedia.org/wiki/Wake_(physics)',
        children: [t('w')],
      },
    ]);
    // A `]` inside code doesn't end the text.
    expect(parseInline('[`a]`](x)')).toEqual([{ type: 'link', href: 'x', children: [code('a]')] }]);
  });

  it('keeps links from nesting', () => {
    expect(parseInline('[outer [inner](a) text](b)')).toEqual([
      { type: 'link', href: 'b', children: [t('outer inner text')] },
    ]);
  });

  it('turns backslash escapes into text and line ends into spaces or breaks', () => {
    expect(parseInline('\\*not\\* \\[x\\] \\\\ \\a')).toEqual([t('*not* [x] \\ \\a')]);
    expect(parseInline('one\ntwo  \nthree\\\nfour')).toEqual([
      t('one two'),
      { type: 'break' },
      t('three'),
      { type: 'break' },
      t('four'),
    ]);
  });

  it('leaves unmatched delimiters and brackets as text', () => {
    expect(parseInline('**open and *half')).toEqual([t('**open and *half')]);
    expect(parseInline('[no link] and [broken](x and ![alt]')).toEqual([
      t('[no link] and [broken](x and ![alt]'),
    ]);
  });

  it('gives the plain words of formatted text', () => {
    expect(plainText(parseInline('**Keys** (in the `Studio`)![pic](x.png)'))).toBe(
      'Keys (in the Studio)pic',
    );
  });
});

describe('guide markdown: anything else is text', () => {
  it('shows HTML as text, never as markup', () => {
    const blocks = parseMarkdown(
      '<div class="x">\n<script>alert(1)</script>\n</div>\n\nA <b>bold</b> <img src=x onerror=alert(1)>',
    );
    expect(blocks).toEqual([
      p(t('<div class="x"> <script>alert(1)</script> </div>')),
      p(t('A <b>bold</b> <img src=x onerror=alert(1)>')),
    ]);
  });

  it('keeps reference links, footnotes, strikethrough, task boxes, autolinks and entities', () => {
    const source = [
      '[ref][1] and [^note] and ~~gone~~ and <https://example.com> and &amp;',
      '',
      '[1]: https://example.com',
      '',
      '- [ ] task',
    ].join('\n');
    const words = texts(parseMarkdown(source)).join('|');
    expect(words).toBe(
      '[ref][1] and [^note] and ~~gone~~ and <https://example.com> and &amp;|' +
        '[1]: https://example.com|[ ] task',
    );
  });

  it('never throws, whatever it is given', () => {
    // A small deterministic generator: strings built from Markdown's special characters.
    let seed = 12345;
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed;
    };
    const pieces = ['*', '**', '_', '`', '``', '[', ']', '(', ')', '!', '#', '> ', '- ', '1. '];
    const more = ['|', '---', '\n', '\n\n', '  ', '\\', 'a', 'word ', '<b>', '~~~', '```', ':'];
    const alphabet = [...pieces, ...more];
    for (let n = 0; n < 2000; n++) {
      let s = '';
      const length = next() % 40;
      for (let i = 0; i < length; i++) s += alphabet[next() % alphabet.length];
      expect(() => parseMarkdown(s)).not.toThrow();
    }
  });
});
