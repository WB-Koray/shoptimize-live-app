import { createContext, useContext, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { getTheme, applyThemeToCSSVars } from './theme';

const ThemeCtx = createContext(null);

// Yeni kullanici icin isletim sisteminin tercihi. Uygulama Shopify Admin'in
// icinde iframe olarak calisiyor ve admin varsayilani acik tema; sabit 'dark'
// varsaymak merchant'i kendi ortamiyla celisen bir panele dusuruyordu.
function varsayilanMod() {
  const kayitli = localStorage.getItem('spt_mode');
  if (kayitli === 'light' || kayitli === 'dark') return kayitli;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(varsayilanMod);
  const theme = getTheme(mode);

  useEffect(() => {
    applyThemeToCSSVars(theme);
    localStorage.setItem('spt_mode', mode);
  }, [mode, theme]);

  // Kullanici elle secmediyse isletim sistemi tercihini izlemeye devam et.
  useEffect(() => {
    if (localStorage.getItem('spt_mode')) return;
    let mq;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const degisti = (e) => setMode(e.matches ? 'dark' : 'light');
    mq.addEventListener?.('change', degisti);
    return () => mq.removeEventListener?.('change', degisti);
  }, []);

  return (
    <ThemeCtx.Provider value={{ theme, mode, setMode }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be inside <ThemeProvider>');
  return ctx;
}

// Tek dugme: acik <-> koyu. Eskiden yedi dugme vardi (SLATE/WARM/BRUTAL +
// LIGHT/DARK); uc tema ailesi kaldirildigi icin geriye tek bir secim kaldi.
export function ThemeSwitch() {
  const { mode, setMode } = useTheme();
  const koyu = mode === 'dark';
  const etiket = koyu ? 'Açık temaya geç' : 'Koyu temaya geç';

  return (
    <button
      type="button"
      onClick={() => setMode(koyu ? 'light' : 'dark')}
      aria-label={etiket}
      title={etiket}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        border: '1px solid var(--c-border)',
        borderRadius: 'var(--r-sm)',
        background: 'transparent',
        color: 'var(--c-textDim)',
        cursor: 'pointer',
        transition: 'background 150ms, color 150ms',
      }}
    >
      {koyu ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}
