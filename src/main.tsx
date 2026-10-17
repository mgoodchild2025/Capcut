import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startAutosave } from './actions';
import { App } from './App';
import './styles.css';

startAutosave();

// Offline support and "Add to Home Screen". Not in development, where it would cache stale modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker', e)));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
