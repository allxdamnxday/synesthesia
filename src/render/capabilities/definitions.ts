/**
 * The list of capability checks (SPEC 14.1), in Diagnostics order. Labels are for the
 * Diagnostics screen, where engineering terms are fine.
 */
import type { CapabilityCheck, CheckGroup, CheckId, CheckImportance } from './types';

export interface CheckDefinition {
  id: CheckId;
  group: CheckGroup;
  label: string;
  importance: CheckImportance;
}

export const CHECK_DEFINITIONS: readonly CheckDefinition[] = [
  { id: 'webgl2', group: 'graphics', label: 'WebGL2', importance: 'required' },
  {
    id: 'float-targets',
    group: 'graphics',
    label: 'Half-float render targets',
    importance: 'required',
  },
  {
    id: 'float-formats',
    group: 'graphics',
    label: 'Compact float formats and signature texture',
    importance: 'preferred',
  },
  {
    id: 'audio-worklet',
    group: 'sound',
    label: 'Web Audio and AudioWorklet',
    importance: 'required',
  },
  { id: 'avc-720p', group: 'export', label: 'H.264 export at 720p', importance: 'required' },
  { id: 'avc-1080p', group: 'export', label: 'H.264 export at 1080p', importance: 'preferred' },
  { id: 'avc-square', group: 'export', label: 'H.264 export, square', importance: 'preferred' },
  { id: 'audio-encode', group: 'export', label: 'AAC audio export', importance: 'preferred' },
  { id: 'h264-decode', group: 'clips', label: 'H.264 clip import', importance: 'required' },
  { id: 'hevc-decode', group: 'clips', label: 'HEVC clip import', importance: 'optional' },
  {
    id: 'folder-saving',
    group: 'storage',
    label: 'Save renders to a folder',
    importance: 'optional',
  },
  {
    id: 'persistent-storage',
    group: 'storage',
    label: 'Persistent storage',
    importance: 'optional',
  },
  { id: 'storage-space', group: 'storage', label: 'Storage space', importance: 'optional' },
];

/** The fast, required checks the startup gate runs (SPEC 14.1: block with explanation). */
export const STARTUP_CHECK_IDS: readonly CheckId[] = ['webgl2', 'float-targets', 'audio-worklet'];

export const GROUP_LABELS: Record<CheckGroup, string> = {
  graphics: 'Graphics',
  sound: 'Sound',
  export: 'Exporting MP4',
  clips: 'Importing clips',
  storage: 'Storage',
};

/** id, group, label and importance for a check. */
export function checkBase(id: CheckId): CheckDefinition {
  const definition = CHECK_DEFINITIONS.find((d) => d.id === id);
  if (!definition) throw new Error(`Unknown capability check: ${id}`);
  return { ...definition };
}

/** A row that hasn't finished yet. */
export function pendingCheck(id: CheckId): CapabilityCheck {
  return { ...checkBase(id), status: 'pending', summary: 'Checking…' };
}
