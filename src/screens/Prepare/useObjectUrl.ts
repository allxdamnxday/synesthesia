import { useEffect, useState } from 'react';

/**
 * An object URL for a file, revoked when the file changes or the component goes away, so
 * the clip can't be reached through its URL once Prepare closes (SPEC C7).
 */
export function useObjectUrl(file: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [file]);
  return url;
}
