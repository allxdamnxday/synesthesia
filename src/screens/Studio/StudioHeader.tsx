import { useMemo, useState } from 'react';
import { href } from '../../app/router';
import { useStudioStore } from '../../state/studioStore';
import { compositionsDiffer } from '../../studio/edits';
import { Button } from '../../ui/Button';
import { InlineRename } from '../../ui/InlineRename';
import styles from './Studio.module.css';

/** Breadcrumb (Library / signature / composition, renamed in place), save state, actions. */
export function StudioHeader() {
  const composition = useStudioStore((s) => s.composition);
  const baseline = useStudioStore((s) => s.baseline);
  const signature = useStudioStore((s) => s.signature);
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
            <a href={href(`/signature/${encodeURIComponent(signature.id)}`)}>{signature.name}</a>
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
          variant="quiet"
          onClick={() => store().setPresentation(true)}
          title="Show only the wake, full screen (F). Esc comes back."
        >
          Present
        </Button>
        <Button
          variant="primary"
          onClick={() => void store().save()}
          disabled={saving}
          title="Save (S)"
        >
          Save
        </Button>
        <Button onClick={() => void store().saveAsNew()} disabled={saving || isNew}>
          Save as new
        </Button>
        <Button onClick={() => store().setRenderOpen(true)} title="Render MP4 (R)">
          Render MP4
        </Button>
      </div>
    </header>
  );
}
