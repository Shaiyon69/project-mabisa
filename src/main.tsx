import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The design system names Fraunces and Nunito, and --display/--sans have always
// pointed at them, but no font file was ever loaded — so both silently fell back
// to a system face. Self-hosted rather than fetched from a CDN: a BHW is offline
// for most of this app's working life, and a CDN would simply never resolve.
// Fraunces ships its SOFT axis here, which the design system calls for by name.
import '@fontsource-variable/fraunces/soft.css';
import '@fontsource-variable/nunito/wght.css';
import './index.css';
import { Capacitor } from '@capacitor/core';
import { App } from './App.tsx';
import { applyTheme, readTheme } from './lib/theme';
import { buildsBhw } from './app/surface';

// Before the first render, so the app never paints light and then correct.
applyTheme(readTheme());

// jeep-sqlite is the browser emulator for Capacitor SQLite; Android has the real
// thing, and the admin portal opens no local database at all. Imported here
// dynamically rather than at the top of the file because a static import is
// bundled whatever the guard decides at runtime — the 292 kB chunk was still
// being emitted into `dist-admin/`. This mirrors the isWebPlatform guard in
// localDatabase.ts: change one, change the other.
if (buildsBhw && Capacitor.getPlatform() === 'web') {
  void import('jeep-sqlite/loader').then(({ defineCustomElements }) => defineCustomElements(window));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
