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
import { defineCustomElements as jeepSqlite } from 'jeep-sqlite/loader';

// jeep-sqlite is the browser emulator for Capacitor SQLite; Android has the real
// thing. Registering it unconditionally made the native build fetch a 292 kB chunk
// it can never use, so this mirrors the isWebPlatform guard in localDatabase.ts —
// change one, change the other.
if (Capacitor.getPlatform() === 'web') {
  jeepSqlite(window);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
