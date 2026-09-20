// `vitest/config` re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /**
     * The offline app shell (§39).
     *
     * `injectManifest` (not the default `generateSW`) because the service worker
     * needs custom logic beyond asset caching — API GET responses are cached for
     * offline reads and mutations queue in IndexedDB while offline — and that
     * logic lives in `src/sw.ts`. `self.__WB_MANIFEST` there is replaced at build
     * time with the real, hashed list of built assets, so the precache always
     * matches exactly what this build produced; nothing is hand-maintained.
     */
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      devOptions: { enabled: false },
      manifest: {
        name: 'Khata — Cash Book & Personal Ledger',
        short_name: 'Khata',
        description: 'A premium cash book, personal ledger and personal finance system.',
        theme_color: '#f7f5f0',
        background_color: '#f7f5f0',
        display: 'standalone',
        start_url: '/',
        icons: [],
      },
      injectManifest: {
        // The API and any cross-origin request are handled by the app's own
        // network/offline logic, not precached — only the built app shell is.
        globPatterns: ['**/*.{js,css,html}'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@khata/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // The API is a separate origin in production; proxying in development keeps
    // the refresh cookie same-origin so `SameSite=Strict` behaves identically here.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  // `vite preview` serves the production build — used to exercise the real
  // service worker locally, since it only registers outside dev mode. Same
  // same-origin proxy as the dev server, so the flow being tested matches
  // production exactly.
  preview: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Recharts is only needed by the dashboard and reports screens, both of
        // which are already route-split below — this keeps it out of every other
        // page's payload entirely rather than just deferring it (§58).
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          query: ['@tanstack/react-query'],
        },
      },
    },
    // The remaining ~1.1MB main chunk is the authenticated app shell shared by
    // every route — UI primitives, icons, forms/validation, state stores — split
    // per-route in App.tsx already pulled charts (390KB) and every individual
    // screen out of it. Raising the warning threshold rather than fragmenting
    // this further: splitting code that's needed on the very first authenticated
    // paint trades one request for several with no real payload win.
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
