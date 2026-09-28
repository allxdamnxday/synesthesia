/**
 * The Studio's autosave record (SPEC 11.1 `workingState`): the working composition as it
 * stood a moment ago, so a crash or a closed tab loses nothing. One record per
 * composition, and one per signature for a new composition that was never saved.
 */
import { GLOBAL_CONTROLS, type Composition } from '../engine/composition';
import {
  createComposition,
  defaultCompositionName,
  type NewCompositionInput,
} from '../engine/compositionFactory';
import { validateComposition } from '../engine/compositionSerialize';
import type { MaterialMeta } from '../materials/types';
import type { KineticSignature } from '../signature/types';

export const WORKING_KIND = 'sp-studio-working';

export interface WorkingRecord {
  kind: typeof WORKING_KIND;
  version: 1;
  composition: Composition;
  /** ISO time of the autosave. */
  savedAt: string;
}

/** What the Studio has open: a saved composition, or a new one from a signature. */
export type StudioTarget =
  { kind: 'composition'; compositionId: string } | { kind: 'new'; signatureId: string };

export function workingKey(target: StudioTarget): string {
  return target.kind === 'new'
    ? `studio:new:${target.signatureId}`
    : `studio:composition:${target.compositionId}`;
}

export function targetKey(target: StudioTarget): string {
  return target.kind === 'new'
    ? `new:${target.signatureId}`
    : `composition:${target.compositionId}`;
}

export function workingRecord(composition: Composition, savedAt: string): WorkingRecord {
  return { kind: WORKING_KIND, version: 1, composition, savedAt };
}

/**
 * The composition in a stored working record when it can be restored for this target:
 * well-formed, and the same composition (or, for a new one, the same signature).
 */
export function restorableComposition(raw: unknown, target: StudioTarget): Composition | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<WorkingRecord>;
  if (record.kind !== WORKING_KIND || record.version !== 1) return null;
  let composition: Composition;
  try {
    composition = validateComposition(record.composition);
  } catch {
    return null;
  }
  if (target.kind === 'composition' && composition.id !== target.compositionId) return null;
  if (target.kind === 'new' && composition.signature.id !== target.signatureId) return null;
  return composition;
}

/** Placeholder when no sound material is installed (the composition still needs one). */
export const NO_SOUND: MaterialMeta = {
  id: 'water',
  version: 1,
  name: 'Water',
  description: '',
  properties: [],
};

export interface FreshCompositionInput {
  id: string;
  now: string;
  seed: number;
  signature: Pick<KineticSignature, 'id' | 'name' | 'contentHash' | 'preferredSpeed'>;
  visual: MaterialMeta;
  sound: MaterialMeta | undefined;
  render: NewCompositionInput['render'];
}

/** A new composition from a signature, at both materials' baselines (SPEC 12). */
export function freshComposition(input: FreshCompositionInput): Composition {
  const sound = input.sound ?? NO_SOUND;
  const speedRange = GLOBAL_CONTROLS.speed;
  const preferred = Number.isFinite(input.signature.preferredSpeed)
    ? input.signature.preferredSpeed
    : speedRange.default;
  return createComposition({
    id: input.id,
    now: input.now,
    name: defaultCompositionName(input.signature.name, input.visual.name, sound.name),
    signature: {
      id: input.signature.id,
      contentHash: input.signature.contentHash,
      name: input.signature.name,
      preferredSpeed: Math.min(speedRange.max, Math.max(speedRange.min, preferred)),
    },
    seed: input.seed,
    visual: input.visual,
    sound,
    render: input.render,
  });
}

/** Name for "Save as new": "Wink 01" → "Wink 01 copy" (as the Library's Duplicate). */
export function saveAsNewName(name: string): string {
  const suffix = ' copy';
  return `${name.slice(0, 120 - suffix.length).trimEnd()}${suffix}`;
}
