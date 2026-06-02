import { useState } from 'react';
import { Zap, User, Lock, AlertCircle, ExternalLink, ShoppingBag, MessageCircle } from 'lucide-react';
import logo from './assets/1200 px icon logo.png';
import { useLang, LangSwitch } from './LangContext';

const API_URL = import.meta.env.VITE_API_URL || 'https://live.shoptimize.com.tr';

function Field({ label, icon: Icon, type = 'text', value, onChange, placeholder, helpText, onKeyDown }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-textDim uppercase tracking-wide">{label}</label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-textMute">
          <Icon size={15} />
        </div>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete={type === 'password' ? 'current-password' : 'off'}
          className="w-full bg-surfaceAlt border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-text placeholder:text-textMute
            focus:outline-none focus:border-green/60 focus:ring-1 focus:ring-green/30 transition-colors"
        />
      </div>
      {helpText && <p className="text-[11px] text-textMute">{helpText}</p>}
    </div>
  );
}

function Divider({ label }) {
  return (
    <div className="flex items-center gap-3 my-1">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[11px] text-textMute font-medium uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// KÃ¼Ã§Ã¼k yardÄ±mcÄ± bÃ¶lÃ¼m baÅlÄ±ÄÄ± (Shopify / WhatsApp giriÅleri iÃ§in)
function AltAuth({ icon: Icon, title, help, children }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-textDim uppercase tracking-wide flex items-center gap-1.5">
        <Icon size={13} /> {title}
      </p>
      <p className="text-[11px] text-textMute leading-relaxed">{help}</p>
      {children}
    </div>
  );
}

export default function LoginPage({ onLogin }) {
  const { t, lang } = useLang();

  // Password login
  const [username, setUsername] = useState('');
  // Brand: URL'den oku (multi-brand iÃ§in ?brand=xxx), varsayÄ±lan 'default' â formda gizli
  const [brand, setBrand] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('brand') || 'default';
  });
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [billingError, setBillingError] = useState(null);

  // Shopify re-auth
  const [shopDomain, setShopDomain] = useState('');
  const [shopLoading, setShopLoading] = useState(false);

  // WA access link
  const [waPhone, setWaPhone] = useState('');
  const [waLoading, setWaLoading] = useState(false);
  const [waStatus, setWaStatus] = useState(''); // 'sent' | 'not_found' | 'unavailable' | 'error'

  // ââ Password login ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  async function handleSubmit() {
    if (!username.trim() || !password.trim()) {
      setError(t('login.err.required'));
      return;
    }
    setLoading(true);
    setError('');
    setBillingError(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), brand: brand.trim() || 'default', password }),
      });
      const data = await res.json();
      if (res.status === 402) {
        const detail = data.detail || {};
        setBillingError({ message: detail.message || t('login.err.billing'), retry_url: detail.retry_url || '' });
        return;
      }
      if (!res.ok || !data.ok) {
        setError(data.detail || data.error || t('login.err.required'));
        return;
      }
      onLogin({ token: data.token, username: data.username, brand: data.brand, tid: data.tid || '' });
    } catch {
      setError(t('login.err.server'));
    } finally {
      setLoading(false);
    }
  }

  function onKey(e) { if (e.key === 'Enter') handleSubmit(); }

  // ââ Shopify re-auth âââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  function handleShopifyLogin() {
    let shop = shopDomain.trim().toLowerCase();
    if (!shop) return;
    if (!shop.includes('.')) shop = `${shop}.myshopify.com`;
    setShopLoading(true);
    window.location.href = `${API_URL}/auth/shopify/reauth?shop=${encodeURIComponent(shop)}`;
  }

  function onShopKey(e) { if (e.key === 'Enter') handleShopifyLogin(); }

  // ââ WA access link ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

  async function handleWaSend() {
    if (!waPhone.trim()) return;
    setWaLoading(true);
    setWaStatus('');
    try {
      const waLang = lang === 'tr' ? 'tr' : 'en';
      const res = await fetch(`${API_URL}/api/auth/request-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: waPhone.trim(), lang: waLang }),
      });
      if (res.status === 503) { setWaStatus('unavailable'); return; }
      const data = await res.json();
      if (!data.ok) { setWaStatus('error'); return; }
      if (!data.sent) {
        setWaStatus(data.reason === 'wa_error' ? 'wa_error' : 'not_found');
        return;
      }
      setWaStatus('sent');
    } catch {
      setWaStatus('error');
    } finally {
      setWaLoading(false);
    }
  }

  function onWaKey(e) { if (e.key === 'Enter') handleWaSend(); }

  const waStatusMsg = {
    sent:        { text: t('login.wa_sent'),        cls: 'text-green' },
    not_found:   { text: t('login.wa_not_found'),   cls: 'text-amber-400' },
    wa_error:    { text: t('login.wa_unavailable'), cls: 'text-textMute' },
    unavailable: { text: t('login.wa_unavailable'), cls: 'text-textMute' },
    error:       { text: t('login.err.server'),     cls: 'text-rose' },
  }[waStatus];

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 bg-bg overflow-hidden">
      {/* Dekoratif yumuÅak parÄ±ltÄ± â derinlik iÃ§in (tema yeÅilini kullanÄ±r) */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[460px] h-[460px] rounded-full bg-green/10 blur-[130px]" />
      <div className="pointer-events-none absolute -bottom-48 -right-24 w-[380px] h-[380px] rounded-full bg-teal/10 blur-[130px]" />

      {/* Dil toggle â saÄ Ã¼st */}
      <div className="fixed top-4 right-4 z-10">
        <LangSwitch />
      </div>

      <div className="relative w-full max-w-md">

        {/* Logo + marka */}
        <div className="text-center mb-7">
          <img src={logo} alt="Shoptimize Live"
            className="w-20 h-20 mx-auto mb-4 object-contain drop-shadow-[0_10px_28px_rgba(0,0,0,0.35)]" />
          <h1 className="text-2xl font-bold text-text tracking-tight">Shoptimize Live</h1>
          <p className="text-sm text-textMute mt-1">{t('login.subtitle')}</p>
        </div>

        {/* Kart */}
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-2xl space-y-5">

          {/* Genel hata */}
          {error && (
            <div className="flex items-center gap-2 bg-roseSoft border border-rose/20 rounded-xl px-4 py-3 text-sm text-rose">
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Billing hatasÄ± */}
          {billingError && (
            <div className="bg-roseSoft border border-rose/20 rounded-xl px-4 py-3 space-y-2">
              <div className="flex items-start gap-2 text-sm text-rose">
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span>{billingError.message}</span>
              </div>
              {billingError.retry_url && (
                <a href={billingError.retry_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-semibold text-rose underline underline-offset-2 hover:opacity-80 transition-opacity">
                  <ExternalLink size={12} />
                  {t('login.billing_activate')}
                </a>
              )}
            </div>
          )}

          {/* Åifre ile giriÅ */}
          <div className="space-y-3">
            <Field label={t('login.username')} icon={User} value={username} onChange={setUsername}
              placeholder="you@yourstore.com" helpText={t('login.username_help')} />
            <Field label={t('login.password')} icon={Lock} type="password" value={password}
              onChange={setPassword} onKeyDown={onKey} />
          </div>

          <button onClick={handleSubmit} disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm
              bg-gradient-to-r from-green to-teal text-bg
              hover:brightness-105 active:brightness-95 transition-all
              disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green/20">
            {loading
              ? <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>{t('login.submitting')}</>
              : <><Zap size={15} /> {t('login.submit')}</>
            }
          </button>

          {/* ââ Shopify ile giriÅ ââ */}
          <Divider label="veya" />
          <AltAuth icon={ShoppingBag} title={t('login.shopify_title')} help={t('login.shopify_help')}>
            <div className="flex gap-2">
              <input
                value={shopDomain}
                onChange={e => setShopDomain(e.target.value)}
                onKeyDown={onShopKey}
                placeholder={t('login.shopify_placeholder')}
                className="flex-1 bg-surfaceAlt border border-border rounded-xl px-3 py-2.5 text-sm text-text placeholder:text-textMute
                  focus:outline-none focus:border-green/60 focus:ring-1 focus:ring-green/30 transition-colors"
              />
              <button onClick={handleShopifyLogin} disabled={shopLoading || !shopDomain.trim()}
                className="px-4 py-2.5 rounded-xl font-bold text-xs bg-surfaceAlt border border-border text-text
                  hover:border-green/50 hover:text-green transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                {shopLoading ? '...' : t('login.shopify_btn')}
              </button>
            </div>
          </AltAuth>

          {/* ââ WA ile eriÅim linki ââ */}
          <Divider label="veya" />
          <AltAuth icon={MessageCircle} title={t('login.wa_title')} help={t('login.wa_help')}>
            <div className="flex gap-2">
              <input
                value={waPhone}
                onChange={e => setWaPhone(e.target.value)}
                onKeyDown={onWaKey}
                placeholder={t('login.wa_placeholder')}
                className="flex-1 bg-surfaceAlt border border-border rounded-xl px-3 py-2.5 text-sm text-text placeholder:text-textMute
                  focus:outline-none focus:border-green/60 focus:ring-1 focus:ring-green/30 transition-colors"
              />
              <button onClick={handleWaSend} disabled={waLoading || !waPhone.trim()}
                className="px-4 py-2.5 rounded-xl font-bold text-xs bg-surfaceAlt border border-border text-text
                  hover:border-green/50 hover:text-green transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                {waLoading ? '...' : t('login.wa_btn')}
              </button>
            </div>
            {waStatusMsg && (
              <p className={`text-[11px] font-medium ${waStatusMsg.cls}`}>{waStatusMsg.text}</p>
            )}
          </AltAuth>

        </div>

        <p className="text-center text-[11px] text-textMute mt-5">
          <a href="/start" className="hover:text-text transition-colors">Kurulum Rehberi</a>
          {' Â· '}
          <a href="/privacy" className="hover:text-text transition-colors">Gizlilik</a>
        </p>

      </div>
    </div>
  );
}
