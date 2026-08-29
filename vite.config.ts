import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// One codebase, two deployments. `--mode bhw` builds the web layer Capacitor
// wraps into the APK; `--mode admin` builds the LGU portal. Each output contains
// only its own routes, so the phone bundle carries no admin screens and the
// portal carries no field forms. Any other mode — `npm run dev`, a plain
// `vite build` — keeps both, which is what local work wants.
//
// The admin build goes to its own directory because `dist` is what
// capacitor.config.ts syncs into Android: one shared folder would mean whichever
// build ran last decides what ships to the phones.
export default defineConfig(({ mode }) => {
  const surface = mode === 'bhw' || mode === 'admin' ? mode : 'both';

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    define: {
      'import.meta.env.VITE_SURFACE': JSON.stringify(surface),
    },
    build: {
      outDir: surface === 'admin' ? 'dist-admin' : 'dist',
    },
    test: {
      // `e2e/` is Playwright's, and its specs cannot run under Vitest — without
      // this they are collected here and fail on an import that has no meaning
      // outside a browser session.
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
})