import { FileButton } from '../../ui/FileButton';
import styles from './DropZone.module.css';
import { CLIP_ACCEPT } from './PreparePanel';

export interface DropZoneProps {
  onFiles: (files: File[]) => void;
  /** A file is being dragged over the window. */
  dragging: boolean;
  opening: boolean;
}

/** The empty stage: drop a clip anywhere on the screen, or choose one. */
export function DropZone({ onFiles, dragging, opening }: DropZoneProps) {
  return (
    <div className={`${styles.zone} ${dragging ? styles.dragging : ''}`}>
      {opening ? (
        <p className={styles.lead} role="status">
          Opening the clip…
        </p>
      ) : (
        <>
          <p className={styles.lead}>{dragging ? 'Drop the clip here' : 'Drop a clip here'}</p>
          <p className={styles.or}>or</p>
          <FileButton accept={CLIP_ACCEPT} onFiles={onFiles}>
            Choose a clip…
          </FileButton>
        </>
      )}
    </div>
  );
}
