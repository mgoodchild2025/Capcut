import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { startAutosave } from './actions';
import { App } from './App';
import './styles.css';

startAutosave();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
