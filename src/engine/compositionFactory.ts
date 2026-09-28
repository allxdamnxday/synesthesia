/**
 * New compositions (SPEC 11.2, 12). Every composition starts from the signature and each
 * material's baseline. The id, time stamps and seed come from the caller (library/UI
 * code), because this folder never reads the clock or browser randomness.
 */
import { baselineValues } from '../materials/properties';
import type { MaterialMeta } from '../materials/types';
import {
  COMPOSITION_FORMAT,
  COMPOSITION_VERSION,
  defaultTimeline,
  type Composition,
  type RenderSettings,
} from './composition';

export interface NewCompositionInput {
  id: string;
  /** ISO date/time. */
  now: string;
  name: string;
  signature: { id: string; contentHash: string; name: string; preferredSpeed: number };
  /** 0–999999 */
  seed: number;
  visual: MaterialMeta;
  sound: MaterialMeta;
  render: RenderSettings;
}

export function createComposition(input: NewCompositionInput): Composition {
  return {
    format: COMPOSITION_FORMAT,
    version: COMPOSITION_VERSION,
    id: input.id,
    name: input.name,
    createdAt: input.now,
    updatedAt: input.now,
    signature: {
      id: input.signature.id,
      contentHash: input.signature.contentHash,
      name: input.signature.name,
    },
    seed: input.seed,
    timeline: defaultTimeline(input.signature.preferredSpeed),
    linked: true,
    visual: {
      materialId: input.visual.id,
      materialVersion: input.visual.version,
      properties: baselineValues(input.visual.properties),
    },
    sound: {
      materialId: input.sound.id,
      materialVersion: input.sound.version,
      properties: baselineValues(input.sound.properties),
    },
    mute: { visual: false, sound: false },
    chance: null,
    render: { ...input.render },
    status: 'draft',
    notes: '',
  };
}

/** A plain default name, e.g. "Sample wink · Water and Breath". */
export function defaultCompositionName(
  signatureName: string,
  visualName: string,
  soundName: string,
): string {
  return `${signatureName} · ${visualName} and ${soundName}`;
}

/** Which materials changed since the composition was saved (SPEC 11.2 notice). */
export function materialVersionChanges(
  composition: Pick<Composition, 'visual' | 'sound'>,
  installed: { visual?: MaterialMeta; sound?: MaterialMeta },
): { visual: boolean; sound: boolean } {
  return {
    visual:
      installed.visual !== undefined &&
      installed.visual.version !== composition.visual.materialVersion,
    sound:
      installed.sound !== undefined &&
      installed.sound.version !== composition.sound.materialVersion,
  };
}
