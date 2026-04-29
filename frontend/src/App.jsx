import { useState, useEffect } from 'react';
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const autoToken = params.get('auto_token');
    if (!autoToken) return;

    const newSession = {
      token: autoToken,
      username: params.get('u') || '',
      brand: params.get('b') || 'default',
      tid: params.get('tid') || '',
    };
    localStorage.setItem('spt_session', JSON.stringify(newSession));
    setSession(newSession);

    // URL'den token parametrelerini temizle
    const url = new URL(window.location.href);
    ['auto_token', 'u', 'b', 'tid'].forEach(k => url.searchParams.delete(k));
    window.history.replaceState({}, '', url.toString());
  }, []);

  function handleLogin(data) {
    localStorage.setItem('spt_session', JSON.stringify(data));
    setSession(data);
  }

  function handleLogout() {
    localStorage.removeItem('spt_session');
    setSession(null);
  }

  if (session) {
    return <Dashboard session={session} onLogout={handleLogout} />;
  }
  return <LoginPage onLogin={handleLogin} />;
}
