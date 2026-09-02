import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted, not a CDN: a BHW is offline for most of this app's working life.
// Fraunces ships its SOFT axis here.
import '@fontsource-variable/fraunces/soft.css';
import '@fontsource-variable/nunito/wght.css';
import './index.css';
import { Capacitor } from '@capacitor/core';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { applyTheme, readTheme } from './lib/theme';
import { buildsBhw } from './app/surface';

// Before the first render, so the app never paints light and then correct.
applyTheme(readTheme());

// jeep-sqlite is the browser emulator for Capacitor SQLite; Android has the real
// thing. Mirrors the isWebPlatform guard in localDatabase.ts.
//
// Dynamic, and only on a build carrying the field client, so the emulator stays
// out of the admin bundle. Awaited before the first render, since the custom
// element must exist before anything calls initializeLocalDatabase().
if (buildsBhw && Capacitor.getPlatform() === 'web') {
  const { defineCustomElements: jeepSqlite } = await import('jeep-sqlite/loader');
  jeepSqlite(window);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
