import { describe, expect, it } from 'vitest';
import { checkBase } from '../../src/render/capabilities/definitions';
import {
  environmentRows,
  formatReport,
  summarizeChecks,
} from '../../src/render/capabilities/report';
import type {
  CapabilityCheck,
  CheckId,
  CheckStatus,
  EnvironmentInfo,
} from '../../src/render/capabilities/types';

function row(id: CheckId, status: CheckStatus, summary: string, detail?: string): CapabilityCheck {
  return { ...checkBase(id), status, summary, ...(detail ? { detail } : {}) };
}

/** A 2017 Intel MacBook Pro on macOS 12, as the report should describe it. */
const MAC: EnvironmentInfo = {
  browser: { name: 'Google Chrome', version: '150.0.7778.12', isChromium: true },
  os: {
    name: 'macOS',
    version: '12.7.6',
    label: 'macOS 12.7.6 (Monterey)',
    source: 'client-hints',
  },
  cpu: { architecture: 'x86', bitness: '64', label: 'Intel (x86, 64-bit)', logicalCores: 4 },
  deviceMemoryGb: 8,
  screen: { width: 1440, height: 900, devicePixelRatio: 2, colorDepth: 30 },
  gpu: {
    vendor: 'Google Inc. (Intel Inc.)',
    renderer: 'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 650, OpenGL 4.1)',
    source: 'debug-renderer-info',
  },
  secureContext: true,
  crossOriginIsolated: false,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
};

const CHECKS: CapabilityCheck[] = [
  row('webgl2', 'pass', 'WebGL2 is available.', 'Version: WebGL 2.0\nMAX_TEXTURE_SIZE: 16384'),
  row('float-targets', 'pass', 'Half-float render targets work, with smooth (linear) sampling.'),
  row('audio-worklet', 'pass', 'Web Audio and AudioWorklet work.'),
  row(
    'audio-encode',
    'warn',
    "AAC isn't available, so renders will use Opus audio. Some players, such as QuickTime, may not play this audio.",
    'AAC 192 kbps: failed\nOPUS 160 kbps: ok, 5 packets, opus',
  ),
  row('persistent-storage', 'warn', 'The browser may clear your library.'),
];

describe('formatReport', () => {
  const text = formatReport({
    checks: CHECKS,
    environment: MAC,
    generatedAt: '2026-09-28T18:00:00.000Z',
    appVersion: '0.0.0 (production)',
  });

  it('starts with a header, timestamp and version', () => {
    const lines = text.split('\n');
    expect(lines[0]).toBe('Synesthesia diagnostics report');
    expect(lines[1]).toBe('Generated: 2026-09-28T18:00:00.000Z');
    expect(lines[2]).toBe('App version: 0.0.0 (production)');
  });

  it('describes the machine in the environment block', () => {
    expect(text).toContain('Browser:               Google Chrome 150.0.7778.12');
    expect(text).toContain('Operating system:      macOS 12.7.6 (Monterey)');
    expect(text).toContain('CPU:                   Intel (x86, 64-bit); 4 logical cores');
    expect(text).toContain('Screen:                1440 × 900 at 2× (2880 × 1800 device pixels)');
    expect(text).toContain(
      'GPU:                   ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 650, OpenGL 4.1)',
    );
  });

  it('lists every check by group with status, importance, summary and indented detail', () => {
    expect(text).toContain(
      '\nGraphics\n  [PASS] WebGL2 (required)\n         WebGL2 is available.\n',
    );
    expect(text).toContain('         Version: WebGL 2.0\n         MAX_TEXTURE_SIZE: 16384\n');
    expect(text).toContain('\nExporting MP4\n  [WARN] AAC audio export (preferred)\n');
    expect(text).toContain('         OPUS 160 kbps: ok, 5 packets, opus');
    expect(text).toContain('  [WARN] Persistent storage (optional)');
  });

  it('summarises and ends with the benchmark line', () => {
    expect(text).toContain('Summary: All required checks passed. 3 passed, 2 warnings, 0 failed.');
    expect(text.endsWith('\nBenchmark: not yet available\n')).toBe(true);
  });

  it('prints a benchmark when one is given, and copes with no environment', () => {
    const other = formatReport({
      checks: [row('webgl2', 'fail', "WebGL2 isn't available, so the wakes can't be drawn.")],
      environment: null,
      generatedAt: 'now',
      benchmark: 'Standard tier, 41 fps',
    });
    expect(other).toContain('Environment\n  not collected');
    expect(other).toContain('[FAIL] WebGL2 (required)');
    expect(other).toContain('Summary: 1 required check failed. 0 passed, 0 warnings, 1 failed.');
    expect(other).toContain('Benchmark: Standard tier, 41 fps');
    expect(other).not.toContain('App version');
  });

  it('matches the stored layout', () => {
    expect(text).toMatchSnapshot();
  });
});

describe('summarizeChecks', () => {
  it('reports progress while checks are running', () => {
    const s = summarizeChecks([row('webgl2', 'pass', ''), row('avc-720p', 'pending', '')]);
    expect(s.headline).toBe('Checking… 1 of 2 done.');
    expect(s.countsLine).toBe('1 passed, 0 warnings, 0 failed, 1 still running.');
  });

  it('counts required failures only as blocking the headline', () => {
    const s = summarizeChecks([
      row('webgl2', 'fail', ''),
      row('float-targets', 'fail', ''),
      row('folder-saving', 'fail', ''),
      row('persistent-storage', 'warn', ''),
    ]);
    expect(s.requiredFailed).toBe(2);
    expect(s.headline).toBe('2 required checks failed.');
    expect(s.countsLine).toBe('0 passed, 1 warning, 3 failed.');
  });
});

describe('environmentRows', () => {
  it('notes a browser that is not Chromium-based and a user-agent OS', () => {
    const rows = environmentRows({
      ...MAC,
      browser: { name: 'Safari', version: '19.0', isChromium: false },
      os: {
        name: 'macOS',
        version: '10.15.7',
        label: 'macOS 10.15.7 (as reported; browsers freeze this value)',
        source: 'user-agent',
      },
      cpu: { architecture: null, bitness: null, label: 'unknown architecture', logicalCores: 8 },
      deviceMemoryGb: null,
      gpu: null,
    });
    const value = (label: string) => rows.find((r) => r.label === label)?.value;
    expect(value('Browser')).toBe('Safari 19.0 (not Chromium-based)');
    expect(value('Operating system')).toContain('(from the user agent)');
    expect(value('Memory')).toBe('not reported');
    expect(value('GPU')).toBe('unknown (no WebGL)');
    expect(value('GPU vendor')).toBeUndefined();
  });
});
