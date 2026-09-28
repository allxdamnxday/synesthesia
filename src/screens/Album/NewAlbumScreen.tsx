import { useEffect, useId, useMemo, useState } from 'react';
import { href, navigate } from '../../app/router';
import { SIGNATURE_VIEW_ID } from '../../materials/registry';
import type { MaterialMeta } from '../../materials/types';
import {
  createAlbumFromPlan,
  errorDetail,
  getSignature,
  getSignatureMeta,
  installedMaterials,
  pairingCount,
  userMessage,
} from '../../library';
import type { KineticSignature } from '../../signature/types';
import { formatSeed, newSeed, parseSeed } from '../../state/seed';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Notice } from '../../ui/Notice';
import { SeedField } from '../../ui/SeedField';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Toggle } from '../../ui/Toggle';
import { formatDuration } from '../Library/format';
import { signatureName } from '../Library/importSummary';
import {
  OPEN_COUNTS,
  PAIRING_OPTIONS,
  checkForm,
  describeOpen,
  describeShape,
  initialForm,
  planNote,
  type NewAlbumForm,
} from './newAlbumForm';
import styles from './NewAlbumScreen.module.css';

type Loaded =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; signature: KineticSignature; thumbnail: string };

const SIGNATURE_VIEW_NOTE =
  'The bare signature, shown directly rather than through a material. Off unless you want it.';

/**
 * New album (SPEC 12.3 step 1): title, the source signature, the number of tracks, a
 * master seed, the eligible materials, how many properties chance opens per track, the
 * pairing, and whether chance also chooses values. Generate makes the drafts.
 */
export function NewAlbumScreen({ params }: { params?: Record<string, string> }) {
  const signatureId = params?.signatureId ?? '';
  const materials = useMemo(() => installedMaterials(), []);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [form, setForm] = useState<NewAlbumForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const idBase = useId();
  const ids = {
    title: `${idBase}-title`,
    tracks: `${idBase}-tracks`,
    tracksNote: `${idBase}-tracks-note`,
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [signature, meta] = await Promise.all([
          getSignature(signatureId),
          getSignatureMeta(signatureId),
        ]);
        if (cancelled) return;
        if (!signature) {
          setLoaded({ status: 'missing' });
          return;
        }
        setLoaded({ status: 'ready', signature, thumbnail: meta?.thumbnail ?? '' });
        setForm((current) => current ?? initialForm(signature.name, newSeed(), materials));
      } catch (err) {
        if (cancelled) return;
        console.error(errorDetail(err));
        setLoaded({ status: 'error', message: userMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signatureId, materials]);

  const check = useMemo(() => (form ? checkForm(form, materials) : null), [form, materials]);
  const note = useMemo(
    () => (check?.settings ? planNote(check.settings, materials) : null),
    [check, materials],
  );

  if (loaded.status === 'loading' || (loaded.status === 'ready' && !form)) {
    return (
      <section className={styles.page}>
        <p className={styles.loading}>Opening the signature…</p>
      </section>
    );
  }
  if (loaded.status === 'missing') {
    return (
      <section className={styles.page} aria-labelledby="new-album-title">
        <h1 id="new-album-title" className={styles.title}>
          New album
        </h1>
        <p className={styles.hint}>
          This signature isn’t in your library any more, so an album can’t be made from it.{' '}
          <a href={href('/')}>Go to the library</a>.
        </p>
      </section>
    );
  }
  if (loaded.status === 'error' || !form || !check) {
    return (
      <section className={styles.page}>
        <Notice tone="error">
          {loaded.status === 'error' ? loaded.message : 'The signature could not be opened.'}
        </Notice>
      </section>
    );
  }

  const { signature, thumbnail } = loaded;
  const name = signatureName(signature.name);
  const update = (patch: Partial<NewAlbumForm>) =>
    setForm((current) => (current ? { ...current, ...patch } : current));
  const togglePool = (key: 'visualPool' | 'soundPool', id: string, on: boolean) =>
    setForm((current) => {
      if (!current) return current;
      const pool = current[key].filter((x) => x !== id);
      return { ...current, [key]: on ? [...pool, id] : pool };
    });
  const settings = check.settings;
  const trackCount = settings?.trackCount ?? 0;
  const pairs = settings ? pairingCount(settings) : 0;
  const pairing = PAIRING_OPTIONS.find((o) => o.value === form.strategy) ?? PAIRING_OPTIONS[1];

  const generate = async () => {
    if (!settings || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const album = await createAlbumFromPlan(signature, settings);
      navigate(`/album/${encodeURIComponent(album.id)}`, { replace: true });
    } catch (err) {
      console.error(errorDetail(err));
      setFailure(userMessage(err));
      setBusy(false);
    }
  };

  const materialBoxes = (
    kind: 'visualPool' | 'soundPool',
    metas: readonly MaterialMeta[],
    legend: string,
  ) => (
    <fieldset className={styles.pool}>
      <legend className={styles.label}>{legend}</legend>
      {metas.map((m) => (
        <Checkbox
          key={m.id}
          label={m.name}
          ariaLabel={m.name}
          description={
            m.id === SIGNATURE_VIEW_ID && kind === 'visualPool'
              ? SIGNATURE_VIEW_NOTE
              : m.description
          }
          checked={form[kind].includes(m.id)}
          onChange={(on) => togglePool(kind, m.id, on)}
          disabled={busy}
        />
      ))}
    </fieldset>
  );

  return (
    <section className={styles.page} aria-labelledby="new-album-title">
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <a href={href('/')}>Library</a>
        <span aria-hidden="true"> / </span>
        <span>New album</span>
      </nav>

      <header className={styles.header}>
        {thumbnail ? <img className={styles.thumb} src={thumbnail} alt="" /> : null}
        <div>
          <h1 id="new-album-title" className={styles.title}>
            New album
          </h1>
          <p className={styles.source}>
            From “{name}” · {formatDuration(signature.frameCount / signature.frameRate)} of movement
          </p>
        </div>
      </header>

      <p className={styles.intro}>
        Every track starts from this signature. Chance chooses each track’s materials and opens a
        few properties for play; every other property stays at its baseline, and if you unlock one
        in the Studio, the album records it.
      </p>

      {/* Not a <form>: Enter in a field (the seed, say) must never generate an album. */}
      <div className={styles.form}>
        <div className={styles.field}>
          <label htmlFor={ids.title} className={styles.label}>
            Title
          </label>
          <input
            id={ids.title}
            className={styles.text}
            type="text"
            value={form.title}
            maxLength={120}
            autoComplete="off"
            disabled={busy}
            onChange={(event) => update({ title: event.target.value })}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor={ids.tracks} className={styles.label}>
              Tracks
            </label>
            <input
              id={ids.tracks}
              className={styles.number}
              type="number"
              inputMode="numeric"
              min={1}
              max={40}
              step={1}
              value={form.trackText}
              disabled={busy}
              aria-invalid={check.errors.tracks ? true : undefined}
              aria-describedby={ids.tracksNote}
              onChange={(event) => update({ trackText: event.target.value })}
            />
            <p id={ids.tracksNote} className={check.errors.tracks ? styles.error : styles.hint}>
              {check.errors.tracks ?? 'From 1 to 40.'}
            </p>
          </div>
          <SeedField
            label="Master seed"
            value={form.seedText}
            onChange={(seedText) => update({ seedText })}
            onCommit={() => {
              const seed = parseSeed(form.seedText);
              if (seed !== null) update({ seedText: formatSeed(seed) });
            }}
            onNewSeed={() => update({ seedText: formatSeed(newSeed()) })}
            description="The same seed and settings always make the same album."
            error={check.errors.seed}
            disabled={busy}
          />
        </div>

        <div className={styles.pools}>
          {materialBoxes('visualPool', materials.visual, 'Visual materials')}
          {materialBoxes('soundPool', materials.sound, 'Sound materials')}
        </div>
        {check.errors.materials ? <p className={styles.error}>{check.errors.materials}</p> : null}

        <div className={styles.field}>
          <SegmentedControl
            label="Open properties per track"
            options={OPEN_COUNTS.map(String)}
            value={Math.max(0, OPEN_COUNTS.indexOf(form.openCount as 1 | 2 | 3))}
            onChange={(i) => update({ openCount: OPEN_COUNTS[i] ?? 2 })}
            disabled={busy}
          />
          <p className={styles.hint}>
            How many properties chance opens for play in each track, from the ones its two materials
            use.
          </p>
        </div>

        <div className={styles.field}>
          <SegmentedControl
            label="Pairing"
            options={PAIRING_OPTIONS.map((o) => o.label)}
            value={PAIRING_OPTIONS.indexOf(pairing)}
            onChange={(i) => update({ strategy: PAIRING_OPTIONS[i]?.value ?? 'grid' })}
            disabled={busy}
          />
          <p className={styles.hint}>{pairing.description}</p>
        </div>

        <div className={styles.field}>
          <Toggle
            label="Also choose values"
            checked={form.chooseValues}
            onChange={(chooseValues) => update({ chooseValues })}
            disabled={busy}
          />
          <p className={styles.hint}>
            Chance also sets where each open property starts. Otherwise they start at their
            baseline.
          </p>
        </div>

        <div className={styles.summary} aria-live="polite" data-testid="album-summary">
          {settings ? (
            <>
              <p className={styles.shape}>{describeShape(trackCount, settings.strategy, pairs)}</p>
              <p className={styles.hint}>
                {describeOpen(settings.openCount, settings.chooseValues)}
              </p>
              {note ? <p className={styles.note}>{note}</p> : null}
            </>
          ) : (
            <p className={styles.hint}>Fix the settings marked above to see the album.</p>
          )}
        </div>

        {failure ? (
          <Notice tone="error" onDismiss={() => setFailure(null)}>
            {failure}
          </Notice>
        ) : null}

        <div className={styles.actions}>
          <Button variant="primary" onClick={() => void generate()} disabled={busy || !settings}>
            {busy ? 'Making the drafts…' : 'Generate album'}
          </Button>
          <Button variant="quiet" onClick={() => navigate('/')} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </section>
  );
}
