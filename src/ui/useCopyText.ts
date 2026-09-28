import { useCallback, useState } from 'react';

export type CopyStatus = 'idle' | 'copied' | 'fallback';

/**
 * Copy text to the clipboard. When the browser refuses (no permission, insecure page, no
 * Clipboard API), the status becomes 'fallback' so the caller can show the text in a
 * {@link CopyFallback} box for the person to copy by hand.
 */
export function useCopyText(): {
  status: CopyStatus;
  text: string;
  copy: (value: string) => Promise<void>;
  reset: () => void;
} {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const [text, setText] = useState('');

  const copy = useCallback(async (value: string) => {
    setText(value);
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(value);
      setStatus('copied');
    } catch {
      setStatus('fallback');
    }
  }, []);

  const reset = useCallback(() => setStatus('idle'), []);

  return { status, text, copy, reset };
}
