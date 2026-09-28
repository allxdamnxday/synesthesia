import { useLayoutEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { ClipInfo } from '../../signature/extractClient';
import type { FocusArea } from '../../signature/types';
import { FocusBox } from '../../ui/FocusBox';
import type { MinSize, NormRect } from '../../ui/rectMath';
import type { SliderPhase } from '../../ui/Slider';
import styles from './ClipView.module.css';
import { fitRect, orientationTransform, orientedSize, type ViewOrientation } from './orientation';

export interface ClipViewProps {
  url: string;
  clip: Pick<ClipInfo, 'width' | 'height'>;
  orientation: ViewOrientation;
  focusArea: FocusArea | null;
  /** Omit to show the focus area as an outline only. */
  onFocusChange?: (rect: NormRect | null, phase: SliderPhase) => void;
  videoRef: (video: HTMLVideoElement | null) => void;
  focusBoxRef?: Ref<HTMLDivElement>;
  /** The browser couldn't play this clip after all. */
  onVideoError: () => void;
}

/** Smallest focus box: 2% of the frame, and never under 8 pixels of the clip. */
export function minFocusSize(
  clip: Pick<ClipInfo, 'width' | 'height'>,
  o: ViewOrientation,
): MinSize {
  const size = orientedSize(clip.width, clip.height, o.rotate);
  return {
    w: Math.min(1, Math.max(0.02, size.width > 0 ? 8 / size.width : 0.02)),
    h: Math.min(1, Math.max(0.02, size.height > 0 ? 8 / size.height : 0.02)),
  };
}

/**
 * The clip as it will be read: rotated and mirrored live with a CSS transform (Chrome has
 * already applied the file's own rotation), letterboxed in black, with the focus area box
 * over the displayed frame. Box coordinates are 0..1 of this displayed frame, exactly what
 * extraction expects.
 */
export function ClipView({
  url,
  clip,
  orientation,
  focusArea,
  onFocusChange,
  videoRef,
  focusBoxRef,
  onVideoError,
}: ClipViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ x: number; y: number; width: number; height: number }>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const displayed = orientedSize(clip.width, clip.height, orientation.rotate);
  const aspect = displayed.height > 0 ? displayed.width / displayed.height : 16 / 9;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const rect = host.getBoundingClientRect();
      const next = fitRect(rect.width, rect.height, aspect);
      setFrame((prev) =>
        Math.abs(prev.x - next.x) < 0.5 &&
        Math.abs(prev.y - next.y) < 0.5 &&
        Math.abs(prev.width - next.width) < 0.5 &&
        Math.abs(prev.height - next.height) < 0.5
          ? prev
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [aspect]);

  // Before rotation the video's box is the displayed frame turned back a quarter if needed.
  const quarter = orientation.rotate === 90 || orientation.rotate === 270;
  const videoWidth = quarter ? frame.height : frame.width;
  const videoHeight = quarter ? frame.width : frame.height;
  const transform = orientationTransform(orientation);

  return (
    <div ref={hostRef} className={styles.host}>
      <div
        className={styles.frame}
        style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
        data-testid="clip-frame"
      >
        <video
          ref={videoRef}
          className={styles.video}
          src={url}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          aria-label="The clip"
          style={{
            width: videoWidth,
            height: videoHeight,
            transform: `translate(-50%, -50%)${transform === 'none' ? '' : ` ${transform}`}`,
          }}
          onError={(event) => {
            // Only "can't play this" counts: an old clip's revoked address fails with a
            // network error while it is being replaced, which isn't the new clip's fault.
            const code = event.currentTarget.error?.code;
            if (
              code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
              code === MediaError.MEDIA_ERR_DECODE
            ) {
              onVideoError();
            }
          }}
        />
        <FocusBox
          rect={focusArea}
          onChange={(rect, phase) => onFocusChange?.(rect, phase)}
          minSize={minFocusSize(clip, orientation)}
          readOnly={!onFocusChange}
          boxRef={focusBoxRef}
        />
      </div>
    </div>
  );
}
