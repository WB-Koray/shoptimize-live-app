import { createContext, useContext, useState } from 'react';
import translations from './i18n';

const LangCtx = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('spt_lang') || 'en');

  function toggleLang() {
    const next = lang === 'en' ? 'tr' : 'en';
    localStorage.setItem('spt_lang', next);
    setLang(next);
  }

  function t(key) {
    return translations[lang]?.[key] ?? translations['en']?.[key] ?? key;
  }

  return (
    <LangCtx.Provider value={{ lang, toggleLang, t }}>
      {children}
    </LangCtx.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LangCtx);
  if (!ctx) throw new Error('useLang must be inside <LangProvider>');
  return ctx;
}

export function LangSwitch() {
  const { lang, toggleLang } = useLang();
  const base = {
    padding: '3px 8px',
    fontSize: 10,
    fontWeight: 700,
    border: '1px solid var(--c-border)',
    background: 'transparent',
    color: 'var(--c-textDim)',
    borderRadius: 'var(--r-sm)',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.04em',
    transition: 'background 150ms, color 150ms',
  };
  const active = { ...base, background: 'var(--c-text)', color: 'var(--c-bg)' };

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <button style={lang === 'en' ? active : base} onClick={() => lang !== 'en' && toggleLang()}>EN</button>
      <button style={lang === 'tr' ? active : base} onClick={() => lang !== 'tr' && toggleLang()}>TR</button>
    </div>
  );
}
