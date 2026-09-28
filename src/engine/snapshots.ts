/**
 * Snapshots A–D (SPEC 6.3): temporary slots holding a composition state for quick
 * comparison. Recalling a snapshot never restarts playback; the Studio swaps materials
 * and values while the playhead keeps its place.
 */
import type { Composition } from './composition';

export const SNAPSHOT_SLOTS = ['A', 'B', 'C', 'D'] as const;
export type SnapshotSlot = (typeof SNAPSHOT_SLOTS)[number];

/** The parts of a composition a snapshot holds (everything that shapes the wake). */
export type SnapshotState = Pick<
  Composition,
  'seed' | 'timeline' | 'linked' | 'visual' | 'sound' | 'mute' | 'chance'
>;

export type Snapshots = Partial<Record<SnapshotSlot, SnapshotState>>;

export function takeSnapshot(composition: Composition): SnapshotState {
  return structuredClone({
    seed: composition.seed,
    timeline: composition.timeline,
    linked: composition.linked,
    visual: composition.visual,
    sound: composition.sound,
    mute: composition.mute,
    chance: composition.chance,
  });
}

export function applySnapshot(composition: Composition, snapshot: SnapshotState): Composition {
  return { ...composition, ...structuredClone(snapshot) };
}

/** Which parts differ between two states, so the Studio knows what to rebuild. */
export function snapshotChanges(
  a: SnapshotState,
  b: SnapshotState,
): { visualMaterial: boolean; soundMaterial: boolean; seed: boolean; timeline: boolean } {
  return {
    visualMaterial:
      a.visual.materialId !== b.visual.materialId ||
      a.visual.materialVersion !== b.visual.materialVersion,
    soundMaterial:
      a.sound.materialId !== b.sound.materialId ||
      a.sound.materialVersion !== b.sound.materialVersion,
    seed: a.seed !== b.seed,
    timeline: JSON.stringify(a.timeline) !== JSON.stringify(b.timeline),
  };
}
