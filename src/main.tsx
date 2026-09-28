import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app/tokens.css';
import './app/global.css';
import { App } from './app/App';
import { registerOffline } from './app/offline';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

registerOffline();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
