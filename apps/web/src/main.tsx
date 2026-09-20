import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { store } from './app/store';
import App from './App';
import './styles/global.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('No #root element found — check index.html.');
}

createRoot(container).render(
  /**
   * Strict Mode double-invokes effects in development to surface
   * non-idempotent side effects. That is genuinely useful, and it is why the
   * session bootstrap in `App.tsx` carries an explicit ref guard — a
   * double-fired refresh would spend a single-use token twice.
   */
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
);
