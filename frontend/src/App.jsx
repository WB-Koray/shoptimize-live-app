import { useState, useEffect } from 'react';
import LoginPage from './LoginPage';
import Dashboard from './Dashboard';
import AdminPanel from './AdminPanel';

function readSession() {
  try {
    return JSON.parse(localStorage.getItem('spt_session') || 'null');
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState(readSession);
  const [adminToken, setAdminToken] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // Admin panel — ?admin_token=XXX
    const at = params.get('admin_token');
    if (at) {
      setAdminToken(at);
      // Temizle
      const url = new URL(window.location.href);
      url.searchParams.delete('admin_token');
      window.history.replaceState({}, '', url.toString());
      return;
    }

    // Auto-login from OAuth redirect
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

  // Admin panel
  if (adminToken) {
    return <AdminPanel adminToken={adminToken} onExit={() => setAdminToken(null)} />;
  }

  if (session) {
    return <Dashboard session={session} onLogout={handleLogout} />;
  }
  return <LoginPage onLogin={handleLogin} />;
}
