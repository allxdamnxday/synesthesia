import { useEffect, useRef, useState } from 'react';
import { href, navigate } from '../../app/router';
import { errorDetail, exportSignatureFile, getSignature, userMessage } from '../../library';
import type { KineticSignature } from '../../signature/types';
import { useLibraryStore } from '../../state/libraryStore';
import { Button } from '../../ui/Button';
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
 * features over time, a few facts in plain words, and what to do next.
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
    return (
      <SignatureView
        key={loaded.signature.id}
        signature={loaded.signature}
        onRenamed={(name) =>
          setLoaded({ state: 'ready', signature: { ...loaded.signature, name } })
        }
      />
    );
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

function SignatureView({
  signature,
  onRenamed,
}: {
  signature: KineticSignature;
  onRenamed: (name: string) => void;
}) {
  const playback = useSignaturePlayback(signature, signature.preferredSpeed);
  const [renaming, setRenaming] = useState(false);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const titleRow = useRef<HTMLDivElement>(null);
  const name = signatureName(signature.name);
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
      onRenamed(meta.name);
    } catch (err) {
      console.error(errorDetail(err));
      setNotice({ tone: 'error', text: userMessage(err) });
    }
  };

  const exportFile = () => {
    try {
      const fileName = exportSignatureFile(signature);
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
            <Button onClick={exportFile}>Export file</Button>
            <Button
              variant="primary"
              onClick={() => navigate(`/studio/new/${encodeURIComponent(signature.id)}`)}
            >
              Start a composition
            </Button>
          </div>
        </header>

        <div className={styles.body}>
          <div className={styles.work}>
            <div className={styles.stage}>
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
      </div>
    </section>
  );
}
