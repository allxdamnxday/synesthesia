import { useState } from 'react';
import { Checkbox } from '../../ui/Checkbox';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { countOf } from '../Library/format';

export interface DeleteAlbumDialogProps {
  /** The album to delete; null keeps the dialog closed. */
  album: { id: string; title: string; trackCount: number } | null;
  busy?: boolean;
  onConfirm: (deleteCompositions: boolean) => void;
  onCancel: () => void;
}

/**
 * Deleting an album removes only its record unless the person ticks the box: its
 * compositions stay in the library (the album is a research record; nothing is thrown
 * away by default).
 */
export function DeleteAlbumDialog({
  album,
  busy = false,
  onConfirm,
  onCancel,
}: DeleteAlbumDialogProps) {
  // The box starts unticked every time the dialog opens for an album.
  const [choice, setChoice] = useState<{ albumId: string | null; also: boolean }>({
    albumId: null,
    also: false,
  });
  const also = album !== null && choice.albumId === album.id && choice.also;
  const tracks = album ? countOf(album.trackCount, 'composition', 'compositions') : '';

  return (
    <ConfirmDialog
      open={album !== null}
      title={album ? `Delete “${album.title}”?` : ''}
      confirmLabel={also ? 'Delete album and compositions' : 'Delete album'}
      tone="danger"
      busy={busy}
      onConfirm={() => onConfirm(also)}
      onCancel={onCancel}
    >
      <p>
        This removes the album and its record from this browser. Its {tracks} stay in your library
        as separate compositions.
      </p>
      {album && album.trackCount > 0 ? (
        <Checkbox
          label={`Also delete its ${tracks} and their notes`}
          checked={also}
          onChange={(checked) => setChoice({ albumId: album.id, also: checked })}
          disabled={busy}
        />
      ) : null}
      {also ? (
        <p>This can’t be undone. Export the album log first if you might want the record.</p>
      ) : null}
    </ConfirmDialog>
  );
}
