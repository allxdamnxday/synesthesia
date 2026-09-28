/**
 * Spike 4 (SPEC 16, M0): WebGL2 half-float/float render targets with linear filtering.
 * Runs the same probe as Diagnostics (src/render/capabilities/webgl.ts) and shows the
 * whole matrix, the extensions, the GPU string and the signature-upload result.
 */
import {
  assessWebGL,
  collectEnvironment,
  environmentRows,
  formatFloatMatrix,
  probeWebGL,
  type FloatFormatResult,
  type WebGLProbe,
} from '../../src/render/capabilities';
import {
  READBACK_VALUES,
  REPORTED_EXTENSIONS,
  type FloatFormatName,
} from '../../src/render/capabilities/webgl';

const NEEDED_FOR: Record<FloatFormatName, string> = {
  RGBA16F: 'Required (fluid velocity, dye, pressure)',
  RG16F: 'Nice to have (velocity, signature field)',
  R16F: 'Nice to have (pressure, divergence, curl)',
  RGBA32F: 'Not needed',
  RG32F: 'Not needed',
  R32F: 'Not needed',
};

let lastProbe: WebGLProbe | null = null;
let lastPower: WebGLPowerPreference = 'default';
let environmentLines: string[] = [];

function formatOk(f: FloatFormatResult): boolean {
  return f.renderable && f.readback === 'ok' && f.linearFilter === 'ok';
}

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function requiredOk(probe: WebGLProbe): boolean {
  const rgba16 = probe.formats.find((f) => f.format === 'RGBA16F');
  return probe.available === true && !!rgba16 && formatOk(rgba16);
}

function resultsText(): string {
  const probe = lastProbe;
  if (!probe) return 'Spike 4: not run yet\n';
  const rows = assessWebGL(probe);
  const lines = [
    'Spike 4: float render targets results',
    ...environmentLines,
    `Power preference: ${lastPower}`,
    `WebGL2: ${probe.available === true ? 'yes' : probe.available === false ? `no (${probe.contextError ?? 'no reason given'})` : 'unknown'}`,
    `GPU: ${probe.gpu?.renderer ?? '?'} (vendor ${probe.gpu?.vendor ?? '?'})`,
    `Version: ${probe.version ?? '?'}; ${probe.shadingLanguageVersion ?? '?'}`,
    `MAX_TEXTURE_SIZE: ${probe.maxTextureSize ?? '?'}`,
    `Extensions: ${REPORTED_EXTENSIONS.map((e) => `${e} ${probe.extensions[e] ? 'yes' : 'no'}`).join(', ')}`,
    `Sampled through: ${probe.sampleTarget ?? 'none'}`,
    '',
    formatFloatMatrix(probe.formats),
    '',
    ...probe.formats.filter((f) => f.note).map((f) => `${f.format} note: ${f.note ?? ''}`),
    ...probe.signatureUpload.map(
      (u) =>
        `Signature upload (Float32 -> ${u.format}, bilinear): ${u.ok ? 'ok' : 'failed'}${
          u.maxError !== null ? `, max error ${u.maxError}` : ''
        }${u.note ? ` (${u.note})` : ''}`,
    ),
    probe.contextLost ? 'The WebGL context was lost during the check.' : '',
    probe.unexpectedError ? `Unexpected error: ${probe.unexpectedError}` : '',
    '',
    `Required (RGBA16F renderable, keeps values outside 0..1, linear filtering): ${
      requiredOk(probe) ? 'PASS' : 'FAIL'
    }`,
    ...rows.map((r) => `${r.label}: ${r.status.toUpperCase()} - ${r.summary}`),
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '');
  return `${lines.join('\n')}\n`;
}

function render(probe: WebGLProbe) {
  const tbody = document.getElementById('matrix');
  if (tbody) {
    tbody.replaceChildren(
      ...probe.formats.map((f) => {
        const tr = document.createElement('tr');
        tr.dataset.format = f.format;
        const ok = formatOk(f);
        tr.append(
          cell(f.format),
          cell(NEEDED_FOR[f.format]),
          cell(f.renderable ? 'yes' : f.allocated ? 'no (incomplete)' : 'no (allocation failed)'),
          cell(
            f.readback === null
              ? 'not tested'
              : `${f.readback}${f.readbackValues ? ` [${f.readbackValues.join(', ')}]` : ''}`,
          ),
          cell(
            f.linearFilter === 'untested'
              ? 'not tested'
              : `${f.linearFilter} (${f.filterValue?.toFixed(4) ?? '?'})`,
          ),
          cell(ok ? 'PASS' : 'FAIL', ok ? 'pass' : 'fail'),
        );
        return tr;
      }),
    );
  }
  const verdict = document.getElementById('verdict');
  if (verdict) {
    const ok = requiredOk(probe);
    verdict.textContent = ok
      ? 'PASS: half-float render targets work with linear filtering.'
      : probe.available === false
        ? 'FAIL: WebGL2 is not available.'
        : 'FAIL: half-float render targets with linear filtering are not fully supported.';
    verdict.className = `verdict ${ok ? 'pass' : 'fail'}`;
  }
  const details = document.getElementById('details');
  if (details) details.textContent = resultsText();
}

async function run() {
  const checked = document.querySelector<HTMLInputElement>('input[name="power"]:checked');
  const power = (checked?.value ?? 'default') as WebGLPowerPreference;
  const status = document.getElementById('status');
  if (status) status.textContent = 'Running…';
  const probe = await probeWebGL({ scope: 'full', powerPreference: power });
  // Update both together so the results text never mixes one run's setting with another's.
  lastProbe = probe;
  lastPower = power;
  render(probe);
  if (status) status.textContent = `Done (values written: ${READBACK_VALUES.join(', ')}).`;
}

document.getElementById('run')?.addEventListener('click', () => void run());
for (const input of document.querySelectorAll<HTMLInputElement>('input[name="power"]')) {
  input.addEventListener('change', () => void run());
}
document.getElementById('copy')?.addEventListener('click', () => {
  const status = document.getElementById('status');
  void navigator.clipboard.writeText(resultsText()).then(
    () => {
      if (status) status.textContent = 'Results copied.';
    },
    () => {
      if (status) status.textContent = 'Copying was blocked; select the details text instead.';
    },
  );
});

declare global {
  interface Window {
    /** For spikes/04-float-targets/run.mjs. */
    spike04?: { done: Promise<void>; text: () => string; probe: () => WebGLProbe | null };
  }
}

const done = collectEnvironment()
  .then((env) => {
    environmentLines = environmentRows(env)
      .filter((row) => ['Browser', 'Operating system', 'CPU'].includes(row.label))
      .map((row) => `${row.label}: ${row.value}`);
  })
  .catch(() => undefined)
  .then(run);
window.spike04 = { done, text: resultsText, probe: () => lastProbe };
