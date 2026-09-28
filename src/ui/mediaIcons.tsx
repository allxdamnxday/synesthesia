/** Media control icons, drawn in the current text colour. Decorative: label the control. */

interface IconProps {
  size?: number;
}

export function PlayIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M6 4l10 6-10 6z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M5 4h3.5v12H5zM11.5 4H15v12h-3.5z" fill="currentColor" />
    </svg>
  );
}

/** One frame back: a bar and a triangle pointing left. */
export function FrameBackIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M5 5h2v10H5zM15 5v10L8 10z" fill="currentColor" />
    </svg>
  );
}

/** One frame forward. */
export function FrameForwardIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M13 5h2v10h-2zM5 5v10l7-5z" fill="currentColor" />
    </svg>
  );
}
