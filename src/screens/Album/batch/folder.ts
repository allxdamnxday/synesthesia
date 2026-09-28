/**
 * Choosing where a batch's files go, and writing them there. Chrome offers the File
 * System Access API: the person picks a folder once per session and every render streams
 * into it with no download prompts. Elsewhere files go to the downloads folder.
 */
import type { RenderDestination } from './renderTracks';

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
};

/** Permission calls Chrome adds to handles (not yet in TypeScript's DOM types). */
interface PermissionedHandle {
  queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
}

/** Whether this browser can save straight into a folder the person picks. */
export function canChooseFolder(): boolean {
  return typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

/**
 * Ask the person for a folder. Returns null when they close the picker, and the
 * downloads folder when this browser can't pick folders.
 */
export async function chooseRenderFolder(): Promise<RenderDestination | null> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (typeof picker !== 'function') return { kind: 'downloads' };
  try {
    const handle = await picker.call(window, {
      id: 'synesthesia-renders',
      mode: 'readwrite',
      startIn: 'videos',
    });
    return { kind: 'folder', name: handle.name, handle };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

/**
 * Make sure the chosen folder can still be written (Chrome may ask again after a while).
 * Call it from a click: the browser only asks in response to one.
 */
export async function ensureWritable(destination: RenderDestination): Promise<boolean> {
  if (destination.kind !== 'folder') return true;
  const handle = destination.handle as FileSystemDirectoryHandle & PermissionedHandle;
  if (typeof handle.queryPermission !== 'function') return true;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  if (typeof handle.requestPermission !== 'function') return false;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** Write (or replace) one file in a folder. */
export async function writeToFolder(
  folder: FileSystemDirectoryHandle,
  fileName: string,
  data: Blob | string,
): Promise<void> {
  const file = await folder.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => undefined);
    throw err;
  }
}
