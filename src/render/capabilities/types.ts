/**
 * Capability checks (SPEC 14.1): shared types for the startup gate, the Diagnostics
 * screen and the render dialog.
 *
 * Every check turns browser facts into one row: a status, one plain sentence for the
 * artist, and optional technical detail for Braden. Probing code lives in the
 * per-area modules (webgl, audio, codecs, storage, environment); the functions that
 * turn probe results into rows are pure so they can be unit tested.
 */

export type CheckStatus = 'pending' | 'pass' | 'warn' | 'fail';

/**
 * How much a capability matters.
 * - `required`: the instrument can't do its job without it.
 * - `preferred`: a fallback exists but is worse (for example 720p only, or Opus audio).
 * - `optional`: a convenience; missing it changes nothing essential.
 */
export type CheckImportance = 'required' | 'preferred' | 'optional';

/** Groups used to lay out Diagnostics. */
export type CheckGroup = 'graphics' | 'sound' | 'export' | 'clips' | 'storage';

export type CheckId =
  | 'webgl2'
  | 'float-targets'
  | 'float-formats'
  | 'audio-worklet'
  | 'avc-720p'
  | 'avc-1080p'
  | 'avc-square'
  | 'audio-encode'
  | 'h264-decode'
  | 'hevc-decode'
  | 'folder-saving'
  | 'persistent-storage'
  | 'storage-space';

export interface CapabilityCheck {
  id: CheckId;
  group: CheckGroup;
  label: string;
  importance: CheckImportance;
  status: CheckStatus;
  /** One plain sentence. */
  summary: string;
  /** Technical detail (Diagnostics and the copied report only). May span several lines. */
  detail?: string;
}

export interface BrowserInfo {
  /** For example 'Google Chrome', 'Microsoft Edge', 'Safari', 'Firefox'. */
  name: string;
  /** Full version when known (for example '153.0.8010.53'), else the major version, else null. */
  version: string | null;
  /** Whether the browser reports a Chromium brand (Chrome, Edge, Opera, Brave, ...). */
  isChromium: boolean;
}

export interface OsInfo {
  /** 'macOS', 'Windows', 'Linux', 'ChromeOS', 'Android', 'iOS' or 'Unknown'. */
  name: string;
  /** The real version when known, for example '12.7.6' (macOS) or '19.0.0' (Windows platform version). */
  version: string | null;
  /** Human label, for example 'macOS 12.7.6 (Monterey)' or 'Windows 11 (platform version 19.0.0)'. */
  label: string;
  /**
   * Where the version came from. User-agent strings freeze macOS at 10.15.7 and Windows at
   * NT 10.0, so only client hints give the real version.
   */
  source: 'client-hints' | 'user-agent' | 'unknown';
}

export interface CpuInfo {
  /** 'x86' or 'arm' from client hints, else null. */
  architecture: string | null;
  /** '64' or '32' from client hints, else null. */
  bitness: string | null;
  /** For example 'Intel (x86, 64-bit)' on a Mac, 'x86, 64-bit' elsewhere. */
  label: string;
  logicalCores: number | null;
}

export interface GpuInfo {
  vendor: string | null;
  renderer: string | null;
  /** Unmasked strings come from WEBGL_debug_renderer_info; otherwise the (often masked) RENDERER. */
  source: 'debug-renderer-info' | 'renderer-parameter';
}

export interface ScreenInfo {
  /** CSS pixels. */
  width: number;
  height: number;
  devicePixelRatio: number;
  colorDepth: number;
}

export interface EnvironmentInfo {
  browser: BrowserInfo;
  os: OsInfo;
  cpu: CpuInfo;
  /** navigator.deviceMemory in GB (rounded, and capped by some Chrome versions), or null. */
  deviceMemoryGb: number | null;
  screen: ScreenInfo | null;
  gpu: GpuInfo | null;
  secureContext: boolean;
  crossOriginIsolated: boolean;
  userAgent: string;
}
