import type { ReactNode } from 'react';
import { DiagnosticsScreen } from '../screens/Diagnostics/DiagnosticsScreen';
import { LibraryScreen } from '../screens/Library/LibraryScreen';
import styles from './App.module.css';
import { href, matchPath, useHashPath } from './router';

interface RouteDef {
  pattern: string;
  render: (params: Record<string, string>) => ReactNode;
}

const ROUTES: RouteDef[] = [
  { pattern: '/', render: () => <LibraryScreen /> },
  { pattern: '/diagnostics', render: () => <DiagnosticsScreen /> },
];

function resolve(path: string): ReactNode {
  for (const route of ROUTES) {
    const params = matchPath(route.pattern, path);
    if (params) return route.render(params);
  }
  return <NotFound />;
}

function NotFound() {
  return (
    <section className={styles.page}>
      <h1>Nothing here</h1>
      <p>
        This address doesn&apos;t match a screen. <a href={href('/')}>Go to the library</a>.
      </p>
    </section>
  );
}

export function App() {
  const path = useHashPath();
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <a className={styles.wordmark} href={href('/')}>
          Synesthesia
        </a>
        <nav className={styles.nav} aria-label="Main">
          <a href={href('/')} aria-current={path === '/' ? 'page' : undefined}>
            Library
          </a>
          <a
            href={href('/diagnostics')}
            aria-current={path === '/diagnostics' ? 'page' : undefined}
          >
            Diagnostics
          </a>
        </nav>
      </header>
      <main className={styles.main}>{resolve(path)}</main>
    </div>
  );
}
