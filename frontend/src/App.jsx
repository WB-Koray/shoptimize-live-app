import { AppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';
import { useState } from 'react';
import LoginPage from './LoginPage';
import Dashboard from './Dashboard';

function readSession() {
  try {
    return JSON.parse(localStorage.getItem('spt_session') || 'null');
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState(readSession);

  function handleLogin(data) {
    localStorage.setItem('spt_session', JSON.stringify(data));
    setSession(data);
  }

  function handleLogout() {
    localStorage.removeItem('spt_session');
    setSession(null);
  }

  return (
    <AppProvider i18n={enTranslations}>
      {session
        ? <Dashboard session={session} onLogout={handleLogout} />
        : <LoginPage onLogin={handleLogin} />
      }
    </AppProvider>
  );
}
