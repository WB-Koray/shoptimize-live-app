// Shoptimize Live â Tema Sistemi
// SLATE (varsayÄ±lan, temiz modern SaaS) + WARM + BRUTALIST â her biri light + dark
// frontend/src/theme.js ile birebir deÄiÅtirilebilir (drop-in).
// SLATE, Dashboard UI Kit ile aynÄ± paleti kullanÄ±r: login ve dashboard tek deneyim.

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

const WARM = {
  light: {
    bg:'#F4EFE6', surface:'#FBF8F2', surfaceAlt:'#EBE3D3', surfaceSoft:'#F8F3E8',
    border:'#E0D6C2', borderStrong:'#3A2E20',
    text:'#2B2218', textDim:'#6B5D4C', textMute:'#9A8C78',
    accent:'#C96F3C', accentSoft:'#F5E5D6',
    teal:'#3E8D7A', tealSoft:'#D8ECE5',
    green:'#5A7A3C', greenSoft:'#E1E8D2',
    amber:'#C49A3C', amberSoft:'#F3E5C2',
    blue:'#5A7A9E', blueSoft:'#DCE3EC',
    purple:'#8A6FA8', purpleSoft:'#E8DFED',
    rose:'#B0526A', roseSoft:'#EEDADE',
    chartA:'#C96F3C', chartB:'#5A7A3C', chartC:'#6B8AA8', chartD:'#8A6B4E',
  },
  dark: {
    bg:'#1F1A14', surface:'#2A231B', surfaceAlt:'#362D22', surfaceSoft:'#24201A',
    border:'#403628', borderStrong:'#F4EFE6',
    text:'#F4EFE6', textDim:'#B8AD9A', textMute:'#7A705F',
    accent:'#E8925F', accentSoft:'#3A2A1E',
    teal:'#6DC4B0', tealSoft:'#1F2E2A',
    green:'#9BBA7A', greenSoft:'#24301D',
    amber:'#E0BA70', amberSoft:'#332815',
    blue:'#8FAECB', blueSoft:'#1F2A36',
    purple:'#C4A5D4', purpleSoft:'#2C2336',
    rose:'#DB8898', roseSoft:'#332027',
    chartA:'#E8925F', chartB:'#9BBA7A', chartC:'#8FAECB', chartD:'#C4A485',
  },
  fonts: {
    display: "'Fraunces', 'Newsreader', Georgia, serif",
    body:    "'Geist', 'Inter', system-ui, sans-serif",
    mono:    "'Geist Mono', ui-monospace, monospace",
  },
  radius: { sm:6, md:10, lg:14, xl:20 },
  shadow: {
    sm:'0 1px 2px rgba(43,34,24,0.06)',
    md:'0 4px 12px rgba(43,34,24,0.08)',
    lg:'0 16px 40px rgba(43,34,24,0.12)',
  },
};

const BRUTALIST = {
  light: {
    bg:'#FAFAF7', surface:'#FFFFFF', surfaceAlt:'#F0F0EA', surfaceSoft:'#FFFFFF',
    border:'#000000', borderStrong:'#000000',
    text:'#000000', textDim:'#3A3A3A', textMute:'#7A7A7A',
    accent:'#FF4500', accentSoft:'#FFE8DD',
    teal:'#0A7F6B', tealSoft:'#D0EBE5',
    green:'#0A7D3E', greenSoft:'#D3EBD9',
    amber:'#C48800', amberSoft:'#F5E6C0',
    blue:'#0048C9', blueSoft:'#D6E1F5',
    purple:'#5B2E9E', purpleSoft:'#E4DAF1',
    rose:'#C41E3A', roseSoft:'#F5D5DB',
    chartA:'#000000', chartB:'#FF4500', chartC:'#0A7D3E', chartD:'#5B2E9E',
  },
  dark: {
    bg:'#0A0A0A', surface:'#121212', surfaceAlt:'#1A1A1A', surfaceSoft:'#0A0A0A',
    border:'#FFFFFF', borderStrong:'#FFFFFF',
    text:'#FFFFFF', textDim:'#C0C0C0', textMute:'#808080',
    accent:'#FF6B35', accentSoft:'#2A1810',
    teal:'#3EDAC4', tealSoft:'#0F2A26',
    green:'#3EE87A', greenSoft:'#0F2A18',
    amber:'#FFCC33', amberSoft:'#2A2110',
    blue:'#5B9DFF', blueSoft:'#0F1A2A',
    purple:'#C88FFF', purpleSoft:'#1F1230',
    rose:'#FF5A7A', roseSoft:'#2A0F18',
    chartA:'#FFFFFF', chartB:'#FF6B35', chartC:'#3EE87A', chartD:'#C88FFF',
  },
  fonts: {
    display: "'JetBrains Mono', ui-monospace, monospace",
    body:    "'JetBrains Mono', ui-monospace, monospace",
    mono:    "'JetBrains Mono', ui-monospace, monospace",
  },
  radius: { sm:0, md:0, lg:0, xl:0 },
  shadow: {
    sm:'2px 2px 0 currentColor',
    md:'4px 4px 0 currentColor',
    lg:'6px 6px 0 currentColor',
  },
};

const THEMES = { slate: SLATE, warm: WARM, brutalist: BRUTALIST };

export function getTheme(vibe = 'slate', mode = 'dark') {
  const t = THEMES[vibe] || SLATE;
  return {
    vibe, mode,
    c: t[mode] || t.dark,
    fonts: t.fonts,
    radius: t.radius,
    shadow: t.shadow,
    isBrutal: vibe === 'brutalist',
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
  r.dataset.vibe = theme.vibe;
  r.dataset.mode = theme.mode;
}

export const T = getTheme('slate', 'dark');
