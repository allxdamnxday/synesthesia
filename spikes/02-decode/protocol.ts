/** Messages between the spike 2 page and its worker. */
import type { ClipResult, ClipSpec } from './checks';

export type DecodeRequest = { type: 'run'; clips: ClipSpec[] };

export type DecodeResponse =
  | { type: 'clip'; result: ClipResult }
  | { type: 'done'; gcForced: boolean; unclosedWarnings: number }
  | { type: 'error'; message: string };
