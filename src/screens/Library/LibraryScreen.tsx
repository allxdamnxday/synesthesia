import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { navigate } from '../../app/router';
import type { Composition } from '../../engine/composition';
import {
  describeRestore,
  errorDetail,
  formatBytes,
  userMessage,
  type SignatureMeta,
} from '../../library';
import { useLibraryStore } from '../../state/libraryStore';
import { Button } from '../../ui/Button';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { FileButton } from '../../ui/FileButton';
import { Notice, type NoticeTone } from '../../ui/Notice';
import { countOf, formatChanged, formatDuration } from './format';
import { compositionName, describeImport, signatureName } from './importSummary';
import { LibraryCard } from './LibraryCard';
import styles from './LibraryScreen.module.css';

/** Library files are JSON (`.sig.json`, `.spcomp.json`); the OS picker filters by last extension. */
const IMPORT_ACCEPT = '.json,application/json';
const BACKUP_ACCEPT = '.zip,application/zip';
const MAX_NOTICES = 3;

interface NoticeItem {
  id: number;
  tone: NoticeTone;
  text: ReactNode;
  /** A composition waiting for this signature: offer to import it. */
  needs?: Composition['signature'];
}

type NewNotice = Omit<NoticeItem, 'id'>;

type Pending =
  | { kind: 'delete-signature'; meta: SignatureMeta; uses: number; twin?: SignatureMeta }
  | { kind: 'delete-composition'; composition: Composition }
  | { kind: 'restore'; file: File };

type ItemKind = 'signature' | 'composition';

function openSignature(id: string) {
  navigate(`/signature/${encodeURIComponent(id)}`);
}
function openComposition(id: string) {
  navigate(`/studio/${encodeURIComponent(id)}`);
}
function startComposition(signatureId: string) {
  navigate(`/studio/new/${encodeURIComponent(signatureId)}`);
}
function newFromClip() {
  navigate('/prepare');
}

/**
 * Home (SPEC 6.1): the person's signatures and compositions, each shown by its wake,
 * with the actions to open, rename, duplicate, delete, export, import, back up and
 * restore. Everything lives in this browser until it is exported or backed up.
 */
export function LibraryScreen() {
  const { status, error, signatures, compositions, usage, persistence } = useLibraryStore(
    useShallow((s) => ({
      status: s.status,
      error: s.error,
      signatures: s.signatures,
      compositions: s.compositions,
      usage: s.usage,
      persistence: s.persistence,
    })),
  );
  const refresh = useLibraryStore((s) => s.refresh);
  const store = useLibraryStore.getState;

  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [renaming, setRenaming] = useState<{ kind: ItemKind; id: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<ItemKind | null>(null);
  const noticeCount = useRef(0);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const signaturesHeading = useRef<HTMLHeadingElement>(null);
  const compositionsHeading = useRef<HTMLHeadingElement>(null);

  // Load on arrival, and again when coming back to this window (another window may have
  // changed the library meanwhile).
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  // After a delete, move focus to the list (or the page title if the list is gone).
  useEffect(() => {
    if (!focusTarget) return;
    const heading = focusTarget === 'signature' ? signaturesHeading : compositionsHeading;
    (heading.current ?? titleRef.current)?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  /**
   * Show one action's notices. Confirmations from earlier actions are cleared so they
   * don't pile up; warnings and errors stay until dismissed.
   */
  const publish = (items: NewNotice[]) => {
    const fresh = items.map((n) => ({ ...n, id: ++noticeCount.current }));
    setNotices((list) =>
      [...fresh, ...list.filter((n) => n.tone === 'warning' || n.tone === 'error')].slice(
        0,
        MAX_NOTICES,
      ),
    );
  };
  const notify = (tone: NoticeTone, text: ReactNode) => publish([{ tone, text }]);
  const dismiss = (id: number) => setNotices((list) => list.filter((n) => n.id !== id));

  /** Run an action with a busy label; failures become a notice. */
  const run = async <T,>(label: string, task: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label);
    try {
      return await task();
    } catch (err) {
      console.error(errorDetail(err));
      notify('error', userMessage(err));
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const importFiles = async (files: File[]) => {
    const outcomes = await run('Importing…', () => store().importFiles(files));
    if (outcomes) publish(describeImport(outcomes));
  };

  const importNeeded = async (noticeId: number, needs: Composition['signature'], file: File) => {
    const result = await run('Importing…', () => store().importSignatureFor(file, needs));
    if (!result) return;
    dismiss(noticeId);
    notify(
      'success',
      result.status === 'already-present'
        ? `“${signatureName(result.meta.name)}” is already in your library.`
        : `Added the signature “${signatureName(result.meta.name)}”. Its compositions can play now.`,
    );
  };

  const backUp = async () => {
    const result = await run('Backing up…', () => store().backUp());
    if (result) {
      notify(
        'success',
        `Backup saved as “${result.fileName}” (${formatBytes(result.bytes)}). Keep a copy somewhere safe, such as a USB drive or a cloud folder.`,
      );
    }
  };

  const exportItem = async (kind: ItemKind, id: string) => {
    const fileName = await run('Exporting…', () =>
      kind === 'signature' ? store().exportSignature(id) : store().exportComposition(id),
    );
    if (fileName) notify('success', `Exported as “${fileName}”.`);
  };

  const duplicateItem = async (kind: ItemKind, id: string) => {
    const copy = await run('Duplicating…', async (): Promise<{ name: string }> =>
      kind === 'signature' ? store().duplicateSignature(id) : store().duplicateComposition(id),
    );
    if (copy) notify('info', `Made a copy: “${copy.name}”.`);
  };

  const renameItem = (kind: ItemKind, id: string, name: string) => {
    const task: Promise<unknown> =
      kind === 'signature'
        ? store().renameSignature(id, name)
        : store().renameComposition(id, name);
    task.catch((err: unknown) => {
      console.error(errorDetail(err));
      notify('error', userMessage(err));
    });
  };

  const confirmPending = async () => {
    if (!pending) return;
    if (pending.kind === 'restore') {
      const summary = await run('Restoring…', () => store().restore(pending.file));
      setPending(null);
      if (summary) notify('success', describeRestore(summary));
      return;
    }
    if (pending.kind === 'delete-signature') {
      const { meta, twin } = pending;
      const result = await run('Deleting…', () => store().deleteSignature(meta.id));
      setPending(null);
      if (!result) return;
      const moved =
        result.moved > 0 && twin
          ? ` ${countOf(result.moved, 'composition now uses', 'compositions now use')} its copy, “${signatureName(twin.name)}”.`
          : '';
      notify('info', `Deleted the signature “${signatureName(meta.name)}”.${moved}`);
      setFocusTarget('signature');
      return;
    }
    const { composition } = pending;
    const done = await run('Deleting…', async () => {
      await store().deleteComposition(composition.id);
      return true;
    });
    setPending(null);
    if (done) {
      notify('info', `Deleted the composition “${compositionName(composition.name)}”.`);
      setFocusTarget('composition');
    }
  };

  const askDeleteSignature = (meta: SignatureMeta) => {
    const twin = signatures.find((s) => s.id !== meta.id && s.contentHash === meta.contentHash);
    setPending({ kind: 'delete-signature', meta, uses: usage[meta.id] ?? 0, twin });
  };

  const ready = status === 'ready';
  const isEmpty = ready && signatures.length === 0 && compositions.length === 0;
  const locked = busy !== null || !ready;

  return (
    <section className={styles.page} aria-labelledby="library-title">
      <header className={styles.header}>
        <h1 id="library-title" ref={titleRef} tabIndex={-1} className={styles.title}>
          Library
        </h1>
        <div className={styles.headerActions}>
          {busy ? (
            <span className={styles.busy} role="status">
              {busy}
            </span>
          ) : null}
          {ready && !isEmpty ? (
            <Button variant="primary" onClick={newFromClip} disabled={locked}>
              New from clip
            </Button>
          ) : null}
          <FileButton accept={IMPORT_ACCEPT} multiple onFiles={importFiles} disabled={locked}>
            Import file
          </FileButton>
          {ready && !isEmpty ? (
            <Button onClick={() => void backUp()} disabled={locked}>
              Back up everything
            </Button>
          ) : null}
          <FileButton
            accept={BACKUP_ACCEPT}
            onFiles={([file]) => {
              if (file) setPending({ kind: 'restore', file });
            }}
            disabled={locked}
          >
            Restore from backup
          </FileButton>
        </div>
      </header>

      {ready && !isEmpty && persistence === 'denied' ? (
        <p className={styles.storageHint}>
          This browser may clear its storage if the computer runs low on space. Back up now and
          then.
        </p>
      ) : null}

      <div className={styles.notices} role="status" aria-live="polite">
        {notices.map((n) => (
          <Notice
            key={n.id}
            tone={n.tone}
            onDismiss={() => dismiss(n.id)}
            actions={
              n.needs ? (
                <FileButton
                  accept={IMPORT_ACCEPT}
                  disabled={busy !== null}
                  onFiles={([file]) => {
                    if (file && n.needs) void importNeeded(n.id, n.needs, file);
                  }}
                >
                  Import signature…
                </FileButton>
              ) : undefined
            }
          >
            {n.text}
          </Notice>
        ))}
      </div>

      {status === 'idle' || status === 'loading' ? (
        <p className={styles.loading}>Opening your library…</p>
      ) : null}

      {status === 'error' ? (
        <Notice tone="error" actions={<Button onClick={() => void refresh()}>Try again</Button>}>
          {error}
        </Notice>
      ) : null}

      {isEmpty ? (
        <div className={styles.empty}>
          <p className={styles.lead}>Bring in a clip to make your first signature.</p>
          <Button variant="primary" onClick={newFromClip} disabled={busy !== null}>
            New from clip
          </Button>
          <p className={styles.hint}>
            You can also import a signature or composition file, or restore a backup, with the
            buttons above.
          </p>
        </div>
      ) : null}

      {ready && !isEmpty ? (
        <>
          <section className={styles.section} aria-labelledby="signatures-heading">
            <div className={styles.sectionHead}>
              <h2 id="signatures-heading" ref={signaturesHeading} tabIndex={-1}>
                Signatures
              </h2>
              <span className={styles.count}>{signatures.length}</span>
            </div>
            {signatures.length === 0 ? (
              <p className={styles.sectionEmpty}>No signatures yet. Bring in a clip to make one.</p>
            ) : (
              <ul className={styles.grid} aria-labelledby="signatures-heading">
                {signatures.map((meta) => {
                  const name = signatureName(meta.name);
                  const uses = usage[meta.id] ?? 0;
                  return (
                    <LibraryCard
                      key={meta.id}
                      name={name}
                      thumbnail={meta.thumbnail || undefined}
                      details={[
                        uses > 0
                          ? `${formatDuration(meta.durationSec)} · used in ${countOf(uses, 'composition', 'compositions')}`
                          : `${formatDuration(meta.durationSec)} of movement`,
                        `Changed ${formatChanged(meta.updatedAt)}`,
                      ]}
                      renaming={renaming?.kind === 'signature' && renaming.id === meta.id}
                      onOpen={() => openSignature(meta.id)}
                      onRename={(next) => renameItem('signature', meta.id, next)}
                      onRenameEnd={() => setRenaming(null)}
                      menu={[
                        { label: 'Start a composition', onSelect: () => startComposition(meta.id) },
                        {
                          label: 'Rename',
                          onSelect: () => setRenaming({ kind: 'signature', id: meta.id }),
                        },
                        {
                          label: 'Duplicate',
                          onSelect: () => void duplicateItem('signature', meta.id),
                        },
                        {
                          label: 'Export file',
                          onSelect: () => void exportItem('signature', meta.id),
                        },
                        {
                          label: 'Delete',
                          tone: 'danger',
                          onSelect: () => askDeleteSignature(meta),
                        },
                      ]}
                    />
                  );
                })}
              </ul>
            )}
          </section>

          <section className={styles.section} aria-labelledby="compositions-heading">
            <div className={styles.sectionHead}>
              <h2 id="compositions-heading" ref={compositionsHeading} tabIndex={-1}>
                Compositions
              </h2>
              <span className={styles.count}>{compositions.length}</span>
            </div>
            {compositions.length === 0 ? (
              <p className={styles.sectionEmpty}>
                No compositions yet. Open a signature and start a composition to make one.
              </p>
            ) : (
              <ul className={styles.grid} aria-labelledby="compositions-heading">
                {compositions.map(({ composition: c, signatureAvailable }) => {
                  const name = compositionName(c.name);
                  const status =
                    c.status === 'kept'
                      ? ' · kept'
                      : c.status === 'set-aside'
                        ? ' · set aside'
                        : '';
                  return (
                    <LibraryCard
                      key={c.id}
                      name={name}
                      thumbnail={c.thumbnail}
                      details={[
                        `From “${signatureName(c.signature.name)}”${status}`,
                        `Changed ${formatChanged(c.updatedAt)}`,
                      ]}
                      warning={
                        signatureAvailable
                          ? undefined
                          : `Needs its signature, “${signatureName(c.signature.name)}”. Import that file to play it.`
                      }
                      renaming={renaming?.kind === 'composition' && renaming.id === c.id}
                      onOpen={() => openComposition(c.id)}
                      onRename={(next) => renameItem('composition', c.id, next)}
                      onRenameEnd={() => setRenaming(null)}
                      menu={[
                        {
                          label: 'Rename',
                          onSelect: () => setRenaming({ kind: 'composition', id: c.id }),
                        },
                        {
                          label: 'Duplicate',
                          onSelect: () => void duplicateItem('composition', c.id),
                        },
                        {
                          label: 'Export file',
                          onSelect: () => void exportItem('composition', c.id),
                        },
                        {
                          label: 'Delete',
                          tone: 'danger',
                          onSelect: () =>
                            setPending({ kind: 'delete-composition', composition: c }),
                        },
                      ]}
                    />
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.kind === 'restore'
            ? 'Restore from backup?'
            : pending?.kind === 'delete-signature'
              ? `Delete “${signatureName(pending.meta.name)}”?`
              : pending?.kind === 'delete-composition'
                ? `Delete “${compositionName(pending.composition.name)}”?`
                : ''
        }
        confirmLabel={pending?.kind === 'restore' ? 'Restore' : 'Delete'}
        tone={pending?.kind === 'restore' ? 'default' : 'danger'}
        busy={busy !== null}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      >
        {pending ? <PendingDescription pending={pending} /> : null}
      </ConfirmDialog>
    </section>
  );
}

function PendingDescription({ pending }: { pending: Pending }) {
  if (pending.kind === 'restore') {
    return (
      <p>
        Everything in “{pending.file.name}” will be added to your library. Items that are already
        here are replaced with their backed-up versions. Nothing else is removed.
      </p>
    );
  }
  if (pending.kind === 'delete-composition') {
    return (
      <p>
        This removes the composition and its notes from this browser. Export it first if you might
        want it later.
      </p>
    );
  }
  const { uses, twin } = pending;
  if (uses === 0) {
    return (
      <p>
        This removes the signature from this browser. Export it first if you might want it later.
      </p>
    );
  }
  const used = countOf(uses, 'composition uses', 'compositions use');
  return twin ? (
    <p>
      {used} this signature. {uses === 1 ? 'It' : 'They'} will switch to its copy, “
      {signatureName(twin.name)}”.
    </p>
  ) : (
    <p>
      {used} this signature. {uses === 1 ? 'It stays' : 'They stay'} in your library, but{' '}
      {uses === 1 ? "it can't" : "they can't"} play until the signature is imported again. Export it
      first if you might want it later.
    </p>
  );
}
