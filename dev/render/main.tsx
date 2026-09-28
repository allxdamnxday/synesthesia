/**
 * Render harness page (Milestone 4). Exposes `window.spRender` for tests/e2e/render.spec.ts
 * and offers the manual checks Braden runs on a Mac:
 *
 * - Check alignment: renders the flash/click test composition and reads the MP4 back with
 *   Mediabunny to measure where the white frames and clicks land (no ffmpeg needed).
 * - Render a sample and download it: a Water composition to play in QuickTime.
 * - Render into a folder: the real folder picker and streaming save.
 * - Open the render dialog: the dialog the Studio uses, with a sample composition.
 *
 * URL options: ?signature=<url of a .sig.json> (default: the synthetic wink).
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/app/tokens.css';
import '../../src/app/global.css';
import type { Composition } from '../../src/engine/composition';
import { getRenderDefaults } from '../../src/render/capabilities';
import { renderComposition } from '../../src/render';
import { RenderDialog } from '../../src/screens/Studio/render/RenderDialog';
import { chooseRenderFolder, setRenderFolderForTesting } from '../../src/state/renderFolder';
import type { KineticSignature } from '../../src/signature/types';
import { Button } from '../../src/ui/Button';
import {
  alignmentCheck,
  buildComposition,
  clearOpfs,
  harnessMaterials,
  listFolder,
  loadSignature,
  opfsFolder,
  readBack,
  renderToBytes,
  type AlignmentReport,
  type ReadBack,
  type RenderBytesOptions,
  type RenderBytesResult,
} from './harness';

interface DialogRequest {
  composition: Composition;
  signature: KineticSignature;
}

interface SpRenderApi {
  ready: boolean;
  renderToBytes(opts: RenderBytesOptions): Promise<RenderBytesResult>;
  alignmentCheck(opts?: Parameters<typeof alignmentCheck>[0]): Promise<AlignmentReport>;
  /** Read back an MP4 (base64) the way a player would. */
  readBackBase64(base64: string): Promise<ReadBack>;
  listOpfs(dir: string): Promise<{ name: string; size: number }[]>;
  clearOpfs(dir: string): Promise<void>;
  /** Open the render dialog; `useOpfsFolder` stands in for a folder chosen with the picker. */
  openDialog(opts?: RenderBytesOptions & { useOpfsFolder?: string }): Promise<void>;
  /** What the dialog's onClose reported last (undefined until it closes). */
  dialogClosedWith: string | null | undefined;
  renderDefaults(): ReturnType<typeof getRenderDefaults>;
}

declare global {
  interface Window {
    spRender: SpRenderApi;
  }
}

const params = new URLSearchParams(location.search);
const signatureUrl = params.get('signature') ?? undefined;

let showDialog: (request: DialogRequest | null) => void = () => {};

function base64ToBlob(base64: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'video/mp4' });
}

window.spRender = {
  ready: true,
  renderToBytes,
  alignmentCheck,
  readBackBase64: (base64) => readBack(base64ToBlob(base64)),
  listOpfs: async (dir) => listFolder(await opfsFolder(dir)),
  clearOpfs,
  async openDialog(opts = {}) {
    const signature = await loadSignature(opts.signatureUrl ?? signatureUrl);
    const composition = buildComposition(signature, opts);
    if (opts.useOpfsFolder) setRenderFolderForTesting(await opfsFolder(opts.useOpfsFolder));
    window.spRender.dialogClosedWith = undefined;
    showDialog({ composition, signature });
  },
  dialogClosedWith: undefined,
  renderDefaults: () => getRenderDefaults(),
};

function Harness() {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  showDialog = setDialog;

  const run = async (label: string, task: () => Promise<string>) => {
    setBusy(true);
    setStatus(`${label}…`);
    try {
      setStatus(await task());
    } catch (error) {
      setStatus(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const sampleRender = async (destination: 'download' | 'folder'): Promise<string> => {
    const signature = await loadSignature(signatureUrl);
    const composition = buildComposition(signature, { width: 1920, height: 1080, fps: 30 });
    let directory: FileSystemDirectoryHandle | null = null;
    if (destination === 'folder') {
      const choice = await chooseRenderFolder();
      if (!choice.ok) return choice.message;
      directory = choice.handle;
    }
    const started = performance.now();
    const result = await renderComposition({
      composition,
      signature,
      output: {
        width: 1920,
        height: 1080,
        fps: 30,
        quality: 'high',
        normalize: true,
        sidecar: true,
      },
      destination: directory ? { kind: 'folder', directory } : { kind: 'download' },
      materials: harnessMaterials(signature, composition),
      onProgress: (p) => {
        if (p.phase === 'frames' && p.framesDone % 15 === 0) {
          setStatus(`Drawing frames… ${p.framesDone} of ${p.frameCount}`);
        }
      },
    });
    const seconds = (performance.now() - started) / 1000;
    return [
      `Saved ${result.fileName} (${(result.bytes / 1e6).toFixed(1)} MB)${
        result.folderName ? ` in “${result.folderName}”` : ' to downloads'
      }, with ${result.sidecarFileName ?? 'no composition file'}.`,
      `${result.frameCount} frames at ${result.width}×${result.height}, ${result.fps} fps, ${result.mimeType}`,
      `Took ${seconds.toFixed(1)} s (${((seconds * 1000) / result.frameCount).toFixed(1)} ms per frame).`,
      ...result.warnings,
    ].join('\n');
  };

  return (
    <main style={{ padding: 32, maxWidth: 820, display: 'grid', gap: 16 }}>
      <h1>Render harness</h1>
      <p style={{ color: 'var(--color-mist)' }}>
        Offline MP4 render checks. Not part of the instrument. Signature:{' '}
        {signatureUrl ?? 'the synthetic wink'}. <a href="../">All harness pages</a>
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            void run('Checking alignment', async () => {
              const a = await alignmentCheck({ signatureUrl, fps: 30 });
              const b = await alignmentCheck({ signatureUrl, fps: 30, speed: 0.96 });
              return `${a.text}\n\n${b.text}`;
            })
          }
        >
          Check alignment
        </Button>
        <Button
          disabled={busy}
          onClick={() => void run('Rendering', () => sampleRender('download'))}
        >
          Render a sample and download it
        </Button>
        <Button disabled={busy} onClick={() => void run('Rendering', () => sampleRender('folder'))}>
          Render a sample into a folder…
        </Button>
        <Button disabled={busy} onClick={() => void window.spRender.openDialog()}>
          Open the render dialog
        </Button>
      </div>
      <pre
        id="status"
        role="status"
        style={{ whiteSpace: 'pre-wrap', color: 'var(--color-mist)', fontSize: 14 }}
      >
        {status}
      </pre>
      {dialog ? (
        <RenderDialog
          composition={dialog.composition}
          signature={dialog.signature}
          onClose={(fileName) => {
            window.spRender.dialogClosedWith = fileName;
            setDialog(null);
          }}
        />
      ) : null}
    </main>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');
createRoot(rootElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
