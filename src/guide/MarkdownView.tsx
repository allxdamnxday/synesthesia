import { Fragment, type MouseEvent, type ReactNode } from 'react';
import type { GuideImage } from './images';
import { plainText, type Align, type Block, type Inline } from './markdown';
import styles from './MarkdownView.module.css';

/**
 * Renders the parsed guide as React elements. Every piece of text becomes a text node (React
 * escapes it), so HTML written in the Markdown shows as text and never runs. Links and
 * pictures only go where the page's resolvers say.
 */
export interface MarkdownOptions {
  /** Where a link goes in the app (an href such as `#/guide/backup`), or null for plain text. */
  resolveLink: (href: string) => string | null;
  /** The bundled picture for an image path, or null to show its description instead. */
  resolveImage: (src: string) => GuideImage | null;
  /** The id of a heading that can be linked to (sections and sub-sections). */
  headingId?: (block: Block) => string | undefined;
  /** Called when a resolved link is clicked (e.g. to scroll when the address doesn't change). */
  onLinkClick?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  /** Show a picture larger. Without it, pictures are plain images rather than buttons. */
  onZoom?: (image: GuideImage, alt: string) => void;
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

function alignStyle(align: Align | undefined) {
  return align ? { textAlign: align } : undefined;
}

function renderInlines(nodes: readonly Inline[], options: MarkdownOptions): ReactNode[] {
  return nodes.map((node, key) => {
    switch (node.type) {
      case 'text':
        return node.value;
      case 'strong':
        return <strong key={key}>{renderInlines(node.children, options)}</strong>;
      case 'emphasis':
        return <em key={key}>{renderInlines(node.children, options)}</em>;
      case 'code':
        return (
          <code key={key} className={styles.code}>
            {node.value}
          </code>
        );
      case 'break':
        return <br key={key} />;
      case 'link': {
        const target = options.resolveLink(node.href);
        const children = renderInlines(node.children, options);
        if (target === null) return <Fragment key={key}>{children}</Fragment>;
        const { onLinkClick } = options;
        return (
          <a
            key={key}
            href={target}
            onClick={onLinkClick ? (event) => onLinkClick(event, target) : undefined}
          >
            {children}
          </a>
        );
      }
      case 'image': {
        const picture = options.resolveImage(node.src);
        if (!picture) return node.alt;
        return (
          <img
            key={key}
            className={styles.inlinePicture}
            src={picture.url}
            alt={node.alt}
            width={picture.width}
            height={picture.height}
            loading="lazy"
            decoding="async"
          />
        );
      }
    }
  });
}

/** A paragraph holding nothing but one picture is shown as a figure. */
function soleImage(nodes: readonly Inline[]): Extract<Inline, { type: 'image' }> | null {
  const content = nodes.filter((n) => !(n.type === 'text' && n.value.trim() === ''));
  const only = content.length === 1 ? content[0] : undefined;
  return only?.type === 'image' ? only : null;
}

function Figure({ src, alt, options }: { src: string; alt: string; options: MarkdownOptions }) {
  const picture = options.resolveImage(src);
  if (!picture) return alt ? <p className={styles.missingPicture}>{alt}</p> : null;
  const image = (
    <img
      className={styles.picture}
      src={picture.url}
      alt={alt}
      width={picture.width}
      height={picture.height}
      loading="lazy"
      decoding="async"
    />
  );
  const { onZoom } = options;
  return (
    <figure className={styles.figure}>
      {onZoom ? (
        <button
          type="button"
          className={styles.zoom}
          aria-haspopup="dialog"
          onClick={() => onZoom(picture, alt)}
        >
          {image}
          <span className="visually-hidden"> (show larger)</span>
        </button>
      ) : (
        image
      )}
    </figure>
  );
}

/**
 * A table. Two columns (such as keys and actions) keep to the reading width; three or more
 * columns of sentences use the full width, and on a phone each row becomes a small block with
 * the column names as labels, so nothing hides off to the side.
 */
function Table({
  table,
  options,
}: {
  table: Extract<Block, { type: 'table' }>;
  options: MarkdownOptions;
}) {
  const wide = table.head.length > 2;
  const labels = table.head.map((cell) => plainText(cell));
  return (
    <div className={wide ? styles.tableWrap : `${styles.tableWrap} ${styles.narrowTableWrap}`}>
      <table className={wide ? `${styles.table} ${styles.wideTable}` : styles.table}>
        <thead>
          <tr>
            {table.head.map((cell, c) => (
              <th key={c} scope="col" style={alignStyle(table.align[c])}>
                {renderInlines(cell, options)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) =>
                c === 0 ? (
                  <th key={c} scope="row" style={alignStyle(table.align[c])}>
                    {renderInlines(cell, options)}
                  </th>
                ) : (
                  <td
                    key={c}
                    style={alignStyle(table.align[c])}
                    data-label={wide && labels[c] ? labels[c] : undefined}
                  >
                    {renderInlines(cell, options)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderBlocks(
  blocks: readonly Block[],
  options: MarkdownOptions,
  tight = false,
): ReactNode[] {
  return blocks.map((block, key) => {
    switch (block.type) {
      case 'heading': {
        const Tag = `h${block.depth}` as HeadingTag;
        const id = options.headingId?.(block);
        return (
          <Tag
            key={key}
            id={id}
            tabIndex={id ? -1 : undefined}
            className={styles[`h${block.depth}`]}
          >
            {renderInlines(block.children, options)}
          </Tag>
        );
      }
      case 'paragraph': {
        const image = soleImage(block.children);
        if (image) return <Figure key={key} src={image.src} alt={image.alt} options={options} />;
        const content = renderInlines(block.children, options);
        // Items of a tight list hold their text directly, as CommonMark renders them.
        if (tight) return <Fragment key={key}>{content}</Fragment>;
        return <p key={key}>{content}</p>;
      }
      case 'list': {
        const items = block.items.map((item, i) => (
          <li key={i}>{renderBlocks(item, options, block.tight)}</li>
        ));
        return block.ordered ? (
          <ol key={key} className={styles.list} start={block.start === 1 ? undefined : block.start}>
            {items}
          </ol>
        ) : (
          <ul key={key} className={styles.list}>
            {items}
          </ul>
        );
      }
      case 'table':
        return <Table key={key} table={block} options={options} />;
      case 'blockquote':
        return (
          <blockquote key={key} className={styles.quote}>
            {renderBlocks(block.children, options)}
          </blockquote>
        );
      case 'code':
        return (
          <pre key={key} className={styles.pre}>
            <code>{block.value}</code>
          </pre>
        );
      case 'rule':
        return <hr key={key} className={styles.rule} />;
    }
  });
}

/** Parsed Markdown blocks as elements, styled for reading. */
export function MarkdownBlocks({
  blocks,
  options,
}: {
  blocks: readonly Block[];
  options: MarkdownOptions;
}) {
  return <>{renderBlocks(blocks, options)}</>;
}
