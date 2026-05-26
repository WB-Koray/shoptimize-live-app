import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ThemeProvider } from './ThemeContext';
import { LangProvider } from './LangContext';
import ErrorBoundary from './ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LangProvider>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </LangProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
