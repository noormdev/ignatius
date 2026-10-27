// First import: modules below read localStorage while they load (useSettings), so the export's view state lands before them.
import './apply-view-state';
import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
