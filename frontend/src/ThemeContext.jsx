import { createContext, useContext, useEffect, useState } from 'react';
import { getTheme, applyThemeToCSSVars } from './theme';

const ThemeCtx = createContext(null);

export function ThemeProvider({ children }) {
  const [vibe, setVibe] = useState(() => localStorage.getItem('spt_vibe') || 'warm');
  const [mode, setMode] = useState(() => localStorage.getItem('spt_mode') || 'dark');
  const theme = getTheme(vibe, mode);

  useEffect(() => {
    applyThemeToCSSVars(theme);
    localStorage.setItem('spt_vibe', vibe);
    localStorage.setItem('spt_mode', mode);
  }, [vibe, mode]);

  return (
    <ThemeCtx.Provider value={{ theme, vibe, mode, setVibe, setMode }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be inside <ThemeProvider>');
  return ctx;
}

export function ThemeSwitch() {
  const { vibe, mode, setVibe, setMode } = useTheme();
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
      <button style={vibe === 'warm'      ? active : base} onClick={() => setVibe('warm')}>WARM</button>
      <button style={vibe === 'brutalist' ? active : base} onClick={() => setVibe('brutalist')}>BRUTAL</button>
      <span style={{ width: 1, height: 14, background: 'var(--c-border)', margin: '0 2px' }} />
      <button style={mode === 'light' ? active : base} onClick={() => setMode('light')}>LIGHT</button>
      <button style={mode === 'dark'  ? active : base} onClick={() => setMode('dark')}>DARK</button>
    </div>
  );
}
