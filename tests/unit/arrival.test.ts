import { describe, expect, it } from 'vitest';
import { screenKey } from '../../src/app/arrival';

describe('which screen a path shows (a new one starts at the top)', () => {
  it('tells the screens apart', () => {
    const keys = [
      '/',
      '/prepare',
      '/signature/a',
      '/signature/b',
      '/studio/new/a',
      '/album/new/a',
      '/album/x',
      '/album/y',
      '/settings',
      '/help',
      '/guide',
      '/diagnostics',
    ].map(screenKey);
    // /studio/new/a and the others are all different screens.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the Studio one screen through a first save and Save as new', () => {
    expect(screenKey('/studio/new/sig')).toBe(screenKey('/studio/comp-1'));
    expect(screenKey('/studio/comp-1')).toBe(screenKey('/studio/comp-2'));
  });

  it('leaves the guide to bring its own sections into view', () => {
    expect(screenKey('/guide')).toBe(screenKey('/guide/studio'));
    expect(screenKey('/guide/albums')).toBe(screenKey('/guide/backup'));
  });

  it('treats a generated album as a new screen after the New album form', () => {
    expect(screenKey('/album/new/sig')).not.toBe(screenKey('/album/abc'));
    expect(screenKey('/album/new/sig-1')).not.toBe(screenKey('/album/new/sig-2'));
  });

  it('ignores a query and trailing slashes', () => {
    expect(screenKey('/settings?x=1')).toBe(screenKey('/settings'));
    expect(screenKey('/signature/a/')).toBe(screenKey('/signature/a'));
    expect(screenKey('')).toBe(screenKey('/'));
  });
});
