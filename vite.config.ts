import { existsSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

/**
 * Every HTML page Vite should build. The app itself is `index.html`. Spike pages
 * (`spikes/<name>/index.html`) and developer harness pages (`dev/<name>/index.html`)
 * are included so they can be opened on a test Mac from a static host, except in the
 * release build Freeman receives (`npm run build:release`, i.e. `--mode release`).
 */
function htmlEntries(release: boolean): Record<string, string> {
  const entries: Record<string, string> = { main: resolve(root, 'index.html') };
  if (release) return entries;
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

export default defineConfig(({ mode }) => ({
  // Relative base so the build works from any static host path (GitHub Pages
  // project path, Vercel root, or a local folder served over localhost).
  base: './',
  plugins: [
    react(),
    // Offline after the first visit (SPEC C5, M8): precache the whole instrument, including
    // OpenCV.js, fonts, worklets, the sample signature and the guide's pictures (WebP, bundled
    // only when the guide shows them). Spike and harness pages are development tools and stay
    // out of the cache.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Synesthesia',
        short_name: 'Synesthesia',
        description:
          'An instrument that applies one movement’s kinetic signature to different visual and sound materials.',
        display: 'standalone',
        background_color: '#0E1A24',
        theme_color: '#0E1A24',
        start_url: './',
        scope: './',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,json,wasm,png,webp}'],
        globIgnores: ['spikes/**', 'dev/**', '**/fixtures/**'],
        // OpenCV.js is ~11 MB (wasm embedded); the default limit is 2 MB.
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/spikes\//, /\/dev\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // Mediabunny loads lazily in its own ~0.5 MB chunk; that's expected.
    chunkSizeWarningLimit: 1024,
    rolldownOptions: { input: htmlEntries(mode === 'release' || process.env.SP_RELEASE === '1') },
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
}));
