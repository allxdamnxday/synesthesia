import { useCallback, useEffect, useState } from 'react';
import { href } from '../../app/router';
import {
  downloadBackup,
  formatBytes,
  getSettings,
  requestPersistence,
  storageEstimate,
  updateSettings,
  userMessage,
  type AppSettings,
  type PreviewQualitySetting,
  type RenderResolution,
} from '../../library';
import { Button } from '../../ui/Button';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Toggle } from '../../ui/Toggle';
import styles from './SettingsScreen.module.css';

const QUALITY_OPTIONS: Array<{ value: PreviewQualitySetting; label: string }> = [
  { value: 'auto', label: 'Automatic' },
  { value: 'draft', label: 'Draft' },
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'High' },
];

const RESOLUTION_OPTIONS: Array<{ value: RenderResolution; label: string }> = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: 'square', label: 'Square' },
];

const TIER_LABEL = { draft: 'Draft', standard: 'Standard', high: 'High' } as const;

function describeDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

interface StorageInfo {
  usage: string;
  quota: string;
}

export function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshStorage = useCallback(async () => {
    const estimate = await storageEstimate();
    setStorage(
      estimate ? { usage: formatBytes(estimate.usage), quota: formatBytes(estimate.quota) } : null,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getSettings().then((s) => {
      if (!cancelled) setSettings(s);
    });
    void refreshStorage();
    return () => {
      cancelled = true;
    };
  }, [refreshStorage]);

  // Controls respond at once; the change is saved in the background.
  const update = async (patch: Partial<AppSettings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current));
    try {
      setSettings(await updateSettings(patch));
    } catch (err) {
      setMessage(userMessage(err));
      setSettings(await getSettings());
    }
  };

  const askToKeep = async () => {
    setBusy(true);
    const outcome = await requestPersistence();
    await update({ persistence: outcome });
    setMessage(
      outcome === 'granted'
        ? 'This browser will keep your library.'
        : 'The browser didn’t agree to keep it. Backups are the safe way to keep your work.',
    );
    setBusy(false);
  };

  const backUp = async () => {
    setBusy(true);
    try {
      const { fileName } = await downloadBackup();
      setMessage(`Backup saved as ${fileName}. Keep it somewhere safe.`);
    } catch (err) {
      setMessage(userMessage(err));
    }
    setBusy(false);
  };

  if (!settings) {
    return (
      <section className={styles.page}>
        <h1>Settings</h1>
      </section>
    );
  }

  const qualityIndex = QUALITY_OPTIONS.findIndex((o) => o.value === settings.previewQuality);
  const resolutionIndex = RESOLUTION_OPTIONS.findIndex(
    (o) => o.value === settings.renderResolution,
  );
  const kept = settings.persistence === 'granted';

  return (
    <section className={styles.page}>
      <h1>Settings</h1>
      {message ? (
        <p className={styles.message} role="status">
          {message}
        </p>
      ) : null}

      <div className={styles.group}>
        <h2>Preview quality</h2>
        <p className={styles.hint}>
          How detailed the wake looks while you play. Automatic picks the most detailed level this
          computer shows smoothly. Renders always use full quality.
        </p>
        <SegmentedControl
          label="Preview quality"
          hideLabel
          options={QUALITY_OPTIONS.map((o) => o.label)}
          value={Math.max(0, qualityIndex)}
          onChange={(i) => void update({ previewQuality: QUALITY_OPTIONS[i]?.value ?? 'auto' })}
        />
        <p className={styles.hint} data-testid="benchmark-summary">
          {settings.benchmark
            ? `Automatic uses ${TIER_LABEL[settings.benchmark.tier]}, measured on this computer on ${describeDate(settings.benchmark.measuredAt)}.`
            : 'Automatic will measure this computer the first time the Studio opens.'}
        </p>
      </div>

      <div className={styles.group}>
        <h2>Renders</h2>
        <p className={styles.hint}>The size and smoothness new MP4 renders start with.</p>
        <div className={styles.row}>
          <SegmentedControl
            label="Size"
            options={RESOLUTION_OPTIONS.map((o) => o.label)}
            value={Math.max(0, resolutionIndex)}
            onChange={(i) =>
              void update({ renderResolution: RESOLUTION_OPTIONS[i]?.value ?? '1080p' })
            }
          />
          <SegmentedControl
            label="Frames per second"
            options={['30', '60']}
            value={settings.renderFps === 60 ? 1 : 0}
            onChange={(i) => void update({ renderFps: i === 1 ? 60 : 30 })}
          />
        </div>
      </div>

      <div className={styles.group}>
        <h2>Your library</h2>
        <p className={styles.hint}>
          Signatures and compositions live in this browser on this computer.
          {storage ? ` They use ${storage.usage} of about ${storage.quota} available.` : ''}
        </p>
        <p className={kept ? styles.good : styles.caution} data-testid="persistence-status">
          {kept
            ? 'This browser has agreed to keep your library.'
            : 'This browser may clear your library if the computer runs low on space.'}
        </p>
        <div className={styles.actions}>
          {kept ? null : (
            <Button onClick={() => void askToKeep()} disabled={busy}>
              Ask the browser to keep it
            </Button>
          )}
          <Button onClick={() => void backUp()} disabled={busy}>
            Back up everything
          </Button>
        </div>
      </div>

      <div className={styles.group}>
        <h2>Welcome</h2>
        <Toggle
          label="Show the dedication when the instrument opens"
          checked={settings.dedicationSplash}
          onChange={(checked) => void update({ dedicationSplash: checked })}
        />
        <div className={styles.actions}>
          <Button
            variant="quiet"
            onClick={() => {
              void update({ onboardingDone: false }).then(() =>
                setMessage('The introduction will show the next time you open the Library.'),
              );
            }}
          >
            Show the introduction again
          </Button>
        </div>
      </div>

      <div className={styles.group}>
        <h2>Diagnostics</h2>
        <p className={styles.hint}>
          Checks what this computer and browser can do, with a report you can copy and send.{' '}
          <a href={href('/diagnostics')}>Open Diagnostics</a>.
        </p>
      </div>
    </section>
  );
}
