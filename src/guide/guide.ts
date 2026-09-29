import source from '../../docs/USER_GUIDE.md?raw';
import { parseMarkdown } from './markdown';
import { outlineGuide, type GuideOutline } from './sections';

/** docs/USER_GUIDE.md as written: the Guide page renders this file itself, so they never drift. */
export const GUIDE_SOURCE: string = source;

/** The guide, parsed once and split into its sections. */
export const GUIDE: GuideOutline = outlineGuide(parseMarkdown(GUIDE_SOURCE));
