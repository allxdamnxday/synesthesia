import { href } from '../app/router';
import { GUIDE_SECTIONS, guidePath, type GuideSectionSlug } from '../guide/sections';
import styles from './GuideLink.module.css';
import { GuideIcon } from './icons';

export interface GuideLinkProps {
  /** The part of the guide that explains this screen, panel or dialog. */
  section: GuideSectionSlug;
  /** On phones (and a phone on its side) show only the icon, for rows short of room. */
  compact?: boolean;
  className?: string;
}

/**
 * The one small, quiet way from a screen to where the guide explains it: "? Guide". Its
 * accessible name says which part ("Guide: The Studio"). An ordinary link through the hash
 * router, like the header's Guide, so Back returns to the screen.
 */
export function GuideLink({ section, compact = false, className }: GuideLinkProps) {
  const title = GUIDE_SECTIONS[section];
  const classes = [styles.link, compact ? styles.compact : '', className].filter(Boolean).join(' ');
  return (
    <a href={href(guidePath(section))} className={classes} title={`${title}, in the guide`}>
      <GuideIcon />
      <span className={styles.text}>Guide</span>
      <span className="visually-hidden">: {title}</span>
    </a>
  );
}
