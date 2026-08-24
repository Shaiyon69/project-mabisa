import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted, not a CDN — a BHW is offline for most of this app's working life,
// and a CDN would simply never resolve. Fraunces ships its SOFT axis here.
import '@fontsource-variable/fraunces/soft.css';
import '@fontsource-variable/nunito/wght.css';
import './index.css';
import { Capacitor } from '@capacitor/core';
import { App } from './App.tsx';
import { defineCustomElements as jeepSqlite } from 'jeep-sqlite/loader';
import { applyTheme, readTheme } from './lib/theme';

// Before the first render, so the app never paints light and then correct.
applyTheme(readTheme());

// jeep-sqlite is the browser emulator for Capacitor SQLite — Android has the real
// thing. Mirrors the isWebPlatform guard in localDatabase.ts; change one, change the other.
if (Capacitor.getPlatform() === 'web') {
  jeepSqlite(window);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
