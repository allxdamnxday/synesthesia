import { describe, expect, it } from 'vitest';
import { assessAudio, type AudioProbe } from '../../src/render/capabilities/audio';
import {
  assessAudioEncode,
  assessDecode,
  assessVideoEncode,
  HEVC_GUIDANCE,
  pickRenderDefaults,
  type AudioCodecOutcome,
  type AudioEncodeResult,
  type DecodeEntry,
  type DecodeResult,
  type RenderResolution,
  type RenderSupport,
  type VideoEncodeResult,
} from '../../src/render/capabilities/codecAssess';
import { checkBase } from '../../src/render/capabilities/definitions';
import {
  blockingFailures,
  inconclusiveCheck,
  mergeChecks,
  pendingChecks,
} from '../../src/render/capabilities/runChecks';
import { assessStorage, type StorageProbe } from '../../src/render/capabilities/storage';
import type { CapabilityCheck, CheckId } from '../../src/render/capabilities/types';
import {
  assessWebGL,
  FLOAT_FORMATS,
  type FloatFormatName,
  type FloatFormatResult,
  type WebGLProbe,
} from '../../src/render/capabilities/webgl';

// ---------------------------------------------------------------------------------------
// Fixtures

function video(resolution: RenderResolution, ok: boolean, extra: Partial<VideoEncodeResult> = {}) {
  const sizes = { '1080p': [1920, 1080], '720p': [1280, 720], square: [1080, 1080] } as const;
  const [width, height] = sizes[resolution];
  return {
    resolution,
    width,
    height,
    ok,
    webCodecs: true,
    configSupported: ok,
    frames: 3,
    packets: ok ? 3 : 0,
    bytes: ok ? 4000 : 0,
    codecString: ok ? 'avc1.640028' : null,
    rateControl: ok ? 'quantizer (per-frame QP)' : null,
    timedOut: false,
    error: ok ? null : 'This specific encoder configuration is not supported',
    ...extra,
  } satisfies VideoEncodeResult;
}

function outcome(codec: 'aac' | 'opus', okBitrate: number | null): AudioCodecOutcome {
  if (okBitrate === null) {
    return {
      ok: false,
      bitrate: null,
      codecString: null,
      attempts: [
        {
          codec,
          bitrate: 192_000,
          ok: false,
          packets: 0,
          codecString: null,
          timedOut: false,
          error: 'not supported',
        },
      ],
    };
  }
  const codecString = codec === 'aac' ? 'mp4a.40.2' : 'opus';
  return {
    ok: true,
    bitrate: okBitrate,
    codecString,
    attempts: [
      {
        codec,
        bitrate: okBitrate,
        ok: true,
        packets: 5,
        codecString,
        timedOut: false,
        error: null,
      },
    ],
  };
}

function audio(aac: number | null, opus: number | null | undefined): AudioEncodeResult {
  return {
    webCodecs: true,
    aac: outcome('aac', aac),
    opus: opus === undefined ? null : outcome('opus', opus),
  };
}

function support(
  videoOk: Record<RenderResolution, boolean>,
  audioResult: AudioEncodeResult,
): RenderSupport {
  return {
    video: {
      '1080p': video('1080p', videoOk['1080p']),
      '720p': video('720p', videoOk['720p']),
      square: video('square', videoOk.square),
    },
    audio: audioResult,
  };
}

const ALL_VIDEO = { '1080p': true, '720p': true, square: true };

function format(name: FloatFormatName, overrides: Partial<FloatFormatResult> = {}) {
  const channels = name.startsWith('RGBA') ? 4 : name.startsWith('RG') ? 2 : 1;
  return {
    format: name,
    channels,
    halfFloat: name.endsWith('16F'),
    allocated: true,
    renderable: true,
    readback: 'ok',
    readbackValues: [-1.5, 2.25, 1000],
    linearFilter: 'ok',
    filterValue: 0.5,
    note: null,
    ...overrides,
  } satisfies FloatFormatResult;
}

function webglProbe(overrides: Partial<WebGLProbe> = {}): WebGLProbe {
  return {
    scope: 'full',
    available: true,
    contextError: null,
    version: 'WebGL 2.0 (OpenGL ES 3.0 Chromium)',
    shadingLanguageVersion: 'WebGL GLSL ES 3.00',
    gpu: {
      vendor: 'Google Inc. (Intel)',
      renderer: 'ANGLE (Intel, Iris)',
      source: 'debug-renderer-info',
    },
    softwareRenderer: false,
    maxTextureSize: 16384,
    extensions: {
      EXT_color_buffer_float: true,
      EXT_color_buffer_half_float: true,
      OES_texture_float_linear: true,
      EXT_float_blend: true,
    },
    formats: FLOAT_FORMATS.map((name) => format(name)),
    signatureUpload: [{ format: 'RG16F', ok: true, maxError: 0, note: null }],
    sampleTarget: 'RGBA32F',
    contextLost: false,
    unexpectedError: null,
    ...overrides,
  };
}

function withFormat(name: FloatFormatName, overrides: Partial<FloatFormatResult>) {
  return FLOAT_FORMATS.map((n) => (n === name ? format(n, overrides) : format(n)));
}

function byId(rows: CapabilityCheck[], id: CheckId): CapabilityCheck {
  const found = rows.find((r) => r.id === id);
  if (!found) throw new Error(`missing row ${id}`);
  return found;
}

// ---------------------------------------------------------------------------------------

describe('render defaults and export rows (SPEC 10.3)', () => {
  it('prefers 1080p and AAC at the bitrate that encoded', () => {
    const defaults = pickRenderDefaults(support(ALL_VIDEO, audio(192_000, undefined)));
    expect(defaults).toEqual({
      resolutions: { '1080p': true, '720p': true, square: true },
      largestResolution: '1080p',
      audioCodec: 'aac',
      audioBitrate: 192_000,
      notes: [],
    });
  });

  it('offers 720p only when 1080p fails, with an explanation', () => {
    const defaults = pickRenderDefaults(
      support({ '1080p': false, '720p': true, square: false }, audio(128_000, undefined)),
    );
    expect(defaults.largestResolution).toBe('720p');
    expect(defaults.resolutions.square).toBe(false);
    expect(defaults.notes).toEqual([
      "1080p isn't available on this computer, so renders are 720p only.",
    ]);
    const row = assessVideoEncode(video('1080p', false));
    expect(row.status).toBe('warn');
    expect(row.summary).toContain('720p only');
  });

  it('falls back to Opus with the QuickTime warning when AAC is missing', () => {
    const result = audio(null, 160_000);
    const defaults = pickRenderDefaults(support(ALL_VIDEO, result));
    expect(defaults.audioCodec).toBe('opus');
    expect(defaults.audioBitrate).toBe(160_000);
    expect(defaults.notes.join(' ')).toContain('QuickTime');
    const row = assessAudioEncode(result);
    expect(row.id).toBe('audio-encode');
    expect(row.status).toBe('warn');
    expect(row.summary).toContain('Opus');
    expect(row.summary).toContain('Some players, such as QuickTime, may not play this audio.');
  });

  it('passes AAC with the working bitrate in the summary', () => {
    const row = assessAudioEncode(audio(160_000, undefined));
    expect(row.status).toBe('pass');
    expect(row.summary).toContain('160 kbps');
    expect(row.detail).toContain('AAC 160 kbps: ok, 5 packets, mp4a.40.2');
  });

  it('fails audio when neither AAC nor Opus encodes, but only warns on a timeout', () => {
    expect(assessAudioEncode(audio(null, null)).status).toBe('fail');
    const timedOut = audio(null, null);
    timedOut.aac.attempts = timedOut.aac.attempts.map((a) => ({ ...a, timedOut: true }));
    expect(assessAudioEncode(timedOut).status).toBe('warn');
  });

  it('fails 720p (the minimum) and reports no MP4 export at all', () => {
    const row = assessVideoEncode(video('720p', false));
    expect(row.status).toBe('fail');
    expect(row.importance).toBe('required');
    const noWebCodecs = assessVideoEncode(video('720p', false, { webCodecs: false }));
    expect(noWebCodecs.summary).toContain('WebCodecs');
    const defaults = pickRenderDefaults(
      support({ '1080p': false, '720p': false, square: false }, audio(null, null)),
    );
    expect(defaults.largestResolution).toBeNull();
    expect(defaults.audioCodec).toBeNull();
    expect(defaults.notes).toHaveLength(2);
  });

  it('treats a timed-out encode as unconfirmed, not missing', () => {
    const row = assessVideoEncode(video('720p', false, { timedOut: true }));
    expect(row.status).toBe('warn');
    expect(row.summary).toContain("didn't finish");
  });
});

describe('clip import rows', () => {
  function decode(supported: Record<DecodeEntry['key'], boolean | null>): DecodeResult {
    const keys = Object.keys(supported) as DecodeEntry['key'][];
    return {
      webCodecs: true,
      entries: keys.map((key) => ({
        key,
        label: key,
        codec: key,
        width: 1920,
        height: 1080,
        supported: supported[key],
        error: null,
      })),
    };
  }

  it('warns with the iPhone guidance when HEVC is missing', () => {
    const [h264, hevc] = assessDecode(
      decode({ 'h264-1080p': true, 'h264-4k': true, 'hevc-1080p': false, 'hevc-main10-4k': false }),
    );
    expect(h264?.status).toBe('pass');
    expect(hevc?.status).toBe('warn');
    expect(hevc?.importance).toBe('optional');
    expect(hevc?.summary).toContain(HEVC_GUIDANCE);
    expect(hevc?.summary).toContain('Most Compatible');
  });

  it('fails without H.264 and warns when only 4K is missing', () => {
    const [missing] = assessDecode(
      decode({
        'h264-1080p': false,
        'h264-4k': false,
        'hevc-1080p': false,
        'hevc-main10-4k': false,
      }),
    );
    expect(missing?.status).toBe('fail');
    const [no4k] = assessDecode(
      decode({ 'h264-1080p': true, 'h264-4k': false, 'hevc-1080p': true, 'hevc-main10-4k': true }),
    );
    expect(no4k?.status).toBe('warn');
    expect(no4k?.summary).toContain('4K');
    const [unknown] = assessDecode(
      decode({ 'h264-1080p': null, 'h264-4k': null, 'hevc-1080p': null, 'hevc-main10-4k': null }),
    );
    expect(unknown?.status).toBe('warn');
  });
});

describe('graphics rows', () => {
  it('passes a healthy GPU, including the compact formats row', () => {
    const rows = assessWebGL(webglProbe());
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ['webgl2', 'pass'],
      ['float-targets', 'pass'],
      ['float-formats', 'pass'],
    ]);
    expect(byId(rows, 'webgl2').detail).toContain('ANGLE (Intel, Iris)');
    expect(byId(rows, 'float-formats').detail).toContain('RG16F');
  });

  it('startup probes return only the two required rows', () => {
    const rows = assessWebGL(webglProbe({ scope: 'startup', formats: [format('RGBA16F')] }));
    expect(rows.map((r) => r.id)).toEqual(['webgl2', 'float-targets']);
  });

  it('fails both required rows when WebGL2 is missing', () => {
    const rows = assessWebGL(
      webglProbe({ available: false, formats: [], contextError: 'GPU process was unable to boot' }),
    );
    expect(byId(rows, 'webgl2').status).toBe('fail');
    expect(byId(rows, 'webgl2').detail).toContain('GPU process was unable to boot');
    expect(byId(rows, 'float-targets').status).toBe('fail');
    expect(byId(rows, 'float-formats').status).toBe('warn');
  });

  it('fails half-float targets that are not renderable, clamp values, or do not filter', () => {
    const notRenderable = assessWebGL(
      webglProbe({ formats: withFormat('RGBA16F', { renderable: false, readback: null }) }),
    );
    expect(byId(notRenderable, 'float-targets').status).toBe('fail');
    const clamped = assessWebGL(
      webglProbe({ formats: withFormat('RGBA16F', { readback: 'mismatch' }) }),
    );
    expect(byId(clamped, 'float-targets').status).toBe('fail');
    expect(byId(clamped, 'float-targets').summary).toContain('outside 0 to 1');
    const noFilter = assessWebGL(
      webglProbe({ formats: withFormat('RGBA16F', { linearFilter: 'mismatch', filterValue: 0 }) }),
    );
    expect(byId(noFilter, 'float-targets').status).toBe('fail');
    expect(byId(noFilter, 'float-targets').summary).toContain('linear filtering');
  });

  it('never fails on an unreadable result, a lost context, or an exception', () => {
    const unreadable = assessWebGL(
      webglProbe({ formats: withFormat('RGBA16F', { readback: 'unreadable' }) }),
    );
    expect(byId(unreadable, 'float-targets').status).toBe('warn');
    const lost = assessWebGL(
      webglProbe({
        contextLost: true,
        formats: withFormat('RGBA16F', { renderable: false, readback: null }),
      }),
    );
    expect(byId(lost, 'float-targets').status).toBe('warn');
    const threw = assessWebGL(
      webglProbe({ available: null, formats: [], unexpectedError: 'TypeError: boom' }),
    );
    expect(byId(threw, 'webgl2').status).toBe('warn');
    expect(byId(threw, 'float-targets').status).toBe('warn');
    expect(blockingFailures([...unreadable, ...lost, ...threw])).toEqual([]);
  });

  it('warns on a software renderer', () => {
    const rows = assessWebGL(
      webglProbe({
        softwareRenderer: true,
        gpu: { vendor: 'Google Inc.', renderer: 'SwiftShader', source: 'renderer-parameter' },
      }),
    );
    expect(byId(rows, 'webgl2').status).toBe('warn');
    expect(byId(rows, 'webgl2').summary).toContain('software');
  });

  it('warns (RGBA fallback) when R16F or RG16F is missing', () => {
    const rows = assessWebGL(
      webglProbe({
        formats: withFormat('RG16F', { renderable: false, readback: null }),
        signatureUpload: [
          { format: 'RG16F', ok: false, maxError: null, note: 'upload error 0x502' },
          { format: 'RGBA16F', ok: true, maxError: 0, note: null },
        ],
      }),
    );
    expect(byId(rows, 'float-targets').status).toBe('pass');
    expect(byId(rows, 'float-formats').status).toBe('warn');
    expect(byId(rows, 'float-formats').summary).toContain('four-channel');
  });
});

describe('sound row', () => {
  const ok: AudioProbe = {
    webAudio: true,
    audioWorklet: true,
    moduleLoaded: true,
    outputOk: true,
    observedValue: 0.25,
    sampleRate: 48000,
    failure: null,
    error: null,
    workletUrl: 'http://localhost/worklets/diagnostic-processor.js',
    secureContext: true,
  };

  it('passes a working worklet', () => {
    expect(assessAudio(ok).status).toBe('pass');
  });

  it('fails when Web Audio or AudioWorklet is missing, and explains insecure pages', () => {
    expect(assessAudio({ ...ok, webAudio: false, failure: 'missing-web-audio' }).status).toBe(
      'fail',
    );
    const insecure = assessAudio({
      ...ok,
      audioWorklet: false,
      secureContext: false,
      failure: 'missing-worklet',
    });
    expect(insecure.status).toBe('fail');
    expect(insecure.summary).toContain('https');
    expect(assessAudio({ ...ok, outputOk: false, failure: 'render' }).status).toBe('fail');
  });

  it('only warns when the module fails to load or the check throws', () => {
    expect(assessAudio({ ...ok, moduleLoaded: false, failure: 'module-load' }).status).toBe('warn');
    expect(assessAudio({ ...ok, failure: 'unexpected', error: 'boom' }).status).toBe('warn');
  });
});

describe('storage rows', () => {
  const base: StorageProbe = {
    folderSaving: true,
    persisted: true,
    usageBytes: 12_000_000,
    quotaBytes: 60_000_000_000,
    secureContext: true,
    error: null,
  };

  it('passes when everything is available', () => {
    const rows = assessStorage(base);
    expect(rows.map((r) => r.status)).toEqual(['pass', 'pass', 'pass']);
    expect(byId(rows, 'storage-space').summary).toBe('12 MB used of 60 GB the browser allows.');
  });

  it('warns about downloads, clearing and low space, never failing', () => {
    const rows = assessStorage({
      ...base,
      folderSaving: false,
      persisted: false,
      quotaBytes: 500_000_000,
    });
    expect(byId(rows, 'folder-saving').summary).toBe(
      'Renders download instead of saving to a folder.',
    );
    expect(byId(rows, 'persistent-storage').summary).toContain('backups');
    expect(byId(rows, 'storage-space').status).toBe('warn');
    expect(rows.every((r) => r.status === 'warn' && r.importance === 'optional')).toBe(true);
  });
});

describe('startup gate rules', () => {
  it('blocks only on required checks that definitely failed', () => {
    const rows: CapabilityCheck[] = [
      { ...checkBase('webgl2'), status: 'warn', summary: '' },
      { ...checkBase('float-targets'), status: 'pass', summary: '' },
      { ...checkBase('audio-worklet'), status: 'fail', summary: '' },
      { ...checkBase('folder-saving'), status: 'fail', summary: '' },
      { ...checkBase('avc-1080p'), status: 'fail', summary: '' },
    ];
    expect(blockingFailures(rows).map((r) => r.id)).toEqual(['audio-worklet']);
  });

  it('turns an unexpected error into a warning, never a failure', () => {
    const row = inconclusiveCheck('webgl2', new Error('context creation threw'));
    expect(row.status).toBe('warn');
    expect(row.importance).toBe('required');
    expect(row.detail).toContain('context creation threw');
    expect(blockingFailures([row])).toEqual([]);
  });

  it('keeps Diagnostics order when rows arrive out of order', () => {
    const merged = mergeChecks(pendingChecks(), [
      { ...checkBase('storage-space'), status: 'pass', summary: 'ok' },
      { ...checkBase('webgl2'), status: 'pass', summary: 'ok' },
    ]);
    expect(merged.map((r) => r.id)).toEqual(pendingChecks().map((r) => r.id));
    expect(merged.filter((r) => r.status === 'pass').map((r) => r.id)).toEqual([
      'webgl2',
      'storage-space',
    ]);
    expect(pendingChecks(['audio-worklet', 'webgl2']).map((r) => r.id)).toEqual([
      'webgl2',
      'audio-worklet',
    ]);
  });
});
