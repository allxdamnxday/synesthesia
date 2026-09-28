import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/app/tokens.css';
import '../../src/app/global.css';
import { sharedProperty } from '../../src/materials/properties';
import type { PropertyDef } from '../../src/materials/types';
import { Button } from '../../src/ui/Button';
import { MaterialPicker } from '../../src/ui/MaterialPicker';
import { PropertyPanel } from '../../src/ui/PropertyPanel';
import { SegmentedControl } from '../../src/ui/SegmentedControl';
import { SnapshotBar, type Slot } from '../../src/ui/SnapshotBar';
import { Slider, type SliderPhase } from '../../src/ui/Slider';
import { Toggle } from '../../src/ui/Toggle';
import { Transport } from '../../src/ui/Transport';

declare global {
  interface Window {
    spUi: { log: Array<{ value: number; phase: SliderPhase }> };
  }
}
window.spUi = { log: [] };

const DEFS: PropertyDef[] = [
  sharedProperty('dispersion', 'visual'),
  sharedProperty('persistence', 'visual'),
  sharedProperty('intensity', 'visual'),
  sharedProperty('range', 'visual'),
  {
    id: 'palette',
    label: 'Palette',
    description: 'The colors of the dye.',
    kind: 'choice',
    shared: false,
    default: 0,
    choices: ['Deep water', 'Ink', 'Prism'],
    primary: true,
  },
];

const MATERIALS = [
  { id: 'water', name: 'Water', description: 'Colored dye in clear water, seen from below.' },
  { id: 'honey', name: 'Honey', description: 'The same movement through thick, slow amber.' },
  { id: 'smoke', name: 'Smoke', description: 'Pale smoke rising and curling on dark.' },
];

function Gallery() {
  const [props, setProps] = useState<Record<string, number>>({});
  const [material, setMaterial] = useState('water');
  const [viscosity, setViscosity] = useState(0.5);
  const [speed, setSpeed] = useState(1);
  const [locked, setLocked] = useState(true);
  const [palette, setPalette] = useState(0);
  const [linked, setLinked] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [position, setPosition] = useState(0);
  const [stored, setStored] = useState<Partial<Record<Slot, boolean>>>({});
  const [activeSlot, setActiveSlot] = useState<Slot | null>(null);
  return (
    <main style={{ padding: 32, maxWidth: 800, display: 'grid', gap: 24 }}>
      <h1>UI controls</h1>
      <div data-testid="viscosity">
        <Slider
          label="Viscosity"
          description="How thick the material is."
          value={viscosity}
          baseline={0.5}
          onChange={(v, phase) => {
            window.spUi.log.push({ value: v, phase });
            setViscosity(v);
          }}
        />
      </div>
      <Slider
        label="Speed"
        min={0.25}
        max={2}
        step={0.05}
        value={speed}
        baseline={1}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => setSpeed(v)}
      />
      <Slider
        label="Brightness"
        value={0.5}
        baseline={0.5}
        locked={locked}
        onUnlock={() => setLocked(false)}
        onChange={() => undefined}
      />
      <SegmentedControl
        label="Palette"
        options={['Deep water', 'Ink', 'Prism']}
        value={palette}
        onChange={setPalette}
      />
      <Toggle label="Linked" checked={linked} onChange={setLinked} accent="water" />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary">Save</Button>
        <Button>Save as new</Button>
        <Button variant="quiet">Cancel</Button>
      </div>
      <output data-testid="value">{viscosity.toFixed(3)}</output>
      <div style={{ width: 760 }}>
        <Transport
          playing={playing}
          onPlayPause={() => setPlaying(!playing)}
          loop={loop}
          onLoopChange={setLoop}
          position={position}
          duration={11}
          onSeek={(t) => setPosition(t)}
          markers={[0.6, 1.15, 2.8, 3.35]}
          tailStart={8}
        >
          <SnapshotBar
            stored={stored}
            active={activeSlot}
            onStore={(slot) => {
              setStored({ ...stored, [slot]: true });
              setActiveSlot(slot);
            }}
            onRecall={(slot) => setActiveSlot(slot)}
          />
        </Transport>
      </div>
      <MaterialPicker kind="Visual" options={MATERIALS} value={material} onChange={setMaterial} />
      <output data-testid="material">{material}</output>
      <PropertyPanel
        label="Water properties"
        defs={DEFS}
        values={props}
        linkedIds={new Set(['dispersion'])}
        lockedIds={new Set(['intensity'])}
        onUnlock={() => undefined}
        onChange={(id, v) => setProps({ ...props, [id]: v })}
      />
      <output data-testid="position">{position.toFixed(1)}</output>
    </main>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
}
