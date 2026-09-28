import { Component, type ErrorInfo, type ReactNode } from 'react';
import { href } from '../../app/router';
import { flushStudioAutosave, useStudioStore } from '../../state/studioStore';
import { Button } from '../../ui/Button';
import styles from './Studio.module.css';

interface State {
  failed: boolean;
}

/**
 * If something in the Studio breaks while playing, say so calmly instead of leaving a
 * blank page. Work in progress is autosaved, so reloading brings it back.
 */
export class StudioErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The Studio stopped:', error, info.componentStack);
    void flushStudioAutosave();
    // Show the app's own header and leave full screen, so the way out is visible.
    useStudioStore.getState().setPresentation(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <section className={styles.message} role="alert">
        <h1>The Studio stopped</h1>
        <p>
          Something went wrong while playing. Your work so far was kept: reload the page to carry
          on. If it happens again, the <a href={href('/diagnostics')}>Diagnostics</a> page can help.
        </p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </section>
    );
  }
}
