import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { href } from '../../app/router';
import { GUIDE } from '../../guide/guide';
import { guideImage, type GuideImage } from '../../guide/images';
import { MarkdownBlocks, type MarkdownOptions } from '../../guide/MarkdownView';
import { guideLinkHref, headingDomId, type GuideHeading } from '../../guide/sections';
import { IconButton } from '../../ui/IconButton';
import { CloseIcon } from '../../ui/icons';
import { Notice } from '../../ui/Notice';
import styles from './GuideScreen.module.css';

/**
 * The user guide (docs/USER_GUIDE.md, rendered from the file itself) with its contents.
 * `#/guide` shows it from the top; `#/guide/<slug>` goes to a section (see GUIDE_SECTIONS).
 * The hash is the route, so every link here goes through the router.
 */

const SLUGS: ReadonlySet<string> = new Set(GUIDE.headings.map((h) => h.slug));

function sectionHref(slug: string | null): string {
  return href(slug === null ? '/guide' : `/guide/${slug}`);
}

function motion(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

/** Bring a heading to the top of the window and move focus there (keyboards, screen readers). */
function goToHeading(slug: string, behavior: ScrollBehavior): void {
  const heading = document.getElementById(headingDomId(slug));
  if (!heading) return;
  heading.scrollIntoView({ block: 'start', behavior });
  heading.focus({ preventScroll: true });
}

/**
 * The heading the reader is in: the last one above a line a quarter of the way down the
 * window. At the very end of the page, where short last sections can't reach that line, the
 * section asked for in the address wins if it's in view, else the last one.
 */
function useCurrentHeading(headings: readonly GuideHeading[], asked: string | null) {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight / 4;
      let found: string | null = null;
      for (const heading of headings) {
        const element = document.getElementById(headingDomId(heading.slug));
        if (!element) continue;
        if (element.getBoundingClientRect().top > line) break;
        found = heading.slug;
      }
      const scroller = document.documentElement;
      if (headings.length > 0 && window.innerHeight + window.scrollY >= scroller.scrollHeight - 2) {
        const top = asked
          ? document.getElementById(headingDomId(asked))?.getBoundingClientRect().top
          : undefined;
        const askedInView = top !== undefined && top >= 0 && top < window.innerHeight;
        found = askedInView ? asked : headings[headings.length - 1].slug;
      }
      setCurrent(found);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [headings, asked]);
  return current;
}

function Contents({
  current,
  onLinkClick,
  onNavigate,
}: {
  current: string | null;
  onLinkClick: (event: MouseEvent<HTMLAnchorElement>, to: string) => void;
  onNavigate?: () => void;
}) {
  const link = (heading: GuideHeading) => {
    const to = sectionHref(heading.slug);
    return (
      <a
        href={to}
        aria-current={current === heading.slug ? 'location' : undefined}
        onClick={(event) => {
          onNavigate?.();
          onLinkClick(event, to);
        }}
      >
        {heading.title}
      </a>
    );
  };
  return (
    <ol className={styles.contents}>
      {GUIDE.sections.map((section) => (
        <li key={section.slug}>
          {link(section)}
          {section.subsections.length > 0 ? (
            <ol>
              {section.subsections.map((sub) => (
                <li key={sub.slug}>{link(sub)}</li>
              ))}
            </ol>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

interface Zoomed {
  image: GuideImage;
  alt: string;
}

/** A picture at full size over everything; a click anywhere, Esc or Close puts it away. */
function PictureViewer({ zoomed, onClose }: { zoomed: Zoomed | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (zoomed && !dialog.open) dialog.showModal();
    else if (!zoomed && dialog.open) dialog.close();
  }, [zoomed]);
  const close = () => ref.current?.close();
  return (
    <dialog
      ref={ref}
      className={styles.viewer}
      aria-label={zoomed?.alt || 'Picture'}
      onClose={onClose}
      onClick={close}
    >
      {zoomed ? (
        <>
          <IconButton label="Close" className={styles.viewerClose} onClick={close}>
            <CloseIcon size={20} />
          </IconButton>
          <img
            className={styles.viewerPicture}
            src={zoomed.image.url}
            alt={zoomed.alt}
            width={zoomed.image.width}
            height={zoomed.image.height}
          />
        </>
      ) : null}
    </dialog>
  );
}

export interface GuideScreenProps {
  /** A section's slug, from `#/guide/<slug>`; none shows the guide from the top. */
  section?: string;
}

export function GuideScreen({ section }: GuideScreenProps) {
  const known = section === undefined || SLUGS.has(section);
  const target = section !== undefined && known ? section : null;
  const current = useCurrentHeading(GUIDE.headings, target);
  const phoneContents = useRef<HTMLDetailsElement>(null);
  const [zoomed, setZoomed] = useState<Zoomed | null>(null);

  // Arriving at the guide or one of its sections: jump there (smoothly once already reading).
  const arrived = useRef(false);
  useEffect(() => {
    const behavior: ScrollBehavior = arrived.current ? motion() : 'auto';
    arrived.current = true;
    if (target === null) {
      window.scrollTo({ top: 0, behavior });
      return;
    }
    goToHeading(target, behavior);
    if (document.fonts.status !== 'loading') return;
    // The text above can reflow when the typeface arrives: land on the heading again then.
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) goToHeading(target, 'auto');
    });
    return () => {
      live = false;
    };
  }, [target]);

  // A link to where the address already points changes nothing for the router: go there here.
  const onLinkClick = useCallback((event: MouseEvent<HTMLAnchorElement>, to: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (window.location.hash !== to) return;
    event.preventDefault();
    const slug = /^#\/guide\/([^/?]+)$/.exec(to)?.[1];
    if (slug && SLUGS.has(slug)) goToHeading(slug, motion());
    else window.scrollTo({ top: 0, behavior: motion() });
  }, []);

  const options = useMemo<MarkdownOptions>(
    () => ({
      resolveLink: (target) => guideLinkHref(target, GUIDE.anchors),
      resolveImage: guideImage,
      headingId: (block) => {
        const slug = GUIDE.slugOf.get(block);
        return slug === undefined ? undefined : headingDomId(slug);
      },
      onLinkClick,
      onZoom: (image, alt) => setZoomed({ image, alt }),
    }),
    [onLinkClick],
  );

  const backToContents = (event: MouseEvent<HTMLAnchorElement>) => {
    const details = phoneContents.current;
    if (details) {
      details.open = true;
      details.querySelector('summary')?.focus({ preventScroll: true });
    }
    onLinkClick(event, sectionHref(null));
  };

  return (
    <div className={styles.layout}>
      <nav className={styles.sidebar} aria-label="Guide contents">
        <p className={styles.contentsTitle}>Contents</p>
        <Contents current={current} onLinkClick={onLinkClick} />
      </nav>

      <nav className={styles.phoneContents} aria-label="Guide contents">
        <details ref={phoneContents} className={styles.disclosure}>
          <summary>Contents</summary>
          <Contents
            current={current}
            onLinkClick={onLinkClick}
            onNavigate={() => {
              if (phoneContents.current) phoneContents.current.open = false;
            }}
          />
        </details>
      </nav>

      <article className={styles.article}>
        <div role="status" className={styles.notice}>
          {known ? null : (
            <Notice>
              The guide has no section called “{section}”. Here it is from the beginning.
            </Notice>
          )}
        </div>
        <MarkdownBlocks blocks={GUIDE.intro} options={options} />
        {GUIDE.sections.map((s) => (
          <section key={s.slug} className={styles.section} aria-labelledby={headingDomId(s.slug)}>
            <MarkdownBlocks blocks={s.blocks} options={options} />
            <p className={styles.backToContents}>
              <a href={sectionHref(null)} onClick={backToContents}>
                Back to contents
              </a>
            </p>
          </section>
        ))}
      </article>

      <PictureViewer zoomed={zoomed} onClose={() => setZoomed(null)} />
    </div>
  );
}
