/**
 * Browser storage health (SPEC 11.1, 14.1): asking the browser to keep the library
 * (persistent storage) and reporting how much space it uses.
 *
 * Chrome never shows a prompt for persist(); it grants it from engagement signals
 * (bookmarked, installed, often used). Without it the browser may clear the library
 * when the disk runs low, so the UI urges backups when it's denied.
 */
import { getSetting, setSetting, type PersistenceState } from './settings';

function storageManager(): StorageManager | undefined {
  return typeof navigator !== 'undefined' ? navigator.storage : undefined;
}

/** Whether the browser has agreed to keep the library; null when it can't say. */
export async function isStoragePersisted(): Promise<boolean | null> {
  const storage = storageManager();
  if (!storage || typeof storage.persisted !== 'function') return null;
  try {
    return await storage.persisted();
  } catch {
    return null;
  }
}

/** Ask the browser to keep the library (always asks) and remember the outcome. */
export async function requestPersistence(): Promise<PersistenceState> {
  const storage = storageManager();
  let outcome: PersistenceState;
  if (!storage || typeof storage.persist !== 'function') {
    outcome = 'unavailable';
  } else {
    try {
      outcome = (await storage.persisted()) || (await storage.persist()) ? 'granted' : 'denied';
    } catch {
      outcome = 'unavailable';
    }
  }
  await setSetting('persistence', outcome);
  return outcome;
}

let pending: Promise<PersistenceState> | null = null;

/**
 * Ask the browser to keep the library the first time anything is saved (SPEC 11.1).
 * Later calls return the remembered outcome without asking again. Never throws.
 */
export function requestPersistenceOnce(): Promise<PersistenceState> {
  pending ??= (async (): Promise<PersistenceState> => {
    try {
      const remembered = await getSetting('persistence');
      return remembered === 'not-asked' ? await requestPersistence() : remembered;
    } catch {
      return 'unavailable';
    }
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export interface StorageUsage {
  /** Bytes used by this app. */
  usage: number;
  /** Bytes the browser allows this app. */
  quota: number;
}

/** How much space the library uses; null when the browser can't say. */
export async function storageEstimate(): Promise<StorageUsage | null> {
  const storage = storageManager();
  if (!storage || typeof storage.estimate !== 'function') return null;
  try {
    const { usage, quota } = await storage.estimate();
    return usage === undefined || quota === undefined ? null : { usage, quota };
  } catch {
    return null;
  }
}

/** "12.3 MB"-style size for people. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  if (unit === 0) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
