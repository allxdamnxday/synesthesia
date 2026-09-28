import { useEffect, useRef, useState } from 'react';
import { getSetting, importParsedSignature, setSetting, userMessage } from '../library';
import { parseSignature } from '../signature/serialize';
import { Button } from '../ui/Button';
import { overlayAllowed } from './firstRun';
import styles from './Introduction.module.css';
import { navigate, useHashPath } from './router';

const SAMPLE_URL = 'samples/sample-wink.sig.json';

const STEPS = [
  {
    title: 'Welcome',
    body: [
      'Synesthesia keeps the movement from a short clip, its signature, and lets that one movement pass through different materials: water, honey, smoke, bubbles, filaments, and sound.',
      'The clip itself disappears. Its wake remains.',
    ],
  },
  {
    title: 'How it goes',
    body: [
      'Bring in a clip and make its signature. Open it in the Studio, choose a visual material and a sound material, and play with their properties while you watch and listen.',
      'Keep what you find: save compositions with notes, render them as videos, and gather them into an album.',
    ],
  },
  {
    title: 'Begin',
    body: [
      'Start with a sample wink, or bring in a clip of your own.',
      'Everything stays on this computer. Now and then, choose Back up everything in the Library and keep the file somewhere safe. Help is always at the top of the screen.',
    ],
  },
];

/**
 * First-run introduction (SPEC M8: three screens at most, with a bundled sample
 * signature). Shows on the Library until it's finished or skipped; Settings can show it
 * again.
 */
export function Introduction() {
  const path = useHashPath();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (path !== '/' || !overlayAllowed('introduction')) return;
    let cancelled = false;
    void getSetting('onboardingDone').then((done) => {
      if (!cancelled && !done) setOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  const finish = async (then?: () => void) => {
    await setSetting('onboardingDone', true);
    dialogRef.current?.close();
    setOpen(false);
    then?.();
  };

  const trySample = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(new URL(SAMPLE_URL, document.baseURI));
      if (!response.ok) throw new Error(`Sample not found (${response.status})`);
      const signature = parseSignature(await response.text());
      const result = await importParsedSignature(signature);
      await finish(() => navigate(`/studio/new/${result.meta.id}`));
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Only over the Library: if something (a dropped clip) takes the person elsewhere, step
  // aside; it comes back on the Library until finished or skipped.
  if (!open || path !== '/') return null;
  const current = STEPS[step] ?? STEPS[0];
  const last = step === STEPS.length - 1;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="intro-title"
      onCancel={(e) => {
        e.preventDefault();
        void finish();
      }}
    >
      <div className={styles.card}>
        <p className={styles.progress} aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s.title} className={i === step ? styles.dotOn : styles.dot} />
          ))}
        </p>
        <h2 id="intro-title">{current?.title}</h2>
        {current?.body.map((paragraph) => (
          <p key={paragraph} className={styles.body}>
            {paragraph}
          </p>
        ))}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          {last ? (
            <>
              <Button variant="primary" onClick={() => void trySample()} disabled={busy}>
                {busy ? 'Opening…' : 'Try the sample wink'}
              </Button>
              <Button onClick={() => void finish(() => navigate('/prepare'))} disabled={busy}>
                Bring in a clip
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              Next
            </Button>
          )}
          {step > 0 ? (
            <Button variant="quiet" onClick={() => setStep(step - 1)} disabled={busy}>
              Back
            </Button>
          ) : null}
          <span className={styles.spacer} />
          {last ? null : (
            <Button variant="quiet" onClick={() => void finish()}>
              Skip
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}
