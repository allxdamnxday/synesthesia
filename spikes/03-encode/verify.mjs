#!/usr/bin/env node
// Spike 3 verification (dev-time only; needs ffmpeg and ffprobe on PATH).
//
//   node spikes/03-encode/verify.mjs <file.mp4> [more.mp4 ...]
//
// For each file: container and brands, H.264 profile/level, frame count (expect 90),
// duration (3.000 s within one frame), audio codec/sample rate/channels, whether `moov`
// comes before `mdat` (fast start), each track's edit list, and the audio/video offset:
// ffmpeg decodes both streams (applying edit lists, like players do) and we find the
// white flash frame and the click onset. Target: within one frame (33.3 ms).
// Exits with 1 if any check fails.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FPS = 30;
const EXPECTED_FRAMES = 90;
const EXPECTED_DURATION_S = 3;
const FRAME_S = 1 / FPS;
const ONSET_THRESHOLD = 0.3;
const FLASH_LUMA = 128;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { maxBuffer: 512 * 1024 * 1024, ...options });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status}: ${String(result.stderr).slice(-2000)}`);
  }
  return result;
}

function ffprobe(file) {
  const { stdout } = run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    '-count_frames',
    file,
  ]);
  return JSON.parse(String(stdout));
}

/** Walk MP4 boxes: top-level order, plus each track's handler, timescale and edit list. */
export function inspectBoxes(file) {
  const buf = readFileSync(file);
  const CONTAINERS = new Set(['moov', 'trak', 'edts', 'mdia', 'minf', 'stbl']);
  const top = [];
  const tracks = [];
  let track = null;

  function walk(start, end, depth) {
    let offset = start;
    while (offset + 8 <= end) {
      let size = buf.readUInt32BE(offset);
      const type = buf.toString('latin1', offset + 4, offset + 8);
      let header = 8;
      if (size === 1) {
        size = Number(buf.readBigUInt64BE(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header || offset + size > end) break;
      if (depth === 0) top.push(type);
      if (type === 'trak') {
        track = { handler: null, timescale: null, edits: null };
        tracks.push(track);
      }
      const body = offset + header;
      if (type === 'hdlr' && track) track.handler = buf.toString('latin1', body + 8, body + 12);
      if (type === 'mdhd' && track) {
        const version = buf.readUInt8(body);
        track.timescale = buf.readUInt32BE(body + (version === 1 ? 20 : 12));
      }
      if (type === 'elst' && track) {
        const version = buf.readUInt8(body);
        const count = buf.readUInt32BE(body + 4);
        const edits = [];
        let p = body + 8;
        for (let i = 0; i < count; i++) {
          if (version === 1) {
            edits.push({
              segmentDuration: Number(buf.readBigUInt64BE(p)),
              mediaTime: Number(buf.readBigInt64BE(p + 8)),
            });
            p += 20;
          } else {
            edits.push({ segmentDuration: buf.readUInt32BE(p), mediaTime: buf.readInt32BE(p + 4) });
            p += 12;
          }
        }
        track.edits = edits;
      }
      if (CONTAINERS.has(type)) walk(body, offset + size, depth + 1);
      offset += size;
    }
  }
  walk(0, buf.length, 0);
  return { top, tracks, bytes: buf.length };
}

/**
 * Decode each stream with ffmpeg, keeping the file's timestamps (-copyts) with edit lists
 * applied, as players do. Video: showinfo logs each frame's time and mean luma. Audio:
 * ashowinfo logs the first frame's time and the first channel goes to stdout as raw
 * float32. Two separate runs, so the two filter graphs' log lines can't interleave.
 */
export function measureAlignment(file) {
  const videoLog = String(
    run('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-copyts',
      '-i',
      file,
      '-map',
      '0:v:0',
      '-vf',
      'showinfo',
      '-f',
      'null',
      '-',
    ]).stderr,
  );
  const frames = [];
  const videoLine =
    /Parsed_showinfo_\d+.*?\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:(-?[\d.eE+-]+).*?mean:\[(\d+)/g;
  for (const m of videoLog.matchAll(videoLine)) {
    frames.push({ n: Number(m[1]), time: Number(m[3]), luma: Number(m[4]) });
  }
  const flash = frames.find((f) => f.luma >= FLASH_LUMA) ?? null;

  const audio = run('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-copyts',
    '-i',
    file,
    '-map',
    '0:a:0',
    '-af',
    'ashowinfo,pan=mono|c0=c0',
    '-f',
    'f32le',
    '-acodec',
    'pcm_f32le',
    'pipe:1',
  ]);
  const audioLine =
    /Parsed_ashowinfo_\d+.*?\bn:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:(-?[\d.eE+-]+).*?rate:(\d+)/;
  const first = audioLine.exec(String(audio.stderr));
  const audioStart = first ? Number(first[3]) : 0;
  const rate = first ? Number(first[4]) : 48000;
  // Copy into a fresh, 4-byte-aligned buffer before viewing it as float32.
  const bytes = new Uint8Array(audio.stdout);
  const samples = new Float32Array(
    bytes.slice(0, bytes.byteLength - (bytes.byteLength % 4)).buffer,
  );
  let onsetIndex = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > ONSET_THRESHOLD) {
      onsetIndex = i;
      break;
    }
  }
  const click = onsetIndex >= 0 ? audioStart + onsetIndex / rate : null;
  return {
    decodedFrames: frames.length,
    flashFrame: flash?.n ?? null,
    flashTime: flash?.time ?? null,
    audioStart,
    audioRate: rate,
    decodedAudioSeconds: samples.length / rate,
    clickTime: click,
    offsetMs: flash && click !== null ? (click - flash.time) * 1000 : null,
  };
}

function levelText(level) {
  if (typeof level !== 'number' || level <= 0) return String(level);
  return `${Math.floor(level / 10)}.${level % 10}`;
}

export function verify(file) {
  const probe = ffprobe(file);
  const boxes = inspectBoxes(file);
  const alignment = measureAlignment(file);
  const video = probe.streams.find((s) => s.codec_type === 'video');
  const audio = probe.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  const frames = Number(video?.nb_read_frames ?? video?.nb_frames ?? NaN);
  const moovIndex = boxes.top.indexOf('moov');
  const mdatIndex = boxes.top.indexOf('mdat');

  const checks = [
    ['container is MP4', probe.format.format_name.includes('mp4'), probe.format.format_name],
    ['video is H.264', video?.codec_name === 'h264', `${video?.codec_name} ${video?.profile}`],
    [`${EXPECTED_FRAMES} video frames`, frames === EXPECTED_FRAMES, String(frames)],
    [
      `duration ${EXPECTED_DURATION_S.toFixed(3)} s within one frame`,
      Math.abs(duration - EXPECTED_DURATION_S) <= FRAME_S + 1e-6,
      `${duration.toFixed(4)} s`,
    ],
    [
      'audio is AAC',
      audio?.codec_name === 'aac',
      `${audio?.codec_name} ${audio?.profile ?? ''}`.trim(),
    ],
    [
      'audio 48 kHz stereo',
      audio?.sample_rate === '48000' && audio?.channels === 2,
      `${audio?.sample_rate} Hz x ${audio?.channels}`,
    ],
    [
      'moov before mdat (fast start)',
      moovIndex >= 0 && mdatIndex >= 0 && moovIndex < mdatIndex,
      boxes.top.join(' '),
    ],
    [
      'audio/video offset within one frame',
      alignment.offsetMs !== null && Math.abs(alignment.offsetMs) <= FRAME_S * 1000 + 1e-6,
      alignment.offsetMs === null ? 'not measured' : `${alignment.offsetMs.toFixed(2)} ms`,
    ],
  ].map(([name, ok, value]) => ({ name, ok: Boolean(ok), value }));

  return {
    file: basename(file),
    ok: checks.every((c) => c.ok),
    checks,
    details: {
      bytes: boxes.bytes,
      brands: `${probe.format.tags?.major_brand ?? '?'} (compatible: ${probe.format.tags?.compatible_brands ?? '?'})`,
      video: video
        ? `${video.codec_name} ${video.profile} level ${levelText(video.level)}, ${video.pix_fmt}, ${video.width}x${video.height}, ${video.avg_frame_rate} fps, ${Math.round(Number(video.bit_rate) / 1000)} kbps, stream duration ${Number(video.duration).toFixed(4)} s, start ${video.start_time}`
        : 'none',
      audio: audio
        ? `${audio.codec_name} ${audio.profile ?? ''} ${audio.sample_rate} Hz, ${audio.channels} ch, ${Math.round(Number(audio.bit_rate) / 1000)} kbps, stream duration ${Number(audio.duration).toFixed(4)} s, start ${audio.start_time}`
        : 'none',
      editLists: boxes.tracks
        .map(
          (t) =>
            `${t.handler ?? '?'} (timescale ${t.timescale ?? '?'}): ${
              t.edits
                ? t.edits
                    .map((e) => `[duration ${e.segmentDuration}, media time ${e.mediaTime}]`)
                    .join(' ')
                : 'none'
            }`,
        )
        .join('; '),
      alignment: `flash at frame ${alignment.flashFrame} = ${alignment.flashTime?.toFixed(4) ?? '?'} s; click at ${
        alignment.clickTime?.toFixed(5) ?? '?'
      } s (decoded audio starts at ${alignment.audioStart} s, ${alignment.decodedAudioSeconds.toFixed(4)} s long); ${alignment.decodedFrames} frames decoded`,
    },
    alignment,
  };
}

export function formatVerification(v) {
  const lines = [`${v.file}: ${v.ok ? 'PASS' : 'FAIL'}`];
  for (const c of v.checks) lines.push(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}: ${c.value}`);
  lines.push(`  Size: ${v.details.bytes} bytes`);
  lines.push(`  Brands: ${v.details.brands}`);
  lines.push(`  Video: ${v.details.video}`);
  lines.push(`  Audio: ${v.details.audio}`);
  lines.push(`  Edit lists: ${v.details.editLists}`);
  lines.push(`  Alignment: ${v.details.alignment}`);
  return lines.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node spikes/03-encode/verify.mjs <file.mp4> [more.mp4 ...]');
    process.exit(2);
  }
  let ok = true;
  for (const file of files) {
    const v = verify(file);
    console.log(formatVerification(v));
    ok &&= v.ok;
  }
  process.exit(ok ? 0 : 1);
}
