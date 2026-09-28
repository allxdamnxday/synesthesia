/** Messages between the spike 1 page and its worker. */

export type SpikeRequest = { type: 'run'; opencvUrl: string; mode: 'full' | 'load-only' };

export interface LoadTiming {
  method: string;
  bytes: number;
  fetchMs: number;
  evalMs: number;
  initMs: number;
  totalMs: number;
}

export interface FlowChecks {
  hasFarneback: boolean;
  shift: { truthU: number; truthV: number; medianU: number; medianV: number };
  zero: { medianU: number; medianV: number; maxAbs: number };
  timing: { runs: number; avgMs: number; minMs: number; maxMs: number };
  heap: { runs: number; before: number; after: number; afterEngines: number };
}

export type SpikeResponse =
  | { type: 'ready'; timing: LoadTiming }
  | { type: 'checks'; checks: FlowChecks }
  | { type: 'error'; message: string };
