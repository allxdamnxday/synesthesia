import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { href, navigate } from '../../app/router';
import { errorDetail, getSignature, userMessage } from '../../library';
import type { KineticSignature } from '../../signature/types';
import { useLibraryStore } from '../../state/libraryStore';
import { Button } from '../../ui/Button';
import { GuideLink } from '../../ui/GuideLink';
import { InlineRename } from '../../ui/InlineRename';
import { Notice, type NoticeTone } from '../../ui/Notice';
import { useKeyShortcuts } from '../../ui/useKeyShortcuts';
import { formatChanged, formatDuration } from '../Library/format';
import { signatureName } from '../Library/importSummary';
import { describeOnsets, formatSpeed } from '../Prepare/format';
import { SignatureTransport, WakeCanvas, useSignaturePlayback } from './SignaturePreview';
import styles from './SignatureScreen.module.css';
import { SignatureSparklines } from './SignatureSparklines';

type Loaded =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'error'; message: string }
  | { state: 'ready'; signature: KineticSignature };

/**
 * A saved signature (#/signature/:signatureId): its bare wake looping, its movement
 * features over time, a few facts in plain words, and the two ways forward (a composition
 * by hand, or an album by chance).
 */
export function SignatureScreen({ params }: { params?: Record<string, string> }) {
  const id = params?.signatureId ?? '';
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoaded({ state: 'loading' });
    getSignature(id)
      .then((signature) => {
        if (cancelled) return;
        setLoaded(signature ? { state: 'ready', signature } : { state: 'missing' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('Could not open the signature:', errorDetail(err));
        setLoaded({ state: 'error', message: userMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  if (loaded.state === 'ready') {
    return <SignatureView key={loaded.signature.id} signature={loaded.signature} />;
  }

  return (
    <section className={styles.message} aria-labelledby="signature-title">
      {loaded.state === 'loading' ? <p className={styles.loading}>Opening the signature…</p> : null}
      {loaded.state === 'missing' ? (
        <>
          <h1 id="signature-title" className={styles.messageTitle}>
            This signature isn’t in your library
          </h1>
          <p>It may have been deleted, or this link came from another browser.</p>
          <p>
            <a href={href('/')}>Back to the library</a>
          </p>
        </>
      ) : null}
      {loaded.state === 'error' ? (
        <>
          <h1 id="signature-title" className={styles.messageTitle}>
            The signature couldn’t be opened
          </h1>
          <Notice
            tone="error"
            actions={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
          >
            {loaded.message}
          </Notice>
          <p className={styles.messageBack}>
            <a href={href('/')}>Back to the library</a>
          </p>
        </>
      ) : null}
    </section>
  );
}

function SignatureView({ signature }: { signature: KineticSignature }) {
  // The movement never changes here; only the name can, so it is kept apart and the
  // preview keeps playing through a rename.
  const playback = useSignaturePlayback(signature, signature.preferredSpeed);
  const [savedName, setSavedName] = useState(signature.name);
  const [renaming, setRenaming] = useState(false);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const titleRow = useRef<HTMLDivElement>(null);
  const name = signatureName(savedName);
  const { clock } = playback;
  /** After renaming, put focus back on the Rename button. */
  const refocus = () =>
    requestAnimationFrame(() =>
      titleRow.current?.querySelector<HTMLButtonElement>('[data-rename]')?.focus(),
    );

  useKeyShortcuts({
    ' ': () => clock.toggle(),
    l: () => clock.setLoop(!clock.isLooping()),
  });

  const rename = async (next: string) => {
    try {
      const meta = await useLibraryStore.getState().renameSignature(signature.id, next);
      setSavedName(meta.name);
    } catch (err) {
      console.error(errorDetail(err));
      setNotice({ tone: 'error', text: userMessage(err) });
    }
  };

  const exportFile = async () => {
    try {
      // From the library, so the file has the latest name even if it changed elsewhere.
      const fileName = await useLibraryStore.getState().exportSignature(signature.id);
      setNotice({ tone: 'success', text: `Exported as “${fileName}”.` });
    } catch (err) {
      console.error(errorDetail(err));
      setNotice({ tone: 'error', text: userMessage(err) });
    }
  };

  const seconds = signature.frameCount / signature.frameRate;
  const onsets = signature.features.onsets.length;

  return (
    <section className={styles.screen} aria-labelledby="signature-title">
      <div className={styles.layout}>
        <header className={styles.bar}>
          <div className={styles.titleRow} ref={titleRow}>
            <a className={styles.crumb} href={href('/')}>
              Library
            </a>
            <span className={styles.slash} aria-hidden="true">
              /
            </span>
            {renaming ? (
              <div className={styles.renameField}>
                <InlineRename
                  value={name}
                  label={`New name for ${name}`}
                  onCommit={(next) => {
                    setRenaming(false);
                    void rename(next);
                    refocus();
                  }}
                  onCancel={() => {
                    setRenaming(false);
                    refocus();
                  }}
                />
              </div>
            ) : (
              <>
                <h1 id="signature-title" className={styles.title}>
                  {name}
                </h1>
                <Button
                  variant="quiet"
                  data-rename=""
                  onClick={() => setRenaming(true)}
                  aria-label={`Rename ${name}`}
                >
                  Rename
                </Button>
              </>
            )}
          </div>
          <div className={styles.actions}>
            <GuideLink section="prepare" />
            <Button onClick={() => void exportFile()}>Export file</Button>
          </div>
        </header>

        {/* The two ways forward, side by side (stacked where the column is narrow). */}
        <section className={styles.next} aria-labelledby="signature-next-title">
          <h2 id="signature-next-title" className={styles.panelTitle}>
            Use this signature
          </h2>
          <div className={styles.ways}>
            <div className={styles.way}>
              <Button
                variant="primary"
                onClick={() => navigate(`/studio/new/${encodeURIComponent(signature.id)}`)}
              >
                Start a composition
              </Button>
              <p className={styles.wayText}>Shape one piece by hand in the Studio.</p>
            </div>
            <div className={styles.way}>
              <Button onClick={() => navigate(`/album/new/${encodeURIComponent(signature.id)}`)}>
                New album
              </Button>
              <p className={styles.wayText}>
                Let chance draw a set of compositions from this signature.
              </p>
            </div>
          </div>
        </section>

        <div className={styles.work}>
          {/* On phones the stage takes the field's shape (SignatureScreen.module.css). */}
          <div
            className={styles.stage}
            style={
              {
                '--stage-aspect': `${signature.grid.cols} / ${signature.grid.rows}`,
              } as CSSProperties
            }
          >
            <WakeCanvas
              playback={playback}
              label={`The wake of “${name}”: a short stroke for each part of the movement, pointing the way it moves`}
            />
          </div>
          <SignatureTransport playback={playback} />
          <SignatureSparklines signature={signature} playback={playback} />
        </div>

        <aside className={styles.panel} aria-label="About this signature">
          <h2 className={styles.panelTitle}>About this signature</h2>
          <dl className={styles.facts}>
            <div>
              <dt>Length</dt>
              <dd>{formatDuration(seconds)} of movement</dd>
            </div>
            <div>
              <dt>Sudden movement</dt>
              <dd>{describeOnsets(onsets)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatChanged(signature.createdAt) || 'Unknown'}</dd>
            </div>
            <div>
              <dt>Speed</dt>
              <dd>Plays at {formatSpeed(signature.preferredSpeed)} by default</dd>
            </div>
            <div>
              <dt>Made from</dt>
              <dd>
                “{signature.source.fileName || 'a clip'}”
                {signature.source.focusArea ? ', using a focus area' : ''}
              </dd>
            </div>
          </dl>
          <p className={styles.note}>
            Only the movement is kept. The clip it came from isn’t stored here.
          </p>
          <div className={styles.notices} role="status" aria-live="polite">
            {notice ? (
              <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
                {notice.text}
              </Notice>
            ) : null}
          </div>
          <a className={styles.back} href={href('/')}>
            Back to library
          </a>
        </aside>
      </div>
    </section>
  );
}
