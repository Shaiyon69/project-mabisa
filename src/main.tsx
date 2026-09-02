import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted, not a CDN — a BHW is offline for most of this app's working life,
// and a CDN would simply never resolve. Fraunces ships its SOFT axis here.
import '@fontsource-variable/fraunces/soft.css';
import '@fontsource-variable/nunito/wght.css';
import './index.css';
import { Capacitor } from '@capacitor/core';
import { App } from './App.tsx';
import { applyTheme, readTheme } from './lib/theme';
import { buildsBhw } from './app/surface';

// Before the first render, so the app never paints light and then correct.
applyTheme(readTheme());

// jeep-sqlite is the browser emulator for Capacitor SQLite — Android has the real
// thing. Mirrors the isWebPlatform guard in localDatabase.ts; change one, change the other.
//
// Imported dynamically, and only on a build that carries the field client: a
// static import lands the whole emulator in the admin bundle, which opens no
// database at all. Awaited before the first render, because the custom element
// has to be defined before anything calls initializeLocalDatabase().
if (buildsBhw && Capacitor.getPlatform() === 'web') {
  const { defineCustomElements: jeepSqlite } = await import('jeep-sqlite/loader');
  jeepSqlite(window);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
