// Shoptimize Live - Tema Sistemi
// Tek tasarim dili (SLATE), iki mod: light + dark.
// Login ve dashboard ayni paleti kullanir, tek deneyim.

const SLATE = {
  light: {
    bg:'#F6F8FB', surface:'#FFFFFF', surfaceAlt:'#F1F5F9', surfaceSoft:'#FAFBFD',
    border:'#E5EAF1', borderStrong:'#CBD5E1',
    text:'#0F1A2A', textDim:'#51607A', textMute:'#8A97AB',
    accent:'#16A34A', accentSoft:'#E2F6E9',
    teal:'#0D9488', tealSoft:'#D9F2EF',
    green:'#16A34A', greenSoft:'#E2F6E9',
    amber:'#D97706', amberSoft:'#FBEBD2',
    blue:'#2563EB', blueSoft:'#DEE9FD',
    purple:'#9333EA', purpleSoft:'#EFE2FB',
    rose:'#E11D48', roseSoft:'#FBDDE4',
    chartA:'#16A34A', chartB:'#2563EB', chartC:'#9333EA', chartD:'#D97706',
  },
  dark: {
    bg:'#0B0F16', surface:'#131A24', surfaceAlt:'#1B232F', surfaceSoft:'#0F151D',
    border:'#232D3B', borderStrong:'#36465A',
    text:'#E8EDF4', textDim:'#94A3B8', textMute:'#5E6B7E',
    accent:'#22C55E', accentSoft:'#11271A',
    teal:'#14B8A6', tealSoft:'#0E2724',
    green:'#22C55E', greenSoft:'#11271A',
    amber:'#F59E0B', amberSoft:'#2A2110',
    blue:'#3B82F6', blueSoft:'#11203A',
    purple:'#A855F7', purpleSoft:'#1F1233',
    rose:'#F43F5E', roseSoft:'#2A0F18',
    chartA:'#22C55E', chartB:'#3B82F6', chartC:'#A855F7', chartD:'#F59E0B',
  },
  fonts: {
    display: "'Geist', system-ui, sans-serif",
    body:    "'Geist', 'Inter', system-ui, sans-serif",
    mono:    "'Geist Mono', ui-monospace, monospace",
  },
  radius: { sm:8, md:12, lg:16, xl:20 },
  shadow: {
    sm:'0 1px 2px rgba(2,6,12,0.30)',
    md:'0 6px 18px rgba(2,6,12,0.35)',
    lg:'0 20px 48px rgba(2,6,12,0.50)',
  },
};

// Tek tasarim dili, iki mod. WARM ve BRUTALIST kaldirildi: her yeni bilesenin
// 3 aile x 2 mod = 6 kombinasyonda calismasi gerekiyordu ve her ailenin ayri
// font/radius/golge olcegi vardi. Tutarliligi korumak isin kendisinden pahaliya
// geliyordu; kaldirilmalariyla Fraunces ve JetBrains Mono yuklemeleri de dustu.

export function getTheme(mode = 'light') {
  const c = SLATE[mode] || SLATE.light;
  return {
    mode,
    c,
    fonts: SLATE.fonts,
    radius: SLATE.radius,
    shadow: SLATE.shadow,
  };
}

export function swatch(theme, name) {
  const { c } = theme;
  const m = {
    teal:   { fg: c.teal,   bg: c.tealSoft   },
    green:  { fg: c.green,  bg: c.greenSoft  },
    amber:  { fg: c.amber,  bg: c.amberSoft  },
    blue:   { fg: c.blue,   bg: c.blueSoft   },
    purple: { fg: c.purple, bg: c.purpleSoft },
    rose:   { fg: c.rose,   bg: c.roseSoft   },
  };
  return m[name] || m.teal;
}

export function applyThemeToCSSVars(theme) {
  const r = document.documentElement;
  const { c, fonts, radius } = theme;
  Object.entries(c).forEach(([k, v]) => r.style.setProperty(`--c-${k}`, v));
  r.style.setProperty('--font-display', fonts.display);
  r.style.setProperty('--font-body',    fonts.body);
  r.style.setProperty('--font-mono',    fonts.mono);
  Object.entries(radius).forEach(([k, v]) => r.style.setProperty(`--r-${k}`, `${v}px`));
  r.dataset.mode = theme.mode;
}

export const T = getTheme('light');
