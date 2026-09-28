import type { ReactNode } from 'react';

/**
 * Runs the required capability checks at startup (SPEC 14.1) and blocks with a
 * plain-language explanation if something essential is missing. Placeholder: renders
 * its children until the Diagnostics work lands.
 */
export function StartupGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
