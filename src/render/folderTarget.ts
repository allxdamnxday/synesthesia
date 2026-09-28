/**
 * Writing renders into a folder the person chose (SPEC 10.2 step 6, File System Access).
 *
 * The MP4 streams to disk as it is made: Mediabunny's StreamTarget sends positioned writes
 * to a WritableStream, which this module forwards to the file's FileSystemWritableFileStream.
 * Chrome writes into a temporary `.crswap` file next to the real one and only replaces the
 * real file when the stream closes, so a render that is cancelled or fails is aborted
 * (the temporary file disappears) and the empty placeholder is removed: nothing is left
 * behind. Existing files are never overwritten (see naming.ts).
 *
 * Works with any FileSystemDirectoryHandle, including the origin-private file system, which
 * the harness page uses to test this code without a folder picker.
 */
import type { StreamTargetChunk } from 'mediabunny';
import { MP4_EXTENSION, firstFreeNumber, numberedStem } from './naming';

/** Names in a folder, in lower case (folders on macOS and Windows usually ignore case). */
export async function takenNames(directory: FileSystemDirectoryHandle): Promise<Set<string>> {
  const names = new Set<string>();
  for await (const name of directory.keys()) names.add(name.toLowerCase());
  return names;
}

export interface FolderFile {
  /** The MP4's name in the folder. */
  readonly fileName: string;
  /** The number used to make the name unique (1 = the plain stem). */
  readonly number: number;
  /** Hand this to Mediabunny's StreamTarget. */
  readonly writable: WritableStream<StreamTargetChunk>;
  /** Call just before finalizing: the stream's close then keeps the file. */
  markComplete(): void;
  /** Stop writing and delete the file, keeping nothing. Never throws. */
  discard(): Promise<void>;
}

/**
 * Create `stem.mp4` (or `stem (n).mp4`, whichever is free, also checking that
 * `stem (n)` + every extension in `alsoFree` is free) and open it for streaming.
 */
export async function createFolderFile(
  directory: FileSystemDirectoryHandle,
  stem: string,
  alsoFree: readonly string[] = [],
): Promise<FolderFile> {
  const taken = await takenNames(directory);
  const number = firstFreeNumber(stem, [MP4_EXTENSION, ...alsoFree], taken);
  const fileName = `${numberedStem(stem, number)}${MP4_EXTENSION}`;
  const handle = await directory.getFileHandle(fileName, { create: true });
  let stream: FileSystemWritableFileStream;
  try {
    stream = await handle.createWritable();
  } catch (error) {
    await removeQuietly(directory, fileName);
    throw error;
  }

  let complete = false;
  let settled = false;
  const finish = async (keep: boolean): Promise<void> => {
    if (settled) return;
    settled = true;
    if (keep) await stream.close();
    else await stream.abort();
  };

  const writable = new WritableStream<StreamTargetChunk>({
    write: (chunk) => stream.write({ type: 'write', position: chunk.position, data: chunk.data }),
    // Mediabunny closes the stream both when it finishes and when it is cancelled.
    close: () => finish(complete),
    abort: () => finish(false),
  });

  return {
    fileName,
    number,
    writable,
    markComplete() {
      complete = true;
    },
    async discard() {
      try {
        await finish(false);
      } catch {
        // Already closed or broken; the file is removed below either way.
      }
      await removeQuietly(directory, fileName);
    },
  };
}

/** Write a small text file into the folder (replacing nothing: the caller picks a free name). */
export async function writeFolderText(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  text: string,
): Promise<void> {
  const handle = await directory.getFileHandle(fileName, { create: true });
  const stream = await handle.createWritable();
  try {
    await stream.write(text);
    await stream.close();
  } catch (error) {
    try {
      await stream.abort();
    } catch {
      // Nothing more to undo.
    }
    await removeQuietly(directory, fileName);
    throw error;
  }
}

/** Delete an entry if it exists. Never throws. */
export async function removeQuietly(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  try {
    await directory.removeEntry(name);
  } catch {
    // Missing already, or not ours to remove.
  }
}
