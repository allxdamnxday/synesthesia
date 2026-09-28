/**
 * The plain-text Diagnostics report behind "Copy report" (SPEC 6.5, 14.1): environment,
 * every check with status, summary and detail, and the benchmark line. Pure: the caller
 * passes the timestamp in (this folder is under the determinism lint).
 */
import { GROUP_LABELS } from './definitions';
import type { CapabilityCheck, CheckGroup, CheckStatus, EnvironmentInfo } from './types';

export interface ReportInput {
  checks: readonly CapabilityCheck[];
  environment: EnvironmentInfo | null;
  /** When the report was made (ISO 8601), supplied by UI code. */
  generatedAt: string;
  appVersion?: string;
  /** One-line benchmark result; arrives with the Water material in Milestone 2. */
  benchmark?: string | null;
}

export interface LabelledValue {
  label: string;
  value: string;
}

const STATUS_TAGS: Record<CheckStatus, string> = {
  pending: '[....]',
  pass: '[PASS]',
  warn: '[WARN]',
  fail: '[FAIL]',
};

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function round(n: number, digits = 2): string {
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}

/** The environment block as label/value pairs (shared by the report and the Diagnostics screen). */
export function environmentRows(env: EnvironmentInfo): LabelledValue[] {
  const rows: LabelledValue[] = [];
  rows.push({
    label: 'Browser',
    value: `${env.browser.name}${env.browser.version ? ` ${env.browser.version}` : ''}${
      env.browser.isChromium ? '' : ' (not Chromium-based)'
    }`,
  });
  rows.push({
    label: 'Operating system',
    value: `${env.os.label}${env.os.source === 'user-agent' ? ' (from the user agent)' : ''}`,
  });
  rows.push({
    label: 'CPU',
    value: `${env.cpu.label}${
      env.cpu.logicalCores !== null ? `; ${env.cpu.logicalCores} logical cores` : ''
    }`,
  });
  rows.push({
    label: 'Memory',
    value:
      env.deviceMemoryGb !== null
        ? `${env.deviceMemoryGb} GB (as reported by the browser, rounded)`
        : 'not reported',
  });
  if (env.screen) {
    const { width, height, devicePixelRatio: dpr, colorDepth } = env.screen;
    rows.push({
      label: 'Screen',
      value: `${width} × ${height} at ${round(dpr)}× (${Math.round(width * dpr)} × ${Math.round(
        height * dpr,
      )} device pixels), ${colorDepth}-bit`,
    });
  }
  rows.push({ label: 'GPU', value: env.gpu?.renderer ?? 'unknown (no WebGL)' });
  if (env.gpu) {
    rows.push({
      label: 'GPU vendor',
      value: `${env.gpu.vendor ?? 'unknown'} (from ${
        env.gpu.source === 'debug-renderer-info' ? 'WEBGL_debug_renderer_info' : 'RENDERER'
      })`,
    });
  }
  rows.push({ label: 'Secure context', value: yesNo(env.secureContext) });
  rows.push({ label: 'Cross-origin isolated', value: yesNo(env.crossOriginIsolated) });
  rows.push({ label: 'User agent', value: env.userAgent });
  return rows;
}

export interface CheckSummary {
  counts: Record<CheckStatus, number>;
  total: number;
  requiredFailed: number;
  /** For example 'All required checks passed.' */
  headline: string;
  /** For example '10 passed, 3 warnings, 0 failed.' */
  countsLine: string;
}

/** Counts and a headline for the Diagnostics screen and the report. */
export function summarizeChecks(checks: readonly CapabilityCheck[]): CheckSummary {
  const counts: Record<CheckStatus, number> = { pending: 0, pass: 0, warn: 0, fail: 0 };
  for (const c of checks) counts[c.status]++;
  const total = checks.length;
  const requiredFailed = checks.filter(
    (c) => c.importance === 'required' && c.status === 'fail',
  ).length;
  let headline: string;
  if (counts.pending > 0) {
    headline = `Checking… ${total - counts.pending} of ${total} done.`;
  } else if (requiredFailed > 0) {
    headline =
      requiredFailed === 1
        ? '1 required check failed.'
        : `${requiredFailed} required checks failed.`;
  } else {
    headline = 'All required checks passed.';
  }
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const countsLine = `${counts.pass} passed, ${plural(counts.warn, 'warning')}, ${counts.fail} failed${
    counts.pending > 0 ? `, ${counts.pending} still running` : ''
  }.`;
  return { counts, total, requiredFailed, headline, countsLine };
}

function indent(text: string, spaces: number): string[] {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map((line) => (line.length > 0 ? `${pad}${line}` : ''));
}

/** Plain text for the clipboard. */
export function formatReport(input: ReportInput): string {
  const lines: string[] = ['Synesthesia diagnostics report', `Generated: ${input.generatedAt}`];
  if (input.appVersion) lines.push(`App version: ${input.appVersion}`);

  lines.push('', 'Environment');
  if (input.environment) {
    const rows = environmentRows(input.environment);
    const width = Math.max(...rows.map((r) => r.label.length));
    for (const row of rows) lines.push(`  ${`${row.label}:`.padEnd(width + 2)}${row.value}`);
  } else {
    lines.push('  not collected');
  }

  const summary = summarizeChecks(input.checks);
  lines.push('', `Summary: ${summary.headline} ${summary.countsLine}`);

  const groups: CheckGroup[] = [];
  for (const check of input.checks) if (!groups.includes(check.group)) groups.push(check.group);
  for (const group of groups) {
    lines.push('', GROUP_LABELS[group]);
    for (const check of input.checks.filter((c) => c.group === group)) {
      lines.push(`  ${STATUS_TAGS[check.status]} ${check.label} (${check.importance})`);
      lines.push(...indent(check.summary, 9));
      if (check.detail) lines.push(...indent(check.detail, 9));
    }
  }

  lines.push('', `Benchmark: ${input.benchmark ?? 'not yet available'}`);
  return `${lines.join('\n')}\n`;
}
