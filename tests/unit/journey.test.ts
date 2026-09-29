import { describe, expect, it } from 'vitest';
import {
  isStepDone,
  journeySteps,
  nextJourneyStep,
  type JourneyFacts,
} from '../../src/screens/Library/journey';

const facts = (patch: Partial<JourneyFacts> = {}): JourneyFacts => ({
  signatures: 0,
  compositions: 0,
  albums: 0,
  videoRendered: false,
  ...patch,
});

const states = (f: JourneyFacts) => journeySteps(f).map((s) => `${s.id}:${s.state}`);

describe('the Library’s how-it-works steps', () => {
  it('starts with making a signature', () => {
    expect(states(facts())).toEqual([
      'signature:current',
      'composition:upcoming',
      'share:upcoming',
    ]);
    expect(nextJourneyStep(facts())).toBe('signature');
  });

  it('moves on to a composition once a signature exists', () => {
    const f = facts({ signatures: 1 });
    expect(states(f)).toEqual(['signature:done', 'composition:current', 'share:upcoming']);
    expect(nextJourneyStep(f)).toBe('composition');
  });

  it('then to a video or an album', () => {
    const f = facts({ signatures: 2, compositions: 1 });
    expect(states(f)).toEqual(['signature:done', 'composition:done', 'share:current']);
    expect(nextJourneyStep(f)).toBe('share');
  });

  it('counts an album or a finished render as the last step', () => {
    const album = facts({ signatures: 1, compositions: 4, albums: 1 });
    const video = facts({ signatures: 1, compositions: 1, videoRendered: true });
    for (const f of [album, video]) {
      expect(states(f)).toEqual(['signature:done', 'composition:done', 'share:done']);
      expect(nextJourneyStep(f)).toBeNull();
    }
    expect(isStepDone('share', facts({ videoRendered: true }))).toBe(true);
    expect(isStepDone('share', facts({ compositions: 3 }))).toBe(false);
  });

  it('goes back to the first step not done, keeping later ones that are', () => {
    // Every signature deleted, its compositions kept (waiting for it to be imported again).
    const f = facts({ compositions: 2 });
    expect(states(f)).toEqual(['signature:current', 'composition:done', 'share:upcoming']);
    expect(nextJourneyStep(f)).toBe('signature');
  });

  it('has exactly one current step until every step is done', () => {
    for (const signatures of [0, 1]) {
      for (const compositions of [0, 3]) {
        for (const albums of [0, 1]) {
          for (const videoRendered of [false, true]) {
            const steps = journeySteps(facts({ signatures, compositions, albums, videoRendered }));
            const current = steps.filter((s) => s.state === 'current').length;
            const allDone = steps.every((s) => s.state === 'done');
            expect(current).toBe(allDone ? 0 : 1);
          }
        }
      }
    }
  });
});
