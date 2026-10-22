import React from 'react';
import ReactDOM from 'react-dom/client';
import './monaco.js';
import { App } from './App.js';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
