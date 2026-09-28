import { useMemo } from 'react';
import { useStudioStore } from '../../state/studioStore';
import { SnapshotBar, type Slot } from '../../ui/SnapshotBar';
import { Transport } from '../../ui/Transport';
import { ChanceButton } from './ChancePopover';
import styles from './Studio.module.css';

/** Play, loop, scrub and time; snapshots A–D; Draw by chance (SPEC 13.3). */
export function StudioTransport() {
  const transport = useStudioStore((s) => s.transport);
  const timeline = useStudioStore((s) => s.timeline);
  const loop = useStudioStore((s) => s.loop);
  const snapshots = useStudioStore((s) => s.snapshots);
  const activeSlot = useStudioStore((s) => s.activeSlot);
  const composition = useStudioStore((s) => s.composition);
  const store = useStudioStore.getState;

  const stored = useMemo(() => {
    const out: Partial<Record<Slot, boolean>> = {};
    for (const slot of ['A', 'B', 'C', 'D'] as const) out[slot] = snapshots[slot] !== undefined;
    return out;
  }, [snapshots]);

  // A slot is lit while the composition still matches it.
  const active = useMemo(() => {
    if (!activeSlot || !composition) return null;
    const snap = snapshots[activeSlot];
    if (!snap) return null;
    const current = {
      seed: composition.seed,
      timeline: composition.timeline,
      linked: composition.linked,
      visual: composition.visual,
      sound: composition.sound,
      mute: composition.mute,
      chance: composition.chance,
    };
    return JSON.stringify(current) === JSON.stringify(snap) ? activeSlot : null;
  }, [activeSlot, snapshots, composition]);

  const duration = timeline.duration > 0 ? timeline.duration : transport.duration;
  return (
    <div className={styles.transport}>
      <Transport
        playing={transport.playing}
        onPlayPause={() => store().togglePlay()}
        loop={loop}
        onLoopChange={(next) => store().setLoop(next)}
        position={Math.min(transport.position, duration)}
        duration={duration}
        onSeek={(t, phase) => store().seek(t, phase)}
        markers={timeline.markers}
        tailStart={timeline.tailStart}
        catchingUp={transport.catchingUp}
      >
        <SnapshotBar
          stored={stored}
          active={active}
          onRecall={(slot) => store().recallSnapshot(slot)}
          onStore={(slot) => store().storeSnapshot(slot)}
        />
        <ChanceButton />
      </Transport>
    </div>
  );
}
