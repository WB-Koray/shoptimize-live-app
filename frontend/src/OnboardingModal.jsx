import { useState } from 'react';
import { CheckCircle, MessageCircle, X } from 'lucide-react';
import { useLang } from './LangContext';

const API_URL = import.meta.env.VITE_API_URL || 'https://live.shoptimize.com.tr';

export default function OnboardingModal({ token, onClose }) {
  const { t } = useLang();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    if (!phone.trim()) { onClose(); return; }
    setLoading(true);
    try {
      await fetch(`${API_URL}/api/auth/owner-phone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      setSaved(true);
      setTimeout(onClose, 1800);
    } catch {
      onClose();
    } finally {
      setLoading(false);
    }
  }

  function onKey(e) { if (e.key === 'Enter') handleSave(); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-surface border border-border rounded-2xl shadow-2xl p-6 relative">
        <button onClick={onClose}
          className="absolute top-4 right-4 text-textMute hover:text-text transition-colors">
          <X size={16} />
        </button>

        {/* Icon */}
        <div className="w-12 h-12 rounded-2xl bg-greenSoft flex items-center justify-center mb-4">
          <CheckCircle size={24} className="text-green" />
        </div>

        <h2 className="text-lg font-bold text-text mb-2">{t('onboarding.title')}</h2>
        <p className="text-sm text-textMute mb-5">{t('onboarding.body')}</p>

        {saved ? (
          <p className="text-sm font-semibold text-green text-center py-3">{t('onboarding.saved')}</p>
        ) : (
          <>
            <div className="space-y-1.5 mb-4">
              <label className="text-xs font-semibold text-textDim uppercase tracking-wide flex items-center gap-1.5">
                <MessageCircle size={12} /> {t('onboarding.phone_label')}
              </label>
              <input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                onKeyDown={onKey}
                placeholder={t('onboarding.phone_placeholder')}
                className="w-full bg-surfaceAlt border border-border rounded-xl px-3 py-2.5 text-sm text-text placeholder:text-textMute
                  focus:outline-none focus:border-green/60 focus:ring-1 focus:ring-green/30 transition-colors"
              />
            </div>

            <div className="flex gap-2">
              <button onClick={handleSave} disabled={loading}
                className="flex-1 py-2.5 rounded-xl font-bold text-sm
                  bg-gradient-to-r from-[#5A7A3C] to-[#3E8D7A] text-text
                  hover:from-[#6A8A4C] hover:to-[#4E9D8A] transition-all
                  disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ boxShadow: '0 4px 12px rgba(90,122,60,0.2)' }}>
                {loading ? '...' : t('onboarding.save')}
              </button>
              <button onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-sm text-textMute hover:text-text border border-border
                  bg-surfaceAlt hover:border-border/80 transition-colors">
                {t('onboarding.skip')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
