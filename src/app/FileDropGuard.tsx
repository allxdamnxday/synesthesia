import { useEffect } from 'react';
import { looksLikeClip, setPendingClip } from '../state/pendingClip';
import { navigate, useHashPath } from './router';

/**
 * Anywhere but Prepare (which handles drops itself): stop the browser from opening a
 * dropped file in place of the app, and take a dropped clip to Prepare.
 */
export function FileDropGuard() {
  const path = useHashPath();
  useEffect(() => {
    if (path === '/prepare') return;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const clip = Array.from(e.dataTransfer?.files ?? []).find(looksLikeClip);
      if (clip) {
        setPendingClip(clip);
        navigate('/prepare');
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [path]);
  return null;
}
