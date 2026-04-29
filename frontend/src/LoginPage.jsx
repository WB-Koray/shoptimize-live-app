import { useState } from 'react';
import { Zap, User, Lock, Tag, Hash, AlertCircle } from 'lucide-react';

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

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [brand, setBrand] = useState('default');
  const [password, setPassword] = useState('');
  const [manualTid, setManualTid] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), brand: brand.trim() || 'default', password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.detail || data.error || 'Login failed');
        return;
      }
      const tid = data.tid || manualTid.trim();
      if (!tid) {
        setError('Tracking ID not found — please fill in the TID field below');
        return;
      }
      onLogin({ token: data.token, username: data.username, brand: data.brand, tid });
    } catch {
      setError('Could not connect to server');
    } finally {
      setLoading(false);
    }
  }

  function onKey(e) { if (e.key === 'Enter') handleSubmit(); }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="p-3 rounded-2xl bg-greenSoft border border-green/30">
              <Zap size={28} className="text-green" />
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-bold text-text">Shoptimize Live</h1>
              <p className="text-sm text-textMute">Real-time store activity</p>
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-2xl p-6 shadow-2xl space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-roseSoft border border-rose/20 rounded-xl px-4 py-3 text-sm text-rose">
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          <Field label="Username" icon={User} value={username} onChange={setUsername}
            placeholder="you@yourstore.com"
            helpText="Email used during OAuth installation" />

          <Field label="Brand" icon={Tag} value={brand} onChange={setBrand}
            placeholder="default"
            helpText="Usually 'default'" />

          <Field label="Password" icon={Lock} type="password" value={password}
            onChange={setPassword} onKeyDown={onKey} />

          <Field label="Tracking ID (TID)" icon={Hash} value={manualTid} onChange={setManualTid}
            placeholder="you@yourstore.com_default_abc123…"
            helpText="Enter manually if not found automatically — the ?tid= value from the pixel URL" />

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm
              bg-gradient-to-r from-[#5A7A3C] to-[#3E8D7A] text-text
              hover:from-[#6A8A4C] hover:to-[#4E9D8A] transition-all
              disabled:opacity-50 disabled:cursor-not-allowed shadow-lg mt-2"
            style={{ boxShadow: '0 4px 16px rgba(90,122,60,0.25)' }}
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Logging in...
              </>
            ) : (
              <><Zap size={15} /> Log In</>
            )}
          </button>
        </div>

        <p className="text-center text-[11px] text-textMute mt-4">
          TID example: you@yourstore.com_default_89f03476cdd41216
        </p>
      </div>
    </div>
  );
}
