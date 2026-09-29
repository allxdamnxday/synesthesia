import { useEffect, useRef, type ReactNode } from 'react';
import type { GuideSectionSlug } from '../../guide/sections';
import { Button } from '../../ui/Button';
import { GuideLink } from '../../ui/GuideLink';
import { CheckIcon } from '../../ui/icons';
import styles from './HowItWorks.module.css';
import { journeySteps, type JourneyFacts, type JourneyStepId } from './journey';

export interface HowItWorksProps {
  facts: JourneyFacts;
  /** Nothing at all in the library yet (the steps stand in for the empty Library). */
  libraryEmpty: boolean;
  /** The signature Start a composition and New album use: the one worked with most recently. */
  signature: { id: string; name: string } | null;
  /** The composition to open for a render: the most recently changed. */
  composition: { id: string; name: string } | null;
  /** More than one composition (so "your latest composition"). */
  manyCompositions: boolean;
  /** Something is under way in the Library (the buttons wait). */
  busy: boolean;
  onNewFromClip: () => void;
  onTrySample: () => void;
  onStartComposition: (signatureId: string) => void;
  onNewAlbum: (signatureId: string) => void;
  onOpenComposition: (compositionId: string) => void;
  onHide: () => void;
}

const TITLES: Record<JourneyStepId, string> = {
  signature: 'Make a signature from a clip',
  composition: 'Start a composition',
  share: 'Render a video or make an album',
};

/** Where the guide explains each step. */
const GUIDE: Record<JourneyStepId, GuideSectionSlug> = {
  signature: 'prepare',
  composition: 'studio',
  share: 'render',
};

/**
 * "How it works" (the Library's where-to-go-next steps): make a signature from a clip, start a
 * composition, render a video or make an album. Each step says what it is; the current one
 * offers its action and the guide; finished ones get a tick. Hide puts it away (Settings
 * brings it back). With nothing in the library it stands in for the empty Library.
 */
export function HowItWorks({
  facts,
  libraryEmpty,
  signature,
  composition,
  manyCompositions,
  busy,
  onNewFromClip,
  onTrySample,
  onStartComposition,
  onNewAlbum,
  onOpenComposition,
  onHide,
}: HowItWorksProps) {
  const steps = journeySteps(facts);
  const current = steps.find((s) => s.state === 'current')?.id ?? null;
  const rootRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previous = useRef(current);
  const refocus = useRef(false);

  // When a step is done from here (the sample wink), its button goes; if that left focus
  // nowhere, move it to the next step's action (once the Library is no longer busy, so the
  // button can take it) rather than leave it at the top of the page.
  useEffect(() => {
    if (previous.current !== current) {
      previous.current = current;
      const active = document.activeElement;
      refocus.current = !active || active === document.body;
    }
    if (!refocus.current || busy) return;
    refocus.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const next = rootRef.current?.querySelector<HTMLElement>('[data-state="current"] button');
    (next ?? headingRef.current)?.focus();
  }, [current, busy]);

  const describe = (id: JourneyStepId): ReactNode => {
    switch (id) {
      case 'signature':
        return `Bring in a clip to make ${libraryEmpty ? 'your first' : 'a'} signature. Only its movement is kept, never the picture.`;
      case 'composition':
        return facts.signatures > 1 && signature
          ? `Play a signature through a visual and a sound material in the Studio, and save what you find. The button starts from “${signature.name}”, the one you worked with last.`
          : 'Play the signature through a visual and a sound material in the Studio, and save what you find.';
      case 'share':
        return 'Render MP4 in the Studio makes a video of a composition. New album lets chance draw a set of compositions from a signature.';
    }
  };

  const actions = (id: JourneyStepId): ReactNode => {
    switch (id) {
      case 'signature':
        return (
          <>
            <Button variant="primary" onClick={onNewFromClip} disabled={busy}>
              New from clip
            </Button>
            <Button onClick={onTrySample} disabled={busy}>
              Try the sample wink
            </Button>
          </>
        );
      case 'composition':
        return signature ? (
          <Button
            variant="primary"
            onClick={() => onStartComposition(signature.id)}
            disabled={busy}
            aria-label={`Start a composition from ${signature.name}`}
          >
            Start a composition
          </Button>
        ) : null;
      case 'share':
        return (
          <>
            {composition ? (
              <Button
                variant="primary"
                onClick={() => onOpenComposition(composition.id)}
                disabled={busy}
                title={`Open “${composition.name}” in the Studio`}
              >
                {manyCompositions ? 'Open your latest composition' : 'Open your composition'}
              </Button>
            ) : null}
            {signature ? (
              <Button
                onClick={() => onNewAlbum(signature.id)}
                disabled={busy}
                aria-label={`New album from ${signature.name}`}
              >
                New album
              </Button>
            ) : null}
          </>
        );
    }
  };

  return (
    <section
      ref={rootRef}
      className={styles.strip}
      aria-labelledby="how-it-works-title"
      data-testid="how-it-works"
    >
      <div className={styles.head}>
        <h2 id="how-it-works-title" ref={headingRef} tabIndex={-1} className={styles.title}>
          How it works
        </h2>
        <Button variant="quiet" onClick={onHide} aria-label="Hide how it works">
          Hide
        </Button>
      </div>
      <ol className={styles.steps} data-current={current ?? undefined}>
        {steps.map((step, i) => (
          <li key={step.id} className={styles.step} data-state={step.state}>
            <span className={styles.marker} aria-hidden="true">
              {step.state === 'done' ? <CheckIcon size={14} /> : i + 1}
            </span>
            <div className={styles.body}>
              <h3 className={styles.stepTitle}>
                {TITLES[step.id]}
                {step.state === 'done' ? <span className="visually-hidden">: done</span> : null}
                {step.state === 'current' ? <span className="visually-hidden">: next</span> : null}
              </h3>
              {step.state === 'done' ? null : <p className={styles.text}>{describe(step.id)}</p>}
              {step.state === 'current' ? (
                <div className={styles.actions}>
                  {actions(step.id)}
                  <GuideLink section={GUIDE[step.id]} />
                </div>
              ) : null}
              {step.state === 'current' && step.id === 'signature' && libraryEmpty ? (
                <p className={styles.aside}>
                  You can also import a signature, composition or album file, or restore a backup,
                  with the buttons above.
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {current === null ? (
        <p className={styles.aside}>
          Every step is done. Hide this whenever you like; Settings can bring it back.
        </p>
      ) : null}
    </section>
  );
}
