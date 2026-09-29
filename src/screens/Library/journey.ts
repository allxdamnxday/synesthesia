/**
 * The journey the Library's "How it works" steps show: a signature from a clip, then a
 * composition, then a video or an album. Each step is done when the library can tell:
 * signatures and compositions exist, an album exists, or a render has finished (a setting,
 * since single renders leave no record in the library). The first step not yet done is the
 * current one; the steps after it are still to come.
 */

export type JourneyStepId = 'signature' | 'composition' | 'share';

export type JourneyStepState = 'done' | 'current' | 'upcoming';

export interface JourneyFacts {
  signatures: number;
  /** Every composition, album tracks included. */
  compositions: number;
  albums: number;
  /** A render has finished in the Studio at least once. */
  videoRendered: boolean;
}

export interface JourneyStep {
  id: JourneyStepId;
  state: JourneyStepState;
}

/** The steps, in order. */
export const JOURNEY: readonly JourneyStepId[] = ['signature', 'composition', 'share'];

/** Whether the library shows that this step has been taken. */
export function isStepDone(id: JourneyStepId, facts: JourneyFacts): boolean {
  switch (id) {
    case 'signature':
      return facts.signatures > 0;
    case 'composition':
      return facts.compositions > 0;
    case 'share':
      return facts.albums > 0 || facts.videoRendered;
  }
}

/** Every step with its state: done, current (the first one not done), or still to come. */
export function journeySteps(facts: JourneyFacts): JourneyStep[] {
  let current: JourneyStepId | null = null;
  return JOURNEY.map((id) => {
    if (isStepDone(id, facts)) return { id, state: 'done' };
    if (current === null) {
      current = id;
      return { id, state: 'current' };
    }
    return { id, state: 'upcoming' };
  });
}

/** The step to take next, or null when every step is done. */
export function nextJourneyStep(facts: JourneyFacts): JourneyStepId | null {
  return journeySteps(facts).find((s) => s.state === 'current')?.id ?? null;
}
