/**
 * Open a clip with Mediabunny and read what Prepare and extraction need to know about it.
 * Used on the main thread by `probeClip()` and inside the extraction worker.
 */
import { ALL_FORMATS, BlobSource, Input, type InputVideoTrack } from 'mediabunny';
import {
  CLIP_FORMAT_MESSAGE,
  CLIP_UNREADABLE_MESSAGE,
  ExtractionFailure,
  describeError,
  toWireError,
} from './extractProtocol';
import type { Rotation } from './types';

export interface ClipInfo {
  fileName: string;
  durationSec: number;
  nativeFps: number;
  /** Displayed size, after the container's rotation metadata. */
  width: number;
  height: number;
  /** The container's rotation metadata (clockwise degrees). */
  rotation: Rotation;
  codec: string | null;
  canDecode: boolean;
}

export interface OpenedClip {
  input: Input;
  track: InputVideoTrack;
  info: ClipInfo;
  /** Container horizontal flip (applied after its rotation); almost always false. */
  flip: boolean;
  /** Frame size in square pixels before rotation. */
  squarePixelWidth: number;
  squarePixelHeight: number;
  /** Timestamp of the first frame and end of the last frame, seconds. */
  firstTimestamp: number;
  endTimestamp: number;
  dispose(): void;
}

/** Packets looked at to measure the native frame rate (about 20 s at 30 fps). */
const FPS_PROBE_PACKETS = 600;

function toRotation(value: number): Rotation {
  return value === 90 || value === 180 || value === 270 ? value : 0;
}

export async function openClip(file: Blob, fileName: string): Promise<OpenedClip> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new ExtractionFailure('format', CLIP_FORMAT_MESSAGE, 'No video track');
    const codec = await track.getCodec();
    const canDecode = codec !== null && (await track.canDecode());
    const rotation = toRotation(await track.getRotation());
    const flip = await track.getFlip();
    const width = await track.getDisplayWidth();
    const height = await track.getDisplayHeight();
    const squarePixelWidth = await track.getSquarePixelWidth();
    const squarePixelHeight = await track.getSquarePixelHeight();
    const firstTimestamp = await track.getFirstTimestamp();
    const endTimestamp = await track.computeDuration();
    const stats = await track.computePacketStats(FPS_PROBE_PACKETS);
    const nativeFps = stats.averagePacketRate;
    const info: ClipInfo = {
      fileName,
      durationSec: Number.isFinite(endTimestamp) ? endTimestamp : 0,
      nativeFps: Number.isFinite(nativeFps) ? nativeFps : 0,
      width,
      height,
      rotation,
      codec,
      canDecode,
    };
    return {
      input,
      track,
      info,
      flip,
      squarePixelWidth,
      squarePixelHeight,
      firstTimestamp: Number.isFinite(firstTimestamp) ? firstTimestamp : 0,
      endTimestamp: info.durationSec,
      dispose: () => input.dispose(),
    };
  } catch (error) {
    input.dispose();
    if (error instanceof ExtractionFailure) throw error;
    const wire = toWireError(error);
    // Anything else that goes wrong while reading the container means the format is not
    // one this browser can read, unless the file itself could not be read.
    if (wire.kind === 'unreadable') {
      throw new ExtractionFailure('unreadable', CLIP_UNREADABLE_MESSAGE, describeError(error));
    }
    throw new ExtractionFailure('format', CLIP_FORMAT_MESSAGE, describeError(error));
  }
}

/** ClipInfo for Prepare (opens and closes the clip). */
export async function readClipInfo(file: Blob, fileName: string): Promise<ClipInfo> {
  const clip = await openClip(file, fileName);
  clip.dispose();
  return clip.info;
}
