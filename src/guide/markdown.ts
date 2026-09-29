/**
 * A small Markdown parser for the in-app guide (docs/USER_GUIDE.md), so the page and the file
 * never drift and no Markdown dependency is needed (see docs/DECISIONS.md).
 *
 * It covers what the guide uses, plus the few things an edit is likely to add: ATX and setext
 * headings, paragraphs, bold and italic, inline code, links, images, hard line breaks, bullet
 * and numbered lists (nested), pipe tables, block quotes, fenced code and thematic breaks.
 * Anything else (HTML, reference links, footnotes, …) stays as plain text. The result is a
 * plain tree: the renderer builds React elements from it, so markup in the source can only
 * ever show up as text.
 */

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'emphasis'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'break' };

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { type: 'heading'; depth: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; tight: boolean; items: Block[][] }
  | { type: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { type: 'blockquote'; children: Block[] }
  | { type: 'code'; lang: string; value: string }
  | { type: 'rule' };

// ---------------------------------------------------------------------------------------
// Blocks

const BLANK = /^[ \t]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const LIST_MARKER = /^( {0,3})([-+*]|\d{1,9}[.)])( +|$)(.*)$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

interface Marker {
  ordered: boolean;
  /** `-`, `+`, `*` for bullets; `.` or `)` for numbers. A different one starts a new list. */
  symbol: string;
  start: number;
  /** Column where the item's content starts; continuation lines are indented this far. */
  offset: number;
  content: string;
}

function listMarker(line: string): Marker | null {
  if (RULE.test(line)) return null;
  const m = LIST_MARKER.exec(line);
  if (!m) return null;
  const [, indent = '', marker = '', spaces = '', rest = ''] = m;
  const ordered = marker.length > 1 || /\d/.test(marker);
  const markerEnd = indent.length + marker.length;
  // An empty item, or content indented 5+ spaces, starts one column after the marker.
  const pad = rest === '' || spaces.length > 4 ? 1 : spaces.length;
  return {
    ordered,
    symbol: ordered ? marker.slice(-1) : marker,
    start: ordered ? Number.parseInt(marker, 10) : 1,
    offset: markerEnd + pad,
    content: line.slice(Math.min(line.length, markerEnd + pad)),
  };
}

function indentOf(line: string): number {
  return /^ */.exec(line)?.[0].length ?? 0;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (c === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += c;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function hasUnescapedPipe(line: string): boolean {
  return /(^|[^\\])\|/.test(line);
}

function isTableStart(lines: readonly string[], i: number): boolean {
  const header = lines[i];
  const delimiter = lines[i + 1];
  if (header === undefined || delimiter === undefined) return false;
  if (!hasUnescapedPipe(header) || !delimiter.includes('|') || !TABLE_DELIMITER.test(delimiter)) {
    return false;
  }
  return splitRow(header).length === splitRow(delimiter).length;
}

/** Whether a line starts a block that ends a paragraph (or a lazy continuation). */
function interrupts(line: string): boolean {
  if (ATX.test(line) || RULE.test(line) || FENCE.test(line) || QUOTE.test(line)) return true;
  const marker = listMarker(line);
  // As in CommonMark: an empty item, or a numbered one not starting at 1, can't interrupt.
  return marker !== null && marker.content.trim() !== '' && (!marker.ordered || marker.start === 1);
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

function parseTable(lines: readonly string[], start: number): [Block, number] {
  const head = splitRow(lines[start]);
  const align = splitRow(lines[start + 1]).map(alignOf);
  const rows: Inline[][][] = [];
  let i = start + 2;
  while (i < lines.length && !BLANK.test(lines[i]) && !interrupts(lines[i])) {
    const cells = splitRow(lines[i]);
    rows.push(head.map((_, c) => parseInline(cells[c] ?? '')));
    i++;
  }
  return [{ type: 'table', align, head: head.map((cell) => parseInline(cell)), rows }, i];
}

function parseFence(lines: readonly string[], start: number): [Block, number] | null {
  const m = FENCE.exec(lines[start]);
  if (!m) return null;
  const [, indent = '', fence = '', info = ''] = m;
  if (fence.startsWith('`') && info.includes('`')) return null;
  const closing = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length && !closing.test(lines[i])) {
    const line = lines[i];
    body.push(line.slice(Math.min(indent.length, indentOf(line))));
    i++;
  }
  const lang = info.trim().split(/\s+/)[0] ?? '';
  // An unclosed fence runs to the end of the document, as in CommonMark.
  return [{ type: 'code', lang, value: body.join('\n') }, Math.min(lines.length, i + 1)];
}

function parseQuote(lines: readonly string[], start: number): [Block, number] {
  const inner: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    const m = QUOTE.exec(line);
    if (m) {
      inner.push(m[1] ?? '');
    } else if (
      !BLANK.test(line) &&
      inner.length > 0 &&
      !BLANK.test(inner[inner.length - 1]) &&
      !interrupts(line)
    ) {
      inner.push(line); // lazy continuation of a quoted paragraph
    } else {
      break;
    }
    i++;
  }
  return [{ type: 'blockquote', children: parseBlocks(inner) }, i];
}

function parseList(lines: readonly string[], start: number): [Block, number] {
  const first = listMarker(lines[start]);
  if (!first) throw new Error('parseList needs a list item');
  const items: Block[][] = [];
  let loose = false;
  let i = start;
  while (i < lines.length) {
    const marker = listMarker(lines[i]);
    if (!marker || marker.ordered !== first.ordered || marker.symbol !== first.symbol) break;
    const itemLines = [marker.content];
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j];
      const previous = itemLines[itemLines.length - 1];
      if (BLANK.test(line)) {
        itemLines.push('');
      } else if (indentOf(line) >= marker.offset) {
        itemLines.push(line.slice(marker.offset));
      } else if (
        !BLANK.test(previous) &&
        !FENCE.test(previous) &&
        !interrupts(line) &&
        !listMarker(line) &&
        !SETEXT.test(line)
      ) {
        itemLines.push(line.trimStart()); // lazy continuation of the item's paragraph
      } else {
        break;
      }
      j++;
    }
    let trailingBlank = false;
    while (itemLines.length > 1 && BLANK.test(itemLines[itemLines.length - 1])) {
      itemLines.pop();
      trailingBlank = true;
    }
    const children = parseBlocks(itemLines);
    const innerBlank = itemLines.some((l, k) => k > 0 && BLANK.test(l));
    if (innerBlank && children.length > 1) loose = true;
    items.push(children);
    i = j;
    if (trailingBlank) {
      const next = i < lines.length ? listMarker(lines[i]) : null;
      if (next && next.ordered === first.ordered && next.symbol === first.symbol) loose = true;
      else break;
    }
  }
  return [{ type: 'list', ordered: first.ordered, start: first.start, tight: !loose, items }, i];
}

function parseParagraph(lines: readonly string[], start: number): [Block, number] {
  const text: string[] = [lines[start].trimStart()];
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (BLANK.test(line)) break;
    const setext = SETEXT.exec(line);
    if (setext) {
      const depth = setext[1]?.startsWith('=') ? 1 : 2;
      return [{ type: 'heading', depth, children: parseInline(text.join('\n').trim()) }, i + 1];
    }
    if (interrupts(line) || isTableStart(lines, i)) break;
    text.push(line.trimStart());
    i++;
  }
  return [{ type: 'paragraph', children: parseInline(text.join('\n').trim()) }, i];
}

function parseBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (BLANK.test(line)) {
      i++;
      continue;
    }
    const fence = parseFence(lines, i);
    if (fence) {
      blocks.push(fence[0]);
      i = fence[1];
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      const depth = (atx[1]?.length ?? 1) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', depth, children: parseInline(atx[2] ?? '') });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }
    let result: [Block, number];
    if (QUOTE.test(line)) result = parseQuote(lines, i);
    else if (listMarker(line)) result = parseList(lines, i);
    else if (isTableStart(lines, i)) result = parseTable(lines, i);
    else result = parseParagraph(lines, i);
    blocks.push(result[0]);
    i = result[1];
  }
  return blocks;
}

/** Parse a Markdown document into blocks. Never throws; unknown syntax becomes text. */
export function parseMarkdown(source: string): Block[] {
  const lines = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\t/g, '    '));
  return parseBlocks(lines);
}

// ---------------------------------------------------------------------------------------
// Inlines

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const WHITESPACE = /\s/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;

interface TextNode {
  type: 'text';
  value: string;
}

interface Delimiter {
  node: TextNode;
  char: '*' | '_';
  length: number;
  originalLength: number;
  canOpen: boolean;
  canClose: boolean;
}

function runLength(s: string, i: number, char: string): number {
  let n = 0;
  while (s[i + n] === char) n++;
  return n;
}

/** Whether a run of `*` or `_` can open and/or close emphasis (CommonMark's flanking rules). */
function flanking(char: '*' | '_', before: string, after: string) {
  const beforeSpace = WHITESPACE.test(before);
  const afterSpace = WHITESPACE.test(after);
  const beforePunct = PUNCTUATION.test(before);
  const afterPunct = PUNCTUATION.test(after);
  const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
  const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
  if (char === '*') return { canOpen: left, canClose: right };
  return { canOpen: left && (!right || beforePunct), canClose: right && (!left || afterPunct) };
}

/** Where the backtick run closing a code span of `length` backticks starts, or -1. */
function codeSpanEnd(s: string, from: number, length: number): number {
  let i = from;
  while (i < s.length) {
    if (s[i] === '`') {
      const run = runLength(s, i, '`');
      if (run === length) return i;
      i += run;
    } else {
      i++;
    }
  }
  return -1;
}

interface LinkParts {
  label: string;
  destination: string;
  end: number;
}

/** Parse `[label](destination "title")` starting at the `[` at `start`, or null. */
function linkAt(s: string, start: number): LinkParts | null {
  let depth = 0;
  let i = start;
  let close = -1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') {
      const run = runLength(s, i, '`');
      const end = codeSpanEnd(s, i + run, run);
      i = end === -1 ? i + run : end + run;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
    i++;
  }
  if (close === -1 || s[close + 1] !== '(') return null;
  i = close + 2;
  while (s[i] === ' ' || s[i] === '\n') i++;
  let destination: string;
  if (s[i] === '<') {
    const end = s.indexOf('>', i + 1);
    if (end === -1 || s.slice(i + 1, end).includes('\n')) return null;
    destination = s.slice(i + 1, end);
    i = end + 1;
  } else {
    let parens = 0;
    const from = i;
    while (i < s.length && !/\s/.test(s[i])) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) {
        i += 2;
        continue;
      }
      if (c === '(') parens++;
      else if (c === ')') {
        if (parens === 0) break;
        parens--;
      }
      i++;
    }
    destination = s.slice(from, i).replace(/\\([!-/:-@[-`{-~])/g, '$1');
  }
  while (s[i] === ' ' || s[i] === '\n') i++;
  const quote = s[i];
  if (quote === '"' || quote === "'" || quote === '(') {
    const closer = quote === '(' ? ')' : quote;
    const end = s.indexOf(closer, i + 1);
    if (end === -1) return null;
    i = end + 1;
    while (s[i] === ' ' || s[i] === '\n') i++;
  }
  if (s[i] !== ')') return null;
  return { label: s.slice(start + 1, close), destination, end: i + 1 };
}

/** Links can't contain links: keep an inner link's text. */
function withoutLinks(nodes: Inline[]): Inline[] {
  return nodes.flatMap((node): Inline[] => {
    if (node.type === 'link') return withoutLinks(node.children);
    if (node.type === 'strong' || node.type === 'emphasis') {
      return [{ ...node, children: withoutLinks(node.children) }];
    }
    return [node];
  });
}

function processEmphasis(nodes: Inline[], delimiters: Delimiter[]): void {
  let c = 0;
  while (c < delimiters.length) {
    const closer = delimiters[c];
    if (!closer.canClose) {
      c++;
      continue;
    }
    let o = c - 1;
    for (; o >= 0; o--) {
      const opener = delimiters[o];
      if (opener.char !== closer.char || !opener.canOpen) continue;
      // The "rule of three" keeps `*a**b*`-style runs from pairing up wrongly.
      const both = opener.canClose || closer.canOpen;
      const sum = opener.originalLength + closer.originalLength;
      const multipleOf3 = opener.originalLength % 3 === 0 && closer.originalLength % 3 === 0;
      if (!(both && sum % 3 === 0 && !multipleOf3)) break;
    }
    if (o < 0) {
      if (closer.canOpen) c++;
      else delimiters.splice(c, 1);
      continue;
    }
    const opener = delimiters[o];
    const use = opener.length >= 2 && closer.length >= 2 ? 2 : 1;
    const from = nodes.indexOf(opener.node);
    const to = nodes.indexOf(closer.node);
    const children = nodes.slice(from + 1, to);
    nodes.splice(
      from + 1,
      to - from - 1,
      use === 2 ? { type: 'strong', children } : { type: 'emphasis', children },
    );
    opener.length -= use;
    opener.node.value = opener.node.value.slice(use);
    closer.length -= use;
    closer.node.value = closer.node.value.slice(use);
    // Delimiters between the pair can no longer match anything outside it.
    delimiters.splice(o + 1, c - o - 1);
    c = o + 1;
    if (opener.length === 0) {
      nodes.splice(nodes.indexOf(opener.node), 1);
      delimiters.splice(o, 1);
      c--;
    }
    if (closer.length === 0) {
      nodes.splice(nodes.indexOf(closer.node), 1);
      delimiters.splice(c, 1);
    }
  }
}

/** Merge neighbouring text and drop empty text, all the way down. */
function tidy(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.value === '') continue;
      const last = out[out.length - 1];
      if (last?.type === 'text') {
        out[out.length - 1] = { type: 'text', value: last.value + node.value };
        continue;
      }
      out.push({ type: 'text', value: node.value });
    } else if (node.type === 'strong' || node.type === 'emphasis' || node.type === 'link') {
      out.push({ ...node, children: tidy(node.children) });
    } else {
      out.push(node);
    }
  }
  return out;
}

/** Parse the inline content of a block (text with emphasis, code, links, images). */
export function parseInline(source: string): Inline[] {
  const nodes: Inline[] = [];
  const delimiters: Delimiter[] = [];
  let text = '';
  const flush = () => {
    if (text !== '') nodes.push({ type: 'text', value: text });
    text = '';
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      const next = source[i + 1];
      if (next === '\n') {
        flush();
        nodes.push({ type: 'break' });
        i += 2;
      } else if (next !== undefined && ASCII_PUNCTUATION.test(next)) {
        text += next;
        i += 2;
      } else {
        text += c;
        i++;
      }
      continue;
    }
    if (c === '`') {
      const run = runLength(source, i, '`');
      const end = codeSpanEnd(source, i + run, run);
      if (end === -1) {
        text += '`'.repeat(run);
        i += run;
        continue;
      }
      let code = source.slice(i + run, end).replace(/\n/g, ' ');
      if (/^ .*[^ ].* $/.test(code)) code = code.slice(1, -1);
      flush();
      nodes.push({ type: 'code', value: code });
      i = end + run;
      continue;
    }
    if (c === '[' || (c === '!' && source[i + 1] === '[')) {
      const image = c === '!';
      const link = linkAt(source, image ? i + 1 : i);
      if (link) {
        flush();
        const label = parseInline(link.label);
        nodes.push(
          image
            ? { type: 'image', src: link.destination, alt: plainText(label) }
            : { type: 'link', href: link.destination, children: withoutLinks(label) },
        );
        i = link.end;
      } else {
        text += c;
        i++;
      }
      continue;
    }
    if (c === '*' || c === '_') {
      const run = runLength(source, i, c);
      const { canOpen, canClose } = flanking(c, source[i - 1] ?? ' ', source[i + run] ?? ' ');
      flush();
      const node: TextNode = { type: 'text', value: c.repeat(run) };
      nodes.push(node);
      if (canOpen || canClose) {
        delimiters.push({ node, char: c, length: run, originalLength: run, canOpen, canClose });
      }
      i += run;
      continue;
    }
    if (c === '\n') {
      // Two or more spaces before a line break make a hard break; otherwise it's a space.
      const hard = / {2,}$/.test(text);
      text = text.replace(/ +$/, '');
      if (hard) {
        flush();
        nodes.push({ type: 'break' });
      } else {
        text += ' ';
      }
      i++;
      while (source[i] === ' ') i++;
      continue;
    }
    text += c;
    i++;
  }
  flush();
  processEmphasis(nodes, delimiters);
  return tidy(nodes);
}

/** The words of some inline content, without formatting (image alt text included). */
export function plainText(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.value;
        case 'image':
          return node.alt;
        case 'break':
          return ' ';
        default:
          return plainText(node.children);
      }
    })
    .join('');
}
