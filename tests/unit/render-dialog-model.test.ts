import { describe, expect, it } from 'vitest';
import type { RenderDefaults } from '../../src/render/capabilities';
import {
  COPY,
  RESOLUTION_CHOICES,
  availabilityNotes,
  doneText,
  initialResolution,
  mutedNotes,
  phaseText,
  sidecarText,
  sizeOf,
} from '../../src/screens/Studio/render/renderDialogModel';

const all = { '720p': true, '1080p': true, square: true } as const;

function defaults(overrides: Partial<RenderDefaults> = {}): RenderDefaults {
  return {
    resolutions: { ...all },
    largestResolution: '1080p',
    audioCodec: 'aac',
    audioBitrate: 192_000,
    notes: [],
    ...overrides,
  };
}

describe('render dialog choices', () => {
  it('offers the three SPEC sizes with their pixel sizes', () => {
    expect(RESOLUTION_CHOICES.map((c) => `${c.label} ${c.detail}`)).toEqual([
      '720p 1280 × 720',
      '1080p 1920 × 1080',
      'Square 1080 × 1080',
    ]);
    expect(sizeOf('720p')).toEqual({ width: 1280, height: 720 });
    expect(sizeOf('1080p')).toEqual({ width: 1920, height: 1080 });
    expect(sizeOf('square')).toEqual({ width: 1080, height: 1080 });
  });

  it('starts from the settings size when this computer can make it', () => {
    expect(initialResolution('square', all)).toBe('square');
    expect(initialResolution('1080p', null)).toBe('1080p');
    expect(initialResolution('1080p', { '720p': true, '1080p': false, square: false })).toBe(
      '720p',
    );
    expect(initialResolution('square', { '720p': true, '1080p': true, square: false })).toBe(
      '1080p',
    );
  });

  it('explains sizes and sound this computer can’t make', () => {
    expect(availabilityNotes(null)).toEqual([]);
    expect(availabilityNotes(defaults())).toEqual([]);
    const limited = defaults({
      resolutions: { '720p': true, '1080p': false, square: false },
      largestResolution: '720p',
      notes: ["1080p isn't available on this computer, so renders are 720p only."],
    });
    expect(availabilityNotes(limited)).toEqual([
      "1080p isn't available on this computer, so renders are 720p only.",
      COPY.squareUnavailable,
    ]);
  });

  it('says when a muted field makes the video black or silent', () => {
    expect(mutedNotes({ mute: { visual: false, sound: false } })).toEqual([]);
    expect(mutedNotes({ mute: { visual: true, sound: true } })).toEqual([
      COPY.mutedVisual,
      COPY.mutedSound,
    ]);
  });
});

describe('render dialog words', () => {
  it('names each phase plainly', () => {
    expect(phaseText(null)).toBe('Getting ready…');
    expect(phaseText({ phase: 'sound', framesDone: 0, frameCount: 90 })).toBe('Making the sound…');
    expect(phaseText({ phase: 'frames', framesDone: 12, frameCount: 90 })).toBe(
      'Drawing frames… 12 of 90',
    );
    expect(phaseText({ phase: 'finishing', framesDone: 90, frameCount: 90 })).toBe('Finishing…');
  });

  it('says where the file went', () => {
    const name = 'SP_Wink_Track-07_004217.mp4';
    expect(doneText({ fileName: name, destination: 'folder', folderName: 'Renders' })).toBe(
      `“${name}” is in the folder “Renders”.`,
    );
    expect(doneText({ fileName: name, destination: 'download', folderName: null })).toBe(
      `“${name}” was saved to your downloads.`,
    );
    expect(sidecarText({ sidecarFileName: null, destination: 'folder' })).toBeNull();
    expect(sidecarText({ sidecarFileName: 'a.spcomp.json', destination: 'folder' })).toBe(
      'The composition file “a.spcomp.json” is next to it.',
    );
    expect(sidecarText({ sidecarFileName: 'a.spcomp.json', destination: 'download' })).toBe(
      'The composition file “a.spcomp.json” was saved too.',
    );
  });

  it('keeps engineering words out of the main copy', () => {
    for (const text of Object.values(COPY)) {
      expect(text).not.toMatch(/\b(codec|fps|WebGL|encoder|bitrate|dBFS|H\.264|AAC)\b/i);
    }
  });
});
