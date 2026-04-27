// Atlas Tema Sistemi — Warm Dark (varsayılan)
// Token'lar sabit kalır, değerler tema ile değişir.

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

export function getTheme(vibe = 'warm', mode = 'dark') {
  const t = vibe === 'warm' ? WARM : WARM;
  return { vibe, mode, c: t[mode], fonts: t.fonts, radius: t.radius, shadow: t.shadow };
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

export const T = getTheme('warm', 'dark');
