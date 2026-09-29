/**
 * App settings (SPEC 6.5), stored one entry per setting in the `settings` store so
 * each can change on its own. Reads always return a complete, valid set: anything
 * missing or malformed falls back to its default.
 */
import { openLibraryDb } from './db';

export type PreviewQualitySetting = 'auto' | 'draft' | 'standard' | 'high';
export type RenderResolution = '720p' | '1080p' | 'square';
/** Outcome of asking the browser to keep the library (navigator.storage.persist()). */
export type PersistenceState = 'not-asked' | 'granted' | 'denied' | 'unavailable';

/** Result of the preview-quality benchmark (SPEC 14.2). */
export interface BenchmarkResult {
  tier: 'draft' | 'standard' | 'high';
  /** Sustained frames per second per tier, as measured. */
  fpsByTier: { draft: number; standard: number; high: number };
  /** ISO date/time of the measurement. */
  measuredAt: string;
}

export interface AppSettings {
  /** Preview quality tier; 'auto' uses the first-launch benchmark (SPEC 14.2). */
  previewQuality: PreviewQualitySetting;
  /** Default render size (SPEC 10.1). */
  renderResolution: RenderResolution;
  renderFps: 30 | 60;
  /** The optional "Made for Freeman" dedication splash (M8). */
  dedicationSplash: boolean;
  onboardingDone: boolean;
  /**
   * Where-to-go-next guidance: the "How it works" steps on the Library, the Studio's first-visit
   * tip and its note after a new composition's first save. Hide (or Settings) turns it off.
   */
  showGuidance: boolean;
  /** A render has finished in the Studio at least once (the Library's third step is done). */
  videoRendered: boolean;
  /** The Studio's first-visit tip has been shown. */
  studioTipSeen: boolean;
  /** Name of the folder renders were last saved to ('' if none), shown as a reminder. */
  renderFolderHint: string;
  persistence: PersistenceState;
  /** Last preview benchmark, used when previewQuality is 'auto'. */
  benchmark: BenchmarkResult | null;
}

export const DEFAULT_SETTINGS: Readonly<AppSettings> = {
  previewQuality: 'auto',
  renderResolution: '1080p',
  renderFps: 30,
  dedicationSplash: true,
  onboardingDone: false,
  showGuidance: true,
  videoRendered: false,
  studioTipSeen: false,
  renderFolderHint: '',
  persistence: 'not-asked',
  benchmark: null,
};

/** Pixel sizes of the render resolutions. */
export const RENDER_RESOLUTIONS: Readonly<
  Record<RenderResolution, { width: number; height: number }>
> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
};

const oneOf =
  <T extends string | number>(...allowed: T[]) =>
  (v: unknown): v is T =>
    (allowed as unknown[]).includes(v);
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isShortText = (v: unknown): v is string => typeof v === 'string' && v.length <= 500;
const isFps = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isBenchmark = (v: unknown): v is BenchmarkResult | null => {
  if (v === null) return true;
  if (typeof v !== 'object') return false;
  const b = v as Partial<BenchmarkResult>;
  return (
    (b.tier === 'draft' || b.tier === 'standard' || b.tier === 'high') &&
    typeof b.measuredAt === 'string' &&
    typeof b.fpsByTier === 'object' &&
    b.fpsByTier !== null &&
    isFps(b.fpsByTier.draft) &&
    isFps(b.fpsByTier.standard) &&
    isFps(b.fpsByTier.high)
  );
};

const VALID: { [K in keyof AppSettings]: (v: unknown) => v is AppSettings[K] } = {
  previewQuality: oneOf<PreviewQualitySetting>('auto', 'draft', 'standard', 'high'),
  renderResolution: oneOf<RenderResolution>('720p', '1080p', 'square'),
  renderFps: oneOf<30 | 60>(30, 60),
  dedicationSplash: isBoolean,
  onboardingDone: isBoolean,
  showGuidance: isBoolean,
  videoRendered: isBoolean,
  studioTipSeen: isBoolean,
  renderFolderHint: isShortText,
  persistence: oneOf<PersistenceState>('not-asked', 'granted', 'denied', 'unavailable'),
  benchmark: isBenchmark,
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[];

export function isSettingKey(key: string): key is keyof AppSettings {
  return (SETTING_KEYS as string[]).includes(key);
}

/** A complete, valid settings object from whatever was stored. */
export function sanitizeSettings(stored: Readonly<Record<string, unknown>>): AppSettings {
  const settings = { ...DEFAULT_SETTINGS } as Record<keyof AppSettings, unknown>;
  for (const key of SETTING_KEYS) {
    const value = stored[key];
    if (VALID[key](value)) settings[key] = value;
  }
  return settings as unknown as AppSettings;
}

export async function getSettings(): Promise<AppSettings> {
  const db = await openLibraryDb();
  const tx = db.transaction('settings');
  const [keys, values] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll(), tx.done]);
  const stored: Record<string, unknown> = {};
  keys.forEach((key, i) => (stored[key] = values[i]));
  return sanitizeSettings(stored);
}

export async function getSetting<K extends keyof AppSettings>(key: K): Promise<AppSettings[K]> {
  const db = await openLibraryDb();
  const value = await db.get('settings', key);
  return VALID[key](value) ? value : DEFAULT_SETTINGS[key];
}

export async function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  if (!VALID[key](value)) throw new Error(`Invalid value for setting "${key}"`);
  const db = await openLibraryDb();
  await db.put('settings', value, key);
}

/** Change several settings at once; returns the full settings afterwards. */
export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const db = await openLibraryDb();
  const tx = db.transaction('settings', 'readwrite');
  const writes: Promise<unknown>[] = [];
  for (const key of SETTING_KEYS) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!VALID[key](value)) throw new Error(`Invalid value for setting "${key}"`);
    writes.push(tx.store.put(value, key));
  }
  await Promise.all([...writes, tx.done]);
  return getSettings();
}
