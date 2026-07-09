import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App.tsx';
import { defineCustomElements as jeepSqlite } from 'jeep-sqlite/loader';

// Register the web component library (safe for Vite HMR)
jeepSqlite(window);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);