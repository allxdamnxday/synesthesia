import { useStudioStore } from '../../state/studioStore';
import { clipForVisit } from '../../state/visitClips';
import { Slider } from '../../ui/Slider';
import styles from './Studio.module.css';

const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * The Clip slider (SPEC 6.3 "Clip layer"): how strongly the clip shows over the wake.
 * It is here only while the clip is, which is the visit its signature was made in; at 0%
 * (where every composition opens) the source is out of sight, as it always was.
 */
export function ClipControl() {
  const hash = useStudioStore((s) => s.signature?.contentHash ?? null);
  const opacity = useStudioStore((s) => s.clipOpacity);
  const failed = useStudioStore((s) => s.clipFailed);
  const here = hash !== null && clipForVisit(hash) !== null;
  if (!here && !failed) return null;

  return (
    <section className={styles.section} aria-label="Clip">
      {here ? (
        <>
          <Slider
            label="Clip"
            description="Shows the clip over the wake, so the movement and what it leaves can be seen together. At 0% it is hidden."
            value={opacity}
            min={0}
            max={1}
            step={0.01}
            baseline={0}
            format={percent}
            showValue
            onChange={(value) => useStudioStore.getState().setClipOpacity(value)}
          />
          <p className={styles.hint}>
            Only for looking: the clip is never part of a video you render. It stays until this page
            is closed or reloaded.
          </p>
        </>
      ) : (
        <p className={styles.fieldNote} role="status">
          The clip can’t be shown any more. Its file may have been moved or changed.
        </p>
      )}
    </section>
  );
}
