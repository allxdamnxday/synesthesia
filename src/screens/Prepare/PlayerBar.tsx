import { useValueStore } from '../../state/valueStore';
import { FrameBackIcon, FrameForwardIcon, PauseIcon, PlayIcon } from '../../ui/mediaIcons';
import { TrimBar, type TrimEdge } from '../../ui/TrimBar';
import type { SliderPhase } from '../../ui/Slider';
import type { ClipPlayer } from './clipPlayback';
import { formatClipTime } from './format';
import styles from './PlayerBar.module.css';
import { frameDuration, type Trim } from './trim';

export interface PlayerBarProps {
  player: ClipPlayer;
  durationSec: number;
  fps: number;
  trim: Trim;
  maxLength: number;
  disabled: boolean;
  onTrim: (edge: TrimEdge, seconds: number, phase: SliderPhase) => void;
  onSeek: (seconds: number, phase: SliderPhase) => void;
}

/** Under the clip: play/pause, one frame back or forward, the time, and the trim timeline. */
export function PlayerBar({
  player,
  durationSec,
  fps,
  trim,
  maxLength,
  disabled,
  onTrim,
  onSeek,
}: PlayerBarProps) {
  const time = useValueStore(player.time);
  const inert = disabled || !player.ready;
  return (
    <div className={styles.player}>
      <div className={styles.controls}>
        <button
          type="button"
          className={`${styles.round} ${styles.play}`}
          onClick={player.toggle}
          disabled={inert}
          aria-label={player.playing ? 'Pause the clip' : 'Play the clip'}
          title={player.playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {player.playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          className={styles.round}
          onClick={() => player.step(-1)}
          disabled={inert}
          aria-label="Back one frame"
          title="Back one frame (,)"
        >
          <FrameBackIcon />
        </button>
        <button
          type="button"
          className={styles.round}
          onClick={() => player.step(1)}
          disabled={inert}
          aria-label="Forward one frame"
          title="Forward one frame (.)"
        >
          <FrameForwardIcon />
        </button>
        <span className={styles.time} data-testid="clip-time">
          {formatClipTime(time)}
          <span className={styles.total}> / {formatClipTime(durationSec)}</span>
        </span>
      </div>
      <TrimBar
        duration={durationSec}
        start={trim.startSec}
        end={trim.endSec}
        position={time}
        frameStep={frameDuration(fps)}
        onTrim={onTrim}
        onSeek={onSeek}
        format={formatClipTime}
        disabled={inert}
        maxLength={maxLength}
      />
    </div>
  );
}
