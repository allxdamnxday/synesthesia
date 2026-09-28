import { useCallback, useEffect, useRef, useState } from 'react';
import { formatResults, runChecks, type SpikeResults } from './checks';
import { FluidCanvas, type FluidCanvasStats } from './FluidCanvas';

export interface Spike5Api {
  run(): Promise<SpikeResults>;
  results: SpikeResults | null;
  report: string;
  done: boolean;
  error: string | null;
}

declare global {
  interface Window {
    spSpike5?: Spike5Api;
  }
}

const api: Spike5Api = {
  run: () => Promise.reject(new Error('not ready')),
  results: null,
  report: '',
  done: false,
  error: null,
};
window.spSpike5 = api;
let autoRunStarted = false;

export function App() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SpikeResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveFps, setLiveFps] = useState(0);
  const [copyState, setCopyState] = useState('');
  const workRef = useRef<HTMLDivElement>(null);
  const lastFpsUpdate = useRef(0);

  const run = useCallback(async (): Promise<SpikeResults> => {
    setRunning(true);
    setError(null);
    setCopyState('');
    api.done = false;
    try {
      // Let React unmount the live demo so it doesn't compete for the GPU.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const container = workRef.current;
      if (!container) throw new Error('The check area is missing.');
      const outcome = await runChecks(container);
      setResults(outcome);
      api.results = outcome;
      api.report = formatResults(outcome);
      return outcome;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      api.error = message;
      throw e;
    } finally {
      api.done = true;
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    api.run = run;
    if (!autoRunStarted && new URLSearchParams(location.search).get('run') === '1') {
      autoRunStarted = true;
      run().catch(() => undefined);
    }
  }, [run]);

  const onFrame = useCallback((stats: FluidCanvasStats) => {
    const now = performance.now();
    if (now - lastFpsUpdate.current > 500) {
      lastFpsUpdate.current = now;
      setLiveFps(stats.fps);
    }
  }, []);

  const copy = async () => {
    if (!results) return;
    try {
      await navigator.clipboard.writeText(formatResults(results));
      setCopyState('Copied to the clipboard.');
    } catch {
      setCopyState('Copying was blocked; select the report below instead.');
    }
  };

  return (
    <main>
      <h1>Spike 5: fluid simulation in React</h1>
      <p className="lede">
        The real Water material on a canvas, driven by the synthetic wink at a fixed step of 1/60 s
        (no mouse or keyboard input). The checks mount and unmount it 20 times, compare frame
        hashes, and measure the frame rate at each quality tier. <a href="../">All spikes</a>
      </p>
      {!running && (
        <div className="stage">
          <FluidCanvas width={960} height={540} quality="standard" onFrame={onFrame} />
        </div>
      )}
      {/* The checks mount their canvases here, visibly, so frame rates include compositing. */}
      <div ref={workRef} className="work" />
      <p className="meta">
        {running
          ? 'Running checks: the demo is paused so it doesn’t compete for the graphics card.'
          : `Demo: standard quality, ${liveFps.toFixed(0)} fps`}
      </p>
      <div className="buttons">
        <button type="button" onClick={() => void run().catch(() => undefined)} disabled={running}>
          {running ? 'Running…' : 'Run checks'}
        </button>
        <button type="button" onClick={() => void copy()} disabled={!results || running}>
          Copy results
        </button>
        <span role="status">{copyState}</span>
      </div>
      {error && <p className="fail">The checks stopped: {error}</p>}
      {results && (
        <section aria-label="Results">
          <h2 className={results.pass ? 'pass' : 'fail'}>{results.pass ? 'PASS' : 'FAIL'}</h2>
          <ul className="checks">
            {results.checks.map((c) => (
              <li key={c.name}>
                <strong className={c.pass ? 'pass' : 'fail'}>{c.pass ? 'PASS' : 'FAIL'}</strong>{' '}
                {c.name}
                <div className="detail">{c.detail}</div>
              </li>
            ))}
          </ul>
          <pre>{formatResults(results)}</pre>
        </section>
      )}
    </main>
  );
}
