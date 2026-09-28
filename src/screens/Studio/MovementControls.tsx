import { GLOBAL_CONTROLS, type TimelineSettings } from '../../engine/composition';
import { useStudioStore } from '../../state/studioStore';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Slider, type SliderPhase } from '../../ui/Slider';
import styles from './Studio.module.css';

type NumericControl = 'signatureStrength' | 'smoothing' | 'speed' | 'loops' | 'tailSec';

interface ControlSpec {
  key: NumericControl;
  label: string;
  description: string;
  format: (value: number) => string;
}

const CONTROLS: ControlSpec[] = [
  {
    key: 'signatureStrength',
    label: 'Signature strength',
    description:
      'How strongly the movement acts on both materials: below 1 gentler, above 1 stronger than recorded.',
    format: (v) => v.toFixed(2),
  },
  {
    key: 'smoothing',
    label: 'Smoothing',
    description: 'Softens quick changes in the movement.',
    format: (v) => v.toFixed(2),
  },
  {
    key: 'speed',
    label: 'Speed',
    description: 'How fast the movement plays.',
    format: (v) => `${v.toFixed(2)}×`,
  },
  {
    key: 'loops',
    label: 'Loops',
    description: 'How many times the movement plays.',
    format: (v) => String(Math.round(v)),
  },
  {
    key: 'tailSec',
    label: 'Tail',
    description: 'How long the wake settles after the movement ends.',
    format: (v) => `${v.toFixed(1)} s`,
  },
];

/** Global composition controls (SPEC 9.2). The timeline's length follows them live. */
export function MovementControls() {
  const timeline = useStudioStore((s) => s.composition?.timeline);
  const preferredSpeed = useStudioStore((s) => s.signature?.preferredSpeed ?? 1);
  if (!timeline) return null;
  const store = useStudioStore.getState;

  const set = (key: NumericControl, value: number, phase: SliderPhase) => {
    const patch: Partial<TimelineSettings> = { [key]: key === 'loops' ? Math.round(value) : value };
    store().setTimeline(patch, { key: `timeline:${key}`, phase });
  };
  const speedRange = GLOBAL_CONTROLS.speed;
  const baselineOf = (key: NumericControl): number =>
    key === 'speed'
      ? Math.min(speedRange.max, Math.max(speedRange.min, preferredSpeed))
      : GLOBAL_CONTROLS[key].default;

  const slider = (spec: ControlSpec) => {
    const range = GLOBAL_CONTROLS[spec.key];
    return (
      <Slider
        key={spec.key}
        label={spec.label}
        description={spec.description}
        value={timeline[spec.key]}
        min={range.min}
        max={range.max}
        step={range.step}
        baseline={baselineOf(spec.key)}
        format={spec.format}
        showValue
        onChange={(value, phase) => set(spec.key, value, phase)}
      />
    );
  };

  return (
    <div className={styles.controls}>
      {CONTROLS.filter((c) => c.key !== 'tailSec').map(slider)}
      <SegmentedControl
        label="Repeat"
        description={
          timeline.loops < 2
            ? 'Takes effect with two or more loops.'
            : 'Each repeat plays from the start again, or back and forth.'
        }
        options={['Loop', 'Back and forth']}
        value={timeline.loopMode === 'pingpong' ? 1 : 0}
        disabled={timeline.loops < 2}
        onChange={(i) => store().setTimeline({ loopMode: i === 1 ? 'pingpong' : 'loop' })}
      />
      {CONTROLS.filter((c) => c.key === 'tailSec').map(slider)}
    </div>
  );
}
