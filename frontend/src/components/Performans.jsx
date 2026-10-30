import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  BarChart2, Download, Table2, TrendingUp, TrendingDown, Minus, AlertCircle,
} from 'lucide-react';
import { useLang } from '../LangContext';

const API_URL = import.meta.env.VITE_API_URL || 'https://live.shoptimize.com.tr';

// Secilebilir donemler. "Bugun" de bir donem: tek gunluk pencere.
const DONEMLER = [
  { gun: 1,  anahtar: 'perf.period_today' },
  { gun: 7,  anahtar: 'perf.period_7' },
  { gun: 30, anahtar: 'perf.period_30' },
];

// Tek seri = tek renk. Uc trend grafigi ayni hue'yu paylasir: bunlar kucuk
// coklular (small multiples) - ayni kodlama, farkli olcu. Her birine ayri renk
// vermek, aralarinda olmayan bir kategorik iliski ima ederdi.
const SERI = 'var(--c-chartB)';


function paraFmt(n, lang) {
  const v = Number(n) || 0;
  return '₺' + v.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US',
    { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

function sayiFmt(n, lang) {
  return (Number(n) || 0).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US');
}

function kisaTarih(iso, lang) {
  const [y, a, g] = (iso || '').split('-');
  if (!g) return iso || '';
  const aylar = lang === 'tr'
    ? ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']
    : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${parseInt(g, 10)} ${aylar[parseInt(a, 10) - 1] || ''}`;
}

/** Yuzde degisim. Onceki 0 ise oran tanimsiz - "yeni" doneriz, %100 degil. */
function degisim(simdi, onceki) {
  const s = Number(simdi) || 0;
  const o = Number(onceki) || 0;
  if (!o) return s ? { tip: 'yeni' } : { tip: 'yok' };
  return { tip: 'oran', yuzde: ((s - o) / o) * 100 };
}


function Delta({ simdi, onceki, tersYon = false, t }) {
  const d = degisim(simdi, onceki);
  if (d.tip === 'yok') return null;
  if (d.tip === 'yeni') {
    return <span className="text-[10px] font-semibold text-textMute">{t('perf.delta_new')}</span>;
  }
  const yukari = d.yuzde > 0.5;
  const asagi  = d.yuzde < -0.5;
  // tersYon: "terk edilen sepet" gibi artisi KOTU olan olculer icin.
  const iyi = tersYon ? asagi : yukari;
  const Ikon = yukari ? TrendingUp : asagi ? TrendingDown : Minus;
  const renk = (!yukari && !asagi) ? 'text-textMute' : iyi ? 'text-green' : 'text-rose';
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${renk}`}>
      <Ikon size={10} aria-hidden="true" />
      {Math.abs(d.yuzde) >= 999 ? '999+' : Math.abs(d.yuzde).toFixed(0)}%
    </span>
  );
}


/** Hero sayi + onceki donemle fark. Grafik degil - tek bir deger icin
 *  grafik cizmek, okunmasi gereken sayiyi zorlastirmaktan baska ise yaramaz. */
function Kpi({ etiket, deger, onceki, para, tersYon, lang, t }) {
  return (
    <div className="bg-surface border border-border rounded-xl px-3.5 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-textMute">
        {etiket}
      </div>
      <div className="mt-1 flex items-baseline gap-2 flex-wrap">
        <span className="text-xl font-bold text-text tabular-nums">
          {para ? paraFmt(deger, lang) : sayiFmt(deger, lang)}
        </span>
        <Delta simdi={deger} onceki={onceki} tersYon={tersYon} t={t} />
      </div>
    </div>
  );
}


function Ipucu({ active, payload, label, lang, para }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface border border-borderStrong rounded-lg px-2.5 py-1.5 shadow-md">
      <div className="text-[10px] text-textMute">{label}</div>
      <div className="text-xs font-bold text-text tabular-nums">
        {para ? paraFmt(payload[0].value, lang) : sayiFmt(payload[0].value, lang)}
      </div>
    </div>
  );
}


/** Kucuk coklu: tek seri, tek renk, efsane yok (baslik zaten adini soyluyor). */
function Trend({ baslik, veri, alan, para, lang }) {
  const bos = !veri.some(g => g[alan]);
  return (
    <div className="bg-surface border border-border rounded-xl p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-textMute mb-1.5">
        {baslik}
      </div>
      <div style={{ height: 96 }}>
        {bos ? (
          <div className="h-full flex items-center justify-center text-[10px] text-textMute">—</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={veri} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`dolgu-${alan}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERI} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={SERI} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              {/* Izgara ve eksenler geri planda: veriyi degil, okumayi destekler */}
              <CartesianGrid stroke="var(--c-border)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="etiket" tick={{ fontSize: 9, fill: 'var(--c-textMute)' }}
                     axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={{ fontSize: 9, fill: 'var(--c-textMute)' }}
                     axisLine={false} tickLine={false} width={34}
                     tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : v} />
              <Tooltip content={<Ipucu lang={lang} para={para} />} cursor={{ stroke: 'var(--c-borderStrong)', strokeWidth: 1 }} />
              <Area type="monotone" dataKey={alan} stroke={SERI} strokeWidth={2}
                    fill={`url(#dolgu-${alan})`} dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--c-surface)' }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}


/** Yatay buyukluk karsilastirmasi. Tek olcu, tek renk: her satira ayri renk
 *  vermek kimlik degil siralama boyardi ve filtre degisince renkler kayardi. */
function YatayBarlar({ baslik, satirlar, lang, bosMetin, biriminiGoster }) {
  const enBuyuk = Math.max(1, ...satirlar.map(s => s.count));
  return (
    <div className="bg-surface border border-border rounded-xl p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-textMute mb-2">
        {baslik}
      </div>
      {!satirlar.length ? (
        <p className="text-[10px] text-textMute">{bosMetin}</p>
      ) : (
        <ul className="space-y-1.5">
          {satirlar.map(s => (
            <li key={s.key} className="flex items-center gap-2">
              <span className="text-[11px] text-textDim truncate flex-1 min-w-0" title={s.key}>
                {s.key}
              </span>
              <span className="h-2 rounded-r-[4px] shrink-0"
                    style={{
                      width: `${Math.max(2, (s.count / enBuyuk) * 100)}px`,
                      background: SERI,
                    }}
                    aria-hidden="true" />
              <span className="text-[11px] font-semibold text-text tabular-nums w-10 text-right shrink-0">
                {sayiFmt(s.count, lang)}{biriminiGoster ? '' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


/** Huni: sirali asamalar arasi gecis orani. Tek hue, asamalar arasinda
 *  donusum yuzdesi dogrudan yazili. */
function Huni({ toplam, lang, t }) {
  const asamalar = [
    { ad: t('perf.funnel_visitors'), deger: toplam.visitors },
    { ad: t('perf.funnel_product'),  deger: toplam.product_viewed },
    { ad: t('perf.funnel_cart'),     deger: toplam.add_to_cart },
    { ad: t('perf.funnel_checkout'), deger: toplam.checkout_started },
    { ad: t('perf.funnel_order'),    deger: toplam.checkout_completed },
  ];
  const tepe = Math.max(1, asamalar[0].deger);

  return (
    <div className="bg-surface border border-border rounded-xl p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-textMute mb-2">
        {t('perf.funnel')}
      </div>
      <ul className="space-y-1.5">
        {asamalar.map((a, i) => {
          const oncekiDeger = i ? asamalar[i - 1].deger : 0;
          const gecis = i && oncekiDeger ? (a.deger / oncekiDeger) * 100 : null;
          return (
            <li key={a.ad}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-textDim w-24 shrink-0 truncate">{a.ad}</span>
                <div className="flex-1 h-2.5 bg-surfaceAlt rounded-[4px] overflow-hidden min-w-0">
                  <div className="h-full rounded-r-[4px]"
                       style={{ width: `${Math.max(1, (a.deger / tepe) * 100)}%`, background: SERI }}
                       aria-hidden="true" />
                </div>
                <span className="text-[11px] font-semibold text-text tabular-nums w-12 text-right shrink-0">
                  {sayiFmt(a.deger, lang)}
                </span>
                <span className="text-[10px] text-textMute tabular-nums w-10 text-right shrink-0">
                  {gecis == null ? '' : `${gecis.toFixed(gecis < 10 ? 1 : 0)}%`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}


export default function Performans({ session }) {
  const { t, lang } = useLang();
  const [gun, setGun]         = useState(7);
  const [veri, setVeri]       = useState(null);
  const [yukleniyor, setYuk]  = useState(true);
  const [hata, setHata]       = useState('');
  const [tabloAcik, setTablo] = useState(false);

  const getir = useCallback(async () => {
    if (!session?.username) return;
    setYuk(true); setHata('');
    try {
      const qs = new URLSearchParams({
        username: session.username,
        brand: session.brand || 'default',
        days: String(gun),
      });
      const r = await fetch(`${API_URL}/api/live/stats/daily?${qs}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setVeri(await r.json());
    } catch (e) {
      setHata(String(e.message || e));
    } finally {
      setYuk(false);
    }
  }, [session?.username, session?.brand, session?.token, gun]);

  useEffect(() => { getir(); }, [getir]);
  // Secili donem bugunu iceriyor; sayaclar yaziliyorken tazele.
  useEffect(() => {
    const id = setInterval(getir, 120000);
    return () => clearInterval(id);
  }, [getir]);

  const toplam  = veri?.totals   || {};
  const onceki  = veri?.previous || {};

  // Grafikler icin eskiden yeniye. API en yeniden eskiye donuyor.
  const seri = useMemo(() => {
    if (!veri?.days) return [];
    return [...veri.days].reverse().map(g => ({
      ...g,
      etiket: kisaTarih(g.date, lang),
    }));
  }, [veri, lang]);

  const donusum = toplam.visitors
    ? (toplam.checkout_completed / toplam.visitors) * 100 : 0;
  const oncekiDonusum = onceki.visitors
    ? (onceki.checkout_completed / onceki.visitors) * 100 : 0;

  // Sayaclarin basladigi gun kismi: o gun gun ortasinda devreye girdi, bir
  // onceki gunlerle kiyaslanamaz. Soylemezsek merchant "dun cok dusukmus"
  // diye okur - duzeltmeye calistigimiz yanlis bilgilendirmenin aynisi.
  const kismiGun = veri?.since && seri.some(g => g.date === veri.since)
    ? veri.since : '';

  function csvIndir() {
    const basliklar = ['tarih', 'ziyaretci', 'olay', 'urun_goruntuleme',
                       'sepete_ekle', 'odeme_basladi', 'siparis', 'ciro'];
    const satirlar = seri.map(g => [
      g.date, g.visitors, g.events, g.product_viewed,
      g.add_to_cart, g.checkout_started, g.checkout_completed, g.revenue,
    ]);
    const csv = [basliklar, ...satirlar].map(r => r.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `shoptimize-performans-${gun}g.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (yukleniyor && !veri) {
    return <p className="text-xs text-textMute px-1 py-6">{t('perf.loading')}</p>;
  }
  if (hata) {
    return (
      <div className="bg-roseSoft border border-rose/30 rounded-xl px-3 py-2.5 flex items-start gap-2">
        <AlertCircle size={14} className="text-rose mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold text-text">{t('perf.error')}</p>
          <p className="text-[10px] text-textDim mt-0.5">{hata}</p>
          <button onClick={getir}
            className="mt-1.5 text-[10px] font-semibold text-blue hover:underline">
            {t('perf.retry')}
          </button>
        </div>
      </div>
    );
  }

  const hicVeriYok = !veri?.since;

  return (
    <div className="space-y-3">

      {/* Filtre satiri - grafiklerin USTUNDE, tek sirada */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-surfaceAlt border border-border rounded-lg p-0.5"
             role="group" aria-label={t('perf.period')}>
          {DONEMLER.map(d => (
            <button key={d.gun} onClick={() => setGun(d.gun)}
              aria-pressed={gun === d.gun}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                gun === d.gun ? 'bg-surface text-text shadow-sm' : 'text-textMute hover:text-text'}`}>
              {t(d.anahtar)}
            </button>
          ))}
        </div>

        <span className="text-[10px] text-textMute">{t('perf.vs_previous')}</span>

        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setTablo(v => !v)}
            aria-pressed={tabloAcik}
            aria-label={t('perf.table')}
            className="flex items-center gap-1 px-2 py-1 border border-border rounded-md text-[10px] font-semibold text-textDim hover:text-text transition-colors">
            <Table2 size={11} aria-hidden="true" /> {t('perf.table')}
          </button>
          <button onClick={csvIndir}
            aria-label={t('perf.csv')}
            className="flex items-center gap-1 px-2 py-1 border border-border rounded-md text-[10px] font-semibold text-textDim hover:text-text transition-colors">
            <Download size={11} aria-hidden="true" /> CSV
          </button>
        </div>
      </div>

      {hicVeriYok && (
        <div className="bg-amberSoft border border-amber/30 rounded-xl px-3 py-2.5 flex items-start gap-2">
          <AlertCircle size={14} className="text-amber mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[11px] text-textDim">{t('perf.no_counters')}</p>
        </div>
      )}

      {!hicVeriYok && kismiGun && (
        <p className="text-[10px] text-textMute px-0.5">
          {t('perf.partial_day').replace('{date}', kisaTarih(kismiGun, lang))}
        </p>
      )}

      {/* KPI satiri - HEPSI ayni donemden */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Kpi etiket={t('perf.visitors')} deger={toplam.visitors} onceki={onceki.visitors} lang={lang} t={t} />
        <Kpi etiket={t('perf.cart')} deger={toplam.add_to_cart} onceki={onceki.add_to_cart} lang={lang} t={t} />
        <Kpi etiket={t('perf.checkout')} deger={toplam.checkout_started} onceki={onceki.checkout_started} lang={lang} t={t} />
        <Kpi etiket={t('perf.orders')} deger={toplam.checkout_completed} onceki={onceki.checkout_completed} lang={lang} t={t} />
        <Kpi etiket={t('perf.revenue')} deger={toplam.revenue} onceki={onceki.revenue} para lang={lang} t={t} />
        <div className="bg-surface border border-border rounded-xl px-3.5 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-textMute">
            {t('perf.conversion')}
          </div>
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <span className="text-xl font-bold text-text tabular-nums">
              {donusum.toFixed(donusum < 10 ? 2 : 1)}%
            </span>
            <Delta simdi={donusum} onceki={oncekiDonusum} t={t} />
          </div>
        </div>
      </div>

      {/* Kucuk coklular: ayni kodlama, farkli olcu. Tek eksen kurali geregi
          ziyaretci ve ciro AYNI grafikte birlestirilmez - olcekleri farkli. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <Trend baslik={t('perf.visitors')} veri={seri} alan="visitors" lang={lang} />
        <Trend baslik={t('perf.orders')} veri={seri} alan="checkout_completed" lang={lang} />
        <Trend baslik={t('perf.revenue')} veri={seri} alan="revenue" para lang={lang} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 items-start">
        <Huni toplam={toplam} lang={lang} t={t} />
        <YatayBarlar baslik={t('perf.channels')} lang={lang}
          satirlar={(veri?.channels || []).slice(0, 8)}
          bosMetin={t('perf.no_channels')} />
        <YatayBarlar baslik={t('perf.products')} lang={lang}
          satirlar={(veri?.products || []).slice(0, 8)}
          bosMetin={t('perf.no_products')} />
      </div>

      {/* Tablo gorunumu - grafigi okuyamayan ya da kesin sayi isteyen icin */}
      {tabloAcik && (
        <div className="bg-surface border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-[11px]">
            <caption className="sr-only">{t('perf.table_caption')}</caption>
            <thead>
              <tr className="border-b border-border text-textMute">
                <th scope="col" className="text-left font-semibold px-3 py-2">{t('perf.date')}</th>
                <th scope="col" className="text-right font-semibold px-2 py-2">{t('perf.visitors')}</th>
                <th scope="col" className="text-right font-semibold px-2 py-2">{t('perf.cart')}</th>
                <th scope="col" className="text-right font-semibold px-2 py-2">{t('perf.checkout')}</th>
                <th scope="col" className="text-right font-semibold px-2 py-2">{t('perf.orders')}</th>
                <th scope="col" className="text-right font-semibold px-3 py-2">{t('perf.revenue')}</th>
              </tr>
            </thead>
            <tbody>
              {[...seri].reverse().map(g => (
                <tr key={g.date} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-1.5 text-textDim">
                    {g.date}
                    {!g.has_data && (
                      <span className="ml-1.5 text-[9px] text-textMute">{t('perf.no_data')}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-text">{sayiFmt(g.visitors, lang)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-text">{sayiFmt(g.add_to_cart, lang)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-text">{sayiFmt(g.checkout_started, lang)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-text">{sayiFmt(g.checkout_completed, lang)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-text">{paraFmt(g.revenue, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
