import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Prefix all /api/ fetch calls with the base path (e.g. /board)
const _origFetch = window.fetch;
const _base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
if (_base) {
  window.fetch = function(input, init) {
    if (typeof input === 'string' && input.startsWith('/api/')) {
      input = _base + input;
    }
    return _origFetch.call(this, input, init);
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
