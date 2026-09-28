/**
 * What machine and browser are we on? Used by Diagnostics and the copied report so a
 * report pasted from Freeman's MacBook Pro says exactly which Mac, macOS and Chrome ran it.
 *
 * User-agent strings are frozen (macOS always reads 10_15_7, Windows 11 reads NT 10.0), so
 * the real OS version, CPU architecture and full Chrome version come from User-Agent Client
 * Hints (`navigator.userAgentData.getHighEntropyValues`). Safari and Firefox don't have
 * client hints; they fall back to parsing the user-agent string.
 */
import type { BrowserInfo, CpuInfo, EnvironmentInfo, GpuInfo, OsInfo, ScreenInfo } from './types';
import { withTimeout } from './util';
import { readGpuInfo } from './webgl';

export interface BrandVersion {
  brand: string;
  version: string;
}

/** The subset of User-Agent Client Hints we read (not in TypeScript's DOM lib). */
export interface UADataValues {
  platform?: string;
  platformVersion?: string;
  architecture?: string;
  bitness?: string;
  model?: string;
  fullVersionList?: BrandVersion[];
}

interface NavigatorUAData {
  readonly brands: BrandVersion[];
  readonly mobile: boolean;
  readonly platform: string;
  getHighEntropyValues(hints: string[]): Promise<UADataValues>;
}

type NavigatorWithHints = Navigator & {
  userAgentData?: NavigatorUAData;
  deviceMemory?: number;
};

const HIGH_ENTROPY_HINTS = [
  'platform',
  'platformVersion',
  'architecture',
  'bitness',
  'model',
  'fullVersionList',
];

/** Brands we name, in order of preference (Chrome is listed before its Chromium base). */
const KNOWN_BRANDS = [
  'Google Chrome',
  'Microsoft Edge',
  'Opera',
  'Brave',
  'Vivaldi',
  'YaBrowser',
  'Chromium',
];

/** GREASE brands such as "Not_A Brand" or "Not)A;Brand" carry no information. */
function isGreaseBrand(brand: string): boolean {
  return /not.?a.?brand/i.test(brand);
}

/** Pick the most specific browser brand from a client-hints brand list. */
export function pickBrand(brands: readonly BrandVersion[]): BrandVersion | null {
  for (const known of KNOWN_BRANDS) {
    const match = brands.find((b) => b.brand === known);
    if (match) return match;
  }
  return brands.find((b) => !isGreaseBrand(b.brand)) ?? null;
}

/** Whether a client-hints brand list belongs to a Chromium-based browser. */
export function hasChromiumBrand(brands: readonly BrandVersion[] | undefined): boolean {
  return (brands ?? []).some((b) => b.brand === 'Chromium' || b.brand === 'Google Chrome');
}

const MACOS_NAMES: Record<number, string> = {
  11: 'Big Sur',
  12: 'Monterey',
  13: 'Ventura',
  14: 'Sonoma',
  15: 'Sequoia',
  26: 'Tahoe',
};

function majorVersion(version: string | null | undefined): number | null {
  if (!version) return null;
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isFinite(major) ? major : null;
}

/** Marketing name for a macOS version ('12.7.6' → 'Monterey'), or null when unknown. */
export function macOsName(version: string): string | null {
  if (version.startsWith('10.15')) return 'Catalina';
  const major = majorVersion(version);
  return major !== null ? (MACOS_NAMES[major] ?? null) : null;
}

/**
 * Describe the OS from client hints. On Windows, `platformVersion` is not the NT version:
 * major 13 or higher means Windows 11, 1–10 means Windows 10, 0 means Windows 7/8/8.1.
 */
export function describeOsFromHints(platform: string, platformVersion: string | null): OsInfo {
  const version = platformVersion && platformVersion.length > 0 ? platformVersion : null;
  const source: OsInfo['source'] = 'client-hints';
  if (platform === 'macOS') {
    const name = version ? macOsName(version) : null;
    const label = version ? `macOS ${version}${name ? ` (${name})` : ''}` : 'macOS';
    return { name: 'macOS', version, label, source };
  }
  if (platform === 'Windows') {
    const major = majorVersion(version);
    let edition = 'Windows';
    if (major !== null) {
      if (major >= 13) edition = 'Windows 11';
      else if (major >= 1) edition = 'Windows 10';
      else edition = 'Windows 7, 8 or 8.1';
    }
    const label = version ? `${edition} (platform version ${version})` : edition;
    return { name: 'Windows', version, label, source };
  }
  const name = platform === 'Chrome OS' ? 'ChromeOS' : platform || 'Unknown';
  const label = version ? `${name} ${version}` : name;
  return { name, version, label, source };
}

/** 'Intel (x86, 64-bit)' / 'Apple Silicon (arm, 64-bit)' on a Mac; 'x86, 64-bit' elsewhere. */
export function describeCpu(
  architecture: string | null,
  bitness: string | null,
  osName: string,
  logicalCores: number | null,
): CpuInfo {
  const parts: string[] = [];
  if (architecture) parts.push(architecture);
  if (bitness) parts.push(`${bitness}-bit`);
  const technical = parts.join(', ');
  let label = technical || 'unknown architecture';
  if (osName === 'macOS' && architecture === 'arm') label = `Apple Silicon (${technical})`;
  else if (osName === 'macOS' && architecture === 'x86') label = `Intel (${technical})`;
  return { architecture, bitness, label, logicalCores };
}

/** Fallback for browsers without client hints (Safari, Firefox) or insecure contexts. */
export function parseUserAgent(ua: string): { browser: BrowserInfo; os: OsInfo } {
  const chromiumEngine = /(?:Chrome|Chromium)\/\d+/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  let browser: BrowserInfo = { name: 'Unknown browser', version: null, isChromium: chromiumEngine };
  const rules: [RegExp, string][] = [
    [/Edg(?:e|A)?\/([\d.]+)/, 'Microsoft Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/(?:Firefox|FxiOS)\/([\d.]+)/, 'Firefox'],
    [/(?:Chrome|CriOS)\/([\d.]+)/, 'Google Chrome'],
    [/Version\/([\d.]+).*Safari\//, 'Safari'],
  ];
  for (const [pattern, name] of rules) {
    const match = pattern.exec(ua);
    if (match) {
      browser = { name, version: match[1] ?? null, isChromium: chromiumEngine };
      break;
    }
  }

  const source: OsInfo['source'] = 'user-agent';
  let os: OsInfo = { name: 'Unknown', version: null, label: 'Unknown OS', source: 'unknown' };
  const ios = /(?:iPhone|iPad|iPod).*? OS (\d+(?:_\d+)*)/.exec(ua);
  const android = /Android (\d+(?:\.\d+)*)/.exec(ua);
  const mac = /Mac OS X (\d+[._]\d+(?:[._]\d+)?)/.exec(ua);
  const windows = /Windows NT (\d+\.\d+)/.exec(ua);
  if (ios) {
    const version = (ios[1] ?? '').replace(/_/g, '.');
    os = { name: 'iOS', version, label: `iOS ${version}`, source };
  } else if (android) {
    const version = android[1] ?? null;
    os = { name: 'Android', version, label: `Android ${version ?? ''}`.trim(), source };
  } else if (mac) {
    const version = (mac[1] ?? '').replace(/_/g, '.');
    const frozen = version === '10.15.7' ? ' (as reported; browsers freeze this value)' : '';
    os = { name: 'macOS', version, label: `macOS ${version}${frozen}`, source };
  } else if (windows) {
    const nt = windows[1] ?? '';
    const names: Record<string, string> = {
      '10.0': 'Windows 10 or 11',
      '6.3': 'Windows 8.1',
      '6.2': 'Windows 8',
      '6.1': 'Windows 7',
    };
    os = { name: 'Windows', version: nt, label: `${names[nt] ?? 'Windows'} (NT ${nt})`, source };
  } else if (/CrOS/.test(ua)) {
    os = { name: 'ChromeOS', version: null, label: 'ChromeOS', source };
  } else if (/Linux/.test(ua)) {
    os = { name: 'Linux', version: null, label: 'Linux', source };
  }
  return { browser, os };
}

/**
 * Whether this is a Chromium-based browser (Chrome, Edge, ...). Uses client-hint brands
 * when present; Safari and Firefox have none, so they fall through to the user agent.
 */
export function isChromiumBrowser(nav: Navigator = navigator): boolean {
  const data = (nav as NavigatorWithHints).userAgentData;
  if (data?.brands) return hasChromiumBrand(data.brands);
  return parseUserAgent(nav.userAgent).browser.isChromium;
}

function readScreen(): ScreenInfo | null {
  if (typeof screen === 'undefined') return null;
  return {
    width: screen.width,
    height: screen.height,
    devicePixelRatio: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    colorDepth: screen.colorDepth,
  };
}

/**
 * Collect the environment block of the report. Pass `gpu` when a WebGL probe already
 * read the GPU strings; otherwise a throwaway context reads them.
 */
export async function collectEnvironment(
  options: { gpu?: GpuInfo | null } = {},
): Promise<EnvironmentInfo> {
  const nav = navigator as NavigatorWithHints;
  const ua = nav.userAgent;
  const fallback = parseUserAgent(ua);

  let browser = fallback.browser;
  let os = fallback.os;
  let architecture: string | null = null;
  let bitness: string | null = null;

  const data = nav.userAgentData;
  if (data) {
    let hints: UADataValues = {};
    try {
      hints = await withTimeout(
        data.getHighEntropyValues(HIGH_ENTROPY_HINTS),
        3000,
        'getHighEntropyValues',
      );
    } catch {
      // Low-entropy values below are still useful.
    }
    const brand = pickBrand(hints.fullVersionList ?? []) ?? pickBrand(data.brands);
    browser = {
      name: brand?.brand ?? fallback.browser.name,
      version: brand?.version ?? fallback.browser.version,
      isChromium: hasChromiumBrand(data.brands),
    };
    os = describeOsFromHints(hints.platform ?? data.platform, hints.platformVersion ?? null);
    architecture = hints.architecture && hints.architecture.length > 0 ? hints.architecture : null;
    bitness = hints.bitness && hints.bitness.length > 0 ? hints.bitness : null;
  }

  const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null;
  const gpu = options.gpu !== undefined ? options.gpu : readGpuInfo();

  return {
    browser,
    os,
    cpu: describeCpu(architecture, bitness, os.name, cores),
    deviceMemoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    screen: readScreen(),
    gpu,
    secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : false,
    crossOriginIsolated: typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false,
    userAgent: ua,
  };
}
