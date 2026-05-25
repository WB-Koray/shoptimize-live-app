import { useState } from 'react';
import { Zap, User, Lock, Tag, AlertCircle, ExternalLink, ShoppingBag, MessageCircle } from 'lucide-react';
import logo from './assets/1200 px icon logo.png';
import { useLang } from './LangContext';

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

export default function LoginPage({ onLogin }) {
  const { t } = useLang();

  // Password login
  const [username, setUsername] = useState('');
  const [brand, setBrand] = useState('default');
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

  // ── Password login ────────────────────────────────────────────────────────

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

  // ── Shopify re-auth ───────────────────────────────────────────────────────

  function handleShopifyLogin() {
    let shop = shopDomain.trim().toLowerCase();
    if (!shop) return;
    if (!shop.includes('.')) shop = `${shop}.myshopify.com`;
    setShopLoading(true);
    window.location.href = `${API_URL}/auth/shopify/reauth?shop=${encodeURIComponent(shop)}`;
  }

  function onShopKey(e) { if (e.key === 'Enter') handleShopifyLogin(); }

  // ── WA access link ────────────────────────────────────────────────────────

  async function handleWaSend() {
    if (!waPhone.trim()) return;
    setWaLoading(true);
    setWaStatus('');
    try {
      const res = await fetch(`${API_URL}/api/auth/request-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: waPhone.trim() }),
      });
      if (res.status === 503) { setWaStatus('unavailable'); return; }
      const data = await res.json();
      if (!data.ok) { setWaStatus('error'); return; }
      setWaStatus(data.sent ? 'sent' : 'not_found');
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
    unavailable: { text: t('login.wa_unavailable'), cls: 'text-textMute' },
    error:       { text: t('login.err.server'),     cls: 'text-rose' },
  }[waStatus];

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <img src={logo} alt="Shoptimize Live" className="w-16 h-16 mx-auto mb-4 rounded-2xl object-contain" />
          <h1 className="text-2xl font-bold text-text">Shoptimize Live</h1>
          <p className="text-sm text-textMute mt-1">{t('login.subtitle')}</p>
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-2xl space-y-4">

          {/* Genel hata */}
          {error && (
            <div className="flex items-center gap-2 bg-roseSoft border border-rose/20 rounded-xl px-4 py-3 text-sm text-rose">
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Billing hatası */}
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

          {/* Şifre ile giriş */}
          <Field label={t('login.username')} icon={User} value={username} onChange={setUsername}
            placeholder="you@yourstore.com" helpText={t('login.username_help')} />
          <Field label={t('login.brand')} icon={Tag} value={brand} onChange={setBrand}
            placeholder="default" helpText={t('login.brand_help')} />
          <Field label={t('login.password')} icon={Lock} type="password" value={password}
            onChange={setPassword} onKeyDown={onKey} />

          <button onClick={handleSubmit} disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm
              bg-gradient-to-r from-[#5A7A3C] to-[#3E8D7A] text-text
              hover:from-[#6A8A4C] hover:to-[#4E9D8A] transition-all
              disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            style={{ boxShadow: '0 4px 16px rgba(90,122,60,0.25)' }}>
            {loading
              ? <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>{t('login.submitting')}</>
              : <><Zap size={15} /> {t('login.submit')}</>
            }
          </button>

          {/* ── Shopify ile giriş ── */}
          <Divider label="veya" />

          <div className="space-y-2">
            <p className="text-xs font-semibold text-textDim uppercase tracking-wide flex items-center gap-1.5">
              <ShoppingBag size={13} /> {t('login.shopify_title')}
            </p>
            <p className="text-[11px] text-textMute">{t('login.shopify_help')}</p>
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
          </div>

          {/* ── WA ile erişim linki ── */}
          <Divider label="veya" />

          <div className="space-y-2">
            <p className="text-xs font-semibold text-textDim uppercase tracking-wide flex items-center gap-1.5">
              <MessageCircle size={13} /> {t('login.wa_title')}
            </p>
            <p className="text-[11px] text-textMute">{t('login.wa_help')}</p>
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
          </div>

        </div>

        <p className="text-center text-[11px] text-textMute mt-4">
          <a href="/start" className="hover:text-text transition-colors">Kurulum Rehberi</a>
          {' · '}
          <a href="/privacy" className="hover:text-text transition-colors">Gizlilik</a>
        </p>

      </div>
    </div>
  );
}
