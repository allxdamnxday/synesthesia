/** Spike 2 worker: run the decode checks for each clip, then force GC and report. */
import { checkClip, collectGarbage, watchUnclosedWarnings } from './checks';
import type { DecodeRequest, DecodeResponse } from './protocol';

const unclosed = watchUnclosedWarnings();

function post(message: DecodeResponse): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<DecodeRequest>) => {
  if (event.data.type !== 'run') return;
  const { clips } = event.data;
  void (async () => {
    try {
      for (const clip of clips) post({ type: 'clip', result: await checkClip(clip) });
      const gcForced = await collectGarbage();
      post({ type: 'done', gcForced, unclosedWarnings: unclosed() });
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  })();
};
