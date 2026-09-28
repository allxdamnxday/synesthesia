import { existsSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

/**
 * Every HTML page Vite should build. The app itself is `index.html`. Spike pages
 * (`spikes/<name>/index.html`) and developer harness pages (`dev/<name>/index.html`)
 * are included so they can be opened on a test Mac from a static host, unless
 * SP_RELEASE=1 (the build Freeman receives).
 */
function htmlEntries(): Record<string, string> {
  const entries: Record<string, string> = { main: resolve(root, 'index.html') };
  if (process.env.SP_RELEASE === '1') return entries;
  for (const dir of ['spikes', 'dev']) {
    const base = resolve(root, dir);
    if (!existsSync(base)) continue;
    if (existsSync(resolve(base, 'index.html'))) entries[dir] = resolve(base, 'index.html');
    for (const name of readdirSync(base)) {
      const page = resolve(base, name, 'index.html');
      if (existsSync(page)) entries[`${dir}/${name}`] = page;
    }
  }
  return entries;
}

export default defineConfig({
  // Relative base so the build works from any static host path (GitHub Pages
  // project path, Vercel root, or a local folder served over localhost).
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // Mediabunny loads lazily in its own ~0.5 MB chunk; that's expected.
    chunkSizeWarningLimit: 1024,
    rolldownOptions: { input: htmlEntries() },
  },
  server: {
    port: 5173,
    // Agent worktrees live under <root>/.claude/; never watch them. Match relative to this
    // checkout's root, because a worktree's own files also sit under a .claude/ path.
    watch: { ignored: (path: string) => relative(root, path).startsWith('.claude') },
  },
  optimizeDeps: {
    entries: ['index.html', 'src/**/*.{ts,tsx}', 'spikes/**/*.html', 'dev/**/*.html'],
  },
  preview: { port: 4173 },
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
