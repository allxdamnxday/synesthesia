/**
 * Storage capabilities (SPEC 14.1): folder saving for renders, whether the browser has
 * made storage persistent, and how much space is available.
 *
 * This only *reads* persistence (`navigator.storage.persisted()`); asking for it
 * (`persist()`) belongs to Settings, where the artist chooses to.
 */
import { checkBase } from './definitions';
import type { CapabilityCheck } from './types';
import { errorMessage, formatBytes, withTimeout } from './util';

/** Warn below this much browser storage. */
export const LOW_QUOTA_BYTES = 1_000_000_000;

export interface StorageProbe {
  /** `showDirectoryPicker` exists (File System Access API). */
  folderSaving: boolean;
  /** `navigator.storage.persisted()`; null when the API is missing or failed. */
  persisted: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
  secureContext: boolean;
  error: string | null;
}

/** Read storage facts. Never throws. */
export async function probeStorage(): Promise<StorageProbe> {
  const probe: StorageProbe = {
    folderSaving: typeof window !== 'undefined' && 'showDirectoryPicker' in window,
    persisted: null,
    usageBytes: null,
    quotaBytes: null,
    secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : false,
    error: null,
  };
  const manager = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  const errors: string[] = [];
  if (manager && typeof manager.persisted === 'function') {
    try {
      probe.persisted = await withTimeout(manager.persisted(), 3000, 'persisted()');
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }
  if (manager && typeof manager.estimate === 'function') {
    try {
      const estimate = await withTimeout(manager.estimate(), 3000, 'estimate()');
      probe.usageBytes = estimate.usage ?? null;
      probe.quotaBytes = estimate.quota ?? null;
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }
  probe.error = errors.length > 0 ? errors.join('; ') : null;
  return probe;
}

/** Folder saving, persistence and space rows. All optional: none of them blocks anything. */
export function assessStorage(probe: StorageProbe): CapabilityCheck[] {
  const folder: CapabilityCheck = {
    ...checkBase('folder-saving'),
    ...(probe.folderSaving
      ? {
          status: 'pass' as const,
          summary: 'Renders can be saved straight into a folder you choose.',
          detail: 'File System Access API (showDirectoryPicker): yes',
        }
      : {
          status: 'warn' as const,
          summary: 'Renders download instead of saving to a folder.',
          detail: `File System Access API (showDirectoryPicker): no${
            probe.secureContext ? '' : ' (the page is not a secure context)'
          }`,
        }),
  };

  const persistedDetail = `navigator.storage.persisted(): ${
    probe.persisted === null ? 'unavailable' : String(probe.persisted)
  }${probe.error ? `\nError: ${probe.error}` : ''}`;
  let persistence: CapabilityCheck;
  if (probe.persisted === true) {
    persistence = {
      ...checkBase('persistent-storage'),
      status: 'pass',
      summary: 'The browser will keep your library even when disk space runs low.',
      detail: persistedDetail,
    };
  } else {
    persistence = {
      ...checkBase('persistent-storage'),
      status: 'warn',
      summary:
        probe.persisted === false
          ? 'The browser may clear your library if the computer runs low on space, so make backups regularly.'
          : "Can't tell whether the browser will keep your library, so make backups regularly.",
      detail: persistedDetail,
    };
  }

  let space: CapabilityCheck;
  if (probe.quotaBytes === null) {
    space = {
      ...checkBase('storage-space'),
      status: 'warn',
      summary: "Couldn't read how much storage the browser allows.",
      detail: probe.error ?? 'navigator.storage.estimate() is unavailable',
    };
  } else {
    const used = formatBytes(probe.usageBytes ?? 0);
    const quota = formatBytes(probe.quotaBytes);
    const detail = `navigator.storage.estimate(): usage ${probe.usageBytes ?? '?'} bytes, quota ${probe.quotaBytes} bytes`;
    space =
      probe.quotaBytes < LOW_QUOTA_BYTES
        ? {
            ...checkBase('storage-space'),
            status: 'warn',
            summary: `Only ${quota} of browser storage is available. Free up disk space on this computer.`,
            detail,
          }
        : {
            ...checkBase('storage-space'),
            status: 'pass',
            summary: `${used} used of ${quota} the browser allows.`,
            detail,
          };
  }
  return [folder, persistence, space];
}
