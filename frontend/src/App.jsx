import { useState, useEffect, useRef } from 'react';
import LoginPage from './LoginPage';
import Dashboard from './Dashboard';
import AdminPanel from './AdminPanel';

const API_URL = import.meta.env.VITE_API_URL || 'https://live.shoptimize.com.tr';

function readSession() {
  try {
    return JSON.parse(localStorage.getItem('spt_session') || 'null');
  } catch {
    // localStorage erişilemez (3rd-party cookie engeli vb.)
    return null;
  }
}

function saveSession(data) {
  try { localStorage.setItem('spt_session', JSON.stringify(data)); } catch { /* ignored */ }
}

function clearSession() {
  try { localStorage.removeItem('spt_session'); } catch { /* ignored */ }
}

/**
 * Shopify admin'den açıldığımızı doğrula.
 * Shopify her zaman ?shop= + ?host= parametrelerini ekler.
 * Aynı oturum içinde kaybolmasınlar diye sessionStorage'a da yazar.
 */
function detectShopifyContext() {
  const params = new URLSearchParams(window.location.search);
  const shop = params.get('shop');
  const host = params.get('host');
  if (shop && host) {
    sessionStorage.setItem('spt_shopify_shop', shop);
    sessionStorage.setItem('spt_shopify_host', host);
    return true;
  }
  return !!(sessionStorage.getItem('spt_shopify_shop') && sessionStorage.getItem('spt_shopify_host'));
}

/** App Bridge v4 CDN hazır olana kadar bekle (max 3sn) */
async function waitForAppBridge(maxMs = 3000) {
  const step = 100;
  let elapsed = 0;
  while (elapsed < maxMs) {
    if (typeof window.shopify?.idToken === 'function') return true;
    await new Promise(r => setTimeout(r, step));
    elapsed += step;
  }
  return typeof window.shopify?.idToken === 'function';
}

/**
 * URL'deki id_token süresi dolmamışsa döner, dolmuşsa null.
 * Shopify token'ları ~60sn geçerli; ağ gecikmesi için 10sn buffer bırakır.
 */
function getFreshUrlToken() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('id_token');
    if (!token) return null;
    const b64 = token.split('.')[1];
    const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
    const payload = JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp > (Date.now() / 1000) + 10 ? token : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession]           = useState(readSession);
  const [adminToken, setAdminToken]     = useState(null);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyError, setShopifyError]     = useState('');
  const authAttempted = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // ── Admin panel ────────────────────────────────────────────────
    const at = params.get('admin_token');
    if (at) {
      setAdminToken(at);
      const url = new URL(window.location.href);
      url.searchParams.delete('admin_token');
      window.history.replaceState({}, '', url.toString());
      return;
    }

    // ── OAuth redirect sonrası otomatik giriş ─────────────────────
    const autoToken = params.get('auto_token');
    if (autoToken) {
      const newSession = {
        token:    autoToken,
        username: params.get('u')   || '',
        brand:    params.get('b')   || 'default',
        tid:      params.get('tid') || '',
      };
      saveSession(newSession);
      setSession(newSession);
      const url = new URL(window.location.href);
      ['auto_token', 'u', 'b', 'tid'].forEach(k => url.searchParams.delete(k));
      window.history.replaceState({}, '', url.toString());
      return;
    }

    // ── Shopify admin context → App Bridge ile her zaman session token al ──
    // Requirement 1.1.1: localStorage'a güvenmek yerine her açılışta
    // App Bridge session token exchange yapılır. Bu, farklı kullanıcıların
    // aynı tarayıcıda güvenle kullanabilmesini sağlar (incognito dahil).
    if (!detectShopifyContext() || authAttempted.current) return;

    authAttempted.current = true;
    doShopifyAuth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function doShopifyAuth() {
    setShopifyLoading(true);
    setShopifyError('');
    try {
      let sessionToken = null;

      // 1. App Bridge'den taze token almayı dene (her zaman taze token verir)
      //    Shopify admin doğru client_id ile kuruluysa çalışır.
      const bridgeReady = await waitForAppBridge(2000);
      if (bridgeReady) {
        try {
          const tokenPromise = window.shopify.idToken();
          const timeout = new Promise((_, rej) =>
            setTimeout(() => rej(new Error('timeout')), 4000)
          );
          sessionToken = await Promise.race([tokenPromise, timeout]);
        } catch {
          // App Bridge yavaş / uyumsuz → URL fallback'e geç
        }
      }

      // 2. App Bridge çalışmadıysa URL'deki taze id_token'ı dene (60sn geçerli)
      if (!sessionToken) {
        sessionToken = getFreshUrlToken();
      }

      // 3. İkisi de yoksa → kullanıcı uygulamayı yeniden açmalı
      if (!sessionToken) {
        throw new Error('Oturum süresi doldu. Sol menüden uygulamayı yeniden tıklayın.');
      }

      const res = await fetch(`${API_URL}/api/auth/shopify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_token: sessionToken }),
      });

      const data = await res.json();

      if (res.status === 401) {
        // Token geçersiz / süresi dolmuş → URL token'ı temizle ve App Bridge ile yeniden dene
        // (URL token'ı atlayarak direkt App Bridge'e gider)
        throw new Error('Oturum süresi doldu. Sol menüden uygulamayı yeniden tıklayın.');
      }

      if (res.status === 404) {
        // Uygulama bu mağazada kurulu değil → install'a yönlendir
        const shop = sessionStorage.getItem('spt_shopify_shop') || '';
        window.location.href = `${API_URL}/auth/shopify/install?shop=${encodeURIComponent(shop)}`;
        return;
      }

      if (res.status === 402) {
        // Billing sorunu — login sayfasına düş, orada billing mesajı gösterilecek
        setShopifyError(data.detail?.message || 'Abonelik sorunu');
        return;
      }

      if (!res.ok || !data.ok) {
        throw new Error(data.detail || 'Giriş başarısız');
      }

      // Billing onayı gerekiyorsa Shopify onay sayfasına yönlendir
      if (data.billing_url) {
        window.top.location.href = data.billing_url;
        return;
      }

      const newSession = {
        token:    data.token,
        username: data.username,
        brand:    data.brand,
        tid:      data.tid || '',
      };
      saveSession(newSession);
      setSession(newSession);
    } catch (e) {
      setShopifyError(e.message || 'Shopify bağlantı hatası');
    } finally {
      setShopifyLoading(false);
    }
  }

  function handleLogin(data) {
    saveSession(data);
    setSession(data);
  }

  function handleLogout() {
    clearSession();
    setSession(null);
    // Shopify context'teyse tekrar otomatik giriş dene
    if (detectShopifyContext()) {
      authAttempted.current = false;
      doShopifyAuth();
    }
  }

  // ── Render ──────────────────────────────────────────────────────

  if (adminToken) {
    return <AdminPanel adminToken={adminToken} onExit={() => setAdminToken(null)} />;
  }

  // Shopify admin'de yükleniyor
  if (shopifyLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#0f1117', flexDirection: 'column', gap: 16,
      }}>
        <style>{`@keyframes spt-spin { to { transform: rotate(360deg); } }`}</style>
        <svg style={{ width: 32, height: 32, color: '#22d3a5', animation: 'spt-spin 1s linear infinite' }}
          fill="none" viewBox="0 0 24 24">
          <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>Shopify ile giriş yapılıyor…</p>
      </div>
    );
  }

  // Shopify context'te hata — login sayfasına düşme, retry sun
  if (shopifyError && detectShopifyContext() && !session) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#0f1117', flexDirection: 'column', gap: 12,
      }}>
        <p style={{ color: '#f87171', fontSize: 14, margin: 0 }}>{shopifyError}</p>
        <button
          onClick={() => { authAttempted.current = false; doShopifyAuth(); }}
          style={{
            padding: '8px 20px', borderRadius: 8, background: '#22d3a5',
            color: '#0f1117', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: 13,
          }}
        >
          Tekrar dene
        </button>
      </div>
    );
  }

  if (session) {
    return <Dashboard session={session} onLogout={handleLogout} />;
  }

  // Shopify context'te session yok ama hata da yok → yüklenmeye devam ediliyor
  if (detectShopifyContext()) {
    return null; // brief flash önleme
  }

  return <LoginPage onLogin={handleLogin} />;
}
