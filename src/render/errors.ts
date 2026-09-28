/**
 * Render errors carry a plain-language `message` for the artist (what happened and what to
 * do next) and a technical `detail` for the console and Diagnostics. Cancelling is not an
 * error: it rejects with a RenderCancelledError, which `isRenderCancelled` recognises.
 */

export type RenderErrorCode =
  | 'no-webgl'
  | 'gpu-lost'
  | 'no-video'
  | 'encoder-failed'
  | 'sound-failed'
  | 'material-missing'
  | 'folder-missing'
  | 'folder-permission'
  | 'disk-full'
  | 'write-failed'
  | 'unknown';

/** Where the render was when it failed; helps turn browser errors into plain messages. */
export type RenderStage = 'setup' | 'sound' | 'frames' | 'finishing' | 'saving';

const HELP = 'If it keeps happening, the Diagnostics page can show what’s wrong.';

export function renderMessage(code: RenderErrorCode, name = ''): string {
  const folder = name ? `“${name}”` : 'the folder';
  switch (code) {
    case 'no-webgl':
      return `The render couldn’t start because this browser can’t draw the wake right now. Reload the page and try again. ${HELP}`;
    case 'gpu-lost':
      return 'The graphics card reset during the render, so it stopped. Try again. If it happens again, close other apps or choose 720p.';
    case 'no-video':
      return `This browser can’t make MP4 video. ${HELP}`;
    case 'encoder-failed':
      return 'Making the video file stopped partway. Try again, or choose 720p.';
    case 'sound-failed':
      return `Making the sound didn’t work. Try again. ${HELP}`;
    case 'material-missing':
      return name
        ? `This composition uses a material this version of the instrument doesn’t have (“${name}”).`
        : 'This composition uses a material this version of the instrument doesn’t have.';
    case 'folder-missing':
      return `The folder ${folder} can’t be found any more. Choose a folder again.`;
    case 'folder-permission':
      return `The instrument isn’t allowed to save into ${folder} any more. Choose the folder again.`;
    case 'disk-full':
      return 'There isn’t enough space on the disk for this render. Free some space or choose another folder, then try again.';
    case 'write-failed':
      return `The video couldn’t be saved into ${folder}. Choose another folder, or save to your downloads.`;
    case 'unknown':
      return `The render stopped unexpectedly. Try again. ${HELP}`;
  }
}

export class RenderError extends Error {
  readonly code: RenderErrorCode;
  readonly detail: string;

  constructor(code: RenderErrorCode, message: string, detail = '') {
    super(message);
    this.name = 'RenderError';
    this.code = code;
    this.detail = detail;
  }
}

/** Thrown (as a rejection) when a render or batch is cancelled through its AbortSignal. */
export class RenderCancelledError extends Error {
  constructor() {
    super('The render was cancelled.');
    this.name = 'RenderCancelledError';
  }
}

export function isRenderCancelled(error: unknown): boolean {
  if (error instanceof RenderCancelledError) return true;
  return (
    (error instanceof DOMException || error instanceof Error) &&
    (error as { name?: string }).name === 'AbortError'
  );
}

/** Throws a RenderCancelledError if the signal has been aborted. */
export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RenderCancelledError();
}

/** A technical one-liner for anything thrown. */
export function describeError(error: unknown): string {
  if (error instanceof RenderError) {
    return error.detail ? `${error.code}: ${error.detail}` : error.code;
  }
  if (error instanceof Error) {
    return error.name && error.name !== 'Error' ? `${error.name}: ${error.message}` : error.message;
  }
  return String(error);
}

function errorName(error: unknown): string {
  return error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
}

/**
 * Turn anything thrown during a render into a RenderError with a plain message.
 * `folderName` is set when the render was saving into a folder.
 */
export function toRenderError(
  error: unknown,
  stage: RenderStage,
  folderName: string | null = null,
): RenderError {
  if (error instanceof RenderError) return error;
  const detail = `${stage}: ${describeError(error)}`;
  const name = errorName(error);
  const make = (code: RenderErrorCode) =>
    new RenderError(code, renderMessage(code, folderName ?? ''), detail);

  if (name === 'QuotaExceededError') return make('disk-full');
  if (folderName !== null) {
    if (name === 'NotFoundError') return make('folder-missing');
    if (name === 'NotAllowedError' || name === 'SecurityError') return make('folder-permission');
    if (
      stage === 'saving' ||
      name === 'NoModificationAllowedError' ||
      name === 'InvalidModificationError'
    ) {
      return make('write-failed');
    }
  }
  if (stage === 'sound') return make('sound-failed');
  // What WebCodecs encoders throw (Mediabunny passes their errors through unchanged).
  if (
    name === 'EncodingError' ||
    name === 'OperationError' ||
    name === 'NotSupportedError' ||
    name === 'InvalidStateError'
  ) {
    return make('encoder-failed');
  }
  return make('unknown');
}

/** The sentence to show for any render failure. */
export function renderErrorMessage(error: unknown): string {
  if (error instanceof RenderError) return error.message;
  return renderMessage('unknown');
}
