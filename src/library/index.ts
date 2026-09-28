/**
 * The library: everything the person keeps in this browser (SPEC 11). Screens and
 * stores import from here.
 */
export {
  BACKUP_FILE_EXTENSION,
  backupFileName,
  createBackup,
  describeRestore,
  downloadBackup,
  readBackup,
  restoreBackup,
  type BackupContents,
  type RestoreCounts,
  type RestoreSummary,
} from './backup';
export {
  UNTITLED_COMPOSITION,
  compositionFileName,
  deleteComposition,
  duplicateComposition,
  exportCompositionFile,
  findSignatureForComposition,
  getComposition,
  importCompositionFile,
  importParsedComposition,
  listCompositions,
  listCompositionsBySignature,
  renameComposition,
  saveComposition,
  type CompositionImportResult,
} from './compositions';
export { DB_NAME, DB_VERSION, closeLibraryDb, openLibraryDb } from './db';
export { downloadBlob, downloadText } from './download';
export { LibraryError, errorDetail, userMessage } from './errors';
export { IMPORT_MESSAGES, importLibraryFile, type LibraryImportResult } from './importFile';
export {
  DEFAULT_SETTINGS,
  RENDER_RESOLUTIONS,
  getSetting,
  getSettings,
  setSetting,
  updateSettings,
  type AppSettings,
  type PersistenceState,
  type PreviewQualitySetting,
  type RenderResolution,
} from './settings';
export {
  UNTITLED_SIGNATURE,
  countCompositionsForSignature,
  deleteSignature,
  duplicateSignature,
  exportSignatureFile,
  finalizeSignature,
  findSignatureMetaByHash,
  getSignature,
  getSignatureMeta,
  importParsedSignature,
  importSignatureFile,
  listSignatureMeta,
  renameSignature,
  saveSignature,
  signatureFileName,
  type SignatureImportOptions,
  type SignatureImportResult,
} from './signatures';
export {
  formatBytes,
  isStoragePersisted,
  requestPersistence,
  requestPersistenceOnce,
  storageEstimate,
  type StorageUsage,
} from './storage';
export { signatureThumbnail } from './thumbnails';
export type { SignatureMeta, StoredAlbum } from './types';
export { clearWorkingState, loadWorkingState, saveWorkingState } from './workingState';
