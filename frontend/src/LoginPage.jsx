import { useState } from 'react';
import { Zap, User, Lock, Tag, Hash, AlertCircle } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'https://live.shoptimize.com.tr';

function Field({ label, icon: Icon, type = 'text', value, onChange, placeholder, helpText, onKeyDown }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
          <Icon size={15} />
        </div>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete={type === 'password' ? 'current-password' : 'off'}
          className="w-full bg-[#161926] border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600
            focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
        />
      </div>
      {helpText && <p className="text-[11px] text-slate-600">{helpText}</p>}
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
      setError('Kullanıcı adı ve şifre gerekli');
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
        setError(data.detail || data.error || 'Giriş başarısız');
        return;
      }
      const tid = data.tid || manualTid.trim();
      if (!tid) {
        setError('Tracking ID bulunamadı — aşağıdaki TID alanını doldurun');
        return;
      }
      onLogin({ token: data.token, username: data.username, brand: data.brand, tid });
    } catch {
      setError('Sunucuya bağlanılamadı');
    } finally {
      setLoading(false);
    }
  }

  function onKey(e) { if (e.key === 'Enter') handleSubmit(); }

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'radial-gradient(ellipse at 60% 0%, #0d1a2e 0%, #0a0b10 60%)' }}>
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
              <Zap size={28} className="text-emerald-400" />
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-bold text-white">Shoptimize Live</h1>
              <p className="text-sm text-slate-500">Canlı mağaza aktivitesi</p>
            </div>
          </div>
        </div>

        {/* Card */}
        <div className="bg-[#0d0f18] border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-sm text-red-400">
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          <Field label="Kullanıcı Adı" icon={User} value={username} onChange={setUsername}
            placeholder="ornek@siteniz.com"
            helpText="OAuth kurulumunda kullanılan e-posta" />

          <Field label="Marka" icon={Tag} value={brand} onChange={setBrand}
            placeholder="default"
            helpText="Genellikle 'default'" />

          <Field label="Şifre" icon={Lock} type="password" value={password}
            onChange={setPassword} onKeyDown={onKey} />

          <Field label="Tracking ID (TID)" icon={Hash} value={manualTid} onChange={setManualTid}
            placeholder="koray@ornek.com_default_abc123…"
            helpText="Otomatik bulunmazsa girin — pixel URL'sindeki ?tid= değeri" />

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm
              bg-gradient-to-r from-emerald-600 to-teal-600 text-white
              hover:from-emerald-500 hover:to-teal-500 transition-all
              disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-900/30 mt-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Giriş yapılıyor...
              </>
            ) : (
              <><Zap size={15} /> Giriş Yap</>
            )}
          </button>
        </div>

        <p className="text-center text-[11px] text-slate-700 mt-4">
          TID örneği: koray@korayyildiz.com.tr_default_89f03476cdd41216
        </p>
      </div>
    </div>
  );
}
