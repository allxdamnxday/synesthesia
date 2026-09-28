import { version } from '../../../package.json';
import {
  formatReport,
  type CapabilityCheck,
  type EnvironmentInfo,
} from '../../render/capabilities';

/** App version and build mode, for the report header. */
export const APP_VERSION = `${version} (${import.meta.env.MODE})`;

/** The plain-text report for the current results, stamped with the current time. */
export function buildReport(
  checks: readonly CapabilityCheck[],
  environment: EnvironmentInfo | null,
): string {
  return formatReport({
    checks,
    environment,
    generatedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    benchmark: null,
  });
}
