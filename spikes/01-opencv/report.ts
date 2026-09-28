/**
 * Tiny PASS/FAIL report used by the spike pages: a table on the page, a plain-text copy
 * for the clipboard, and `window.spikeDone` / `window.spikeResultsText` for headless runs.
 */

export type Verdict = 'PASS' | 'FAIL' | 'INFO';

export interface CheckRow {
  name: string;
  verdict: Verdict;
  detail: string;
}

declare global {
  interface Window {
    spikeDone?: boolean;
    spikeResultsText?: string;
  }
}

export class Report {
  private readonly rows: CheckRow[] = [];
  private readonly title: string;

  constructor(title: string) {
    this.title = title;
  }

  add(name: string, verdict: Verdict | boolean, detail: string): void {
    const v: Verdict = typeof verdict === 'boolean' ? (verdict ? 'PASS' : 'FAIL') : verdict;
    this.rows.push({ name, verdict: v, detail });
    const body = document.getElementById('checks');
    if (!body) return;
    const tr = document.createElement('tr');
    const cells = [name, v, detail];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i === 1) td.className = v === 'PASS' ? 'pass' : v === 'FAIL' ? 'fail' : 'info';
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }

  get failed(): number {
    return this.rows.filter((r) => r.verdict === 'FAIL').length;
  }

  text(environment: string[]): string {
    const lines = [this.title, ...environment, ''];
    for (const row of this.rows) lines.push(`[${row.verdict}] ${row.name}: ${row.detail}`);
    lines.push('', this.failed === 0 ? 'All checks passed.' : `${this.failed} check(s) failed.`);
    return lines.join('\n');
  }

  finish(environment: string[]): void {
    const text = this.text(environment);
    const pre = document.getElementById('text');
    if (pre) pre.textContent = text;
    const status = document.getElementById('status');
    if (status) {
      status.textContent =
        this.failed === 0 ? 'Done: all checks passed.' : 'Done: some checks failed.';
    }
    const copy = document.getElementById('copy');
    if (copy instanceof HTMLButtonElement) {
      copy.disabled = false;
      copy.onclick = () => {
        void navigator.clipboard.writeText(text).then(() => {
          copy.textContent = 'Copied';
        });
      };
    }
    window.spikeResultsText = text;
    window.spikeDone = true;
  }
}

export function environmentLines(): string[] {
  return [
    `Date: ${new Date().toISOString()}`,
    `Build: ${import.meta.env.DEV ? 'vite dev server' : 'production build (vite build + preview)'}`,
    `User agent: ${navigator.userAgent}`,
    `Logical CPUs: ${navigator.hardwareConcurrency}`,
  ];
}

export function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : String(n);
}
