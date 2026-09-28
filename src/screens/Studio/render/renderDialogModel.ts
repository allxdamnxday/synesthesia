/**
 * The render dialog's choices and words (SPEC 10.1), kept apart from the component so
 * they can be tested. Plain, calm, sentence case; no engineering terms.
 */
import type { Composition } from '../../../engine/composition';
import type { Quality } from '../../../materials/types';
import type { RenderProgress, RenderResult } from '../../../render';
import type { RenderDefaults } from '../../../render/capabilities';
import { RENDER_RESOLUTIONS, type RenderResolution } from '../../../library/settings';

export const RESOLUTION_CHOICES: readonly {
  value: RenderResolution;
  label: string;
  detail: string;
}[] = [
  { value: '720p', label: '720p', detail: '1280 × 720' },
  { value: '1080p', label: '1080p', detail: '1920 × 1080' },
  { value: 'square', label: 'Square', detail: '1080 × 1080' },
];

export const FPS_CHOICES: readonly (30 | 60)[] = [30, 60];

export const QUALITY_CHOICES: readonly { value: Quality; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'standard', label: 'Standard' },
  { value: 'draft', label: 'Draft' },
];

export const COPY = {
  title: 'Render MP4',
  size: 'Size',
  fps: 'Frames per second',
  quality: 'Quality',
  qualityHint: 'High looks best. Standard and Draft finish sooner, with less detail.',
  loudness: 'Even out loudness',
  loudnessHint:
    'Brings the loudest moment up to just below full volume. Turn it off to keep quiet compositions quiet.',
  sidecar: 'Also save the composition file',
  sidecarHint:
    'Saves this composition’s settings next to the video, so you can open it again later.',
  saveTo: 'Save to',
  folder: 'A folder',
  downloads: 'Downloads',
  downloadsOnly: 'Renders go to your downloads (this browser can’t save straight into a folder).',
  chooseFolder: 'Choose folder…',
  changeFolder: 'Change folder…',
  noFolderYet: 'You’ll choose the folder when you render.',
  folderTip: 'Tip: make a folder of your own for renders, for example inside Movies or Documents.',
  checking: 'Checking what this computer can make…',
  cancelled: 'The render was cancelled. Nothing was saved.',
  render: 'Render',
  cancel: 'Cancel',
  cancelRender: 'Cancel render',
  close: 'Close',
  finished: 'Render finished',
  rendering: 'Rendering',
  squareUnavailable: 'Square isn’t available on this computer.',
  mutedSound: 'The sound is muted, so the video will be silent.',
  mutedVisual: 'The picture is muted, so the video will be black.',
} as const;

/** The size to start with: the settings' choice if it works here, else the largest that does. */
export function initialResolution(
  preferred: RenderResolution,
  available: Readonly<Record<RenderResolution, boolean>> | null,
): RenderResolution {
  if (!available || available[preferred]) return preferred;
  for (const choice of ['1080p', '720p', 'square'] as const) if (available[choice]) return choice;
  return preferred;
}

/** Plain notes about what this computer can't make (from the capability probe). */
export function availabilityNotes(defaults: RenderDefaults | null): string[] {
  if (!defaults) return [];
  const notes = [...defaults.notes];
  if (defaults.largestResolution && !defaults.resolutions.square)
    notes.push(COPY.squareUnavailable);
  return notes;
}

export function mutedNotes(composition: Pick<Composition, 'mute'>): string[] {
  const notes: string[] = [];
  if (composition.mute.visual) notes.push(COPY.mutedVisual);
  if (composition.mute.sound) notes.push(COPY.mutedSound);
  return notes;
}

export function sizeOf(resolution: RenderResolution): { width: number; height: number } {
  return RENDER_RESOLUTIONS[resolution];
}

/** What the render is doing, in a few words. */
export function phaseText(progress: RenderProgress | null): string {
  if (!progress) return 'Getting ready…';
  switch (progress.phase) {
    case 'starting':
      return 'Getting ready…';
    case 'sound':
      return 'Making the sound…';
    case 'frames':
      return `Drawing frames… ${progress.framesDone} of ${progress.frameCount}`;
    case 'finishing':
      return 'Finishing…';
    case 'done':
      return COPY.finished;
  }
}

/** Where the finished file went, in a sentence. */
export function doneText(
  result: Pick<RenderResult, 'fileName' | 'destination' | 'folderName'>,
): string {
  if (result.destination === 'folder') {
    return `“${result.fileName}” is in the folder “${result.folderName ?? ''}”.`;
  }
  if (result.destination === 'download') {
    return `“${result.fileName}” was saved to your downloads.`;
  }
  return `“${result.fileName}” is ready.`;
}

export function sidecarText(
  result: Pick<RenderResult, 'sidecarFileName' | 'destination'>,
): string | null {
  if (!result.sidecarFileName) return null;
  return result.destination === 'download'
    ? `The composition file “${result.sidecarFileName}” was saved too.`
    : `The composition file “${result.sidecarFileName}” is next to it.`;
}
