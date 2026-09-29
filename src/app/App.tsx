import type { ReactNode } from 'react';
import { AlbumScreen } from '../screens/Album/AlbumScreen';
import { NewAlbumScreen } from '../screens/Album/NewAlbumScreen';
import { DiagnosticsScreen } from '../screens/Diagnostics/DiagnosticsScreen';
import { GuideScreen } from '../screens/Guide/GuideScreen';
import { HelpScreen } from '../screens/Help/HelpScreen';
import { LibraryScreen } from '../screens/Library/LibraryScreen';
import { PrepareScreen } from '../screens/Prepare/PrepareScreen';
import { SettingsScreen } from '../screens/Settings/SettingsScreen';
import { SignatureScreen } from '../screens/Signature/SignatureScreen';
import { StudioScreen } from '../screens/Studio/StudioScreen';
import { usePresentationStore } from '../state/presentationStore';
import styles from './App.module.css';
import { DedicationSplash } from './DedicationSplash';
import { FileDropGuard } from './FileDropGuard';
import { Introduction } from './Introduction';
import { MainNav, type NavItem } from './MainNav';
import { href, matchPath, useHashPath } from './router';
import { StartupGate } from './StartupGate';

interface RouteDef {
  pattern: string;
  render: (params: Record<string, string>) => ReactNode;
}

/**
 * Screens by hash path. Studio opens an existing composition (`/studio/:compositionId`)
 * or starts a new one from a signature (`/studio/new/:signatureId`); albums likewise
 * (`/album/:albumId`, `/album/new/:signatureId`).
 */
const ROUTES: RouteDef[] = [
  { pattern: '/', render: () => <LibraryScreen /> },
  { pattern: '/prepare', render: (params) => <PrepareScreen params={params} /> },
  { pattern: '/signature/:signatureId', render: (params) => <SignatureScreen params={params} /> },
  { pattern: '/studio/new/:signatureId', render: (params) => <StudioScreen params={params} /> },
  { pattern: '/studio/:compositionId', render: (params) => <StudioScreen params={params} /> },
  { pattern: '/album/new/:signatureId', render: (params) => <NewAlbumScreen params={params} /> },
  { pattern: '/album/:albumId', render: (params) => <AlbumScreen params={params} /> },
  { pattern: '/settings', render: () => <SettingsScreen /> },
  { pattern: '/help', render: () => <HelpScreen /> },
  { pattern: '/guide', render: () => <GuideScreen /> },
  { pattern: '/guide/:section', render: (params) => <GuideScreen section={params.section} /> },
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

/** The main navigation, in the header (or its Menu on phones). */
const NAV: NavItem[] = [
  { path: '/', label: 'Library' },
  { path: '/settings', label: 'Settings' },
  { path: '/help', label: 'Help' },
  { path: '/diagnostics', label: 'Diagnostics' },
];

export function App() {
  const path = useHashPath();
  // Presentation mode shows only the wake (Studio, SPEC 6.3).
  const presenting = usePresentationStore((s) => s.active);
  return (
    <StartupGate>
      <div className={styles.app}>
        {presenting ? null : (
          <header className={styles.header}>
            <a className={styles.wordmark} href={href('/')}>
              Synesthesia
            </a>
            <MainNav items={NAV} current={path} />
          </header>
        )}
        <main className={styles.main}>{resolve(path)}</main>
      </div>
      <FileDropGuard />
      <Introduction />
      <DedicationSplash />
    </StartupGate>
  );
}
