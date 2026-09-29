import { useMemo, useState } from 'react';
import { href } from '../../app/router';
import { useStudioStore } from '../../state/studioStore';
import { compositionsDiffer } from '../../studio/edits';
import { ActionMenu } from '../../ui/ActionMenu';
import { Button } from '../../ui/Button';
import { InlineRename } from '../../ui/InlineRename';
import styles from './Studio.module.css';

/** Breadcrumb (Library / signature / composition, renamed in place), save state, actions. */
export function StudioHeader() {
  const composition = useStudioStore((s) => s.composition);
  const baseline = useStudioStore((s) => s.baseline);
  const signature = useStudioStore((s) => s.signature);
  const album = useStudioStore((s) => s.album);
  const isNew = useStudioStore((s) => s.isNew);
  const saving = useStudioStore((s) => s.saving);
  const [renaming, setRenaming] = useState(false);
  const changed = useMemo(
    () => (composition && baseline ? compositionsDiffer(composition, baseline) : false),
    [composition, baseline],
  );
  if (!composition || !signature) return null;
  const store = useStudioStore.getState;

  const saveState = saving
    ? 'Saving…'
    : isNew
      ? 'Not saved yet'
      : changed
        ? 'Unsaved changes'
        : 'Saved';

  return (
    <header className={styles.header}>
      <nav className={styles.crumbs} aria-label="Where you are">
        <ol>
          <li>
            <a href={href('/')}>Library</a>
          </li>
          <li>
            {album ? (
              <a href={href(`/album/${encodeURIComponent(album.id)}`)}>{album.title}</a>
            ) : (
              <a href={href(`/signature/${encodeURIComponent(signature.id)}`)}>{signature.name}</a>
            )}
          </li>
          <li aria-current="page" className={styles.current}>
            {renaming ? (
              <InlineRename
                value={composition.name}
                label={`New name for ${composition.name}`}
                className={styles.renameField}
                onCommit={(name) => {
                  store().rename(name);
                  setRenaming(false);
                }}
                onCancel={() => setRenaming(false)}
              />
            ) : (
              <button
                type="button"
                className={styles.nameButton}
                onClick={() => setRenaming(true)}
                title="Rename"
                aria-label={`${composition.name}. Rename`}
              >
                {composition.name}
              </button>
            )}
          </li>
        </ol>
      </nav>
      <p className={styles.saveState} role="status" data-testid="save-state">
        {saveState}
      </p>
      <div className={styles.headerActions}>
        <Button
          variant="primary"
          onClick={() => void store().save()}
          disabled={saving}
          title="Save (S)"
        >
          Save
        </Button>
        <Button
          className={styles.wideOnly}
          onClick={() => void store().saveAsNew()}
          disabled={saving || isNew}
        >
          Save as new
        </Button>
        <Button
          className={styles.wideOnly}
          onClick={() => store().setRenderOpen(true)}
          title="Render MP4 (R)"
        >
          Render MP4
        </Button>
        <Button
          variant="quiet"
          className={styles.wideOnly}
          onClick={() => store().setPresentation(true)}
          title="Show only the wake, full screen (F). Esc comes back."
        >
          Present
        </Button>
        {/* Phones and tablets: the three above, folded into one menu. */}
        <span className={styles.moreMenu}>
          <ActionMenu
            label="More actions"
            items={[
              {
                label: 'Save as new',
                onSelect: () => void store().saveAsNew(),
                disabled: saving || isNew,
              },
              { label: 'Render MP4', onSelect: () => store().setRenderOpen(true) },
              { label: 'Present', onSelect: () => store().setPresentation(true) },
            ]}
          />
        </span>
      </div>
    </header>
  );
}
