/**
 * Encode and decode the signature field (float32 values) as base64 (SPEC 8.3,
 * `field.encoding: 'f32-base64'`). Bytes are little-endian regardless of platform, so a
 * file written on one machine reads identically on another.
 */

const CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Float32 values → little-endian bytes. */
export function float32ToBytesLE(values: Float32Array): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setFloat32(i * 4, values[i] ?? 0, true);
  return bytes;
}

/** Little-endian bytes → Float32 values. */
export function bytesLEToFloat32(bytes: Uint8Array): Float32Array {
  if (bytes.length % 4 !== 0) throw new Error('Field data length is not a multiple of 4 bytes');
  const values = new Float32Array(bytes.length / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, true);
  return values;
}

export function encodeField(values: Float32Array): string {
  return bytesToBase64(float32ToBytesLE(values));
}

export function decodeField(base64: string): Float32Array {
  return bytesLEToFloat32(base64ToBytes(base64));
}
