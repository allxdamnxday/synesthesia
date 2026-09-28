/**
 * Working state (SPEC 11.1): the Studio's debounced autosave and similar scratch data,
 * so a crash or a closed tab loses nothing. Values must be structured-cloneable.
 */
import { openLibraryDb } from './db';

export async function saveWorkingState(key: string, value: unknown): Promise<void> {
  const db = await openLibraryDb();
  await db.put('workingState', value, key);
}

export async function loadWorkingState<T>(key: string): Promise<T | undefined> {
  const db = await openLibraryDb();
  return (await db.get('workingState', key)) as T | undefined;
}

export async function clearWorkingState(key: string): Promise<void> {
  const db = await openLibraryDb();
  await db.delete('workingState', key);
}
