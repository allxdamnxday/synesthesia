/**
 * The folder renders are saved into (SPEC 10.2 step 6): chosen once per session with the
 * File System Access folder picker, remembered for the rest of the session, and its name
 * kept in settings (`renderFolderHint`) so the next session can say which folder was used.
 *
 * Browsers without the File System Access API (and people who decline the picker) get
 * downloads instead: `canSaveToFolder()` says which applies.
 *
 * The folder handle lives only in memory: after a reload the person picks the folder again
 * (the picker opens where they left off). Keeping handles across sessions would need
 * Chrome's "allow on every visit" permission, which is worth revisiting after handover.
 */
import { create } from 'zustand';
import { getSetting, setSetting } from '../library/settings';

/** Chromium's File System Access additions that TypeScript's DOM types don't include. */
interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}
type PermissionMode = { mode: 'read' | 'readwrite' };
interface PermissionHandle {
  queryPermission?: (options: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (options: PermissionMode) => Promise<PermissionState>;
}
type PickerWindow = Window & {
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
};

/** The picker remembers the last folder chosen under this id and opens there next time. */
export const RENDER_FOLDER_PICKER_ID = 'sp-renders';

export interface RenderFolderState {
  /** The folder chosen this session, or null. */
  handle: FileSystemDirectoryHandle | null;
  /** The name of the folder used last (this session or an earlier one), or ''. */
  hint: string;
}

export const useRenderFolder = create<RenderFolderState>()(() => ({ handle: null, hint: '' }));

let hintLoaded: Promise<void> | null = null;

/** Load the remembered folder name from settings (once). */
export function loadRenderFolderHint(): Promise<void> {
  hintLoaded ??= getSetting('renderFolderHint')
    .then((hint) => {
      if (!useRenderFolder.getState().hint) useRenderFolder.setState({ hint });
    })
    .catch(() => {
      // Settings unavailable: no reminder, nothing else changes.
    });
  return hintLoaded;
}

/** True when this browser can save renders straight into a folder. */
export function canSaveToFolder(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof (window as PickerWindow).showDirectoryPicker === 'function' &&
    window.self === window.top
  );
}

/** The folder chosen this session, if any. */
export function getRenderFolder(): FileSystemDirectoryHandle | null {
  return useRenderFolder.getState().handle;
}

export type FolderChoice =
  | { ok: true; handle: FileSystemDirectoryHandle }
  | { ok: false; reason: 'unavailable' | 'declined' | 'blocked'; message: string };

export const FOLDER_MESSAGES = {
  unavailable: 'This browser can’t save into a folder, so renders go to your downloads.',
  declined: 'No folder was chosen, so this render will go to your downloads.',
  blocked:
    'That folder can’t be used. Choose or make a folder of your own, for example a “Renders” folder inside Movies or Documents.',
  permission: 'The instrument needs permission to save into the folder. Choose it again.',
} as const;

/**
 * Show the folder picker. Call it straight from a click (the browser requires a user
 * gesture). Remembers the folder for the session and its name in settings.
 */
export async function chooseRenderFolder(): Promise<FolderChoice> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (!canSaveToFolder() || !picker) {
    return { ok: false, reason: 'unavailable', message: FOLDER_MESSAGES.unavailable };
  }
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await picker.call(window, {
      id: RENDER_FOLDER_PICKER_ID,
      mode: 'readwrite',
      startIn: 'videos',
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    // AbortError: the picker was closed. SecurityError/NotAllowedError: a system folder
    // was chosen or write access was refused.
    return name === 'AbortError'
      ? { ok: false, reason: 'declined', message: FOLDER_MESSAGES.declined }
      : { ok: false, reason: 'blocked', message: FOLDER_MESSAGES.blocked };
  }
  useRenderFolder.setState({ handle, hint: handle.name });
  void setSetting('renderFolderHint', handle.name).catch(() => {
    // The reminder is a convenience; the folder still works this session.
  });
  return { ok: true, handle };
}

/**
 * Make sure the session's folder can still be written to, asking again if the browser
 * wants to (call from a click). False means the person should choose the folder again.
 */
export async function ensureFolderPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & PermissionHandle;
  const mode: PermissionMode = { mode: 'readwrite' };
  try {
    if (!h.queryPermission) return true;
    if ((await h.queryPermission(mode)) === 'granted') return true;
    if (!h.requestPermission) return false;
    return (await h.requestPermission(mode)) === 'granted';
  } catch {
    return false;
  }
}

/** Forget the session's folder (for example after it disappeared). The hint stays. */
export function forgetRenderFolder(): void {
  useRenderFolder.setState({ handle: null });
}

/** Tests and harness pages: use a folder without the picker (e.g. the origin-private one). */
export function setRenderFolderForTesting(handle: FileSystemDirectoryHandle | null): void {
  useRenderFolder.setState({ handle, hint: handle?.name ?? useRenderFolder.getState().hint });
}
