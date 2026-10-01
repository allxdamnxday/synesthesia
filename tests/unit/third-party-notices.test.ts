import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The built app is minified, which drops the license notices that must travel with the
// software it uses. `public/third-party-notices.txt` carries them (Help links to it), made by
// `node scripts/third-party-notices.mjs`. These tests fail when it falls behind.

const ROOT = resolve(import.meta.dirname, '../..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8').replace(/\r\n?/g, '\n');
}

/** A license file as the notices carry it: trailing spaces and outer blank lines removed. */
function licenseOf(name: string): string {
  const dir = join(ROOT, 'node_modules', name);
  const file = readdirSync(dir).find((f) => /^licen[cs]e(\.|$)/i.test(f));
  if (!file) throw new Error(`${name} has no license file`);
  return readFileSync(join(dir, file), 'utf8')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

const notices = read('public/third-party-notices.txt');
const manifest = JSON.parse(read('package.json')) as {
  license?: string;
  dependencies: Record<string, string>;
};

describe('open-source notices shipped with the app', () => {
  it('is up to date (run `node scripts/third-party-notices.mjs` after changing a dependency)', () => {
    expect(() =>
      execFileSync(process.execPath, [join(ROOT, 'scripts/third-party-notices.mjs'), '--check'], {
        cwd: ROOT,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });

  it('names every runtime dependency with its version and carries its license', () => {
    const names = Object.keys(manifest.dependencies);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const pkg = JSON.parse(read(`node_modules/${name}/package.json`)) as { version: string };
      expect(notices, name).toContain(`${name} ${pkg.version}`);
      expect(notices, `${name}'s license text`).toContain(licenseOf(name));
    }
  });

  it('tells where to get the source of the one copyleft package', () => {
    expect(notices).toContain('Mozilla Public License Version 2.0');
    expect(notices).toMatch(/Mediabunny[\s\S]*Its source code is available at the address above/);
  });

  it('covers the adapted solver, OpenCV.js and the typeface, whose licenses ship beside them', () => {
    expect(notices).toContain('Copyright (c) 2017 Pavel Dobryakov');
    for (const shipped of ['vendor/opencv/LICENSE', 'fonts/OFL.txt']) {
      expect(notices).toContain(shipped);
      expect(existsSync(join(ROOT, 'public', shipped)), shipped).toBe(true);
    }
  });

  it('says the instrument itself is MIT, as LICENSE and package.json do', () => {
    expect(notices).toContain('Synesthesia is free software under the MIT License');
    expect(read('LICENSE').startsWith('MIT License\n')).toBe(true);
    expect(manifest.license).toBe('MIT');
  });
});
