import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
/* eslint-disable no-unused-vars */
const _buildTs = typeof __BUILD_TS__ !== 'undefined' ? __BUILD_TS__ : 0
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
