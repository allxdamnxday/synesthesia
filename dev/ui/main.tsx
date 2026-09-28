import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/app/tokens.css';
import '../../src/app/global.css';
import { Button } from '../../src/ui/Button';
import { SegmentedControl } from '../../src/ui/SegmentedControl';
import { Slider, type SliderPhase } from '../../src/ui/Slider';
import { Toggle } from '../../src/ui/Toggle';

declare global {
  interface Window {
    spUi: { log: Array<{ value: number; phase: SliderPhase }> };
  }
}
window.spUi = { log: [] };

function Gallery() {
  const [viscosity, setViscosity] = useState(0.5);
  const [speed, setSpeed] = useState(1);
  const [locked, setLocked] = useState(true);
  const [palette, setPalette] = useState(0);
  const [linked, setLinked] = useState(true);
  return (
    <main style={{ padding: 32, maxWidth: 420, display: 'grid', gap: 24 }}>
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
