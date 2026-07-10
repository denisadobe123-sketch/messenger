import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './App.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary><App /></ErrorBoundary>
);

// Сообщаем странице, что приложение успешно отрисовалось (сброс флага самолечения)
try { window.__appMounted && window.__appMounted(); } catch {}
