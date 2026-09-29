import { describe, expect, it } from 'vitest';
import { isCurrentNav } from '../../src/app/MainNav';

describe('main navigation', () => {
  it('marks an item current on its own screen and on the screens below it', () => {
    expect(isCurrentNav('/guide', '/guide')).toBe(true);
    expect(isCurrentNav('/guide', '/guide/studio')).toBe(true);
    expect(isCurrentNav('/help', '/help')).toBe(true);
    expect(isCurrentNav('/help', '/guide')).toBe(false);
    // A path that merely starts with the same letters is another screen.
    expect(isCurrentNav('/guide', '/guidebook')).toBe(false);
  });

  it('marks the Library current only on the Library itself', () => {
    expect(isCurrentNav('/', '/')).toBe(true);
    expect(isCurrentNav('/', '/studio/abc')).toBe(false);
    expect(isCurrentNav('/', '/guide')).toBe(false);
  });
});
