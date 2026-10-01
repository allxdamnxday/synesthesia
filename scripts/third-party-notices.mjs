/**
 * Write the open-source notices the app ships: `public/third-party-notices.txt`.
 *
 *   node scripts/third-party-notices.mjs           # rewrite the file
 *   node scripts/third-party-notices.mjs --check   # exit 1 if the file is out of date
 *
 * The built app is minified, which drops the license notices the MIT, ISC and MPL licenses ask
 * to travel with the code. This file carries them instead; Help links to it and the service
 * worker caches it. Versions and license texts are read from `node_modules`, so run it after
 * changing a dependency (a unit test fails until you do). `docs/THIRD_PARTY.md` stays the
 * human record of every dependency; this is only what ships.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'public', 'third-party-notices.txt');

/**
 * What ships in the built app. `packages` are read from node_modules (the first one's license
 * text stands for the group; a group shares one license file). Keep in step with the
 * "Runtime" table in docs/THIRD_PARTY.md.
 */
const PACKAGES = [
  { title: 'React', use: 'the interface', packages: ['react', 'react-dom', 'scheduler'] },
  {
    title: 'Mediabunny',
    use: 'reading clips and writing videos',
    packages: ['mediabunny'],
    note:
      'Used as published, without changes. Its source code is available at the address above ' +
      'and in its npm package, under the Mozilla Public License 2.0.',
  },
  { title: 'Zustand', use: 'keeping track of what is on screen', packages: ['zustand'] },
  { title: 'idb', use: 'the library kept in this browser', packages: ['idb'] },
  { title: 'fflate', use: 'backup files', packages: ['fflate'] },
  {
    title: 'Workbox',
    use: 'working offline',
    packages: [
      'workbox-window',
      'workbox-core',
      'workbox-precaching',
      'workbox-routing',
      'workbox-strategies',
    ],
  },
  { title: 'vite-plugin-pwa', use: 'working offline', packages: ['vite-plugin-pwa'] },
];

const RULE = '='.repeat(80);
const THIN = '-'.repeat(80);

function clean(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

function readPackage(name) {
  const dir = join(root, 'node_modules', name);
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const licenseFile = readdirSync(dir).find((f) => /^licen[cs]e(\.|$)/i.test(f));
  if (!licenseFile) throw new Error(`${name} has no license file in node_modules.`);
  const repository =
    typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  const address = (manifest.homepage || repository || '')
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
    .replace(/#readme$/, '');
  return {
    name,
    version: manifest.version,
    license: manifest.license,
    address,
    text: clean(readFileSync(join(dir, licenseFile), 'utf8')),
  };
}

function packageSection({ title, use, packages, note }) {
  const read = packages.map(readPackage);
  const first = read[0];
  for (const p of read) {
    if (p.text !== first.text) {
      throw new Error(`${p.name} and ${first.name} are grouped but their licenses differ.`);
    }
  }
  const lines = [RULE, `${title}: ${use}`];
  lines.push(read.map((p) => `${p.name} ${p.version}`).join(', '));
  lines.push(`License: ${first.license}`);
  if (first.address) lines.push(first.address);
  if (note) lines.push('', note);
  lines.push(THIN, first.text);
  return lines.join('\n');
}

function build() {
  // The file opens with a sentence about "this folder"; the notices keep the license itself.
  const fluidFile = clean(
    readFileSync(
      join(root, 'src', 'materials', 'visual', 'shared', 'fluid', 'LICENSE-webgl-fluid.txt'),
      'utf8',
    ),
  );
  const fluidStart = fluidFile.indexOf('MIT License');
  if (fluidStart < 0) throw new Error('LICENSE-webgl-fluid.txt no longer holds an MIT License.');
  const fluid = fluidFile.slice(fluidStart);
  for (const shipped of ['vendor/opencv/LICENSE', 'fonts/OFL.txt']) {
    if (!existsSync(join(root, 'public', shipped)))
      throw new Error(`public/${shipped} is missing.`);
  }
  const sections = [
    [
      'Synesthesia: open-source notices',
      '',
      'Synesthesia is free software under the MIT License. Its source code, with its own license,',
      'is at https://github.com/allxdamnxday/synesthesia.',
      '',
      'It is built with the software and typeface below. Each stays under its own license, and',
      'these notices are theirs.',
    ].join('\n'),
    ...PACKAGES.map(packageSection),
    [
      RULE,
      'WebGL-Fluid-Simulation by Pavel Dobryakov: the flowing materials (Water, Honey, Smoke)',
      'are built on a solver adapted from it',
      'License: MIT',
      'https://github.com/PavelDoGreat/WebGL-Fluid-Simulation',
      THIN,
      fluid,
    ].join('\n'),
    [
      RULE,
      'OpenCV.js 4.13.0: finding the movement in a clip',
      'License: Apache-2.0',
      'https://opencv.org',
      '',
      'Used as published, without changes. Its license is included with this app:',
      'vendor/opencv/LICENSE',
    ].join('\n'),
    [
      RULE,
      'Atkinson Hyperlegible Next: the typeface',
      'License: SIL Open Font License 1.1',
      'https://github.com/googlefonts/atkinson-hyperlegible-next',
      '',
      'Its license is included with this app:',
      'fonts/OFL.txt',
    ].join('\n'),
  ];
  return `${sections.join('\n\n')}\n`;
}

const text = build();
if (process.argv.includes('--check')) {
  const current = existsSync(outFile) ? readFileSync(outFile, 'utf8').replace(/\r\n?/g, '\n') : '';
  if (current !== text) {
    console.error(
      'public/third-party-notices.txt is out of date. Run: node scripts/third-party-notices.mjs',
    );
    process.exit(1);
  }
  console.log('public/third-party-notices.txt is up to date.');
} else {
  writeFileSync(outFile, text);
  console.log(`Wrote ${outFile} (${Math.round(text.length / 1024)} KB).`);
}
