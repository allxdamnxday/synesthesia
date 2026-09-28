import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app/tokens.css';
import './app/global.css';
import { App } from './app/App';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
